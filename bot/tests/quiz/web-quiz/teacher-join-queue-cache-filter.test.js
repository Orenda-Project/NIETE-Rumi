'use strict';
/**
 * The teacher join queue's per-teacher cache after a tap (web-quiz-join-queue.js): a written 'same' / 'no' takes its
 * pair out of the cached queue (a 'same' takes every row of that loose child with it) and the key keeps its remaining
 * TTL, so the next tab read and the next tap do not recompute; an undo puts back the rows its 'same' took out (an undo
 * of unknown tier and a refused stale pair drop the key).
 * Supabase (in-memory, filters applied, every call recorded) and Redis (a Map with TTLs) are the faked boundaries; the
 * module runs for real. The seed is the cache suite's plus a second served pair (Bilal).
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/services/cache/railway-redis.service', () => {
  const store = new Map();
  const ttls = new Map();
  const state = { up: true };
  return {
    _store: store, _ttls: ttls, _state: state,
    isAvailable: () => state.up,
    get: jest.fn(async (k) => (state.up && store.has(k) ? store.get(k) : null)),
    set: jest.fn(async (k, v, ttl) => { if (!state.up) return false; store.set(k, v); ttls.set(k, ttl == null ? -1 : ttl); return true; }),
    delete: jest.fn(async (k) => { store.delete(k); ttls.delete(k); return true; }),
    // ioredis TTL: seconds left; -1 when the key has no TTL, -2 when it is missing (railway-redis getTTL; -1 on error)
    getTTL: jest.fn(async (k) => (!state.up ? -1 : (store.has(k) ? ttls.get(k) : -2))),
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
      // a second served pair: the roster-unique Bilal with another loose Bilal on another device (blocked → queue)
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
const calls = () => fake.calls.length;
const COMPUTE = ['students', 'quiz_sessions', 'class_teachers', 'student_lists', 'classes', 'class_enrollments', 'quiz_share_codes', 'quizzes'];
const computeReads = (from) => fake.calls.slice(from).filter((x) => x.op === 'select' && COMPUTE.includes(x.table)).length;
const studentSessionReads = (from) => fake.calls.slice(from).filter((x) => x.op === 'select' && ['students', 'quiz_sessions'].includes(x.table)).length;
const pairs = (rows) => rows.map((x) => [x.loose_id, x.candidate_id]);
const PAIR1 = { looseId: c(3), candidateId: r(6) };   // Omar
const PAIR2 = { looseId: c(8), candidateId: r(8) };   // Bilal
const tap = (pair, decision) => Queue.decide({ teacherUserId: T1, ...pair, decision });
const theKey = () => [...redis._store.keys()][0];

beforeEach(() => { jest.clearAllMocks(); redis._store.clear(); redis._ttls.clear(); redis._state.up = true; seed(); });

describe('a written tap takes its pair out of the cached queue', () => {
  test('two decisions back to back: the second reads the cache (0 compute), the first pair absent', async () => {
    expect(pairs(await Queue.candidatesFor(T1))).toEqual([[c(3), r(6)], [c(8), r(8)]]);
    expect(await tap(PAIR1, 'no')).toEqual({ ok: true, decision: 'no' });
    const before = calls();
    expect(await tap(PAIR2, 'no')).toEqual({ ok: true, decision: 'no' });
    const second = fake.calls.slice(before);
    // the second tap reads merge_log only (its own last decision + the tier counts) and writes its merge_log row
    expect([...new Set(second.filter((x) => x.op === 'select').map((x) => x.table))]).toEqual(['merge_log']);
    expect(second.filter((x) => x.op !== 'select').map((x) => `${x.op}:${x.table}`)).toEqual(['insert:merge_log']);
    expect(computeReads(before)).toBe(0);
    const mid = calls();
    expect(await Queue.candidatesFor(T1)).toEqual([]);
    expect(computeReads(mid)).toBe(0);
  });

  test('a \'no\' keeps the key with its remaining TTL: set() called with the TTL getTTL reported', async () => {
    await Queue.candidatesFor(T1);
    const key = theKey();
    const { at, rows: cached } = redis._store.get(key);   // both tiers, ungated (compute()'s rows)
    redis.set.mockClear();
    redis.getTTL.mockResolvedValueOnce(437);
    expect(await tap(PAIR1, 'no')).toEqual({ ok: true, decision: 'no' });
    expect(redis.getTTL).toHaveBeenCalledWith(key);
    expect(redis.set.mock.calls[redis.set.mock.calls.length - 1]).toEqual([key, { at, rows: cached.filter((x) => x.loose_id !== c(3)) }, 437]);
    expect(redis.delete).not.toHaveBeenCalled();
  });

  test('a \'same\' takes every row of that loose child with it', async () => {
    await Queue.candidatesFor(T1);
    const key = theKey();
    // a second row for the same loose child (a cached row of another candidate): match() serves one candidate per child
    const hit = redis._store.get(key);
    const extra = { ...hit.rows.find((x) => x.loose_id === c(3)), candidate_id: r(5), candidate_first: 'Hamza' };
    redis._store.set(key, { at: hit.at, rows: [...hit.rows, extra] });
    expect(await tap(PAIR1, 'same')).toEqual({ ok: true, decision: 'same' });
    expect(redis.delete).not.toHaveBeenCalled();
    const left = redis._store.get(key);
    expect(left.rows.filter((x) => x.loose_id === c(3))).toEqual([]);
    expect(left.rows).toEqual(hit.rows.filter((x) => x.loose_id !== c(3)));   // every other row kept, verbatim
    const before = calls();
    expect(pairs(await Queue.candidatesFor(T1))).toEqual([[c(8), r(8)]]);
    expect(computeReads(before)).toBe(0);
  });

  test('Redis down: the local copy is filtered, kept for the rest of its TTL', async () => {
    redis._state.up = false;
    expect(pairs(await Queue.candidatesFor(T1))).toEqual([[c(3), r(6)], [c(8), r(8)]]);
    expect(await tap(PAIR1, 'no')).toEqual({ ok: true, decision: 'no' });
    const before = calls();
    expect(await tap(PAIR2, 'no')).toEqual({ ok: true, decision: 'no' });
    expect(computeReads(before)).toBe(0);
    const mid = calls();
    expect(await Queue.candidatesFor(T1)).toEqual([]);
    expect(computeReads(mid)).toBe(0);
    expect(redis.set).not.toHaveBeenCalled();
  });

  test('getTTL missing or -2/-1: the key is dropped (never a stale pair)', async () => {
    for (const ttl of [-2, -1, null]) {
      jest.clearAllMocks(); redis._store.clear(); redis._ttls.clear(); seed();
      await Queue.candidatesFor(T1);
      const key = theKey();
      redis.getTTL.mockResolvedValueOnce(ttl);
      expect(await tap(PAIR1, 'no')).toEqual({ ok: true, decision: 'no' });
      expect(redis.delete).toHaveBeenCalledWith(key);
      expect(redis._store.has(key)).toBe(false);
    }
    const saved = redis.getTTL;
    delete redis.getTTL;
    try {
      jest.clearAllMocks(); redis._store.clear(); redis._ttls.clear(); seed();
      await Queue.candidatesFor(T1);
      const key = theKey();
      expect(await tap(PAIR1, 'no')).toEqual({ ok: true, decision: 'no' });
      expect(redis.delete).toHaveBeenCalledWith(key);
      const before = calls();
      expect(pairs(await Queue.candidatesFor(T1))).toEqual([[c(8), r(8)]]);
      expect(computeReads(before)).toBeGreaterThan(0);
    } finally {
      redis.getTTL = saved;
    }
  });
});

describe('an undo puts back what its \'same\' took out', () => {
  test('undo → the next same reads the cache (≤ 1 compute in total across undo + the next same); the undone pair is served again from the cache', async () => {
    const first = await Queue.candidatesFor(T1);
    const key = theKey();
    expect(await tap(PAIR1, 'same')).toEqual({ ok: true, decision: 'same' });
    const before = calls();
    expect(await tap(PAIR1, 'undo')).toEqual({ ok: true, decision: 'undo' });
    expect(redis.delete).not.toHaveBeenCalled();
    expect(redis._store.has(key)).toBe(true);
    const mid = calls();
    expect(await Queue.candidatesFor(T1)).toEqual(first);   // the pair back, verbatim, from the cache
    expect(studentSessionReads(mid)).toBe(0);
    const mid2 = calls();
    expect(await tap(PAIR1, 'same')).toEqual({ ok: true, decision: 'same' });   // the served-pair path
    expect(studentSessionReads(mid2)).toBe(0);
    expect(fake.db.students.find((x) => x.id === c(3))).toMatchObject({ status: 'merged', merged_into: r(6) });
    // across undo + read + same: the undo's own roster check only, never a loose recompute
    expect(fake.calls.slice(before).filter((x) => x.op === 'select' && x.table === 'quiz_sessions').length).toBe(0);
    expect(redis.delete).not.toHaveBeenCalled();
  });

  test('undo with no known tier (the same row carries tier null) → the key drops', async () => {
    await Queue.candidatesFor(T1);
    const key = theKey();
    expect(await tap(PAIR1, 'same')).toEqual({ ok: true, decision: 'same' });
    fake.db.merge_log.filter((x) => x.decision === 'same').forEach((x) => { x.tier = null; });
    redis.delete.mockClear();
    expect(await tap(PAIR1, 'undo')).toEqual({ ok: true, decision: 'undo' });
    expect(redis.delete).toHaveBeenCalledWith(key);
    expect(redis._store.has(key)).toBe(false);
    const before = calls();
    expect(pairs(await Queue.candidatesFor(T1))).toEqual([[c(3), r(6)], [c(8), r(8)]]);
    expect(studentSessionReads(before)).toBeGreaterThan(0);
  });

  test('Redis down: the undone pair goes back into the local copy, no recompute', async () => {
    redis._state.up = false;
    const first = await Queue.candidatesFor(T1);
    expect(await tap(PAIR1, 'same')).toEqual({ ok: true, decision: 'same' });
    expect(pairs(await Queue.candidatesFor(T1))).toEqual([[c(8), r(8)]]);
    expect(await tap(PAIR1, 'undo')).toEqual({ ok: true, decision: 'undo' });
    const mid = calls();
    expect(await Queue.candidatesFor(T1)).toEqual(first);
    expect(studentSessionReads(mid)).toBe(0);
  });
});

describe('golden: the stale path still drops the key', () => {
  test('a stale pair refused not_loose still drops the key', async () => {
    await Queue.candidatesFor(T1);
    const key = theKey();
    fake.db.class_enrollments.push({ class_id: C1, student_id: c(3), is_active: true });   // the child was enrolled meanwhile
    expect(await tap(PAIR1, 'same')).toEqual({ ok: false, reason: 'not_loose' });
    expect(redis.delete).toHaveBeenCalledWith(key);
    expect(redis.set).toHaveBeenCalledTimes(1);   // the first compute only: nothing written back
    expect(redis._store.has(key)).toBe(false);
  });
});
