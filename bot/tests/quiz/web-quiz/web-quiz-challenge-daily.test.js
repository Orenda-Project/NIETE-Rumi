'use strict';
/**
 * The Challenge's daily job (app_settings `web_quiz_challenge_audio_purge`, under `web_quiz_challenge`), once per PKT
 * day across every replica (the claim is a Redis key, `wq:daily_job:<PKT day>`, so a second process or a second tick
 * the same day does nothing, and no table row is written for it): the kept readings past `audio_keep_until` are deleted from R2 and their rows stop pointing
 * at them; one `web_quiz.ch_audio_purged{n, oldest_age_d, reason:'age', w:'s'}`; the binding expiry is called once,
 * whatever the switches say (retention outlives every switch): with every switch off and the expiry module present the
 * job still claims the day and runs the expiry, and nothing else.
 *
 * Faked boundaries only: Supabase (the in-memory fake), R2, the logger, the event transport. The binding expiry
 * module (`web-quiz-bind-expiry`) is mocked: its own tests cover what it does; here, that the daily job calls it.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('../../../shared/storage/r2', () => ({
  deleteKey: jest.fn(async () => true),
  listKeys: jest.fn(async () => []),
  getPresignedUploadUrl: jest.fn(),
}));
const mockExpireBindings = jest.fn(async () => ({ expired: 0, deleted: 0 }));
jest.mock('../../../shared/services/quiz/web-quiz-bind-expiry', () => ({ expireBindings: mockExpireBindings }));
// Redis: the day claim (SET NX over an in-memory store shared by every process) and the reply-cap counters
// (scanValues: none here unless a test says so).
jest.mock('../../../shared/services/cache/railway-redis.service', () => {
  const store = new Map();
  return {
    _store: store,
    isAvailable: jest.fn(() => true),
    setNX: jest.fn(async (k, v) => { if (store.has(k)) return false; store.set(k, v); return true; }),
    scanValues: jest.fn(async () => null),
  };
});
jest.mock('openchemlib', () => require('../../../../tests/__mocks__/openchemlib.js'));

const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const r2 = require('../../../shared/storage/r2');
const { logEvent } = require('../../../shared/utils/structured-logger');
const S = require('../../../shared/services/quiz/web-quiz-challenge-sweeper');

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-10-15T06:00:00Z');   // Thursday 11:00 PKT
const iso = (ms) => new Date(ms).toISOString();
const ON = (key) => ({ key, value: true });
const KID = '44444444-4444-4444-8444-444444444444';
const RUNS = 'web_quiz_challenge_runs';
const keyOf = (day, run) => `child-voice/sandbox/kept/${day}/${run}/read-1760000000000.webm`;

let db;
let fake;
const install = (settings, runs) => {
  db = { app_settings: settings, [RUNS]: runs, web_quiz_strip_weekly: [] };
  fake = makeFake(db, { uniques: { web_quiz_strip_weekly: ['week', 'line', 'cell'] } });
  Object.assign(supabase, fake);
};
const row = (id, extra) => ({ id, student_id: KID, exercise: 'read', grade: 3, lang: 'ur', status: 'scored', created_at: iso(NOW - 100 * DAY), meta: {}, ...extra });
const fixture = () => [
  // kept_ok, kept 100 days ago, past its keep date: purged
  row('k-past', { audio_consent: 'kept_ok', scored_at: iso(NOW - 100 * DAY), audio_keep_until: iso(NOW - 10 * DAY), meta: { audio_key: keyOf('2026-07-07', 'k-past') } }),
  // kept_ok, inside its 90 days: kept
  row('k-live', { audio_consent: 'kept_ok', scored_at: iso(NOW - 20 * DAY), audio_keep_until: iso(NOW + 70 * DAY), meta: { audio_key: keyOf('2026-09-25', 'k-live') } }),
  // kept_no / not_asked: no object, no keep date — the purge never asks R2 about them
  row('k-no', { audio_consent: 'kept_no', meta: {} }),
  row('k-na', { audio_consent: 'not_asked', meta: {} }),
  // a reading kept before the consent columns (no audio_keep_until): never touched by the job
  row('k-old', { meta: { audio_key: keyOf('2026-06-01', 'k-old') } }),
  // purged already (its keep date is past, its key is gone): not a candidate again
  row('k-done', { audio_consent: 'kept_ok', scored_at: iso(NOW - 120 * DAY), audio_keep_until: iso(NOW - 30 * DAY), meta: { audio_key: null, audio_purged_on: '2026-09-15' } }),
];
const events = (name) => logEvent.mock.calls.filter((c) => c[0] === name).map((c) => c[1]);

beforeAll(() => { process.env.CHILD_TEST_R2_ENV = 'sandbox'; process.env.R2_BUCKET_NAME = 'r2-default'; delete process.env.CHILD_VOICE_BUCKET; });
afterEach(() => { jest.clearAllMocks(); S.__reset(); require('../../../shared/services/cache/railway-redis.service')._store.clear(); });

const PURGE = () => [ON('web_quiz_challenge'), ON('web_quiz_challenge_audio_purge')];
// The binding expiry has its own switch (web_quiz_phone_bind, under web_quiz_identity_canon), never the purge's.
const BIND = () => [ON('web_quiz_identity_canon'), ON('web_quiz_phone_bind')];

test('the purge deletes only readings past audio_keep_until, clears their rows, and logs ch_audio_purged once', async () => {
  install(PURGE(), fixture());
  const out = await S.dailyJob({ now: NOW });
  expect(r2.deleteKey).toHaveBeenCalledTimes(1);
  expect(r2.deleteKey).toHaveBeenCalledWith(keyOf('2026-07-07', 'k-past'), expect.objectContaining({ bucket: expect.any(String) }));
  const by = Object.fromEntries(db[RUNS].map((r) => [r.id, r.meta.audio_key]));
  expect(by).toEqual({ 'k-past': null, 'k-live': keyOf('2026-09-25', 'k-live'), 'k-no': undefined, 'k-na': undefined, 'k-old': keyOf('2026-06-01', 'k-old'), 'k-done': null });
  expect(db[RUNS].find((r) => r.id === 'k-past').meta.audio_purged_on).toBe('2026-10-15');
  expect(events('web_quiz.ch_audio_purged')).toEqual([{ n: 1, oldest_age_d: 100, reason: 'age', w: 's' }]);
  expect(out).toMatchObject({ ran: true, purged: 1 });
});

test('kept_no / not_asked rows: no object exists and R2 is never called for them', async () => {
  install(PURGE(), fixture().filter((r) => ['k-no', 'k-na'].includes(r.id)));
  await S.dailyJob({ now: NOW });
  expect(r2.deleteKey).not.toHaveBeenCalled();
  expect(r2.listKeys).not.toHaveBeenCalled();
  expect(events('web_quiz.ch_audio_purged')).toEqual([{ n: 0, oldest_age_d: null, reason: 'age', w: 's' }]);
});

test('once per PKT day: a second run the same day (any process) is a no-op; the next PKT day runs again', async () => {
  install([...PURGE(), ...BIND()], fixture());
  await S.dailyJob({ now: NOW });
  S.__reset();                                   // a second process: no memory of the first
  const again = await S.dailyJob({ now: NOW + 3 * 60 * 60 * 1000 });
  expect(again).toMatchObject({ ran: false, reason: 'already_ran_today' });
  expect(r2.deleteKey).toHaveBeenCalledTimes(1);
  expect(events('web_quiz.ch_audio_purged')).toHaveLength(1);
  expect(mockExpireBindings).toHaveBeenCalledTimes(1);
  // 19:00Z is 00:00 PKT the next day
  await S.dailyJob({ now: Date.parse('2026-10-15T19:00:00Z') });
  expect(events('web_quiz.ch_audio_purged')).toHaveLength(2);
  expect(mockExpireBindings).toHaveBeenCalledTimes(2);
  expect(db.web_quiz_strip_weekly.filter((r) => r.line === 'daily_job').map((r) => r.cell)).toEqual(['2026-10-15', '2026-10-16']);
});

test('expireBindings is called once per daily run, with the run\'s time; nothing about bindings is logged here', async () => {
  install([...PURGE(), ...BIND()], []);
  await S.dailyJob({ now: NOW });
  expect(mockExpireBindings).toHaveBeenCalledTimes(1);
  expect(mockExpireBindings.mock.calls[0][0]).toEqual(new Date(NOW));
  expect(logEvent.mock.calls.map((c) => c[0])).toEqual(['web_quiz.ch_audio_purged']);
});

test('a reading R2 refuses to delete stays on its row and is not counted', async () => {
  install(PURGE(), fixture());
  r2.deleteKey.mockResolvedValueOnce(false);
  await S.dailyJob({ now: NOW });
  expect(db[RUNS].find((r) => r.id === 'k-past').meta.audio_key).toBe(keyOf('2026-07-07', 'k-past'));
  expect(events('web_quiz.ch_audio_purged')).toEqual([{ n: 0, oldest_age_d: null, reason: 'age', w: 's' }]);
});

test('a key outside this env\'s kept prefix is never deleted, even past its keep date', async () => {
  install(PURGE(), [row('k-x', { audio_consent: 'kept_ok', scored_at: iso(NOW - 100 * DAY), audio_keep_until: iso(NOW - DAY), meta: { audio_key: 'child-voice/production/kept/2026-07-07/k-x/read-1.webm' } })]);
  await S.dailyJob({ now: NOW });
  expect(r2.deleteKey).not.toHaveBeenCalled();
});

test('golden: every switch off, the expiry module present: the job claims the day (a Redis key, no row) and runs the binding expiry ONLY (no sweep, no purge, no strip, no reply-cap read, no event)', async () => {
  const Redis = require('../../../shared/services/cache/railway-redis.service');
  install([ON('web_quiz_challenge')], fixture());
  const before = JSON.stringify(db[RUNS]);
  const out = await S.dailyJob({ now: NOW });
  expect(out).toMatchObject({ ran: true, bindings: true, purged: null, strip: null, replyCap: null });
  await S.tick({ now: NOW });                            // the same PKT day: the claim holds
  await S.tick({ now: NOW + 60 * 60 * 1000 });
  expect(mockExpireBindings).toHaveBeenCalledTimes(1);
  expect(mockExpireBindings.mock.calls[0][0]).toEqual(new Date(NOW));
  expect(fake.calls.filter((c) => c.table === RUNS)).toEqual([]);
  expect(fake.calls.filter((c) => !['app_settings', 'web_quiz_strip_weekly'].includes(c.table))).toEqual([]);
  expect(db.web_quiz_strip_weekly).toEqual([]);
  expect(fake.calls.filter((c) => c.op !== 'select')).toEqual([]);
  expect([...Redis._store.keys()]).toEqual(['wq:daily_job:2026-10-15']);
  expect(r2.deleteKey).not.toHaveBeenCalled();
  expect(r2.listKeys).not.toHaveBeenCalled();
  expect(Redis.scanValues).not.toHaveBeenCalled();
  expect(logEvent).not.toHaveBeenCalled();
  expect(JSON.stringify(db[RUNS])).toBe(before);
});

test('a tier where phone binding was on and is now off: the expiry still runs (no settings at all)', async () => {
  install([], []);
  await S.tick({ now: NOW });
  expect(mockExpireBindings).toHaveBeenCalledTimes(1);
  expect(logEvent).not.toHaveBeenCalled();
});

// The operator's keep-all state with phone binding live: the 31 March erase must still run.
test('phone binding on, sweeper and purge off: the tick runs expireBindings once a day; no runs-table query, no R2 call, no purge event', async () => {
  install(BIND(), fixture());
  const before = JSON.stringify(db[RUNS]);
  await S.tick({ now: NOW });
  await S.tick({ now: NOW + 60 * 60 * 1000 });          // the next hourly tick, same PKT day
  expect(mockExpireBindings).toHaveBeenCalledTimes(1);
  expect(mockExpireBindings.mock.calls[0][0]).toEqual(new Date(NOW));
  expect(fake.calls.filter((c) => c.table === RUNS)).toEqual([]);
  expect(r2.deleteKey).not.toHaveBeenCalled();
  expect(r2.listKeys).not.toHaveBeenCalled();
  expect(logEvent).not.toHaveBeenCalled();
  expect(JSON.stringify(db[RUNS])).toBe(before);
  expect(db.web_quiz_strip_weekly).toEqual([]);
  expect([...require('../../../shared/services/cache/railway-redis.service')._store.keys()]).toEqual(['wq:daily_job:2026-10-15']);
});

// Operator decision (keep every kept reading for now): the purge is a designed option behind a switch that stays off.
test('golden: purge switch off while the daily job runs (sweeper on) and rows are past audio_keep_until: zero R2 deletes, rows untouched', async () => {
  install([ON('web_quiz_challenge'), ON('web_quiz_challenge_sweeper')], fixture());
  const before = JSON.stringify(fixture().map((r) => [r.id, r.meta]));
  const out = await S.dailyJob({ now: NOW });
  expect(out).toMatchObject({ ran: true, purged: null });
  expect(r2.deleteKey).not.toHaveBeenCalled();
  expect(r2.listKeys).not.toHaveBeenCalled();
  expect(events('web_quiz.ch_audio_purged')).toEqual([]);
  expect(JSON.stringify(db[RUNS].map((r) => [r.id, r.meta]))).toBe(before);
});

test('binding expiry runs without the purge: sweeper + phone binding on, purge off → expireBindings once, no R2, no purge event', async () => {
  install([ON('web_quiz_challenge'), ON('web_quiz_challenge_sweeper'), ...BIND()], fixture());
  await S.dailyJob({ now: NOW });
  expect(mockExpireBindings).toHaveBeenCalledTimes(1);
  expect(r2.deleteKey).not.toHaveBeenCalled();
  expect(logEvent).not.toHaveBeenCalled();
});

test('the purge with phone binding off: the purge runs and the binding expiry still runs once (unconditional)', async () => {
  install(PURGE(), fixture());
  await S.dailyJob({ now: NOW });
  expect(r2.deleteKey).toHaveBeenCalledTimes(1);
  expect(mockExpireBindings).toHaveBeenCalledTimes(1);
});

test('a throwing binding expiry is logged and the rest of the daily job still runs', async () => {
  const { logError } = require('../../../shared/utils/logger');
  mockExpireBindings.mockImplementationOnce(async () => { throw new Error('pooler down'); });
  install(PURGE(), fixture());
  const out = await S.dailyJob({ now: NOW });
  expect(out).toMatchObject({ ran: true, bindings: false, purged: 1 });
  expect(logError).toHaveBeenCalledWith('web_quiz.ch_daily_bind_expiry_failed', expect.any(Object));
});

describe('the daily reply-cap snapshot (sweeper switch)', () => {
  const Redis = require('../../../shared/services/cache/railway-redis.service');
  afterEach(() => { Redis.isAvailable.mockImplementation(() => true); Redis.scanValues.mockImplementation(async () => null); });

  test('sweeper on: yesterday\'s (PKT) reply counts are kept as reply_cap_day rows, counts only', async () => {
    Redis.isAvailable.mockImplementation(() => true);
    Redis.scanValues.mockImplementation(async () => ['1', '2', '9']);
    install([ON('web_quiz_challenge'), ON('web_quiz_challenge_sweeper')], []);
    const out = await S.dailyJob({ now: NOW });
    expect(Redis.scanValues).toHaveBeenCalledWith('wq:reply_cap:2026-10-14:*');
    const rows = db.web_quiz_strip_weekly.filter((r) => r.line === 'reply_cap_day');
    expect(Object.fromEntries(rows.map((r) => [r.cell, r.value])))
      .toEqual({ '2026-10-14|1': 1, '2026-10-14|2': 1, '2026-10-14|3-4': 0, '2026-10-14|5-8': 0, '2026-10-14|capped': 1 });
    expect(out.replyCap).toMatchObject({ day: '2026-10-14', phones: 3 });
  });

  test('purge only (sweeper off): no reply-cap read (the day claim is the only Redis call), no snapshot row', async () => {
    install(PURGE(), []);
    await S.dailyJob({ now: NOW });
    expect(Redis.setNX.mock.calls.map((c) => c[0])).toEqual(['wq:daily_job:2026-10-15']);
    expect(Redis.scanValues).not.toHaveBeenCalled();
    expect(db.web_quiz_strip_weekly.filter((r) => r.line === 'reply_cap_day')).toEqual([]);
  });
});
