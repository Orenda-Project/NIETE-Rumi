'use strict';
/**
 * The teacher join queue (web-quiz-join-queue.js): a configured test teacher's decisions never feed a tier's
 * teacher-accepted share or its hold (precisionByTier reads the fixture teachers once per computation, from
 * app_settings `web_quiz_fixture_rule` through web-quiz-fixture.js, and leaves their merge_log rows out of every count),
 * and the kept queue lives QUEUE_TTL_S = 30 minutes, so a decision 25 minutes after the tab was opened, with no read in
 * between, still reads it (the tab pages make no request of their own). The hour cap is unchanged.
 * Supabase (in-memory, filters applied, every call recorded) and Redis (a Map whose keys expire on a fake clock) are the
 * faked boundaries; the module and the fixture helper run for real. The seed is the cache-slide suite's.
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
const TF = '10000000-0000-4000-8000-000000000009'; // the configured test teacher
const C1 = 'c0000000-0000-4000-8000-000000000001';
const L1 = 'a0000000-0000-4000-8000-000000000001';
const SC1 = '30000000-0000-4000-8000-000000000001';
const Q1 = '20000000-0000-4000-8000-000000000001';
const r = (n) => `b0000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;
const c = (n) => `d0000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;
const x = (n) => `e0000000-0000-4000-8000-${String(n).padStart(12, '0')}`; // pairs of no served row
const P = (n) => `92000000${String(600 + n).padStart(4, '0')}`;
const roster = (id, name) => ({ id, list_id: L1, student_name: name, student_name_urdu: null, status: 'active', is_active: true, merged_into: null });
const loose = (id, name, extra = {}) => ({ id, list_id: null, student_name: name, status: 'active', is_active: true, merged_into: null, enrolled_by_user_id: T1, self_reported_class: '3', phone: null, ...extra });
const sess = (id, student, extra = {}) => ({ id, student_id: student, quiz_id: Q1, share_code_id: SC1, parent_phone: null, device_ref: null, user_id: null, ...extra });

const TIER = 'roster_unique_with_loose';
let seq = 0;
const decision = (teacher, d) => {
  seq += 1;
  return { id: seq, loose_id: x(seq), candidate_id: x(1000 + seq), teacher_id: teacher, decided_at: new Date(Date.UTC(2026, 9, 15, 8, 0, seq)).toISOString(), decision: d, source: 'queue', tier: TIER };
};
const many = (teacher, d, k) => Array.from({ length: k }, () => decision(teacher, d));
const mixed = () => [...many(TF, 'same', 3), ...many(TF, 'no', 2), ...many(TF, 'undo', 1), ...many(T1, 'same', 2), ...many(T1, 'no', 1)];
const RULE = (value) => ({ key: 'web_quiz_fixture_rule', value });

let fake;
let reads; // every query: {table, eqs: [[col, val]], neqs: [[col, val]]}
function seed({ mergeLog = [], rule = RULE({ student_lists: [], teachers: [TF] }) } = {}) {
  fake = makeFake({
    app_settings: [{ key: 'web_quiz_hub', value: true }, { key: 'web_quiz_identity_canon', value: true }, ...(rule ? [rule] : [])],
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
    merge_log: mergeLog,
  });
  reads = [];
  const from = (t) => {
    const b = fake.from(t);
    const q = { table: t, eqs: [], neqs: [] };
    reads.push(q);
    const eq = b.eq; const neq = b.neq;
    b.eq = (col, v) => { q.eqs.push([col, v]); return eq(col, v); };
    b.neq = (col, v) => { q.neqs.push([col, v]); return neq(col, v); };
    return b;
  };
  Object.assign(supabase, { from, rpc: fake.rpc });
  IdFlags._resetCache(); HubFlags._resetCache(); Queue._resetPrecisionCache(); Queue._resetQueueCache();
}
const MIN = 60 * 1000;
let t0;
const at = (minutes) => { clock = t0 + minutes * MIN; };
const calls = () => fake.calls.length;
const computeReads = (from) => fake.calls.slice(from).filter((y) => y.op === 'select' && ['students', 'quiz_sessions'].includes(y.table)).length;
const fixtureReads = () => reads.filter((q) => q.table === 'app_settings' && q.eqs.some(([col, v]) => col === 'key' && v === 'web_quiz_fixture_rule')).length;
const countReads = () => reads.filter((q) => q.table === 'merge_log' && q.eqs.some(([col, v]) => col === 'source' && v === 'queue')).length;
const PAIR1 = { looseId: c(3), candidateId: r(6) };
const PAIR2 = { looseId: c(8), candidateId: r(8) };
const tap = (pair, d) => Queue.decide({ teacherUserId: T1, ...pair, decision: d });
const tierOf = async () => (await Queue.precisionByTier()).find((y) => y.tier === TIER);

beforeEach(() => {
  jest.clearAllMocks();
  seq = 0;
  t0 = Date.UTC(2026, 9, 16, 8, 0, 0);
  clock = t0;
  if (!jest.isMockFunction(Date.now)) jest.spyOn(Date, 'now').mockImplementation(() => clock);
  redis._store.clear(); redis._until.clear(); redis._state.up = true;
  seed();
});
afterAll(() => { jest.restoreAllMocks(); });

describe('the deciding teacher', () => {
  test('decisions by a configured test teacher count for nothing: n, same, no, undo of the tier come from the real teacher only', async () => {
    seed({ mergeLog: mixed() });
    expect(await tierOf()).toMatchObject({ same: 2, no: 1, undo: 0, n: 3, precision: 0.6667, held: false });
    // the decider filter is on the count query itself: one neq per configured test teacher
    const q = reads.filter((y) => y.table === 'merge_log' && y.eqs.some(([col]) => col === 'decision'));
    expect(q.length).toBe(Queue.TIERS.length * 3);
    q.forEach((y) => expect(y.neqs).toEqual([['teacher_id', TF]]));
  });

  test('a tier with only test-teacher decisions reads 0/0/0/0 and is not held', async () => {
    seed({ mergeLog: [...many(TF, 'same', 30), ...many(TF, 'no', 30)] });
    expect(await tierOf()).toEqual({ tier: TIER, n: 0, same: 0, no: 0, undo: 0, excluded_n: 60, precision: null, wilson_lower_95: null, held: false });
    Queue._resetPrecisionCache();
    expect(await Queue.servedTiers()).toEqual([TIER]);
    expect((await Queue.candidatesFor(T1)).map((y) => y.loose_id)).toEqual([c(3), c(8)]);
  });
});

describe('golden', () => {
  const today = { same: 5, no: 3, undo: 1, n: 7, precision: 0.5714, held: false };
  test('the key absent → today\'s count (the test teacher\'s decisions counted)', async () => {
    seed({ mergeLog: mixed(), rule: null });
    expect(await tierOf()).toMatchObject(today);
    reads.filter((y) => y.table === 'merge_log').forEach((y) => expect(y.neqs).toEqual([]));
  });

  test.each([['a string', 'x'], ['an array', []], ['teachers not a list', { teachers: 'a' }]])('the key malformed (%s) → today\'s count', async (_, value) => {
    seed({ mergeLog: mixed(), rule: RULE(value) });
    expect(await tierOf()).toMatchObject(today);
  });

  test('the 60-s precision cache is unchanged: two reads within 60 s → one set of merge_log reads and one fixture read', async () => {
    seed({ mergeLog: mixed() });
    const first = await Queue.precisionByTier();
    clock = t0 + 59 * 1000;
    expect(await Queue.precisionByTier()).toEqual(first);
    expect(countReads()).toBe(Queue.TIERS.length * 4); // same, no, undo + the excluded count, per tier
    expect(fixtureReads()).toBe(1);
    clock = t0 + 61 * 1000;
    await Queue.precisionByTier();
    expect(countReads()).toBe(Queue.TIERS.length * 4 * 2);
    expect(fixtureReads()).toBe(2);
  });
});

describe('the kept queue lives 30 minutes', () => {
  test('a decision 25 minutes after the compute, with no read in between, reads the kept queue (0 students/quiz_sessions compute reads)', async () => {
    await Queue.candidatesFor(T1);
    expect(Queue.QUEUE_TTL_S).toBe(30 * 60);
    expect(redis.set).toHaveBeenCalledTimes(1);
    expect(redis.set.mock.calls[0][2]).toBe(Queue.QUEUE_TTL_S);
    at(25);
    const b = calls();
    expect(await tap(PAIR1, 'no')).toEqual({ ok: true, decision: 'no' });
    expect(computeReads(b)).toBe(0);
    expect(redis.delete).not.toHaveBeenCalled();
  });

  test('golden: reads at 20, 40 and 59 min slide the key; 61 min from the compute the next read is worked out afresh', async () => {
    await Queue.candidatesFor(T1);
    for (const m of [20, 40]) {
      at(m);
      const b = calls();
      await Queue.candidatesFor(T1);
      expect(computeReads(b)).toBe(0);
    }
    at(59);
    const b59 = calls();
    await Queue.candidatesFor(T1);
    expect(computeReads(b59)).toBe(0);
    at(61);
    const b61 = calls();
    expect((await Queue.candidatesFor(T1)).length).toBe(2);
    expect(computeReads(b61)).toBeGreaterThan(0);
    expect(Queue.QUEUE_MAX_AGE_S).toBe(60 * 60);
  });

  test('Redis down: the local copy lives 30 minutes from its last read', async () => {
    redis._state.up = false;
    await Queue.candidatesFor(T1);
    at(25);
    const b25 = calls();
    expect(await tap(PAIR1, 'no')).toEqual({ ok: true, decision: 'no' });
    expect(computeReads(b25)).toBe(0);
    at(56); // 31 min after the last read
    const b56 = calls();
    expect(await tap(PAIR2, 'no')).toEqual({ ok: true, decision: 'no' });
    expect(computeReads(b56)).toBeGreaterThan(0);
    expect(redis.set).not.toHaveBeenCalled();
  });
});

describe('an undo of my own \'same\' needs no roster read', () => {
  const ROSTER_TABLES = ['class_teachers', 'student_lists', 'classes', 'class_enrollments'];
  const rosterReads = (slice) => slice.filter((y) => y.op === 'select' && (ROSTER_TABLES.includes(y.table) || y.table === 'students')).length;
  const writes = (slice) => slice.filter((y) => y.op !== 'select').map((y) => `${y.op}:${y.table}`);

  test('undo of my own \'same\': 0 reads of class_teachers/student_lists/class_enrollments/students-by-roster (the roster read) between the undo call and its merge_log write; the pair is restored to the kept queue (cache-filter suite\'s restore behaviour unchanged)', async () => {
    await Queue.candidatesFor(T1);
    expect(await tap(PAIR1, 'same')).toEqual({ ok: true, decision: 'same' });
    expect((await Queue.candidatesFor(T1)).map((y) => y.loose_id)).toEqual([c(8)]);
    const b = calls();
    expect(await tap(PAIR1, 'undo')).toEqual({ ok: true, decision: 'undo' });
    const during = fake.calls.slice(b);
    const logAt = during.findIndex((y) => y.op === 'insert' && y.table === 'merge_log');
    expect(logAt).toBeGreaterThan(-1);
    expect(rosterReads(during.slice(0, logAt))).toBe(0);
    expect(writes(during)).toEqual(['update:students', 'insert:merge_log']);
    expect(fake.db.students.find((s) => s.id === c(3))).toMatchObject({ merged_into: null, status: 'active', is_active: true });
    expect(fake.db.merge_log[fake.db.merge_log.length - 1]).toMatchObject({ teacher_id: T1, loose_id: c(3), candidate_id: r(6), decision: 'undo', source: 'queue', tier: TIER });
    const b2 = calls();
    expect((await Queue.candidatesFor(T1)).map((y) => y.loose_id)).toEqual([c(3), c(8)]);
    expect(computeReads(b2)).toBe(0);
  });

  test('golden: undo of a pair whose last decision is not my \'same\' → {ok:false, reason:\'nothing_to_undo\'}, nothing written', async () => {
    await Queue.candidatesFor(T1);
    const b = calls();
    expect(await tap(PAIR2, 'undo')).toEqual({ ok: false, reason: 'nothing_to_undo' });
    expect(writes(fake.calls.slice(b))).toEqual([]);
    expect(await tap(PAIR2, 'no')).toEqual({ ok: true, decision: 'no' });
    const b2 = calls();
    expect(await tap(PAIR2, 'undo')).toEqual({ ok: false, reason: 'nothing_to_undo' });
    expect(writes(fake.calls.slice(b2))).toEqual([]);
  });

  test('golden: undo when the loose row is no longer merged_into the candidate → nothing_to_undo', async () => {
    await Queue.candidatesFor(T1);
    expect(await tap(PAIR1, 'same')).toEqual({ ok: true, decision: 'same' });
    Object.assign(fake.db.students.find((s) => s.id === c(3)), { merged_into: null, status: 'active', is_active: true });
    const before = fake.db.merge_log.length;
    expect(await tap(PAIR1, 'undo')).toEqual({ ok: false, reason: 'nothing_to_undo' });
    expect(fake.db.merge_log.length).toBe(before);
  });
});
