'use strict';
/**
 * The teacher join queue's per-teacher cache (web-quiz-join-queue.js): the computed rows are kept per teacher for a
 * few minutes (Redis, a local fallback when Redis is down), read by the tab's candidatesFor() AND by decide(); every
 * decision drops the teacher's cache; decide() on a pair the cached queue serves verifies that pair only and goes
 * straight to the guarded write. Supabase (in-memory, filters applied, every call recorded) and Redis (a Map) are the
 * faked boundaries; the module runs for real. The seed is the join-queue suite's (Omar = the served pair).
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/services/cache/railway-redis.service', () => {
  const store = new Map();
  const state = { up: true };
  return {
    _store: store, _state: state,
    isAvailable: () => state.up,
    get: jest.fn(async (k) => (state.up && store.has(k) ? store.get(k) : null)),
    set: jest.fn(async (k, v) => { if (!state.up) return false; store.set(k, v); return true; }),
    delete: jest.fn(async (k) => { store.delete(k); return true; }),
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
function seed(on = true) {
  fake = makeFake({
    app_settings: on ? [{ key: 'web_quiz_hub', value: true }, { key: 'web_quiz_identity_canon', value: true }] : [{ key: 'web_quiz_hub', value: true }],
    classes: [{ id: C1, grade_code: '3', is_active: true }],
    class_teachers: [{ class_id: C1, teacher_user_id: T1, is_active: true }],
    student_lists: [{ id: L1, user_id: T1, class_name: 'Class 3', class_id: C1, is_active: true }],
    class_enrollments: [5, 6].map((n) => ({ class_id: C1, student_id: r(n), is_active: true })),
    students: [roster(r(5), 'Hamza Testwala'), roster(r(6), 'Omar Testwala'),
      loose(c(3), 'Omar Testwala'), loose(c(33), 'Omar  Testwala'), loose(c(7), 'Hamza')],
    quiz_sessions: [sess('s3', c(3), { parent_phone: P(3), device_ref: 'dev-3' }), sess('s33', c(33), { device_ref: 'dev-9' }), sess('s7', c(7), { parent_phone: P(7) })],
    quiz_share_codes: [{ id: SC1, teacher_user_id: T1, class_id: null }],
    quizzes: [{ id: Q1, teacher_id: T1, list_id: null }],
    merge_log: [],
  });
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
  IdFlags._resetCache(); HubFlags._resetCache(); Queue._resetPrecisionCache();
  if (typeof Queue._resetQueueCache === 'function') Queue._resetQueueCache();
}
const calls = () => fake.calls.length;
const reads = (table) => fake.calls.filter((x) => x.table === table && x.op === 'select').length;
const writes = () => fake.calls.filter((x) => x.op !== 'select').map((x) => `${x.op}:${x.table}`);
const SERVED = [{ loose_id: c(3), candidate_id: r(6) }];

beforeEach(() => { jest.clearAllMocks(); redis._store.clear(); redis._state.up = true; seed(); });

describe('the queue is computed once per teacher and kept', () => {
  test('a second candidatesFor within the TTL makes no supabase read beyond the switch and the tier hold', async () => {
    const first = await Queue.candidatesFor(T1);
    expect(first.map((x) => ({ loose_id: x.loose_id, candidate_id: x.candidate_id }))).toEqual(SERVED);
    const before = calls();
    const second = await Queue.candidatesFor(T1);
    expect(second).toEqual(first);
    const extra = fake.calls.slice(before).filter((x) => !['app_settings', 'merge_log'].includes(x.table));
    expect(extra).toEqual([]);
  });

  test('a decision drops the teacher\'s cache: the decided pair is gone on the next read, recomputed from the store', async () => {
    await Queue.candidatesFor(T1);
    expect(await Queue.decide({ teacherUserId: T1, looseId: c(3), candidateId: r(6), decision: 'no' })).toEqual({ ok: true, decision: 'no' });
    const before = calls();
    const after = await Queue.candidatesFor(T1);
    expect(after).toEqual([]);
    expect(reads('students') + reads('quiz_sessions')).toBeGreaterThan(0);
    expect(calls()).toBeGreaterThan(before);
  });

  test('Redis down -> the local fallback serves the same rows and still avoids the re-read', async () => {
    redis._state.up = false;
    const first = await Queue.candidatesFor(T1);
    expect(first.map((x) => x.loose_id)).toEqual([c(3)]);
    const before = calls();
    expect(await Queue.candidatesFor(T1)).toEqual(first);
    expect(fake.calls.slice(before).filter((x) => !['app_settings', 'merge_log'].includes(x.table))).toEqual([]);
  });
});

describe('decide() verifies only its own pair when the cached queue serves it', () => {
  test('"same" on a served pair: the guarded merge write + the merge_log insert, no roster or loose re-read', async () => {
    await Queue.candidatesFor(T1);
    const before = calls();
    expect(await Queue.decide({ teacherUserId: T1, looseId: c(3), candidateId: r(6), decision: 'same' })).toEqual({ ok: true, decision: 'same' });
    const after = fake.calls.slice(before);
    expect(after.filter((x) => x.op === 'select' && ['student_lists', 'class_teachers', 'classes', 'quiz_share_codes', 'quizzes', 'quiz_sessions'].includes(x.table))).toEqual([]);
    expect(after.filter((x) => x.op !== 'select').map((x) => `${x.op}:${x.table}`)).toEqual(['update:students', 'insert:merge_log']);
    expect(fake.db.students.find((s) => s.id === c(3))).toMatchObject({ status: 'merged', merged_into: r(6) });
  });

  test('a pair the queue does not serve keeps today\'s full checks: not_served, nothing written', async () => {
    await Queue.candidatesFor(T1);
    expect(await Queue.decide({ teacherUserId: T1, looseId: c(7), candidateId: r(5), decision: 'same' })).toEqual({ ok: false, reason: 'not_served' });
    expect(writes()).toEqual([]);
  });

  test('a stale cached pair cannot merge a child that moved: the guarded write refuses, not_loose', async () => {
    await Queue.candidatesFor(T1);
    fake.db.class_enrollments.push({ class_id: C1, student_id: c(3), is_active: true });   // the child was enrolled meanwhile
    expect(await Queue.decide({ teacherUserId: T1, looseId: c(3), candidateId: r(6), decision: 'same' })).toEqual({ ok: false, reason: 'not_loose' });
    expect(fake.db.students.find((s) => s.id === c(3)).merged_into).toBeNull();
  });
});

describe('golden', () => {
  test('switch off -> [] and no store read; the cold-cache rows are today\'s rows', async () => {
    seed(false);
    expect(await Queue.candidatesFor(T1)).toEqual([]);
    expect(reads('students')).toBe(0);
    seed(true);
    const rows = await Queue.candidatesFor(T1);
    expect(rows).toEqual([{ loose_id: c(3), candidate_id: r(6), first: 'Omar', candidate_first: 'Omar', father_first: null, candidate_father_first: null, class_id: C1, grade: 3,
      evidence: { tier: 'roster_unique_with_loose', name_words_matched: 2, same_grade: true, other_same_name_loose: true } }]);
  });
});
