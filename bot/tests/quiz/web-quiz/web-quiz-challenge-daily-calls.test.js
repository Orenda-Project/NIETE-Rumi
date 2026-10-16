'use strict';
/**
 * The calls the daily job makes to other jobs (web-quiz-challenge-sweeper.js dailyJob), once per PKT day under its day
 * claim; each called module carries its own switches, the daily job only schedules it:
 *   - the class sample windows' daily({ now }) (web-quiz-sample-window.js, shipped with the class round), when present;
 *   - on the first PKT day of a month, the calibration job's runMonthly({ period_id: the month just ended, now });
 *   - the rung job's settleDeferred({ now }), when present AND the rung switch is on (web_quiz_challenge_rungs under
 *     web_quiz_challenge_v2 under web_quiz_challenge); off, it is not called and claims no day.
 * Faked boundaries only: Supabase (the in-memory fake), the logger, the event transport, Redis. The calibration module
 * is mocked (absent in a fresh registry); the binding expiry is mocked as absent.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('../../../shared/storage/r2', () => ({ deleteKey: jest.fn(async () => true), listKeys: jest.fn(async () => []), getPresignedUploadUrl: jest.fn() }));
jest.mock('../../../shared/services/cache/railway-redis.service', () => ({ isAvailable: jest.fn(() => false), scanValues: jest.fn(async () => null) }));
// global.__absent names the module a fresh registry must not find (the module not deployed)
jest.mock('../../../shared/services/quiz/web-quiz-challenge-calibration', () => {
  if (global.__absent === 'web-quiz-challenge-calibration') throw new Error("Cannot find module './web-quiz-challenge-calibration'");
  return { runMonthly: jest.fn(async () => ({ ran: false, reason: 'off' })) };
});
jest.mock('../../../shared/services/quiz/web-quiz-bind-expiry', () => { throw new Error("Cannot find module './web-quiz-bind-expiry'"); });
// The rung job (web-quiz-rungs.js). global.__rungs picks what a fresh registry finds: unset → no module;
// 'present' → settleDeferred; 'no_export' → a module without settleDeferred.
const mockSettleDeferred = jest.fn(async () => ({ settled: 0 }));
jest.mock('../../../shared/services/quiz/web-quiz-rungs', () => {
  if (global.__rungs === 'present') return { settleDeferred: mockSettleDeferred };
  if (global.__rungs === 'no_export') return { onRecordFinal: async () => ({ lit: [] }) };
  throw new Error("Cannot find module './web-quiz-rungs'");
});
// The class sample windows (web-quiz-sample-window.js, ships with the class round; not on the base yet): VIRTUAL.
// global.__win: unset → no module; 'present' → daily().
const mockWinDaily = jest.fn(async () => 0);
// its own switches (web_quiz_class_round under web_quiz_challenge_v2 + web_quiz_events_v2 under web_quiz_hub)
const mockWinOn = jest.fn(async () => true);
jest.mock('../../../shared/services/quiz/web-quiz-sample-window', () => {
  if (global.__win === 'present') return { daily: mockWinDaily, switchesOn: mockWinOn };
  throw new Error("Cannot find module './web-quiz-sample-window'");
});
jest.mock('openchemlib', () => require('../../../../tests/__mocks__/openchemlib.js'));

const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const { logEvent } = require('../../../shared/utils/structured-logger');
const { logToFile, logError } = require('../../../shared/utils/logger');
// read at call time: the sweeper requires it lazily, so after a registry reset the test and the job share the fresh one
const cal = () => require('../../../shared/services/quiz/web-quiz-challenge-calibration');
const S = require('../../../shared/services/quiz/web-quiz-challenge-sweeper');

const HOUR = 60 * 60 * 1000;
const NOW = Date.parse('2026-10-15T00:30:00Z');            // Thursday 15 Oct, 05:30 PKT
const ON = (key) => ({ key, value: true });
let db;
let fake;
const install = (settings, extra = {}) => {
  db = { app_settings: settings, web_quiz_challenge_runs: [], web_quiz_strip_weekly: [], ...extra };
  fake = makeFake(db, { uniques: { web_quiz_strip_weekly: ['week', 'line', 'cell'] } });
  Object.assign(supabase, fake);
};

afterEach(() => { jest.clearAllMocks(); });

describe('the class sample windows: scheduled here, decided by their own module', () => {
  const PURGE = () => [ON('web_quiz_challenge'), ON('web_quiz_challenge_audio_purge')];
  const fresh = (mode, settings) => {
    if (mode) global.__win = mode;
    jest.resetModules();
    const sb = require('../../../shared/config/supabase');
    const lg = require('../../../shared/utils/logger');
    const S2 = require('../../../shared/services/quiz/web-quiz-challenge-sweeper');
    db = { app_settings: settings, web_quiz_challenge_runs: [], web_quiz_strip_weekly: [] };
    const f = makeFake(db, { uniques: { web_quiz_strip_weekly: ['week', 'line', 'cell'] } });
    Object.assign(sb, f);
    return { S2, lg, f };
  };
  afterEach(() => {
    delete global.__win; jest.resetModules();
    mockWinDaily.mockReset(); mockWinDaily.mockImplementation(async () => 0);
    mockWinOn.mockReset(); mockWinOn.mockImplementation(async () => true);
  });

  test('present: daily({ now }) once per PKT day, its count returned as windows', async () => {
    mockWinDaily.mockImplementation(async () => 2);
    const { S2 } = fresh('present', PURGE());
    const out = await S2.dailyJob({ now: NOW });
    await S2.dailyJob({ now: NOW + 3 * HOUR });
    expect(mockWinDaily).toHaveBeenCalledTimes(1);
    expect(mockWinDaily.mock.calls[0]).toEqual([{ now: NOW }]);
    expect(out).toMatchObject({ ran: true, windows: 2 });
  });

  test('present with every switch of ours off and its own on: scheduled (its own switches decide)', async () => {
    const { S2 } = fresh('present', []);
    await expect(S2.dailyJob({ now: NOW })).resolves.toMatchObject({ ran: true, purged: null, strip: null });
    expect(mockWinDaily).toHaveBeenCalledTimes(1);
  });

  test('present with every switch off, its own too: not called, no day claimed, nothing written', async () => {
    mockWinOn.mockImplementation(async () => false);
    const { S2, f } = fresh('present', []);
    await expect(S2.dailyJob({ now: NOW })).resolves.toEqual({ ran: false, reason: 'off' });
    expect(mockWinDaily).not.toHaveBeenCalled();
    expect(f.calls.filter((c) => c.table !== 'app_settings')).toEqual([]);   // the switches read only
  });

  test('present with the purge on and its own switches off: the day runs, the windows are not called', async () => {
    mockWinOn.mockImplementation(async () => false);
    const { S2 } = fresh('present', PURGE());
    await expect(S2.dailyJob({ now: NOW })).resolves.toMatchObject({ ran: true, windows: null });
    expect(mockWinDaily).not.toHaveBeenCalled();
  });

  test('a throwing module is one error line and the daily job goes on', async () => {
    mockWinDaily.mockImplementation(async () => { throw new Error('boom'); });
    const { S2, lg } = fresh('present', PURGE());
    await expect(S2.dailyJob({ now: NOW })).resolves.toMatchObject({ ran: true, purged: 0 });
    expect(lg.logError).toHaveBeenCalledWith('web_quiz.ch_sample_window_failed', expect.any(Object));
  });

  test('absent: no call, no log about it, and no class table is ever read here', async () => {
    const { S2, lg, f } = fresh(null, PURGE());
    await expect(S2.dailyJob({ now: NOW })).resolves.toMatchObject({ ran: true, windows: null });
    expect(JSON.stringify([lg.logToFile.mock.calls, lg.logError.mock.calls])).not.toMatch(/sample_window|class_round/i);
    expect(f.calls.filter((c) => /class_round/.test(c.table))).toEqual([]);
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

describe('the rung job\'s deferred settle (settleDeferred): once per daily run, only under the rung switch', () => {
  const PURGE = () => [ON('web_quiz_challenge'), ON('web_quiz_challenge_audio_purge')];
  const RUNGS = () => [...PURGE(), ON('web_quiz_challenge_v2'), ON('web_quiz_challenge_rungs')];
  // a fresh registry where the rung module is as `mode` says; returns the job, the logger and the fake's calls
  const fresh = (mode, settings) => {
    if (mode) global.__rungs = mode;
    jest.resetModules();
    const sb = require('../../../shared/config/supabase');
    const lg = require('../../../shared/utils/logger');
    const sl = require('../../../shared/utils/structured-logger');
    const S2 = require('../../../shared/services/quiz/web-quiz-challenge-sweeper');
    db = { app_settings: settings, web_quiz_challenge_runs: [], web_quiz_strip_weekly: [] };
    const f = makeFake(db, { uniques: { web_quiz_strip_weekly: ['week', 'line', 'cell'] } });
    Object.assign(sb, f);
    return { S2, lg, sl, f };
  };
  afterEach(() => { delete global.__rungs; jest.resetModules(); mockSettleDeferred.mockReset(); mockSettleDeferred.mockImplementation(async () => ({ settled: 0 })); });

  test('present: called once per daily run with now; a second run the same PKT day does not call it again', async () => {
    const { S2 } = fresh('present', RUNGS());
    const out = await S2.dailyJob({ now: NOW });
    await S2.dailyJob({ now: NOW + 3 * HOUR });
    expect(mockSettleDeferred).toHaveBeenCalledTimes(1);
    expect(mockSettleDeferred.mock.calls[0]).toEqual([{ now: NOW }]);
    expect(out).toMatchObject({ ran: true, settled: { settled: 0 } });
  });

  test('present and throwing: one error line, the daily job goes on', async () => {
    mockSettleDeferred.mockImplementation(async () => { throw new Error('pooler down'); });
    const { S2, lg } = fresh('present', RUNGS());
    const out = await S2.dailyJob({ now: NOW });
    expect(out).toMatchObject({ ran: true, purged: 0 });
    expect(lg.logError).toHaveBeenCalledWith('web_quiz.ch_rung_settle_failed', expect.any(Object));
  });

  test('the module without settleDeferred, or no module at all: no call, no error, nothing logged about it', async () => {
    for (const mode of ['no_export', null]) {
      const { S2, lg } = fresh(mode, RUNGS());
      await expect(S2.dailyJob({ now: NOW })).resolves.toMatchObject({ ran: true, settled: null });
      const said = JSON.stringify([lg.logToFile.mock.calls, lg.logError.mock.calls]);
      expect(said).not.toMatch(/rung|settle/i);
      delete global.__rungs;
    }
    expect(mockSettleDeferred).not.toHaveBeenCalled();
  });

  test('golden: every switch off and no rung module, any other day: still nothing at all', async () => {
    const { S2, f, sl } = fresh(null, []);
    await expect(S2.dailyJob({ now: NOW })).resolves.toEqual({ ran: false, reason: 'off' });
    expect(f.calls.filter((c) => c.table !== 'app_settings')).toEqual([]);   // the switches read only
    expect(sl.logEvent).not.toHaveBeenCalled();
  });

  test('every switch off with the rung module present: still nothing at all (no settle, no day claimed)', async () => {
    const { S2, f, sl } = fresh('present', []);
    await expect(S2.dailyJob({ now: NOW })).resolves.toEqual({ ran: false, reason: 'off' });
    expect(mockSettleDeferred).not.toHaveBeenCalled();
    expect(f.calls.filter((c) => c.table !== 'app_settings')).toEqual([]);   // the switches read only
    expect(sl.logEvent).not.toHaveBeenCalled();
  });

  test.each([
    ['web_quiz_challenge_rungs off', ['web_quiz_challenge', 'web_quiz_challenge_audio_purge', 'web_quiz_challenge_v2']],
    ['web_quiz_challenge_v2 off', ['web_quiz_challenge', 'web_quiz_challenge_audio_purge', 'web_quiz_challenge_rungs']],
  ])('the rung module present, %s (the purge on): the day runs, the settle is not called', async (_n, keys) => {
    const { S2 } = fresh('present', keys.map(ON));
    await expect(S2.dailyJob({ now: NOW })).resolves.toMatchObject({ ran: true, settled: null });
    expect(mockSettleDeferred).not.toHaveBeenCalled();
  });
});
