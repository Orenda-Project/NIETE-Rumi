'use strict';
/**
 * Two calls the daily job makes (web-quiz-challenge-sweeper.js dailyJob), once per PKT day under its day claim:
 *   - `web_quiz.sample_window{arm, unit:'class', cls, opens_at, closes_at, w:'s'}` for every drawn class whose window
 *     opens that PKT day: the round window (arm 'class_round', window_start/window_end) and the week window (arm
 *     'class_week', week_start/week_end, only when set), read from class_round_draws. The daily job is the event's one
 *     writer. Built with the keyed-id module's envelope + cls(class_id): a raw class id never rides the event. Under
 *     web_quiz_class_round (its parents web_quiz_challenge_v2 and web_quiz_challenge) and, as a v2 event, events v2.
 *   - on the first PKT day of a month, the calibration job's runMonthly({ period_id: the month just ended, now }).
 *     That module carries its own switches; the daily job only schedules it.
 * Faked boundaries only: Supabase (the in-memory fake), the logger, the event transport, Redis. The keyed-id module and
 * the calibration module are mocked (absent in a fresh registry); the binding expiry is not on the base yet: a VIRTUAL mock.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('../../../shared/storage/r2', () => ({ deleteKey: jest.fn(async () => true), listKeys: jest.fn(async () => []), getPresignedUploadUrl: jest.fn() }));
jest.mock('../../../shared/services/cache/railway-redis.service', () => ({ isAvailable: jest.fn(() => false), scanValues: jest.fn(async () => null) }));
// global.__absent names the module a fresh registry must not find (the module not deployed)
jest.mock('../../../shared/services/quiz/web-quiz-kid', () => {
  if (global.__absent === 'web-quiz-kid') throw new Error("Cannot find module './web-quiz-kid'");
  return {
    envelope: jest.fn((f = {}) => ({ w: 's', ev_v: 2, kid_v: '2026', kid: null, ...f })),
    cls: jest.fn((id) => (id ? `c1a55${String(id).replace(/-/g, '').slice(-7)}` : null)),
  };
});
jest.mock('../../../shared/services/quiz/web-quiz-challenge-calibration', () => {
  if (global.__absent === 'web-quiz-challenge-calibration') throw new Error("Cannot find module './web-quiz-challenge-calibration'");
  return { runMonthly: jest.fn(async () => ({ ran: false, reason: 'off' })) };
});
jest.mock('../../../shared/services/quiz/web-quiz-bind-expiry', () => { throw new Error("Cannot find module './web-quiz-bind-expiry'"); }, { virtual: true });
jest.mock('openchemlib', () => require('../../../../tests/__mocks__/openchemlib.js'));

const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const { logEvent } = require('../../../shared/utils/structured-logger');
const { logToFile, logError } = require('../../../shared/utils/logger');
const Kid = require('../../../shared/services/quiz/web-quiz-kid');
// read at call time: the sweeper requires it lazily, so after a registry reset the test and the job share the fresh one
const cal = () => require('../../../shared/services/quiz/web-quiz-challenge-calibration');
const S = require('../../../shared/services/quiz/web-quiz-challenge-sweeper');

const HOUR = 60 * 60 * 1000;
const NOW = Date.parse('2026-10-15T00:30:00Z');            // Thursday 15 Oct, 05:30 PKT
const ON = (key) => ({ key, value: true });
const ROUND_ON = () => [ON('web_quiz_challenge'), ON('web_quiz_challenge_v2'), ON('web_quiz_class_round'), ON('web_quiz_hub'), ON('web_quiz_events_v2')];
const C1 = '11111111-1111-4111-8111-111111111111';
const C2 = '22222222-2222-4222-8222-222222222222';
const C3 = '33333333-3333-4333-8333-333333333333';
const C4 = '44444444-4444-4444-8444-444444444444';
const draw = (class_id, extra) => ({
  id: `d-${class_id.slice(0, 4)}`, round: `${class_id.slice(0, 1).repeat(16)}`, term_code: '2026-27a', class_id, stratum: 'urban|G23',
  N_h: 40, n_h: 4, p_incl: 0.1, window_start: '2026-10-01T03:00:00Z', window_end: '2026-10-08T18:59:59Z',
  order_arm: 'round_first', week_start: null, week_end: null, roster_k: 30, ...extra,
});
const draws = () => [
  // the round window opens today (15 Oct PKT, 08:00 PKT)
  draw(C1, { window_start: '2026-10-15T03:00:00Z', window_end: '2026-10-22T18:59:59Z' }),
  // the week window opens today (00:00 PKT is 14 Oct 19:00Z); its round window opened earlier
  draw(C2, { order_arm: 'week_first', window_start: '2026-10-05T03:00:00Z', window_end: '2026-10-12T18:59:59Z', week_start: '2026-10-14T19:00:00Z', week_end: '2026-10-21T18:59:59Z' }),
  // opened yesterday (PKT) and opens tomorrow (PKT): not today
  draw(C3, { window_start: '2026-10-14T18:59:59Z', window_end: '2026-10-20T18:59:59Z' }),
  draw(C4, { window_start: '2026-10-15T19:00:00Z', window_end: '2026-10-22T18:59:59Z', week_start: '2026-10-15T19:00:00Z', week_end: '2026-10-22T18:59:59Z' }),
];

let db;
let fake;
const install = (settings, extra = {}) => {
  db = { app_settings: settings, web_quiz_challenge_runs: [], web_quiz_strip_weekly: [], class_round_draws: draws(), ...extra };
  fake = makeFake(db, { uniques: { web_quiz_strip_weekly: ['week', 'line', 'cell'] } });
  Object.assign(supabase, fake);
};
const windows = () => logEvent.mock.calls.filter((c) => c[0] === 'web_quiz.sample_window').map((c) => c[1]);

afterEach(() => { jest.clearAllMocks(); });

describe('sample_window at window open (the one writer)', () => {
  test('one event per drawn class whose round or week window opens today (PKT), keyed cls, no raw class id', async () => {
    install(ROUND_ON());
    await S.dailyJob({ now: NOW });
    expect(windows()).toEqual([
      { w: 's', ev_v: 2, kid_v: '2026', kid: null, arm: 'class_round', unit: 'class', cls: Kid.cls(C1), opens_at: '2026-10-15T03:00:00.000Z', closes_at: '2026-10-22T18:59:59.000Z' },
      { w: 's', ev_v: 2, kid_v: '2026', kid: null, arm: 'class_week', unit: 'class', cls: Kid.cls(C2), opens_at: '2026-10-14T19:00:00.000Z', closes_at: '2026-10-21T18:59:59.000Z' },
    ]);
    expect(Kid.envelope).toHaveBeenCalledTimes(2);
    const all = JSON.stringify(logEvent.mock.calls);
    for (const id of [C1, C2, C3, C4]) expect(all).not.toContain(id);
  });

  test('once per class per window: the day claim stops a second run the same PKT day', async () => {
    install(ROUND_ON());
    await S.dailyJob({ now: NOW });
    await S.dailyJob({ now: NOW + 3 * HOUR });
    await S.tick({ now: NOW + 4 * HOUR });
    expect(windows()).toHaveLength(2);
  });

  test('web_quiz_class_round off (or its parent web_quiz_challenge_v2 off): no draws read, no event', async () => {
    install([ON('web_quiz_challenge'), ON('web_quiz_challenge_v2'), ON('web_quiz_challenge_sweeper'), ON('web_quiz_hub'), ON('web_quiz_events_v2')]);
    await S.dailyJob({ now: NOW });
    install([ON('web_quiz_challenge'), ON('web_quiz_class_round'), ON('web_quiz_challenge_sweeper'), ON('web_quiz_hub'), ON('web_quiz_events_v2')]);
    await S.dailyJob({ now: NOW });
    expect(fake.calls.filter((c) => c.table === 'class_round_draws')).toEqual([]);
    expect(windows()).toEqual([]);
  });

  test('events v2 off: a v2 event is not written (no draws read)', async () => {
    install([ON('web_quiz_challenge'), ON('web_quiz_challenge_v2'), ON('web_quiz_class_round')]);
    await S.dailyJob({ now: NOW });
    expect(fake.calls.filter((c) => c.table === 'class_round_draws')).toEqual([]);
    expect(windows()).toEqual([]);
  });

  test('class_round_draws not there yet: skipped with one log line, the job goes on', async () => {
    install(ROUND_ON());
    const realFrom = supabase.from;
    supabase.from = (t) => (t === 'class_round_draws'
      ? { select: () => { const q = { gte: () => q, lt: async () => ({ data: null, error: { code: '42P01', message: 'relation "class_round_draws" does not exist' } }) }; return q; } }
      : realFrom(t));
    const out = await S.dailyJob({ now: NOW });
    expect(out).toMatchObject({ ran: true });
    expect(windows()).toEqual([]);
    expect(logToFile.mock.calls.filter((c) => /sample_window/.test(c[0]))).toHaveLength(1);
  });

  test('the keyed-id module absent: no event (never a raw class id), one log line', async () => {
    global.__absent = 'web-quiz-kid';
    jest.resetModules();
    try {
      const sb = require('../../../shared/config/supabase');
      const lg = require('../../../shared/utils/logger');
      const sl = require('../../../shared/utils/structured-logger');
      const S2 = require('../../../shared/services/quiz/web-quiz-challenge-sweeper');
      db = { app_settings: ROUND_ON(), web_quiz_challenge_runs: [], web_quiz_strip_weekly: [], class_round_draws: draws() };
      Object.assign(sb, makeFake(db, { uniques: { web_quiz_strip_weekly: ['week', 'line', 'cell'] } }));
      await S2.dailyJob({ now: NOW });
      expect(sl.logEvent.mock.calls.filter((c) => c[0] === 'web_quiz.sample_window')).toEqual([]);
      expect(lg.logToFile.mock.calls.filter((c) => /sample_window/.test(c[0]))).toHaveLength(1);
    } finally { delete global.__absent; jest.resetModules(); }
  });
});

describe('the monthly calibration call', () => {
  const PURGE = () => [ON('web_quiz_challenge'), ON('web_quiz_challenge_audio_purge')];

  test('the 1st PKT day of a month: runMonthly once with the month just ended', async () => {
    const first = Date.parse('2026-10-31T19:30:00Z');       // 1 Nov 00:30 PKT
    install(PURGE());
    await S.dailyJob({ now: first });
    expect(cal().runMonthly).toHaveBeenCalledTimes(1);
    expect(cal().runMonthly.mock.calls[0][0]).toEqual({ period_id: '2026-10', now: new Date(first) });
  });

  test('every switch of ours off: still called on the 1st (the call is ours, the switch is the calibration job\'s own)', async () => {
    install([]);
    const out = await S.dailyJob({ now: Date.parse('2026-11-01T06:00:00Z') });
    expect(cal().runMonthly).toHaveBeenCalledTimes(1);
    expect(out).toMatchObject({ ran: true, purged: null, strip: null, windows: null });
    install([]);
    await expect(S.dailyJob({ now: NOW })).resolves.toEqual({ ran: false, reason: 'off' });   // any other day: nothing
    expect(cal().runMonthly).toHaveBeenCalledTimes(1);
  });

  test('January 1st calls December of the year before', async () => {
    install(PURGE());
    await S.dailyJob({ now: Date.parse('2027-01-01T06:00:00Z') });
    expect(cal().runMonthly.mock.calls[0][0]).toMatchObject({ period_id: '2026-12' });
  });

  test('any other day: not called (31 Oct 23:30 PKT is still October)', async () => {
    install(PURGE());
    await S.dailyJob({ now: Date.parse('2026-10-31T18:30:00Z') });
    install(PURGE());
    await S.dailyJob({ now: NOW });
    expect(cal().runMonthly).not.toHaveBeenCalled();
  });

  test('a throwing calibration job is logged and never breaks the daily job', async () => {
    cal().runMonthly.mockImplementationOnce(async () => { throw new Error('boom'); });
    install(PURGE());
    const out = await S.dailyJob({ now: Date.parse('2026-11-01T06:00:00Z') });
    expect(out).toMatchObject({ ran: true });
    expect(logError).toHaveBeenCalledWith('web_quiz.ch_calibration_call_failed', expect.any(Object));
  });

  test('the calibration module absent: a no-op', async () => {
    global.__absent = 'web-quiz-challenge-calibration';
    jest.resetModules();
    try {
      const sb = require('../../../shared/config/supabase');
      const S2 = require('../../../shared/services/quiz/web-quiz-challenge-sweeper');
      db = { app_settings: PURGE(), web_quiz_challenge_runs: [], web_quiz_strip_weekly: [] };
      Object.assign(sb, makeFake(db, { uniques: { web_quiz_strip_weekly: ['week', 'line', 'cell'] } }));
      await expect(S2.dailyJob({ now: Date.parse('2026-11-01T06:00:00Z') })).resolves.toMatchObject({ ran: true });
    } finally { delete global.__absent; jest.resetModules(); }
    expect(cal().runMonthly).not.toHaveBeenCalled();
  });
});
