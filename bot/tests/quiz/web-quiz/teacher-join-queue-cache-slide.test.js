'use strict';
/**
 * The teacher join queue's kept queue slides while the tab is open (web-quiz-join-queue.js cachedCompute): a read of a
 * kept queue renews its key for another QUEUE_TTL_S, so a tap after more than 10 minutes on the tab still reads it, but
 * never past QUEUE_MAX_AGE_S from its compute (an older entry is worked out afresh). Redis down: the local copy's
 * 10-minute expiry counts from its last read, its hour cap from its compute.
 * Supabase (in-memory, filters applied, every call recorded) and Redis (a Map whose keys expire on a fake clock) are the
 * faked boundaries; the module runs for real. The seed is the cache-filter suite's (two served pairs: Omar, Bilal).
 */
let clock = Date.UTC(2026, 9, 16, 8, 0, 0);
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/services/cache/railway-redis.service', () => {
  const store = new Map();
  const until = new Map(); // key → expiry time (ms) on the fake clock
  const state = { up: true };
  const live = (k) => store.has(k) && Date.now() < until.get(k);
  return {
    _store: store, _until: until, _state: state,
    isAvailable: () => state.up,
    get: jest.fn(async (k) => (state.up && live(k) ? store.get(k) : null)),
    set: jest.fn(async (k, v, ttl) => { if (!state.up) return false; store.set(k, v); until.set(k, ttl ? Date.now() + ttl * 1000 : Infinity); return true; }),
    delete: jest.fn(async (k) => { store.delete(k); until.delete(k); return true; }),
    getTTL: jest.fn(async (k) => (!state.up ? -1 : (live(k) ? Math.ceil((until.get(k) - Date.now()) / 1000) : -2))),
    expire: jest.fn(async (k, s) => { if (!live(k)) return false; until.set(k, Date.now() + s * 1000); return true; }),
  };
});
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../../shared/services/quiz/web-quiz-kid', () => ({ kidOf: (id) => (id ? `k_${String(id).slice(-2)}` : null) }));

const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const redis = require('../../../shared/services/cache/railway-redis.service');
const IdFlags = require('../../../shared/services/quiz/web-quiz-identity-flags');
const HubFlags = require('../../../shared/services/quiz/web-quiz-hub-flags');
const Queue = require('../../../shared/services/quiz/web-quiz-join-queue');

const T1 = '10000000-0000-4000-8000-000000000001';
const C1 = 'c0000000-0000-4000-8000-000000000001';
const L1 = 'a0000000-0000-4000-8000-000000000001';
const SC1 = '30000000-0000-4000-8000-000000000001';
const Q1 = '20000000-0000-4000-8000-000000000001';
const r = (n) => `b0000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;
const c = (n) => `d0000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;
const P = (n) => `92000000${String(600 + n).padStart(4, '0')}`;
const roster = (id, name) => ({ id, list_id: L1, student_name: name, student_name_urdu: null, status: 'active', is_active: true, merged_into: null });
const loose = (id, name, extra = {}) => ({ id, list_id: null, student_name: name, status: 'active', is_active: true, merged_into: null, enrolled_by_user_id: T1, self_reported_class: '3', phone: null, ...extra });
const sess = (id, student, extra = {}) => ({ id, student_id: student, quiz_id: Q1, share_code_id: SC1, parent_phone: null, device_ref: null, user_id: null, ...extra });

let fake;
function seed() {
  fake = makeFake({
    app_settings: [{ key: 'web_quiz_hub', value: true }, { key: 'web_quiz_identity_canon', value: true }],
    classes: [{ id: C1, grade_code: '3', is_active: true }],
    class_teachers: [{ class_id: C1, teacher_user_id: T1, is_active: true }],
    student_lists: [{ id: L1, user_id: T1, class_name: 'Class 3', class_id: C1, is_active: true }],
    class_enrollments: [5, 6, 8].map((n) => ({ class_id: C1, student_id: r(n), is_active: true })),
    students: [roster(r(5), 'Hamza Testwala'), roster(r(6), 'Omar Testwala'), roster(r(8), 'Bilal Testwala'),
      loose(c(3), 'Omar Testwala'), loose(c(33), 'Omar  Testwala'), loose(c(7), 'Hamza'),
      loose(c(8), 'Bilal Testwala'), loose(c(88), 'Bilal  Testwala')],
    quiz_sessions: [sess('s3', c(3), { parent_phone: P(3), device_ref: 'dev-3' }), sess('s33', c(33), { device_ref: 'dev-9' }), sess('s7', c(7), { parent_phone: P(7) }),
      sess('s8', c(8), { parent_phone: P(8), device_ref: 'dev-8' }), sess('s88', c(88), { device_ref: 'dev-88' })],
    quiz_share_codes: [{ id: SC1, teacher_user_id: T1, class_id: null }],
    quizzes: [{ id: Q1, teacher_id: T1, list_id: null }],
    merge_log: [],
  });
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
  IdFlags._resetCache(); HubFlags._resetCache(); Queue._resetPrecisionCache(); Queue._resetQueueCache();
}
const MIN = 60 * 1000;
let t0;
const at = (minutes) => { clock = t0 + minutes * MIN; };
const calls = () => fake.calls.length;
const computeReads = (from) => fake.calls.slice(from).filter((x) => x.op === 'select' && ['students', 'quiz_sessions'].includes(x.table)).length;
const PAIR1 = { looseId: c(3), candidateId: r(6) };
const tap = (pair, decision) => Queue.decide({ teacherUserId: T1, ...pair, decision });
const theKey = () => [...redis._store.keys()][0];

beforeEach(() => {
  jest.clearAllMocks();
  t0 = Date.UTC(2026, 9, 16, 8, 0, 0);
  clock = t0;
  if (!jest.isMockFunction(Date.now)) jest.spyOn(Date, 'now').mockImplementation(() => clock);
  redis._store.clear(); redis._until.clear(); redis._state.up = true;
  seed();
});
afterAll(() => { jest.restoreAllMocks(); });

describe('a read slides the kept queue', () => {
  test('a tab read at 9 min slides the key: expire(key, QUEUE_TTL_S) is called; the decision at 11 min reads the cache (0 students/quiz_sessions compute reads)', async () => {
    await Queue.candidatesFor(T1);
    const key = theKey();
    at(9);
    const before9 = calls();
    expect((await Queue.candidatesFor(T1)).length).toBe(2);
    expect(computeReads(before9)).toBe(0);
    expect(redis.expire).toHaveBeenCalledWith(key, Queue.QUEUE_TTL_S);
    at(11);
    const before11 = calls();
    redis.set.mockClear();
    expect(await tap(PAIR1, 'no')).toEqual({ ok: true, decision: 'no' });
    expect(computeReads(before11)).toBe(0);
    // the decision's own cache read slid the key again (to 21 min); its edit keeps that remaining TTL (600 s)
    expect(redis.expire).toHaveBeenLastCalledWith(key, Queue.QUEUE_TTL_S);
    expect(redis.set.mock.calls[redis.set.mock.calls.length - 1][2]).toBe(600);
    expect(redis.delete).not.toHaveBeenCalled();
  });

  test('a hit 61 min after the compute is not slid: the next read recomputes and sets a fresh entry (set called with the full TTL; expire not called)', async () => {
    await Queue.candidatesFor(T1);
    const key = theKey();
    for (const m of [9, 18, 27, 36, 45, 54]) {
      at(m);
      const b = calls();
      await Queue.candidatesFor(T1);
      expect(computeReads(b)).toBe(0);   // every read within the hour is served from the slid key
    }
    at(61);
    redis.expire.mockClear(); redis.set.mockClear();
    const b = calls();
    expect((await Queue.candidatesFor(T1)).length).toBe(2);
    expect(computeReads(b)).toBeGreaterThan(0);
    expect(redis.expire).not.toHaveBeenCalled();
    expect(redis.set).toHaveBeenCalledTimes(1);
    expect(redis.set.mock.calls[0]).toEqual([key, { at: t0 + 61 * MIN, rows: expect.any(Array) }, Queue.QUEUE_TTL_S]);
    expect(Queue.QUEUE_MAX_AGE_S).toBe(60 * 60);
  });

  test('Redis down: the local copy\'s 10-min expiry counts from the last read, its 60-min cap from the compute', async () => {
    redis._state.up = false;
    await Queue.candidatesFor(T1);
    for (const m of [9, 18, 27, 36, 45, 54]) {
      at(m);
      const b = calls();
      await Queue.candidatesFor(T1);
      expect(computeReads(b)).toBe(0);
    }
    // at 61 min the last read was 7 min ago, but the copy was computed 61 min ago → worked out afresh
    at(61);
    const b61 = calls();
    await Queue.candidatesFor(T1);
    expect(computeReads(b61)).toBeGreaterThan(0);
    // and a copy left unread for more than 10 min expires as before
    at(72);
    const b72 = calls();
    await Queue.candidatesFor(T1);
    expect(computeReads(b72)).toBeGreaterThan(0);
    expect(redis.set).not.toHaveBeenCalled();
  });

  test('Redis down: a decision keeps the local copy alive from its last read', async () => {
    redis._state.up = false;
    await Queue.candidatesFor(T1);
    at(9);
    await Queue.candidatesFor(T1);
    at(11);
    const b = calls();
    expect(await tap(PAIR1, 'no')).toEqual({ ok: true, decision: 'no' });
    at(15);
    expect((await Queue.candidatesFor(T1)).map((x) => x.loose_id)).toEqual([c(8)]);
    expect(computeReads(b)).toBe(0);
  });
});

describe('golden', () => {
  test('a miss still sets the full TTL, as today', async () => {
    await Queue.candidatesFor(T1);
    expect(redis.set).toHaveBeenCalledTimes(1);
    expect(redis.set.mock.calls[0]).toEqual([theKey(), { at: t0, rows: expect.any(Array) }, Queue.QUEUE_TTL_S]);
    expect(redis.expire).not.toHaveBeenCalled();
  });

  test('editQueue after a slide keeps the remaining TTL (getTTL)', async () => {
    await Queue.candidatesFor(T1);
    at(5);
    await Queue.candidatesFor(T1);
    at(7);
    redis.set.mockClear(); redis.getTTL.mockClear();
    expect(await tap(PAIR1, 'no')).toEqual({ ok: true, decision: 'no' });
    const reported = await redis.getTTL.mock.results[redis.getTTL.mock.results.length - 1].value;
    expect(redis.set.mock.calls[redis.set.mock.calls.length - 1][2]).toBe(reported);
    expect(redis.delete).not.toHaveBeenCalled();
  });
});
