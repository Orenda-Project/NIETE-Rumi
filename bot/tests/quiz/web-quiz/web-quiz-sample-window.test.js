'use strict';
/**
 * The class sample windows (web-quiz-sample-window.js daily): `web_quiz.sample_window{arm, unit:'class', cls,
 * opens_at, closes_at, w:'s'}` for every drawn class whose window opens that PKT day: the round window (arm
 * 'class_round', window_start/window_end) and the week window (arm 'class_week', week_start/week_end, only when set),
 * read from class_round_draws. Built with the keyed-id module's envelope + cls(class_id): a raw class id never rides
 * the event. Under web_quiz_class_round (its parents web_quiz_challenge_v2 and web_quiz_challenge) and, as a v2
 * event, web_quiz_events_v2 (under web_quiz_hub). Once a day is the caller's (the Challenge daily job's day claim).
 * Faked boundaries only: Supabase (the in-memory fake), the logger, the event transport. The keyed-id module is
 * mocked so the cls values are fixed (absent in a fresh registry).
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
// global.__absent names the module a fresh registry must not find (the module not deployed)
jest.mock('../../../shared/services/quiz/web-quiz-kid', () => {
  if (global.__absent === 'web-quiz-kid') throw new Error("Cannot find module './web-quiz-kid'");
  return {
    envelope: jest.fn((f = {}) => ({ w: 's', ev_v: 2, kid_v: '2026', kid: null, ...f })),
    cls: jest.fn((id) => (id ? `c1a55${String(id).replace(/-/g, '').slice(-7)}` : null)),
  };
});

const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const { logEvent } = require('../../../shared/utils/structured-logger');
const { logToFile } = require('../../../shared/utils/logger');
const Kid = require('../../../shared/services/quiz/web-quiz-kid');
const SW = require('../../../shared/services/quiz/web-quiz-sample-window');

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
const install = (settings) => {
  db = { app_settings: settings, class_round_draws: draws() };
  fake = makeFake(db);
  Object.assign(supabase, fake);
};
const windows = () => logEvent.mock.calls.filter((c) => c[0] === 'web_quiz.sample_window').map((c) => c[1]);
const drawReads = () => fake.calls.filter((c) => c.table === 'class_round_draws');

afterEach(() => { jest.clearAllMocks(); });

test('one event per drawn class whose round or week window opens today (PKT), keyed cls, no raw class id', async () => {
  install(ROUND_ON());
  await expect(SW.daily({ now: NOW })).resolves.toBe(2);
  expect(windows()).toEqual([
    { w: 's', ev_v: 2, kid_v: '2026', kid: null, arm: 'class_round', unit: 'class', cls: Kid.cls(C1), opens_at: '2026-10-15T03:00:00.000Z', closes_at: '2026-10-22T18:59:59.000Z' },
    { w: 's', ev_v: 2, kid_v: '2026', kid: null, arm: 'class_week', unit: 'class', cls: Kid.cls(C2), opens_at: '2026-10-14T19:00:00.000Z', closes_at: '2026-10-21T18:59:59.000Z' },
  ]);
  expect(Kid.envelope).toHaveBeenCalledTimes(2);
  const all = JSON.stringify(logEvent.mock.calls);
  for (const id of [C1, C2, C3, C4]) expect(all).not.toContain(id);
});

test('web_quiz_class_round off (or its parent web_quiz_challenge_v2 off, or web_quiz_challenge off): no draws read, no event', async () => {
  for (const off of ['web_quiz_class_round', 'web_quiz_challenge_v2', 'web_quiz_challenge']) {
    install(ROUND_ON().filter((s) => s.key !== off));
    await expect(SW.daily({ now: NOW })).resolves.toBeNull();
    expect(drawReads()).toEqual([]);
  }
  expect(windows()).toEqual([]);
});

test('events v2 off (or its parent web_quiz_hub off): a v2 event is not written (no draws read)', async () => {
  for (const off of ['web_quiz_events_v2', 'web_quiz_hub']) {
    install(ROUND_ON().filter((s) => s.key !== off));
    await SW.daily({ now: NOW });
    expect(drawReads()).toEqual([]);
  }
  expect(windows()).toEqual([]);
});

test('golden: every switch off: the switches read only, nothing else, no event, no log', async () => {
  install([]);
  await expect(SW.daily({ now: NOW })).resolves.toBeNull();
  expect(fake.calls.filter((c) => c.table !== 'app_settings')).toEqual([]);
  expect(logEvent).not.toHaveBeenCalled();
  expect(logToFile).not.toHaveBeenCalled();
});

test('a failed settings read is off (fails closed) and never throws', async () => {
  install([]);
  supabase.from = () => { throw new Error('pooler down'); };
  await expect(SW.daily({ now: NOW })).resolves.toBeNull();
  expect(logEvent).not.toHaveBeenCalled();
});

test('class_round_draws not there yet: skipped with one log line, never throws', async () => {
  install(ROUND_ON());
  const realFrom = supabase.from;
  supabase.from = (t) => (t === 'class_round_draws'
    ? { select: () => { const q = { gte: () => q, lt: async () => ({ data: null, error: { code: '42P01', message: 'relation "class_round_draws" does not exist' } }) }; return q; } }
    : realFrom(t));
  await expect(SW.daily({ now: NOW })).resolves.toBe(0);
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
    const SW2 = require('../../../shared/services/quiz/web-quiz-sample-window');
    db = { app_settings: ROUND_ON(), class_round_draws: draws() };
    Object.assign(sb, makeFake(db));
    await SW2.daily({ now: NOW });
    expect(sl.logEvent.mock.calls.filter((c) => c[0] === 'web_quiz.sample_window')).toEqual([]);
    expect(lg.logToFile.mock.calls.filter((c) => /sample_window/.test(c[0]))).toHaveLength(1);
  } finally { delete global.__absent; jest.resetModules(); }
});
