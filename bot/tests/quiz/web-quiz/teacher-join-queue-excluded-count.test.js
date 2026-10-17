'use strict';
/**
 * The teacher join queue (web-quiz-join-queue.js): precisionByTier()'s per-tier result carries `excluded_n`, the
 * number of merge_log queue rows of that tier (any decision) made by a configured test teacher (app_settings
 * `web_quiz_fixture_rule` through web-quiz-fixture.js), the rows the tier's share leaves out. No configured teacher →
 * 0 with no extra read. Supabase (in-memory, filters applied, every call recorded) and Redis are the faked boundaries;
 * the module and the fixture helper run for real. The seed is the decider-filter suite's.
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
let t0;
const countReads = () => reads.filter((q) => q.table === 'merge_log' && q.eqs.some(([col, v]) => col === 'source' && v === 'queue')).length;
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

describe('excluded_n', () => {
  test('the tier\'s excluded_n counts the configured test teachers\' queue rows of that tier, all decisions', async () => {
    seed({ mergeLog: [...mixed(), { ...decision(TF, 'same'), tier: 'probable' }, { ...decision(TF, 'no'), source: 'job' }] });
    const all = await Queue.precisionByTier();
    expect(all.find((y) => y.tier === TIER)).toMatchObject({ same: 2, no: 1, undo: 0, n: 3, excluded_n: 6 });
    expect(all.find((y) => y.tier === 'probable')).toMatchObject({ n: 0, excluded_n: 1 });
    // one bounded head count per tier, on the configured ids only
    const q = reads.filter((y) => y.table === 'merge_log');
    expect(q.length).toBe(Queue.TIERS.length * 4);
  });

  test('golden: key absent → excluded_n 0 and no extra read (merge_log read count equals today\'s three per tier)', async () => {
    seed({ mergeLog: mixed(), rule: null });
    expect(await tierOf()).toMatchObject({ same: 5, no: 3, undo: 1, n: 7, excluded_n: 0 });
    expect(countReads()).toBe(Queue.TIERS.length * 3);
    expect(reads.filter((y) => y.table === 'merge_log').length).toBe(Queue.TIERS.length * 3);
  });

  test('the 60-s cache returns excluded_n with the rest', async () => {
    seed({ mergeLog: mixed() });
    const first = await Queue.precisionByTier();
    const n = reads.length;
    clock = t0 + 59 * 1000;
    const again = await Queue.precisionByTier();
    expect(again).toEqual(first);
    expect(again.find((y) => y.tier === TIER).excluded_n).toBe(6);
    expect(reads.length).toBe(n);
  });

  test('golden: a failed merge_log read → every tier held with excluded_n 0', async () => {
    seed({ mergeLog: mixed() });
    const from = supabase.from;
    supabase.from = (t) => {
      if (t !== 'merge_log') return from(t);
      const b = from(t);
      b.then = (res, rej) => Promise.resolve({ data: null, count: null, error: { message: 'down' } }).then(res, rej);
      return b;
    };
    const all = await Queue.precisionByTier();
    expect(all).toEqual(Queue.TIERS.map((tier) => ({ tier, n: 0, same: 0, no: 0, undo: 0, excluded_n: 0, precision: null, wilson_lower_95: null, held: true, error: true })));
  });
});
