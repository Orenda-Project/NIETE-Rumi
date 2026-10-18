'use strict';
/**
 * The teacher join queue's served 'same' (web-quiz-join-queue.js decide → mergeLoose): the two independent checks
 * before the one guarded write, the teacher's own last decision on the pair (the idempotency read on merge_log) and
 * the loose child's active enrolment (class_enrollments), are read together, not one after the other; the guarded
 * students UPDATE waits for both. Every write, refusal reason and return shape is as before; 'no' and 'undo' read no
 * enrolment. Supabase (in-memory, filters applied, every call recorded; one read can be held on a promise the test
 * releases) and Redis (a Map whose keys expire on a fake clock) are the faked boundaries; the module runs for real.
 * The seed is the cache-slide suite's (two served pairs: Omar, Bilal).
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
let trace;   // every query in the order it was ISSUED (awaited): {table, op, eqs, done}
let hold;    // null, or {match(q), gate: Promise} — the first matching query waits for `gate`
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
  trace = [];
  hold = null;
  const from = (t) => {
    const b = fake.from(t);
    const q = { table: t, op: 'select', eqs: [], done: false };
    const wrap = (k, f) => { const orig = b[k]; b[k] = (...a) => { f(...a); return orig(...a); }; };
    wrap('eq', (col, v) => q.eqs.push([col, v]));
    ['insert', 'update', 'delete', 'upsert'].forEach((k) => { if (typeof b[k] === 'function') wrap(k, () => { q.op = k; }); });
    const then = b.then;
    b.then = (res, rej) => {
      trace.push(q);
      const h = hold && hold.match(q) ? hold : null;
      if (h) hold = null;
      const go = () => then((v) => { q.done = true; return res(v); }, rej);
      return h ? h.gate.then(go) : go();
    };
    return b;
  };
  Object.assign(supabase, { from, rpc: fake.rpc });
  IdFlags._resetCache(); HubFlags._resetCache(); Queue._resetPrecisionCache(); Queue._resetQueueCache();
}
const PAIR1 = { looseId: c(3), candidateId: r(6) };
const PAIR2 = { looseId: c(8), candidateId: r(8) };
const tap = (pair, d) => Queue.decide({ teacherUserId: T1, ...pair, decision: d });
const isEnrolRead = (q, id) => q.table === 'class_enrollments' && q.op === 'select' && q.eqs.some(([col, v]) => col === 'student_id' && v === id);
const isLastRead = (q) => q.table === 'merge_log' && q.op === 'select' && q.eqs.some(([col, v]) => col === 'teacher_id' && v === T1);
const isMerge = (q, id) => q.table === 'students' && q.op === 'update' && q.eqs.some(([col, v]) => col === 'id' && v === id);
const opsOf = (qs) => qs.map((q) => `${q.op}:${q.table}`);
const sorted = (xs) => [...xs].sort();
const tick = () => new Promise((res) => setImmediate(res));
const mergeLogRows = () => fake.db.merge_log.map(({ id, created_at: _c, decided_at: d, ...rest }) => ({ ...rest, decided_at: typeof d === 'string' }));

beforeEach(() => {
  jest.clearAllMocks();
  clock = Date.UTC(2026, 9, 16, 8, 0, 0);
  if (!jest.isMockFunction(Date.now)) jest.spyOn(Date, 'now').mockImplementation(() => clock);
  redis._store.clear(); redis._until.clear(); redis._state.up = true;
  seed();
});
afterAll(() => { jest.restoreAllMocks(); });

// Today's tables and ops of each tap, captured from the code before this change (warm key, tier counts cached where
// the tap before cleared nothing), in issue order.
const TODAY = {
  same: ['select:merge_log', 'select:class_enrollments', 'update:students', 'insert:merge_log'],
  no: ['select:merge_log', 'select:merge_log', 'select:merge_log', 'select:merge_log', 'select:merge_log', 'select:merge_log', 'select:merge_log', 'insert:merge_log'],
  undo: ['select:merge_log', 'update:students', 'select:merge_log', 'insert:merge_log'],
  notLoose: ['select:merge_log', 'select:class_enrollments', 'update:students'],
};

describe('a served \'same\': the two checks read together', () => {
  test('a served \'same\' issues the enrolment read before the idempotency read resolves; the UPDATE waits for both', async () => {
    await Queue.candidatesFor(T1);
    trace = [];
    let release;
    hold = { match: isLastRead, gate: new Promise((res) => { release = res; }) };
    const p = tap(PAIR1, 'same');
    for (let i = 0; i < 5; i += 1) await tick();
    const last = trace.find(isLastRead);
    expect(last).toBeDefined();
    expect(last.done).toBe(false);                                       // the idempotency read is still held
    expect(trace.some((q) => isEnrolRead(q, c(3)))).toBe(true);           // and the enrolment read is already out
    expect(trace.some((q) => isMerge(q, c(3)))).toBe(false);              // no write before both are back
    release();
    expect(await p).toEqual({ ok: true, decision: 'same' });
    const enr = trace.findIndex((q) => isEnrolRead(q, c(3)));
    const upd = trace.findIndex((q) => isMerge(q, c(3)));
    expect(upd).toBeGreaterThan(trace.indexOf(last));
    expect(upd).toBeGreaterThan(enr);
    expect(trace[enr].done && last.done).toBe(true);
  });
});

describe('golden', () => {
  test('the tables/ops of a served \'same\', \'no\', \'undo\' and a refused not_loose are today\'s set; the UPDATE comes after both reads; results and merge_log rows as before', async () => {
    await Queue.candidatesFor(T1);
    trace = [];
    expect(await tap(PAIR1, 'same')).toEqual({ ok: true, decision: 'same' });
    const same = trace;
    expect(sorted(opsOf(same))).toEqual(sorted(TODAY.same));
    const u = same.findIndex((q) => isMerge(q, c(3)));
    expect(u).toBeGreaterThan(same.findIndex(isLastRead));
    expect(u).toBeGreaterThan(same.findIndex((q) => isEnrolRead(q, c(3))));
    expect(fake.db.students.find((s) => s.id === c(3))).toMatchObject({ status: 'merged', merged_into: r(6), is_active: false });

    trace = [];
    expect(await tap(PAIR2, 'no')).toEqual({ ok: true, decision: 'no' });
    expect(sorted(opsOf(trace))).toEqual(sorted(TODAY.no));

    trace = [];
    expect(await tap(PAIR1, 'undo')).toEqual({ ok: true, decision: 'undo' });
    expect(sorted(opsOf(trace))).toEqual(sorted(TODAY.undo));
    expect(mergeLogRows()).toEqual([
      { loose_id: c(3), candidate_id: r(6), teacher_id: T1, decision: 'same', source: 'queue', tier: 'roster_unique_with_loose', decided_at: true },
      { loose_id: c(8), candidate_id: r(8), teacher_id: T1, decision: 'no', source: 'queue', tier: 'roster_unique_with_loose', decided_at: true },
      { loose_id: c(3), candidate_id: r(6), teacher_id: T1, decision: 'undo', source: 'queue', tier: 'roster_unique_with_loose', decided_at: true },
    ]);

    // a served pair whose loose row was merged meanwhile: the guarded UPDATE refuses it
    redis._store.clear(); redis._until.clear();
    seed();
    await Queue.candidatesFor(T1);
    Object.assign(fake.db.students.find((s) => s.id === c(8)), { status: 'merged', merged_into: r(5) });
    trace = [];
    expect(await tap(PAIR2, 'same')).toEqual({ ok: false, reason: 'not_loose' });
    expect(sorted(opsOf(trace))).toEqual(sorted(TODAY.notLoose));
    expect(fake.db.merge_log).toEqual([]);
  });

  test('an enrolled loose child → not_loose, no UPDATE, the key dropped', async () => {
    await Queue.candidatesFor(T1);
    fake.db.class_enrollments.push({ class_id: C1, student_id: c(3), is_active: true });
    trace = [];
    expect(await tap(PAIR1, 'same')).toEqual({ ok: false, reason: 'not_loose' });
    expect(trace.some((q) => q.table === 'students' && q.op === 'update')).toBe(false);
    expect(fake.db.merge_log).toEqual([]);
    expect(redis._store.size).toBe(0);
    expect(redis.delete).toHaveBeenCalled();
  });

  test('a failed enrolment read → the tap fails as before ({ok:false, reason:"failed"}), no UPDATE, no unhandled rejection', async () => {
    await Queue.candidatesFor(T1);
    const from = supabase.from;
    supabase.from = (t) => {
      const b = from(t);
      if (t === 'class_enrollments') b.then = (res, rej) => Promise.resolve({ data: null, error: { message: 'down' } }).then(res, rej);
      return b;
    };
    trace = [];
    expect(await tap(PAIR1, 'same')).toEqual({ ok: false, reason: 'failed' });
    expect(fake.calls.some((y) => y.table === 'students' && y.op === 'update')).toBe(false);
    expect(fake.db.merge_log).toEqual([]);
  });

  test('the idempotent second \'same\' answers {already:true} with no UPDATE', async () => {
    await Queue.candidatesFor(T1);
    expect(await tap(PAIR1, 'same')).toEqual({ ok: true, decision: 'same' });
    trace = [];
    expect(await tap(PAIR1, 'same')).toEqual({ ok: true, decision: 'same', already: true });
    expect(trace.some((q) => q.op !== 'select')).toBe(false);
    expect(fake.db.merge_log.length).toBe(1);
  });
});

describe('\'no\' and \'undo\' read no enrolment', () => {
  test('\'no\' and \'undo\' make no class_enrollments read', async () => {
    await Queue.candidatesFor(T1);
    expect(await tap(PAIR1, 'same')).toEqual({ ok: true, decision: 'same' });
    trace = [];
    expect(await tap(PAIR2, 'no')).toEqual({ ok: true, decision: 'no' });
    expect(await tap(PAIR1, 'undo')).toEqual({ ok: true, decision: 'undo' });
    expect(trace.some((q) => q.table === 'class_enrollments')).toBe(false);
  });
});
