'use strict';
/**
 * The stuck-run sweeper (app_settings `web_quiz_challenge_sweeper`, under `web_quiz_challenge`): a run left in
 * `scoring` for more than 10 minutes becomes `failed` with `meta.fail_reason` and one `web_quiz.ch_swept`; a v2 row
 * (mode set) also logs `web_quiz.m_lost{reason:'swept'}` when events v2 is on; a `served` run never played for 24 h
 * becomes `abandoned`. With every new switch off nothing is read from or written to the runs table (golden).
 *
 * Faked boundaries only: Supabase (the in-memory fake that applies filters), R2, the logger and the event transport.
 * `web-quiz-measure-events` (the m_lost builder) is not on the base yet, so it is a VIRTUAL mock here; the binding
 * expiry module is mocked as absent (its require throws) to prove the daily job skips it and says so.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('../../../shared/storage/r2', () => ({
  deleteKey: jest.fn(async () => true),
  listKeys: jest.fn(async () => []),
  getPresignedUploadUrl: jest.fn(),
}));
jest.mock('../../../shared/services/quiz/web-quiz-measure-events', () => ({
  mLost: jest.fn((row, o = {}) => ({ run: row.id, mode: row.mode, reason: o.reason, ...(o.ageMin != null ? { age_min: o.ageMin } : {}) })),
}), { virtual: true });
jest.mock('../../../shared/services/quiz/web-quiz-bind-expiry', () => { throw new Error("Cannot find module './web-quiz-bind-expiry'"); }, { virtual: true });
// The weekly numbers' identity lines read the Redis service and the join queue (not on the base yet: VIRTUAL);
// the golden below proves neither is touched with every switch off.
jest.mock('../../../shared/services/cache/railway-redis.service', () => ({ isAvailable: jest.fn(() => true), scanValues: jest.fn(async () => []), get: jest.fn(), incr: jest.fn() }));
jest.mock('../../../shared/services/quiz/web-quiz-join-queue', () => ({ precisionByTier: jest.fn(async () => []) }), { virtual: true });
jest.mock('openchemlib', () => require('../../../../tests/__mocks__/openchemlib.js'));

const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const r2 = require('../../../shared/storage/r2');
const { logEvent } = require('../../../shared/utils/structured-logger');
const { logToFile } = require('../../../shared/utils/logger');
const ME = require('../../../shared/services/quiz/web-quiz-measure-events');
const S = require('../../../shared/services/quiz/web-quiz-challenge-sweeper');
const Redis = require('../../../shared/services/cache/railway-redis.service');
const Queue = require('../../../shared/services/quiz/web-quiz-join-queue');

const NOW = Date.parse('2026-10-19T06:00:00Z');   // Monday 11:00 PKT
const ago = (min) => new Date(NOW - min * 60 * 1000).toISOString();
const ON = (key) => ({ key, value: true });
const KID = '44444444-4444-4444-8444-444444444444';
const RUNS = 'web_quiz_challenge_runs';

let db;
let fake;
const install = (settings, runs) => {
  db = { app_settings: settings, [RUNS]: runs, web_quiz_strip_weekly: [] };
  fake = makeFake(db, { uniques: { web_quiz_strip_weekly: ['week', 'line', 'cell'] } });
  Object.assign(supabase, fake);
};
const runRow = (id, status, minAgo, extra = {}) => ({
  id, student_id: KID, exercise: 'read', grade: 3, lang: 'ur', status, created_at: ago(minAgo), meta: { ms: 1 }, ...extra,
});
const events = (name) => logEvent.mock.calls.filter((c) => c[0] === name).map((c) => c[1]);
const runCalls = () => fake.calls.filter((c) => c.table === RUNS);

beforeAll(() => { process.env.CHILD_TEST_R2_ENV = 'sandbox'; process.env.R2_BUCKET_NAME = 'r2-default'; });
afterEach(() => { jest.clearAllMocks(); S.__reset(); });

describe('sweepStuck', () => {
  const settings = () => [ON('web_quiz_challenge'), ON('web_quiz_challenge_sweeper'), ON('web_quiz_hub'), ON('web_quiz_events_v2')];

  test('a scoring row 11 min old becomes failed with meta.fail_reason and one ch_swept; a 9 min old one is untouched', async () => {
    install(settings(), [runRow('r-old', 'scoring', 11), runRow('r-new', 'scoring', 9)]);
    const out = await S.sweepStuck({ now: NOW });
    const old = db[RUNS].find((r) => r.id === 'r-old');
    const fresh = db[RUNS].find((r) => r.id === 'r-new');
    expect(old.status).toBe('failed');
    expect(old.meta).toEqual({ ms: 1, fail_reason: 'unknown', swept_at: new Date(NOW).toISOString() });
    expect(fresh.status).toBe('scoring');
    expect(fresh.meta).toEqual({ ms: 1 });
    expect(events('web_quiz.ch_swept')).toEqual([{ run: 'r-old', age_min: 11, reason: 'unknown', w: 's' }]);
    expect(events('web_quiz.m_lost')).toEqual([]);   // a pre-v2 row (no mode) logs no m_lost
    expect(out).toMatchObject({ swept: 1, abandoned: 0 });
  });

  test('fail_reason comes from the row when it says (a reason in the list, or a live reading the page never sent)', async () => {
    install(settings(), [
      runRow('r-stt', 'scoring', 30, { meta: { fail_reason: 'stt_timeout' } }),
      runRow('r-live', 'scoring', 30, { meta: { phase: 'live' } }),
      runRow('r-odd', 'scoring', 30, { meta: { fail_reason: 'not-a-reason' } }),
    ]);
    await S.sweepStuck({ now: NOW });
    const by = Object.fromEntries(db[RUNS].map((r) => [r.id, r.meta.fail_reason]));
    expect(by).toEqual({ 'r-stt': 'stt_timeout', 'r-live': 'page_gone', 'r-odd': 'unknown' });
    expect(events('web_quiz.ch_swept').map((e) => e.reason).sort()).toEqual(['page_gone', 'stt_timeout', 'unknown']);
  });

  test('a v2 row (mode set) also logs m_lost{reason:swept} built by the measurement events module', async () => {
    install(settings(), [runRow('r-v2', 'scoring', 15, { mode: 'check', form: 'G3', band: 2, record: true })]);
    await S.sweepStuck({ now: NOW });
    expect(ME.mLost).toHaveBeenCalledTimes(1);
    expect(ME.mLost.mock.calls[0][0]).toMatchObject({ id: 'r-v2', mode: 'check', status: 'failed' });
    expect(ME.mLost.mock.calls[0][1]).toEqual({ reason: 'swept', ageMin: 15 });
    expect(events('web_quiz.m_lost')).toEqual([{ run: 'r-v2', mode: 'check', reason: 'swept', age_min: 15 }]);
    expect(events('web_quiz.ch_swept')).toEqual([{ run: 'r-v2', age_min: 15, reason: 'unknown', w: 's' }]);
  });

  test('m_lost waits for events v2: with web_quiz_events_v2 off the v2 row is still swept but no m_lost is logged', async () => {
    install([ON('web_quiz_challenge'), ON('web_quiz_challenge_sweeper'), ON('web_quiz_hub')], [runRow('r-v2', 'scoring', 15, { mode: 'check' })]);
    await S.sweepStuck({ now: NOW });
    expect(db[RUNS][0].status).toBe('failed');
    expect(ME.mLost).not.toHaveBeenCalled();
    expect(events('web_quiz.m_lost')).toEqual([]);
  });

  test('a row that finished scoring between the read and the write is left as the scorer wrote it', async () => {
    install(settings(), [runRow('r-race', 'scoring', 20)]);
    // the scorer lands its result after the sweeper read the row and before its write (the write's meta guard misses)
    const realFrom = fake.from;
    let landed = false;
    supabase.from = (t) => {
      const b = realFrom(t);
      if (t === RUNS) {
        const upd = b.update;
        b.update = (...a) => {
          if (!landed) { landed = true; Object.assign(db[RUNS][0], { status: 'scored', score: { correct: 30 }, meta: { ms: 1, stamp: 1 } }); }
          return upd(...a);
        };
      }
      return b;
    };
    await S.sweepStuck({ now: NOW });
    expect(db[RUNS][0]).toMatchObject({ status: 'scored', meta: { ms: 1, stamp: 1 } });
    expect(events('web_quiz.ch_swept')).toEqual([]);
  });

  test('a served run never played for 24 h becomes abandoned (a count, no event); 23 h is untouched; scored rows never move', async () => {
    install(settings(), [
      runRow('s-old', 'served', 25 * 60), runRow('s-new', 'served', 23 * 60), runRow('done', 'scored', 48 * 60),
    ]);
    const out = await S.sweepStuck({ now: NOW });
    const by = Object.fromEntries(db[RUNS].map((r) => [r.id, r.status]));
    expect(by).toEqual({ 's-old': 'abandoned', 's-new': 'served', done: 'scored' });
    expect(out).toMatchObject({ swept: 0, abandoned: 1 });
    expect(logEvent).not.toHaveBeenCalled();
  });

  test('a tick is bounded: at most `max` rows are swept, the rest wait for the next tick', async () => {
    install(settings(), [runRow('a', 'scoring', 40), runRow('b', 'scoring', 30), runRow('c', 'scoring', 20)]);
    const out = await S.sweepStuck({ now: NOW, max: 2 });
    expect(out.swept).toBe(2);
    expect(db[RUNS].filter((r) => r.status === 'failed').map((r) => r.id)).toEqual(['a', 'b']);
  });
});

describe('golden: every new switch off', () => {
  test('both switches off: no query to the runs table, no event, no R2 call, nothing written (no sweep, no purge)', async () => {
    install([ON('web_quiz_challenge')], [
      runRow('r-old', 'scoring', 60), runRow('s-old', 'served', 48 * 60),
      runRow('k1', 'scored', 200 * 24 * 60, { audio_consent: 'kept_ok', audio_keep_until: ago(60 * 24), meta: { audio_key: 'child-voice/sandbox/kept/2026-05-01/k1/read-1.webm' } }),
    ]);
    const before = JSON.stringify(db);
    await S.tick({ now: NOW });
    await S.sweepStuck({ now: NOW });
    await S.dailyJob({ now: NOW });
    expect(runCalls()).toEqual([]);
    expect(fake.calls.filter((c) => c.table !== 'app_settings')).toEqual([]);
    expect(logEvent).not.toHaveBeenCalled();
    expect(r2.deleteKey).not.toHaveBeenCalled();
    expect(r2.listKeys).not.toHaveBeenCalled();
    expect(JSON.stringify(db)).toBe(before);
    // the identity lines: no Redis call, no queue read, no new strip line
    expect(Redis.isAvailable).not.toHaveBeenCalled();
    expect(Redis.scanValues).not.toHaveBeenCalled();
    expect(Queue.precisionByTier).not.toHaveBeenCalled();
    expect(db.web_quiz_strip_weekly).toEqual([]);
  });

  test('the children on but web_quiz_challenge (the parent) off: still nothing', async () => {
    install([ON('web_quiz_challenge_sweeper'), ON('web_quiz_challenge_audio_purge'), ON('web_quiz_events_v2'), ON('web_quiz_hub')], [runRow('r-old', 'scoring', 60)]);
    await S.tick({ now: NOW });
    expect(runCalls()).toEqual([]);
    expect(logEvent).not.toHaveBeenCalled();
    expect(db[RUNS][0].status).toBe('scoring');
  });

  test('a failed settings read is off (fails closed) and the tick never throws', async () => {
    install([], []);
    supabase.from = () => { throw new Error('pooler down'); };
    await expect(S.tick({ now: NOW })).resolves.toBeDefined();
    expect(logEvent).not.toHaveBeenCalled();
  });
});

describe('daily job: binding expiry absent', () => {
  test('without web-quiz-bind-expiry the daily job logs one skip and nothing about bindings', async () => {
    install([ON('web_quiz_challenge'), ON('web_quiz_challenge_audio_purge'), ON('web_quiz_identity_canon'), ON('web_quiz_phone_bind')], []);
    await S.dailyJob({ now: NOW });
    expect(logToFile).toHaveBeenCalledWith('Challenge daily job: binding expiry not available, skipped', expect.any(Object));
    expect(logEvent.mock.calls.map((c) => c[0])).toEqual(['web_quiz.ch_audio_purged']);
  });
});
