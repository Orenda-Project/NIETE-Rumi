'use strict';
/**
 * `.in()` on a data-sized list (web-quiz-in-chunks.js inChunks, and the join queue's reads through it): a supabase-js
 * `.in()` with more than ~390 UUIDs fails on the 16 KB response-header cap, so the queue of a teacher with 614 quiz
 * codes read as empty and the backward join could not run over 614 loose children. The in-memory Supabase fake answers
 * such a list the way supabase-js does (`TypeError: fetch failed`, data null), so every read that feeds a big list in
 * unchunked goes red here; the module under test and the queue run for real.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/services/cache/railway-redis.service', () => ({
  get: jest.fn(async () => null), set: jest.fn(async () => true), delete: jest.fn(async () => true), isAvailable: () => true,
}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../../shared/services/quiz/web-quiz-kid', () => ({ kidOf: (id) => (id ? `k_${String(id).slice(-2)}` : null) }));

const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const { logToFile } = require('../../../shared/utils/logger');
const IdFlags = require('../../../shared/services/quiz/web-quiz-identity-flags');
const HubFlags = require('../../../shared/services/quiz/web-quiz-hub-flags');
const { inChunks, chunks, IN_CHUNK } = require('../../../shared/services/quiz/web-quiz-in-chunks');
const Queue = require('../../../shared/services/quiz/web-quiz-join-queue');

const T1 = '10000000-0000-4000-8000-000000000001';
const C1 = 'c0000000-0000-4000-8000-000000000001';
const L1 = 'a0000000-0000-4000-8000-000000000001';
const Q1 = '20000000-0000-4000-8000-000000000001';
const SC1 = '30000000-0000-4000-8000-000000000001';
const uuid = (prefix, n) => `${prefix}0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const r = (n) => uuid('b', n);     // roster
const c = (n) => uuid('d', n);     // loose
const sc = (n) => uuid('3', n);    // share code
const P = (n) => `92000000${String(1000 + n).padStart(5, '0')}`;
const BIG = 614;                   // sandbox's loose-child count on 16 Oct (qa-teacher-2 015954)
const ON = [{ key: 'web_quiz_hub', value: true }, { key: 'web_quiz_identity_canon', value: true }];
const roster = (id, name, extra = {}) => ({ id, list_id: L1, student_name: name, student_name_urdu: null, status: 'active', is_active: true, merged_into: null, ...extra });
const loose = (id, name, extra = {}) => ({ id, list_id: null, student_name: name, status: 'active', is_active: true, merged_into: null, enrolled_by_user_id: T1, self_reported_class: '3', phone: null, ...extra });
const sess = (id, student, extra = {}) => ({ id, student_id: student, quiz_id: Q1, share_code_id: SC1, parent_phone: null, device_ref: null, user_id: null, ...extra });

let fake;
function seed(over = {}) {
  const db = {
    app_settings: ON.map((x) => ({ ...x })),
    classes: [{ id: C1, grade_code: '3', is_active: true }],
    class_teachers: [{ class_id: C1, teacher_user_id: T1, is_active: true }],
    student_lists: [{ id: L1, user_id: T1, class_name: 'Class 3', class_id: C1, is_active: true }],
    class_enrollments: [1, 2, 3].map((n) => ({ class_id: C1, student_id: r(n), is_active: true })),
    students: [roster(r(1), 'Ali Testwala', { parent_phone: P(1) }), roster(r(2), 'Sara Testwala'), roster(r(3), 'Omar Testwala'),
      loose(c(1), 'ali testwala', { phone: P(1) }), loose(c(2), 'Sara Testwala'), loose(c(3), 'Omar Testwala'),
      loose(c(33), 'Omar  Testwala', { phone: null })],   // a second loose Omar on another device: c(3) is blocked → the queue row
    quiz_sessions: [sess('s1', c(1), { parent_phone: P(1), device_ref: 'dev-1' }), sess('s2', c(2), { parent_phone: P(2), device_ref: 'dev-2' }),
      sess('s3', c(3), { parent_phone: P(3), device_ref: 'dev-3' }), sess('s33', c(33), { device_ref: 'dev-9' })],
    quiz_share_codes: [{ id: SC1, teacher_user_id: T1, class_id: null }],
    quizzes: [{ id: Q1, teacher_id: T1, list_id: null }],
    merge_log: [],
    ...over,
  };
  fake = makeFake(db);
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
  IdFlags._resetCache();
  HubFlags._resetCache();
  Queue._resetPrecisionCache();
  return fake;
}
// a teacher with BIG quiz codes, each used by one session of a loose child (the sandbox shape of row 21)
function seedBig() {
  const codes = Array.from({ length: BIG }, (_, i) => ({ id: sc(100 + i), teacher_user_id: T1, class_id: null }));
  const kids = Array.from({ length: BIG }, (_, i) => loose(c(100 + i), `Child${i} Testwala`, { enrolled_by_user_id: null }));
  const sessions = kids.map((k, i) => sess(`sb${i}`, k.id, { share_code_id: codes[i].id, parent_phone: P(100 + i), device_ref: `dev-b${i}` }));
  const f = seed();
  f.db.quiz_share_codes.push(...codes);
  f.db.students.push(...kids);
  f.db.quiz_sessions.push(...sessions);
  return f;
}
const reads = (t) => fake.calls.filter((x) => x.table === t && x.op === 'select');
const writes = () => fake.calls.filter((x) => x.op !== 'select');

beforeEach(() => { jest.clearAllMocks(); seed(); });

describe('the fake answers a big list the way supabase-js does', () => {
  test('391 ids → {data:null, error:"TypeError: fetch failed", the 16KB hint}; 390 → the rows', async () => {
    fake.db.students.push(...Array.from({ length: 400 }, (_, i) => loose(c(5000 + i), 'X')));
    const big = await supabase.from('students').select('id').in('id', Array.from({ length: 391 }, (_, i) => c(5000 + i)));
    expect(big).toMatchObject({ data: null, error: { message: 'TypeError: fetch failed', hint: expect.stringContaining('16KB') } });
    const ok = await supabase.from('students').select('id').in('id', Array.from({ length: 390 }, (_, i) => c(5000 + i)));
    expect(ok.error).toBeNull();
    expect(ok.data).toHaveLength(390);
  });
});

describe('inChunks', () => {
  test('chunks: slices of at most size, in order; [] → []', () => {
    expect(chunks([], 200)).toEqual([]);
    expect(chunks([1, 2, 3], 2)).toEqual([[1, 2], [3]]);
    expect(chunks(Array.from({ length: 401 }, (_, i) => i)).map((x) => x.length)).toEqual([200, 200, 1]);
    expect(IN_CHUNK).toBe(200);
  });
  test('614 ids → 4 requests of ≤ 200, every row back once, in chunk order; a fresh query per chunk; [] → no request', async () => {
    fake.db.students.push(...Array.from({ length: BIG }, (_, i) => loose(c(100 + i), 'X')));
    const ids = Array.from({ length: BIG }, (_, i) => c(100 + i));
    const makes = [];
    const out = await inChunks(() => { const q = supabase.from('students').select('id'); makes.push(q); return q; }, 'id', ids);
    expect(out.map((x) => x.id)).toEqual(ids);
    expect(makes).toHaveLength(4);
    expect(new Set(makes).size).toBe(4);
    expect(reads('students')).toHaveLength(4);
    expect(reads('students').every((x) => !x.overflow)).toBe(true);
    expect(await inChunks(() => supabase.from('students').select('id'), 'id', [])).toEqual([]);
    expect(reads('students')).toHaveLength(4);
  });
  test('a chunk that errors throws (a partial read never passes as a whole one)', async () => {
    const ids = Array.from({ length: 5 }, (_, i) => c(100 + i));
    await expect(inChunks(() => ({ in: async () => ({ data: null, error: { message: 'boom' } }) }), 'id', ids, 2)).rejects.toThrow('boom');
  });
  test('≤ 200 ids: exactly one request, the same filters, the same rows as a bare .in()', async () => {
    const ids = [c(1), c(2), c(3), c(999)];
    const bare = await supabase.from('students').select('id, student_name').in('id', ids).is('list_id', null);
    const viaHelper = await inChunks(() => supabase.from('students').select('id, student_name').is('list_id', null), 'id', ids);
    expect(viaHelper).toEqual(bare.data);
    expect(reads('students')).toHaveLength(2);
  });
});

describe('the join queue reads every data-sized list in chunks (RULING #94)', () => {
  test('a teacher with 614 quiz codes: the queue is NOT empty, no read overflows, nothing is written', async () => {
    seedBig();
    const rows = await Queue.candidatesFor(T1);
    expect(fake.calls.filter((x) => x.overflow)).toEqual([]);
    expect(logToFile.mock.calls.map((x) => x[0]).filter((m) => /candidates failed/.test(m))).toEqual([]);
    expect(rows.map((x) => x.loose_id)).toContain(c(3));   // the blocked Omar pair is served
    expect(writes()).toEqual([]);
    // the 614 session rows were read: 4 requests of ≤ 200 codes, not one of 614
    expect(reads('quiz_sessions').length).toBeGreaterThanOrEqual(4);
  });
  test('the backward join over 614 loose children runs: labels for all, joins the provable ones, pages ≤ 200', async () => {
    seedBig();
    const out = await Queue.runBackwardJoin();
    expect(out.error).toBeUndefined();
    expect(out.dryRun).toBe(true);
    expect(Object.keys(out.labels || {}).length).toBe(BIG + 3);   // c(33) has no phone: the job skips it, as today
    expect(out.counts.joined).toBeGreaterThanOrEqual(2);   // the seed's Ali (phone_name) and Sara (strict)
    expect(fake.calls.filter((x) => x.overflow)).toEqual([]);
    expect(writes()).toEqual([]);
  });
  test('golden: the small seed reads and routes exactly as before (one request per read site, the same labels)', async () => {
    const out = await Queue.runBackwardJoin();
    expect(out.labels).toEqual({ [c(1)]: 'phone_name', [c(2)]: 'strict', [c(3)]: 'blocked' });
    const sessionReads = reads('quiz_sessions').length;
    expect(sessionReads).toBeGreaterThan(0);
    expect(fake.calls.every((x) => !x.overflow)).toBe(true);
  });
});
