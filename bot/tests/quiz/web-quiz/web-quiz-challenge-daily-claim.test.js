'use strict';
/**
 * The daily job's once-a-day claim is a Redis key (`wq:daily_job:<PKT day>`, SET NX, 48 h), never a table row, so
 * with every switch off the job writes no row anywhere — with every optional module REAL and present (the binding
 * expiry, the rung job, the class sample windows, the calibration), on a mid-month day and on the first PKT day of a
 * month. The expiry still runs every day (retention outlives every switch) and logs its two counts; nothing else.
 * Redis down → a process-local claim: the job runs at most once per process per day, logged once.
 * Also: the sweep's served → abandoned move clears `record`, so the record index never holds a stop for a row that
 * was never played.
 * Faked boundaries only: Supabase (the in-memory fake), Redis (an in-memory SET NX), R2, the logger, the event transport.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), logError: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('../../../shared/storage/r2', () => ({ deleteKey: jest.fn(async () => true), listKeys: jest.fn(async () => []), getPresignedUploadUrl: jest.fn() }));
// Redis: SET NX with a TTL over one store shared by every module registry (a second registry = a second process).
jest.mock('../../../shared/services/cache/railway-redis.service', () => {
  global.__redis = global.__redis || { up: true, store: new Map() };
  const r = global.__redis;
  return {
    isAvailable: jest.fn(() => r.up),
    setNX: jest.fn(async (k, v, ttl) => { if (!r.up) return true; if (r.store.has(k)) return false; r.store.set(k, { v, ttl }); return true; }),
    scanValues: jest.fn(async () => null),
    get: jest.fn(async () => null), set: jest.fn(async () => true), incr: jest.fn(async () => 1), delete: jest.fn(async () => true),
  };
});
jest.mock('openchemlib', () => require('../../../../tests/__mocks__/openchemlib.js'));

const { makeFake } = require('./fake-supabase');

const HOUR = 60 * 60 * 1000;
const MID_MONTH = Date.parse('2026-10-15T06:00:00Z');     // Thursday 11:00 PKT
const FIRST_PKT = Date.parse('2026-10-31T19:30:00Z');     // 1 Nov 00:30 PKT: the calibration's day
const ON = (key) => ({ key, value: true });
const RUNS = 'web_quiz_challenge_runs';
const WRITES = new Set(['insert', 'update', 'upsert', 'delete']);
const KID = '44444444-4444-4444-8444-444444444444';

// A fresh registry: the job and every module it loads, as a new process would.
function boot(settings, extra = {}) {
  jest.resetModules();
  const sb = require('../../../shared/config/supabase');
  const db = { app_settings: settings, [RUNS]: [], web_quiz_strip_weekly: [], child_phone_bindings: [], child_rungs: [], challenge_periods: [], class_round_draws: [], ...extra };
  const fake = makeFake(db, { uniques: { web_quiz_strip_weekly: ['week', 'line', 'cell'] } });
  Object.assign(sb, fake);
  return {
    db, fake,
    S: require('../../../shared/services/quiz/web-quiz-challenge-sweeper'),
    Redis: require('../../../shared/services/cache/railway-redis.service'),
    logEvent: require('../../../shared/utils/structured-logger').logEvent,
    logToFile: require('../../../shared/utils/logger').logToFile,
  };
}
const writes = (fake) => fake.calls.filter((c) => WRITES.has(c.op)).map((c) => `${c.op} ${c.table}`);

beforeEach(() => { global.__redis = { up: true, store: new Map() }; });
afterAll(() => { delete global.__redis; });

describe('every switch off, every optional module real and present: no row written anywhere', () => {
  test.each([
    ['a mid-month day', MID_MONTH, '2026-10-15'],
    ['the first PKT day of a month (the calibration\'s day)', FIRST_PKT, '2026-11-01'],
  ])('%s: the claim is the Redis key, the expiry runs and logs its counts, nothing else', async (_n, now, day) => {
    const { S, fake, db, logEvent } = boot([]);
    const Cal = require('../../../shared/services/quiz/web-quiz-challenge-calibration');
    const monthly = jest.spyOn(Cal, 'runMonthly');
    const out = await S.tick({ now });
    expect(out.daily).toMatchObject({ ran: true, bindings: true, purged: null, strip: null, windows: null, calibration: null, settled: null });
    expect(writes(fake)).toEqual([]);
    expect(db.web_quiz_strip_weekly).toEqual([]);
    expect(fake.calls.filter((c) => c.table === RUNS)).toEqual([]);
    expect([...global.__redis.store.keys()]).toEqual([`wq:daily_job:${day}`]);
    expect(global.__redis.store.get(`wq:daily_job:${day}`).ttl).toBe(48 * 60 * 60);
    expect(monthly).not.toHaveBeenCalled();
    expect(logEvent.mock.calls.map((c) => c[0]).sort()).toEqual(['web_quiz.bind_expired', 'web_quiz.bind_rows_deleted']);
  });

  test('the same PKT day again, in this process and in another: the claim holds (the expiry ran once)', async () => {
    const a = boot([]);
    await a.S.tick({ now: MID_MONTH });
    await a.S.tick({ now: MID_MONTH + HOUR });
    const b = boot([]);                                     // a second replica, same Redis
    await expect(b.S.dailyJob({ now: MID_MONTH + 2 * HOUR })).resolves.toEqual({ ran: false, reason: 'already_ran_today' });
    expect(a.logEvent.mock.calls.filter((c) => c[0] === 'web_quiz.bind_expired')).toHaveLength(1);
    expect(b.logEvent).not.toHaveBeenCalled();
    // the next PKT day (19:00Z is 00:00 PKT) is a new claim
    await expect(b.S.dailyJob({ now: Date.parse('2026-10-15T19:00:00Z') })).resolves.toMatchObject({ ran: true, day: '2026-10-16' });
  });
});

describe('Redis down: a process-local claim', () => {
  test('once per process per day, one log line; no table row', async () => {
    global.__redis.up = false;
    const { S, fake, logToFile } = boot([]);
    await expect(S.dailyJob({ now: MID_MONTH })).resolves.toMatchObject({ ran: true });
    await expect(S.dailyJob({ now: MID_MONTH + HOUR })).resolves.toEqual({ ran: false, reason: 'already_ran_today' });
    await S.dailyJob({ now: Date.parse('2026-10-15T19:00:00Z') });
    const said = logToFile.mock.calls.filter((c) => /process-local/.test(c[0]));
    expect(said).toHaveLength(1);
    expect(writes(fake)).toEqual([]);
  });

  test('a SET that fails open still runs this process once a day', async () => {
    const { S, Redis } = boot([]);
    Redis.setNX.mockImplementation(async () => true);       // the service answers true on a failed SET
    await expect(S.dailyJob({ now: MID_MONTH })).resolves.toMatchObject({ ran: true });
    await expect(S.dailyJob({ now: MID_MONTH + HOUR })).resolves.toEqual({ ran: false, reason: 'already_ran_today' });
  });
});

describe('the parts that do write, under their own switches', () => {
  test('the purge on: its day count is the one strip row (line daily_job), written once', async () => {
    const { S, db } = boot([ON('web_quiz_challenge'), ON('web_quiz_challenge_audio_purge')]);
    await S.dailyJob({ now: MID_MONTH });
    await S.dailyJob({ now: MID_MONTH + HOUR });
    expect(db.web_quiz_strip_weekly.map(({ week, line, cell, value, n }) => ({ week, line, cell, value, n })))
      .toEqual([{ week: '2026-W42', line: 'daily_job', cell: '2026-10-15', value: 0, n: 0 }]);
  });

  test('the calibration on, its first PKT day: runMonthly is scheduled with the month just ended', async () => {
    const { S } = boot([ON('web_quiz_challenge'), ON('web_quiz_challenge_v2'), ON('web_quiz_challenge_calibration')]);
    const Cal = require('../../../shared/services/quiz/web-quiz-challenge-calibration');
    const monthly = jest.spyOn(Cal, 'runMonthly').mockImplementation(async () => ({ ran: false, reason: 'test' }));
    await S.dailyJob({ now: FIRST_PKT });
    expect(monthly).toHaveBeenCalledTimes(1);
    expect(monthly.mock.calls[0][0]).toMatchObject({ period_id: '2026-10' });
  });
});

describe('the sweep: a served row never played for 24 h is abandoned and is no longer a record', () => {
  const run = (id, status, hoursAgo, extra = {}) => ({
    id, student_id: KID, canonical_id: KID, exercise: 'read', grade: 3, lang: 'ur', status, mode: 'check', record: true,
    period_id: '2026-10', created_at: new Date(MID_MONTH - hoursAgo * HOUR).toISOString(), meta: {}, ...extra,
  });

  test('25 h → abandoned, record false; 23 h and a scored record untouched', async () => {
    const { S, db } = boot([ON('web_quiz_challenge'), ON('web_quiz_challenge_sweeper')], {
      [RUNS]: [run('s-old', 'served', 25), run('s-new', 'served', 23), run('done', 'scored', 30)],
    });
    const out = await S.sweepStuck({ now: MID_MONTH });
    expect(out).toMatchObject({ abandoned: 1 });
    const by = Object.fromEntries(db[RUNS].map((r) => [r.id, [r.status, r.record]]));
    expect(by).toEqual({ 's-old': ['abandoned', false], 's-new': ['served', true], done: ['scored', true] });
  });
});
