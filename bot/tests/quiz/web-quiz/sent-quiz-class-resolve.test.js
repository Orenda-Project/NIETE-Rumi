'use strict';
/**
 * A hand-out never resolves to ANOTHER teacher's class (switch `quiz_teacher_home`).
 *
 * The author made the quiz for their 4-A (`quizzes.list_id` = 4-A's list). A second teacher (the sender) sends the
 * same quiz to their own 4-C on a code with no class bound (the normal case: only "Which class?" binds one). The
 * class resolver used to bind the sender's code through the quiz's own list — the AUTHOR's class — for every
 * consumer: the not-played list, the report fix (which moves a finish onto a class child), the class a new code is
 * minted with, and the child hub's class pick. With the switch on, another teacher's list is skipped and the
 * sender's own classes answer; off, today's reading is kept (asserted, so the switch is the only difference).
 *
 * Run for real: web-quiz-identity, web-quiz-identity-roster, web-quiz.service fixWho, handout-class. Faked: Supabase
 * (in-memory, applies filters), Redis, WhatsApp, the queue, the loggers.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/services/queue/sqs-queue.service', () => ({ queueJob: jest.fn().mockResolvedValue({ MessageId: 'm1' }) }));
jest.mock('../../../shared/services/cache/railway-redis.service', () => ({
  get: jest.fn().mockResolvedValue(null), set: jest.fn().mockResolvedValue(true), delete: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../../shared/services/whatsapp.service', () => ({ sendMessage: jest.fn(), sendImageFromBuffer: jest.fn(), sendDocument: jest.fn() }));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('openchemlib', () => require('../../../../tests/__mocks__/openchemlib.js'));

const { makeFake } = require('./fake-supabase');
const F = require('./web-quiz-identity-fixture');
const supabase = require('../../../shared/config/supabase');
const T = require('../../../shared/services/quiz/web-quiz-token');
const WQ = require('../../../shared/services/quiz/web-quiz.service');
const Identity = require('../../../shared/services/quiz/web-quiz-identity');
const IdRoster = require('../../../shared/services/quiz/web-quiz-identity-roster');
const HandoutClass = require('../../../shared/services/quiz/handout-class.service');
const HomeFlags = require('../../../shared/services/first-touch/teacher-home.flags');

const SENDER = '11111111-1111-4111-8111-11111111111b';
const SC_S = '33333333-3333-4333-8333-3333333333b1';
const CLS_C = 'c0000000-0000-4000-8000-00000000000c';
const LIST_C = 'a0000000-0000-4000-8000-00000000000c';
const kidC = (n) => `b0000000-0000-4000-8000-0000000000c${n}`;

let fake;
function seed({ home = true } = {}) {
  const db = F.db({ codeClass: null });
  // the author's quiz was made for their 4-A
  db.quizzes[0].list_id = F.LIST_A;
  db.app_settings.push({ key: 'quiz_teacher_home', value: home ? 'true' : 'false' });
  // the sender's own 4-C: two children
  db.classes.push({ id: CLS_C, school_id: 's2', grade_code: 'grade_4', section: 'C', shift_code: 'morning', is_active: true, merged_into_class_id: null });
  db.class_teachers.push({ id: 'ct-c', class_id: CLS_C, teacher_user_id: SENDER, is_active: true, is_class_teacher: true });
  db.student_lists.push({ id: LIST_C, user_id: SENDER, class_name: 'Grade 4 - C', section: 'C', class_id: CLS_C, is_active: true });
  [1, 2].forEach((n) => {
    db.students.push({ id: kidC(n), student_name: `Chaand${n} Testwala`, father_name: null, roll_number: n, list_id: LIST_C,
      is_active: true, status: 'active', created_at: '2026-09-01T00:00:00Z' });
    db.class_enrollments.push({ id: `e-c${n}`, class_id: CLS_C, student_id: kidC(n), roll_number: n, is_active: true });
  });
  // the sender's code on the author's quiz, no class bound; a typed child finished on it
  db.quiz_share_codes.push({ id: SC_S, code: 'SE12ND', quiz_id: F.QUIZ, teacher_user_id: SENDER, teacher_name: 'Sender', language: 'en',
    active: true, expires_at: new Date(Date.now() + 86400000).toISOString(), invited_by_student_id: null, parent_share_code_id: null,
    created_at: F.ago(3), class_id: null });
  db.quiz_sessions.push(F.done('sT', F.TYPED, 'Dansh', 3, 2, { share_code_id: SC_S }));
  fake = makeFake(db);
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
  IdRoster._resetCache();
  HomeFlags.reset();
}

const SAVED = { ...process.env };
beforeEach(() => {
  process.env = { ...SAVED, INTERNAL_API_KEY: 'test-key' };
  delete process.env.WEB_QUIZ_TOKEN_SECRET;
  jest.clearAllMocks();
});
afterAll(() => { process.env = SAVED; });

const A_NAMES = /Ayesha|Ali|Sana|Hina|Bilal/;

describe('on: the sender\'s hand-out resolves to the sender\'s own class', () => {
  test('the resolver (as the hub and the report call it) never answers the author\'s class', async () => {
    seed();
    const r = await Identity.resolveQuizClass({ teacherUserId: SENDER, quizId: F.QUIZ, shareCodeId: SC_S });
    expect(r).toMatchObject({ state: 'known', class: { id: CLS_C } });
    expect(r.bound).not.toBe('quiz');
    // the author's own code still binds through their list, as today
    const a = await Identity.resolveQuizClass({ teacherUserId: F.TEACHER, quizId: F.QUIZ, shareCodeId: F.SC });
    expect(a).toMatchObject({ state: 'known', bound: 'quiz', class: { id: F.CLS_A } });
  });

  test('not played lists the sender\'s children only — none of the author\'s', async () => {
    seed();
    const out = await IdRoster.nonAttempters({ shareCodeId: SC_S });
    expect(out.class).toMatchObject({ state: 'known', id: CLS_C });
    expect(out.notPlayed.map((k) => k.first)).toEqual(['Chaand1', 'Chaand2']);
    expect(JSON.stringify(out)).not.toMatch(A_NAMES);
  });

  test('the report fix refuses to move a finish on the sender\'s code onto the author\'s child: no move, no merge', async () => {
    seed();
    const before = JSON.stringify(fake.db.quiz_sessions);
    const studentsBefore = JSON.stringify(fake.db.students);
    const P = T.signPreview({ shareCodeId: SC_S, teacherUserId: SENDER });
    await expect(WQ.fixWho({ code: 'SE12ND', p: P, ref: 'sT', studentId: F.kid(1) })).rejects.toMatchObject({ status: 404 });
    expect(JSON.stringify(fake.db.quiz_sessions)).toBe(before);
    expect(JSON.stringify(fake.db.students)).toBe(studentsBefore);
  });

  test('a new code the sender mints on the author\'s quiz is never bound to the author\'s class', async () => {
    seed();
    const resolved = await HandoutClass.resolveClass({ teacherUserId: SENDER, quizId: F.QUIZ });
    expect(HandoutClass.classIdToMint(resolved)).not.toBe(F.CLS_A);
    expect(HandoutClass.classIdToMint(resolved)).toBe(CLS_C);
  });
});

describe('off: today\'s resolver, unchanged', () => {
  test('the sender\'s code reads the quiz\'s list as today (the switch is the only difference)', async () => {
    seed({ home: false });
    const r = await Identity.resolveQuizClass({ teacherUserId: SENDER, quizId: F.QUIZ, shareCodeId: SC_S });
    expect(r).toMatchObject({ state: 'known', bound: 'quiz', class: { id: F.CLS_A } });
    const resolved = await HandoutClass.resolveClass({ teacherUserId: SENDER, quizId: F.QUIZ });
    expect(HandoutClass.classIdToMint(resolved)).toBe(F.CLS_A);
  });
});
