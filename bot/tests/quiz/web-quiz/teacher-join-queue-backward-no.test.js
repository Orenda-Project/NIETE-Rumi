'use strict';
/**
 * The strict backward join (web-quiz-join-queue.js runBackwardJoin) after the teacher's own taps:
 *  - a child the teacher merged with "Same child" in the queue still counts as a same-name look-alike, so its twin on
 *    another phone stays blocked (never joined automatically) instead of turning strict once the first one is merged;
 *  - a pair the teacher answered "Different" (decision 'no') is never joined by the job, whatever the rule says
 *    (counts.refused_by_teacher).
 * Supabase (in-memory, filters applied) is the faked boundary, Redis and the loggers are mocked; the module runs for real.
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
const X = 'b0000000-0000-4000-8000-000000000001';   // the roster child
const A = 'd0000000-0000-4000-8000-000000000001';   // a loose look-alike on one family phone
const B = 'd0000000-0000-4000-8000-000000000002';   // a loose look-alike on another family phone
const P = (n) => `92000000${String(600 + n).padStart(4, '0')}`;
const roster = (id, name, extra = {}) => ({ id, list_id: L1, student_name: name, student_name_urdu: null, status: 'active', is_active: true, merged_into: null, ...extra });
const loose = (id, name, extra = {}) => ({ id, list_id: null, student_name: name, status: 'active', is_active: true, merged_into: null, enrolled_by_user_id: T1, self_reported_class: '3', phone: null, ...extra });
const sess = (id, student, extra = {}) => ({ id, student_id: student, quiz_id: Q1, share_code_id: SC1, parent_phone: null, device_ref: null, user_id: null, ...extra });
const merged = (id, name) => loose(id, name, { status: 'merged', merged_into: X, is_active: false });

let fake;
function seed({ students, merge_log = [] } = {}) {
  fake = makeFake({
    app_settings: [{ key: 'web_quiz_hub', value: true }, { key: 'web_quiz_identity_canon', value: true }],
    classes: [{ id: C1, grade_code: '3', is_active: true }],
    class_teachers: [{ class_id: C1, teacher_user_id: T1, is_active: true }],
    student_lists: [{ id: L1, user_id: T1, class_name: 'Class 3', class_id: C1, is_active: true }],
    class_enrollments: [{ class_id: C1, student_id: X, is_active: true }],
    students: students || [roster(X, 'Zara Testwala'), loose(A, 'Zara Testwala'), loose(B, 'Zara Testwala')],
    quiz_sessions: [sess('sa', A, { parent_phone: P(1), device_ref: 'dev-a' }), sess('sb', B, { parent_phone: P(2), device_ref: 'dev-b' })],
    quiz_share_codes: [{ id: SC1, teacher_user_id: T1, class_id: null }],
    quizzes: [{ id: Q1, teacher_id: T1, list_id: null }],
    merge_log,
  });
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
  IdFlags._resetCache(); HubFlags._resetCache(); Queue._resetPrecisionCache(); Queue._resetQueueCache();
}
const student = (id) => fake.db.students.find((s) => s.id === id);
const tap = (looseId, decision) => Queue.decide({ teacherUserId: T1, looseId, candidateId: X, decision });
const logRow = (looseId, decision, source) => ({ id: `m-${looseId.slice(-2)}-${source}`, loose_id: looseId, candidate_id: X, teacher_id: T1, decision, source, tier: null, decided_at: '2026-10-01T10:00:00.000Z' });

beforeEach(() => { jest.clearAllMocks(); redis._store.clear(); redis._ttls.clear(); redis._state.up = true; seed(); });

describe('a child the teacher merged still blocks its look-alike', () => {
  test('X on the roster; A and B loose look-alikes on different phones → both blocked; the teacher\'s \'same\' on A → B STAYS blocked (not strict), the dry run joins 0', async () => {
    const before = await Queue.runBackwardJoin();
    expect(before.labels).toEqual({ [A]: 'blocked', [B]: 'blocked' });
    expect(before.counts.joined).toBe(0);
    expect((await Queue.computeCandidates(T1)).map((x) => [x.loose_id, x.evidence.tier])).toEqual([[A, 'roster_unique_with_loose'], [B, 'roster_unique_with_loose']]);

    expect(await tap(A, 'same')).toEqual({ ok: true, decision: 'same' });
    expect(student(A)).toMatchObject({ merged_into: X, status: 'merged' });

    const after = await Queue.runBackwardJoin();
    expect(after.labels).toEqual({ [B]: 'blocked' });   // A is merged: never labelled or joined again
    expect(after.counts.joined).toBe(0);
    expect(after.counts.blocked).toBe(1);
    // the queue still asks the teacher about B; A (merged) is never served
    expect((await Queue.computeCandidates(T1)).map((x) => [x.loose_id, x.candidate_id, x.evidence.tier])).toEqual([[B, X, 'roster_unique_with_loose']]);
    // the real run writes nothing either
    const run = await Queue.runBackwardJoin({ dryRun: false });
    expect(run.counts.joined).toBe(0);
    expect(student(B).merged_into).toBeNull();
  });

  test('undo of A\'s \'same\' → A loose again, both blocked, joined 0', async () => {
    expect(await tap(A, 'same')).toEqual({ ok: true, decision: 'same' });
    expect(await tap(A, 'undo')).toEqual({ ok: true, decision: 'undo' });
    expect(student(A)).toMatchObject({ merged_into: null, status: 'active', is_active: true });
    const out = await Queue.runBackwardJoin();
    expect(out.labels).toEqual({ [A]: 'blocked', [B]: 'blocked' });
    expect(out.counts.joined).toBe(0);
  });

  test.each(['job', 'class_tab'])('a child merged by source \'%s\' (not the teacher\'s queue tap) is not a blocker: its look-alike stays strict', async (source) => {
    seed({ students: [roster(X, 'Zara Testwala'), merged(A, 'Zara Testwala'), loose(B, 'Zara Testwala')], merge_log: [logRow(A, 'same', source)] });
    const out = await Queue.runBackwardJoin();
    expect(out.labels).toEqual({ [B]: 'strict' });
    expect(out.counts.joined).toBe(1);
  });

  test('a child merged by the queue whose latest decision is no longer \'same\' is not a blocker', async () => {
    seed({ students: [roster(X, 'Zara Testwala'), merged(A, 'Zara Testwala'), loose(B, 'Zara Testwala')],
      merge_log: [logRow(A, 'same', 'queue'), { ...logRow(A, 'undo', 'queue'), id: 'm-undo', decided_at: '2026-10-02T10:00:00.000Z' }] });
    expect((await Queue.runBackwardJoin()).labels).toEqual({ [B]: 'strict' });
  });

  test('a child merged by the queue tap (seeded) blocks its look-alike exactly as the live tap does', async () => {
    seed({ students: [roster(X, 'Zara Testwala'), merged(A, 'Zara Testwala'), loose(B, 'Zara Testwala')], merge_log: [logRow(A, 'same', 'queue')] });
    const out = await Queue.runBackwardJoin();
    expect(out.labels).toEqual({ [B]: 'blocked' });
    expect(out.counts.joined).toBe(0);
  });
});

describe('the job keeps the teacher\'s "Different"', () => {
  test('the teacher\'s \'no\' on (B, X) → the job never joins B, counts.refused_by_teacher = 1, whatever route() says', async () => {
    seed({ students: [roster(X, 'Zara Testwala'), loose(B, 'Zara Testwala')] });   // B alone: the strict rule would join it
    expect((await Queue.runBackwardJoin()).labels).toEqual({ [B]: 'strict' });
    expect(await tap(B, 'no')).toEqual({ ok: true, decision: 'no' });
    const out = await Queue.runBackwardJoin();
    expect(out.labels).toEqual({ [B]: 'refused_by_teacher' });
    expect(out.counts).toMatchObject({ refused_by_teacher: 1, strict: 0, joined: 0 });
    const writesBefore = fake.calls.filter((x) => x.op !== 'select').length;
    const run = await Queue.runBackwardJoin({ dryRun: false });
    expect(run.counts).toMatchObject({ refused_by_teacher: 1, joined: 0 });
    expect(student(B).merged_into).toBeNull();
    expect(fake.calls.filter((x) => x.op !== 'select').length).toBe(writesBefore);
  });

  test('a phone + name match the teacher answered \'no\' is refused too', async () => {
    seed({ students: [roster(X, 'Zara Testwala', { parent_phone: P(2) }), loose(B, 'Zara Testwala')], merge_log: [logRow(B, 'no', 'queue')] });
    const out = await Queue.runBackwardJoin();
    expect(out.labels).toEqual({ [B]: 'refused_by_teacher' });
    expect(out.counts).toMatchObject({ refused_by_teacher: 1, phone_name: 0, joined: 0 });
  });

  test('an undo after the \'no\' (latest decision undo) lets the rule join again', async () => {
    seed({ students: [roster(X, 'Zara Testwala'), loose(B, 'Zara Testwala')],
      merge_log: [logRow(B, 'no', 'queue'), { ...logRow(B, 'undo', 'queue'), id: 'm-undo', decided_at: '2026-10-02T10:00:00.000Z' }] });
    const out = await Queue.runBackwardJoin();
    expect(out.labels).toEqual({ [B]: 'strict' });
    expect(out.counts).toMatchObject({ refused_by_teacher: 0, joined: 1 });
  });
});

describe('queueAge: the age of the teacher\'s kept queue (reads only)', () => {
  test('queueAge: null before the first read; ≥ 0 after candidatesFor; null again after the key drops (undo with unknown tier)', async () => {
    expect(await Queue.queueAge(T1)).toBeNull();
    await Queue.candidatesFor(T1);
    const age = await Queue.queueAge(T1);
    expect(Number.isInteger(age)).toBe(true);
    expect(age).toBeGreaterThanOrEqual(0);
    expect(await tap(A, 'same')).toEqual({ ok: true, decision: 'same' });
    expect(await Queue.queueAge(T1)).toBeGreaterThanOrEqual(0);   // the entry is kept, minus A
    fake.db.merge_log.filter((x) => x.decision === 'same').forEach((x) => { x.tier = null; });
    const writes = fake.calls.filter((x) => x.op !== 'select').length;
    const sets = redis.set.mock.calls.length;
    expect(await tap(A, 'undo')).toEqual({ ok: true, decision: 'undo' });
    expect(await Queue.queueAge(T1)).toBeNull();
    // queueAge itself computes nothing and writes nothing
    const n = fake.calls.length;
    await Queue.queueAge(T1);
    expect(fake.calls.length).toBe(n);
    expect(redis.set.mock.calls.length).toBe(sets);
    expect(fake.calls.filter((x) => x.op !== 'select').length).toBeGreaterThan(writes);   // the undo's own writes only
  });

  test('queueAge with Redis down reads the local copy', async () => {
    redis._state.up = false;
    expect(await Queue.queueAge(T1)).toBeNull();
    await Queue.candidatesFor(T1);
    expect(await Queue.queueAge(T1)).toBeGreaterThanOrEqual(0);
  });
});
