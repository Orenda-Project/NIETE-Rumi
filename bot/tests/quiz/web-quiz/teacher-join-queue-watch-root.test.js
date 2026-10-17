'use strict';
/**
 * The teacher join queue and the watch root (app_settings VALUE web_quiz_watch_root): a class-less child's video code
 * hangs under the root and copies the root's teacher, and a friend's code hangs under that child's code. Those children
 * are strangers from other schools, so they are never in the root teacher's queue, never a blocker, never joined into
 * that teacher's roster, and their codes are never linked to that teacher's class. No VALUE: every reader as today.
 * Supabase (an in-memory table set that applies filters) is the faked boundary; the module under test runs for real.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/services/cache/railway-redis.service', () => ({
  get: jest.fn(async () => null), set: jest.fn(async () => true), delete: jest.fn(async () => true), isAvailable: () => true,
}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../../shared/services/quiz/web-quiz-kid', () => ({ kidOf: (id) => (id ? `k_${String(id).slice(-2)}` : null) }));

const { makeFake } = require('./fake-supabase');

const T1 = '10000000-0000-4000-8000-000000000001';
const TA = '10000000-0000-4000-8000-0000000000aa'; // the bank video quiz's author: not the root teacher
const C1 = 'c0000000-0000-4000-8000-000000000001';
const L1 = 'a0000000-0000-4000-8000-000000000001';
const SC1 = '30000000-0000-4000-8000-000000000001';   // the root teacher's class code
const SCL = '30000000-0000-4000-8000-000000000011';   // a class child's own lesson code under it (no inviter)
const SCF = '30000000-0000-4000-8000-000000000012';   // a class child's friend code under it (inviter set)
const ROOT = '30000000-0000-4000-8000-0000000000a0';  // the watch root
const W1 = '30000000-0000-4000-8000-0000000000a1';    // a class-less child's code under the root
const W2 = '30000000-0000-4000-8000-0000000000a2';
const WF = '30000000-0000-4000-8000-0000000000a3';    // a friend's code under W1 (inviter set)
const WFF = '30000000-0000-4000-8000-0000000000a4';   // that friend's own friend code under WF (inviter set)
const Q1 = '20000000-0000-4000-8000-000000000001';
const QV = '20000000-0000-4000-8000-0000000000aa';    // the bank video quiz the watch codes play
const r = (n) => `b0000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;
const c = (n) => `d0000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;
const w = (n) => `e0000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;
const P = (n) => `92000000${String(600 + n).padStart(4, '0')}`;

const ON = [{ key: 'web_quiz_hub', value: true }, { key: 'web_quiz_identity_canon', value: true }];
const roster = (id, name) => ({ id, list_id: L1, student_name: name, student_name_urdu: null, status: 'active', is_active: true, merged_into: null });
const loose = (id, name, extra = {}) => ({ id, list_id: null, student_name: name, status: 'active', is_active: true, merged_into: null, enrolled_by_user_id: T1, self_reported_class: '3', phone: null, ...extra });
const watchKid = (id, name, extra = {}) => loose(id, name, { enrolled_by_user_id: null, ...extra });
const sess = (id, student, extra = {}) => ({ id, student_id: student, quiz_id: Q1, share_code_id: SC1, parent_phone: null, device_ref: null, user_id: null, ...extra });
const onWatch = (id, student, code, extra = {}) => sess(id, student, { quiz_id: QV, share_code_id: code, ...extra });

let fake; let supabase; let Queue;
function seed({ value, over = {} } = {}) {
  const db = {
    app_settings: [...ON.map((x) => ({ ...x })), ...(value === undefined ? [] : [{ key: 'web_quiz_watch_root', value }])],
    classes: [{ id: C1, grade_code: '3', is_active: true }],
    class_teachers: [{ class_id: C1, teacher_user_id: T1, is_active: true }],
    student_lists: [{ id: L1, user_id: T1, class_name: 'Class 3', class_id: C1, is_active: true }],
    class_enrollments: [2, 5, 6, 7].map((n) => ({ class_id: C1, student_id: r(n), is_active: true })),
    students: [
      roster(r(2), 'Sara Testwala'),
      roster(r(5), 'Hamza Testwala'),
      roster(r(6), 'Omar Testwala'),
      roster(r(7), 'Huda Testwala'),
      loose(c(2), 'Sara Testwala'),                                         // the root teacher's own chat child: strict
      loose(c(7), 'Hamza'),                                                 // the root teacher's own chat child: probable
      watchKid(w(1), 'Hamza Testwala', { phone: P(21) }),                    // roster-unique name: today a strict join
      watchKid(w(2), 'Huda', { father_name: 'Rashid Testwala' }),            // today a probable row, father's name shown
      watchKid(w(3), 'Omar'),                                               // a friend on the watch child's friend code
      watchKid(w(4), 'Omar'),                                               // played the root code itself
    ],
    quiz_sessions: [
      sess('s2', c(2), { parent_phone: P(2), device_ref: 'dev-2' }),
      sess('s7', c(7), { parent_phone: P(7), device_ref: 'dev-7' }),
      onWatch('w1', w(1), W1, { parent_phone: P(21), device_ref: 'dev-21' }),
      onWatch('w2', w(2), W2, { parent_phone: P(22), device_ref: 'dev-22' }),
      onWatch('w3', w(3), WF, { parent_phone: P(23), device_ref: 'dev-23' }),
      onWatch('w4', w(4), ROOT, { parent_phone: P(24), device_ref: 'dev-24' }),
    ],
    quiz_share_codes: [
      { id: SC1, teacher_user_id: T1, class_id: null, parent_share_code_id: null, invited_by_student_id: null },
      { id: ROOT, teacher_user_id: T1, class_id: null, parent_share_code_id: null, invited_by_student_id: null },
      { id: W1, teacher_user_id: T1, class_id: null, parent_share_code_id: ROOT, invited_by_student_id: null },
      { id: W2, teacher_user_id: T1, class_id: null, parent_share_code_id: ROOT, invited_by_student_id: null },
      { id: WF, teacher_user_id: T1, class_id: null, parent_share_code_id: W1, invited_by_student_id: w(1) },
    ],
    quizzes: [{ id: Q1, teacher_id: T1, list_id: null }, { id: QV, teacher_id: TA, list_id: null }],
    merge_log: [],
    ...over,
  };
  fake = makeFake(db);
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
  return fake;
}
const WATCH = [w(1), w(2), w(3), w(4)];
const codeClass = (id) => fake.db.quiz_share_codes.find((x) => x.id === id).class_id;

// every test reads its own VALUE: a fresh module registry, so no 30 s cache carries one test's VALUE into the next
beforeEach(() => {
  jest.resetModules();
  jest.clearAllMocks();
  supabase = require('../../../shared/config/supabase');
  Queue = require('../../../shared/services/quiz/web-quiz-join-queue');
});

// What the root teacher's queue and the job hold when no watch child exists at all: the bar the VALUE must meet.
const OWN_ROWS = [
  { loose_id: c(7), candidate_id: r(5), first: 'Hamza', candidate_first: 'Hamza', father_first: null, candidate_father_first: null, class_id: C1, grade: 3,
    evidence: { tier: 'probable', name_words_matched: 1, same_grade: true, other_same_name_loose: false } },
];
const OWN_LABELS = { [c(2)]: 'strict', [c(7)]: 'none' };

describe('the VALUE set: a watch child is never in the root teacher\'s queue', () => {
  test.each([
    ['a plain id', ROOT],
    ['a JSON string', JSON.stringify(ROOT)],
    ['an upper-case id padded with spaces', `  ${ROOT.toUpperCase()} `],
  ])('the VALUE as %s: the queue is the teacher\'s own children only; no watch child\'s or father\'s name', async (_, value) => {
    seed({ value });
    const rows = await Queue.computeCandidates(T1);
    expect(rows).toEqual(OWN_ROWS);
    expect(JSON.stringify(rows)).not.toMatch(/Huda|Rashid|Omar/);
  });

  test('a friend on a watch child\'s friend code and a child on the root code itself are not the root teacher\'s either', async () => {
    seed({ value: ROOT });
    const ids = (await Queue.computeCandidates(T1)).map((x) => x.loose_id);
    expect(ids).not.toContain(w(3));
    expect(ids).not.toContain(w(4));
  });

  test('every depth under the root is out: the root code, a watch child\'s code, its friend code, a friend\'s friend code', async () => {
    seed({ value: ROOT });
    fake.db.quiz_share_codes.push({ id: WFF, teacher_user_id: T1, class_id: null, parent_share_code_id: WF, invited_by_student_id: w(3) });
    fake.db.students.push(watchKid(w(6), 'Huda'));
    fake.db.quiz_sessions.push(onWatch('w6', w(6), WFF, { parent_phone: P(26), device_ref: 'dev-26' }));
    expect(await Queue.computeCandidates(T1)).toEqual(OWN_ROWS);
    expect(await Queue.linkClassCodes({ teacherUserId: T1, classId: C1 })).toEqual({ linked: 1 });
    expect([ROOT, W1, W2, WF, WFF].map(codeClass)).toEqual([null, null, null, null, null]);
  });

  test('a watch child the teacher once merged by a queue tap is no blocker: the teacher\'s own same-name child still joins', async () => {
    // the residue of a pooled watch child: merged into the roster Sara by a "Same child" tap, on another phone and device
    seed({
      value: ROOT,
      over: {
        merge_log: [{ id: 1, loose_id: w(5), candidate_id: r(2), teacher_id: T1, decision: 'same', source: 'queue', decided_at: '2026-10-15T10:00:00Z' }],
      },
    });
    fake.db.students.push(watchKid(w(5), 'Sara Testwala', { status: 'merged', merged_into: r(2), is_active: false }));
    fake.db.quiz_sessions.push(onWatch('w5', w(5), W1, { parent_phone: P(25), device_ref: 'dev-25' }));
    expect((await Queue.computeCandidates(T1)).map((x) => x.loose_id)).not.toContain(c(2));
    expect((await Queue.runBackwardJoin()).labels[c(2)]).toBe('strict');
  });

  test('a class child\'s own lesson code and a class friend code still bring their players to the queue (as today)', async () => {
    seed({ value: ROOT });
    fake.db.quiz_share_codes.push(
      { id: SCL, teacher_user_id: T1, class_id: null, parent_share_code_id: SC1, invited_by_student_id: null },
      { id: SCF, teacher_user_id: T1, class_id: null, parent_share_code_id: SC1, invited_by_student_id: r(2) },
    );
    const s7 = fake.db.quiz_sessions.find((x) => x.id === 's7');
    Object.assign(s7, { quiz_id: QV, share_code_id: SCF });
    expect(await Queue.computeCandidates(T1)).toEqual(OWN_ROWS);
    Object.assign(s7, { share_code_id: SCL });
    expect(await Queue.computeCandidates(T1)).toEqual(OWN_ROWS);
  });
});

describe('the VALUE set: the backward join never joins a watch child', () => {
  test('dryRun: no watch child is a join (the unique-named one is not "strict"); the root teacher\'s own children as before', async () => {
    seed({ value: ROOT });
    const out = await Queue.runBackwardJoin();
    // the bank video quiz's author still reaches them by the quiz (no roster there): 'none', never a join
    expect(out.labels).toEqual({ ...OWN_LABELS, ...Object.fromEntries(WATCH.map((id) => [id, 'none'])) });
  });

  test('a real run joins the teacher\'s own child and no watch child', async () => {
    seed({ value: ROOT });
    const out = await Queue.runBackwardJoin({ dryRun: false });
    expect(out.counts.joined).toBe(1);
    expect(fake.db.students.filter((s) => s.merged_into).map((s) => s.id)).toEqual([c(2)]);
    expect(fake.db.merge_log.map((m) => m.loose_id)).toEqual([c(2)]);
  });
});

describe('the VALUE set: "link this class\'s quiz codes" never binds a watch code', () => {
  test('the class code, a class child\'s lesson code and a class friend code are linked; the root and its codes are not', async () => {
    seed({ value: ROOT });
    fake.db.quiz_share_codes.push(
      { id: SCL, teacher_user_id: T1, class_id: null, parent_share_code_id: SC1, invited_by_student_id: null },
      { id: SCF, teacher_user_id: T1, class_id: null, parent_share_code_id: SC1, invited_by_student_id: r(2) },
    );
    expect(await Queue.linkClassCodes({ teacherUserId: T1, classId: C1 })).toEqual({ linked: 3 });
    expect([SC1, SCL, SCF].map(codeClass)).toEqual([C1, C1, C1]);
    expect([ROOT, W1, W2, WF].map(codeClass)).toEqual([null, null, null, null]);
    expect(await Queue.linkClassCodes({ teacherUserId: T1, classId: C1 })).toEqual({ linked: 0 });
  });
});

describe('golden: no VALUE (absent, or not an id) — both readers answer exactly as today', () => {
  // today's answers on this very fixture, watch children included (no root: nothing is left out)
  const TODAY_ROWS = [
    { loose_id: c(7), candidate_id: r(5), first: 'Hamza', candidate_first: 'Hamza', father_first: null, candidate_father_first: null, class_id: C1, grade: 3,
      evidence: { tier: 'probable', name_words_matched: 1, same_grade: true, other_same_name_loose: false } },
    { loose_id: w(2), candidate_id: r(7), first: 'Huda', candidate_first: 'Huda', father_first: 'Rashid', candidate_father_first: null, class_id: C1, grade: 3,
      evidence: { tier: 'probable', name_words_matched: 1, same_grade: true, other_same_name_loose: false } },
    { loose_id: w(3), candidate_id: r(6), first: 'Omar', candidate_first: 'Omar', father_first: null, candidate_father_first: null, class_id: C1, grade: 3,
      evidence: { tier: 'probable', name_words_matched: 1, same_grade: true, other_same_name_loose: false } },
    { loose_id: w(4), candidate_id: r(6), first: 'Omar', candidate_first: 'Omar', father_first: null, candidate_father_first: null, class_id: C1, grade: 3,
      evidence: { tier: 'probable', name_words_matched: 1, same_grade: true, other_same_name_loose: false } },
  ];
  const TODAY_LABELS = { [c(2)]: 'strict', [c(7)]: 'none', [w(1)]: 'strict', [w(2)]: 'none', [w(3)]: 'none', [w(4)]: 'none' };
  test.each([['absent', undefined], ['not an id', 'not-a-code'], ['an object', { id: ROOT }]])('the VALUE %s', async (_, value) => {
    seed({ value });
    expect(await Queue.computeCandidates(T1)).toEqual(TODAY_ROWS);
    expect((await Queue.runBackwardJoin()).labels).toEqual(TODAY_LABELS);
    expect(await Queue.linkClassCodes({ teacherUserId: T1, classId: C1 })).toEqual({ linked: 5 });
    expect(fake.db.quiz_share_codes.map((x) => x.class_id)).toEqual([C1, C1, C1, C1, C1]);
  });
});
