'use strict';
/**
 * The teacher's web report — its data core and its link token.
 *
 * quizReport(teacherId, quizId) is everything the page and the PDF show for one
 * quiz: who played (each child's counted attempt, the class report's own rule),
 * who has NOT played (only when the quiz's ONE class is known), every question's
 * difficulty, the stored reteach guidance, and a reminder for the class group
 * that names nobody. classReport(teacherId) is the same teacher's quizzes by
 * grade × subject and by week. Only the teacher's own quizzes are ever read.
 *
 * Supabase is the faked boundary (an in-memory client that applies the filters).
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const { makeFake } = require('./fake-supabase');

const TEACHER = '11111111-1111-4111-8111-111111111111';
const OTHER = '99999999-9999-4999-8999-999999999999';
const QUIZ = '22222222-2222-4222-8222-222222222222';
const QUIZ2 = '22222222-2222-4222-8222-222222222223';
const SC = '33333333-3333-4333-8333-333333333333';
const SC2 = '33333333-3333-4333-8333-333333333334';
const LIST3B = 'a0000000-0000-4000-8000-00000000003b';
const LIST3C = 'a0000000-0000-4000-8000-00000000003c';
const LIST5A = 'a0000000-0000-4000-8000-00000000005a';
const kid = (n) => `b0000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;
const Q = (n) => `c0000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;
const ago = (h) => new Date(Date.now() - h * 3600000).toISOString();
const LINK = 'https://portal.example.test/q/AB12CD';
// Distinct synthetic first names: identity v2 dedupes children whose canonical full names match.
const NAMES = ['Amna', 'Bilal', 'Chand', 'Dua', 'Esha', 'Fahad', 'Gul', 'Huma'];

const session = (id, studentId, name, correct, h, extra = {}) => ({
  id, quiz_id: QUIZ, share_code_id: SC, student_id: studentId, student_name: name, user_id: null,
  status: 'completed', correct_answers: correct, total_questions_answered: 4, mastery_percentage: correct * 25,
  completed_at: ago(h), created_at: ago(h + 0.1), invited_by_student_id: null, device_ref: `dev-${id}`, ...extra,
});

function seed({ lists = [{ id: LIST3B, class_name: '3', section: 'B' }], quizExtra = {} } = {}) {
  const students = [];
  lists.forEach((l, li) => {
    for (let r = 1; r <= 4; r += 1) {
      students.push({ id: kid(li * 10 + r), list_id: l.id, roll_number: r, student_name: `${NAMES[li * 4 + r - 1]} Testwala`, student_name_urdu: null, is_active: true });
    }
  });
  const fake = makeFake({
    quizzes: [
      { id: QUIZ, teacher_id: TEACHER, topic: 'Plants', subject: 'science', grade: '3', language: 'en', quiz_source: 'transcript', status: 'report_sent',
        list_id: null, created_at: ago(30),
        meta: { share_code_id: SC, student_message: `Our quiz is ready! Tap: ${LINK}`, report_guidance: { muddled: 'Roots vs stems', board: 'Draw a plant', check: 'Ask: which part drinks?' } },
        ...quizExtra },
      { id: QUIZ2, teacher_id: TEACHER, topic: 'Fractions', subject: 'maths', grade: '5', language: 'ur', quiz_source: 'lp_v8', status: 'sent',
        list_id: null, created_at: ago(24 * 9), meta: { share_code_id: SC2 } },
      { id: '22222222-2222-4222-8222-2222222222ff', teacher_id: OTHER, topic: 'Secret', subject: 'english', grade: '3', language: 'en',
        quiz_source: 'transcript', status: 'sent', created_at: ago(5), meta: {} },
    ],
    quiz_share_codes: [
      { id: SC, code: 'AB12CD', quiz_id: QUIZ, teacher_user_id: TEACHER, invited_by_student_id: null, created_at: ago(30) },
      { id: SC2, code: 'EF34GH', quiz_id: QUIZ2, teacher_user_id: TEACHER, invited_by_student_id: null, created_at: ago(24 * 9) },
    ],
    student_lists: lists.map((l) => ({ ...l, user_id: TEACHER, is_active: true })),
    students,
    quiz_sessions: [
      session('s1', kid(1), 'Amna Testwala', 4, 20),
      session('s2', kid(2), 'Bilal Testwala', 1, 19),
      // kid 2 replays later and scores higher: on a web code the FIRST finish counts
      session('s2b', kid(2), 'Bilal Testwala', 4, 2),
      // the teacher's own test run never counts
      session('s3', null, 'Teacher', 4, 18, { user_id: TEACHER, device_ref: null }),
      // an invited friend is not the class
      session('s4', 'b0000000-0000-4000-8000-0000000000ee', 'Friend Testwala', 4, 17, { invited_by_student_id: kid(1) }),
      // started, not finished: not "played"
      session('s5', kid(3), 'Chand Testwala', 0, 16, { status: 'in_progress', completed_at: null }),
      { ...session('t1', kid(11), 'Esha Testwala', 2, 200), quiz_id: QUIZ2, share_code_id: SC2, total_questions_answered: 4 },
    ],
    quiz_questions: [1, 2, 3, 4].map((n) => ({ id: Q(n), quiz_id: QUIZ, external_id: null, sort_order: n, question_text: `Question ${n}?`,
      option_a: 'A', option_b: 'B', option_c: 'C', option_d: 'D', correct_option: 'A' })),
    quiz_answers: [
      { session_id: 's1', question_id: Q(1), is_correct: true, selected_option: 'A' },
      { session_id: 's1', question_id: Q(2), is_correct: true, selected_option: 'A' },
      { session_id: 's2', question_id: Q(1), is_correct: true, selected_option: 'A' },
      { session_id: 's2', question_id: Q(2), is_correct: false, selected_option: 'C' },
      // the replay's answers are not the counted attempt
      { session_id: 's2b', question_id: Q(2), is_correct: true, selected_option: 'A' },
    ],
  });
  // resetModules gives every test a fresh module registry: wire the instance the module under test will require
  Object.assign(require('../../../shared/config/supabase'), { from: fake.from, rpc: fake.rpc });
  return fake;
}

let Data;
let Token;
beforeEach(() => {
  jest.resetModules();
  process.env.INTERNAL_API_KEY = 'test-key';
  delete process.env.WEB_QUIZ_TOKEN_SECRET;
  Data = require('../../../shared/services/quiz/teacher-report.data');
  Token = require('../../../shared/services/quiz/teacher-report-token');
});

describe('quizReport', () => {
  test('another teacher\'s quiz is not found', async () => {
    seed();
    expect(await Data.quizReport(OTHER, QUIZ)).toBeNull();
    expect(await Data.quizReport(TEACHER, '22222222-2222-4222-8222-2222222222ff')).toBeNull();
  });

  test('the one class is known: played by score, each child\'s first finish, not-played greyed list', async () => {
    seed();
    const r = await Data.quizReport(TEACHER, QUIZ);
    expect(r.roster).toMatchObject({ state: 'known', className: '3-B', of: 4 });
    expect(r.roster.lists).toEqual([expect.objectContaining({ label: '3-B' })]);
    expect(r.played.map((p) => [p.first, p.roll, p.correct])).toEqual([['Amna', 1, 4], ['Bilal', 2, 1]]);
    expect(r.summary).toMatchObject({ played: 2, onList: 2, of: 4, avg: 63, total: 4 });
    // kid 3 started but did not finish; kid 4 never opened it — both still to play
    expect(r.notPlayed).toEqual([
      { studentId: kid(3), first: 'Chand', roll: 3 }, { studentId: kid(4), first: 'Dua', roll: 4 },
    ]);
    expect(r.quiz).toMatchObject({ id: QUIZ, topic: 'Plants', code: 'AB12CD', link: LINK, language: 'en' });
  });

  test('per-question difficulty counts only the counted attempts, with the top wrong answer', async () => {
    seed();
    const r = await Data.quizReport(TEACHER, QUIZ);
    const q2 = r.questions.find((q) => q.n === 2);
    expect(q2).toMatchObject({ n: 2, text: 'Question 2?', answered: 2, correctPct: 50 });
    expect(q2.wrongTop).toMatchObject({ option: 'C', text: 'C' });
    expect(r.summary.hardestN).toBe(2);
    expect(r.questions.find((q) => q.n === 4)).toMatchObject({ answered: 0, correctPct: null });
  });

  test('two lists of the quiz grade and none bound: ambiguous, no not-played list, the classes offered', async () => {
    seed({ lists: [{ id: LIST3B, class_name: '3', section: 'B' }, { id: LIST3C, class_name: '3', section: 'C' }] });
    const r = await Data.quizReport(TEACHER, QUIZ);
    expect(r.roster.state).toBe('ambiguous');
    expect(r.notPlayed).toBeNull();
    expect(r.roster.lists.map((l) => l.label)).toEqual(['3-B', '3-C']);
    // the teacher picks the class on the page: the same report, now for 3-C
    const picked = await Data.quizReport(TEACHER, QUIZ, { listId: LIST3C });
    expect(picked.roster).toMatchObject({ state: 'known', className: '3-C', of: 4 });
    expect(picked.notPlayed.map((k) => k.first)).toEqual(['Esha', 'Fahad', 'Gul', 'Huma']);
  });

  test('a quiz bound to its list is known even when the teacher keeps several', async () => {
    seed({ lists: [{ id: LIST3B, class_name: '3', section: 'B' }, { id: LIST3C, class_name: '3', section: 'C' }], quizExtra: { list_id: LIST3B } });
    const r = await Data.quizReport(TEACHER, QUIZ);
    expect(r.roster).toMatchObject({ state: 'known', className: '3-B' });
  });

  test('a list id that is not the teacher\'s is ignored', async () => {
    seed({ lists: [{ id: LIST3B, class_name: '3', section: 'B' }, { id: LIST3C, class_name: '3', section: 'C' }] });
    const r = await Data.quizReport(TEACHER, QUIZ, { listId: 'a0000000-0000-4000-8000-0000000000zz' });
    expect(r.roster.state).toBe('ambiguous');
  });

  test('the teacher\'s only list is a different grade: not assumed — ambiguous, no not-played list', async () => {
    seed();
    // QUIZ2 is grade 5; the teacher keeps only 3-B
    const r = await Data.quizReport(TEACHER, QUIZ2);
    expect(r.roster.state).toBe('ambiguous');
    expect(r.notPlayed).toBeNull();
    // the teacher can still say it was 3-B on the page
    expect((await Data.quizReport(TEACHER, QUIZ2, { listId: LIST3B })).roster).toMatchObject({ state: 'known', className: '3-B' });
  });

  test('a grade band ("3-5") matches the teacher\'s only list of grade 4: known', async () => {
    seed({ lists: [{ id: LIST5A, class_name: '4', section: 'A' }], quizExtra: { grade: '3-5' } });
    expect((await Data.quizReport(TEACHER, QUIZ)).roster).toMatchObject({ state: 'known', className: '4-A' });
  });

  test('a grade band two of the teacher\'s lists fall in: ambiguous', async () => {
    seed({ lists: [{ id: LIST3B, class_name: '3', section: 'B' }, { id: LIST5A, class_name: '5', section: 'A' }], quizExtra: { grade: '3-5' } });
    expect((await Data.quizReport(TEACHER, QUIZ)).roster.state).toBe('ambiguous');
    expect(Data.gradesOf('3-5')).toEqual([3, 4, 5]);
    expect(Data.gradesOf('Class 4')).toEqual([4]);
    expect(Data.gradesOf(null)).toEqual([]);
  });

  test('a mirrored list already named "Grade 3 - B" is not labelled "Grade 3 - B-B"', async () => {
    seed({ lists: [{ id: LIST3B, class_name: 'Grade 3 - B', section: 'B' }] });
    // identity v2 labels it from the class (3-B); the legacy path (a list the teacher picked) must not double it
    expect((await Data.quizReport(TEACHER, QUIZ)).roster.className).not.toMatch(/B-B$/);
    // the legacy fallback's own label (used when identity v2 cannot answer)
    expect(Data.listLabel({ class_name: 'Grade 3 - B', section: 'B' })).toBe('Grade 3 - B');
    expect(Data.listLabel({ class_name: '3', section: 'B' })).toBe('3-B');
    expect(Data.listLabel({ class_name: 'Grade 3', section: null })).toBe('Grade 3');
  });

  test('the reminder carries the class count as social proof when the class is known, naming nobody', async () => {
    seed();
    const r = await Data.quizReport(TEACHER, QUIZ);
    expect(r.reminder.text).toContain('2');
    expect(r.reminder.text).toContain('4');
    expect(r.reminder.text).toContain('3-B');
    expect(r.reminder.text).toContain(LINK);
    ['Amna', 'Bilal', 'Chand', 'Dua'].forEach((n) => expect(r.reminder.text).not.toContain(n));
    const ur = Data.reminderText({ topic: 'کسر', link: LINK, language: 'ur', played: 12, of: 31, className: '5-A' });
    expect(ur).toContain('\u206612\u2069');
    expect(ur).toContain('\u206631\u2069');
    // no class known: today's text, no count
    expect(Data.reminderText({ topic: 'Plants', link: LINK, language: 'en' })).not.toMatch(/ of /);
  });

  test('no class list: state none, played still shown', async () => {
    seed({ lists: [] });
    const r = await Data.quizReport(TEACHER, QUIZ);
    expect(r.roster).toEqual({ state: 'none', className: null, of: null, lists: [] });
    expect(r.notPlayed).toBeNull();
    expect(r.summary.played).toBe(2);
  });

  test('the stored reteach guidance is returned; none stored is null (no model call)', async () => {
    seed();
    expect((await Data.quizReport(TEACHER, QUIZ)).guidance).toEqual({ muddled: 'Roots vs stems', board: 'Draw a plant', check: 'Ask: which part drinks?' });
    expect((await Data.quizReport(TEACHER, QUIZ2)).guidance).toBeNull();
  });

  test('the reminder names nobody and carries the children\'s own link, in the quiz language', async () => {
    seed();
    const r = await Data.quizReport(TEACHER, QUIZ);
    expect(r.reminder.text).toContain(LINK);
    expect(r.reminder.text).toContain('Plants');
    expect(r.reminder.language).toBe('en');
    ['Amna', 'Bilal', 'Chand', 'Dua'].forEach((n) => expect(r.reminder.text).not.toContain(n));
    const ur = Data.reminderText({ topic: 'کسر', link: LINK, language: 'ur' });
    expect(ur).toContain(LINK);
    expect(ur).toMatch(/[؀-ۿ]/);
  });
});

describe('one quiz, two class codes', () => {
  test('a child who played on both codes is ONE row: the first finish', async () => {
    const fake = seed();
    const SC3 = '33333333-3333-4333-8333-333333333335';
    fake.db.quiz_share_codes.push({ id: SC3, code: 'ZZ99ZZ', quiz_id: QUIZ, teacher_user_id: TEACHER, invited_by_student_id: null, created_at: ago(5) });
    fake.db.quiz_sessions.push({ ...session('s9', kid(1), 'Amna Testwala', 1, 3), share_code_id: SC3 });
    const r = await Data.quizReport(TEACHER, QUIZ);
    const amna = r.played.filter((p) => p.first === 'Amna');
    expect(amna).toHaveLength(1);
    expect(amna[0].correct).toBe(4);
    expect(r.summary.played).toBe(2);
  });
});

describe('the reminder link when the hand-out message carries none', () => {
  test('falls back to the quiz\'s own class code on the web page', async () => {
    const fake = seed({ quizExtra: { meta: { share_code_id: SC } } });
    fake.db.app_settings = [{ key: 'web_quiz_enabled', value: true }, { key: 'web_quiz_teachers', value: 'all' }];
    process.env.WEB_QUIZ_BASE_URL = 'https://portal.example.test';
    try {
      const r = await Data.quizReport(TEACHER, QUIZ);
      expect(r.quiz.link).toBe('https://portal.example.test/q/AB12CD');
      expect(r.reminder.text).toContain('https://portal.example.test/q/AB12CD');
    } finally {
      delete process.env.WEB_QUIZ_BASE_URL;
    }
  });
});

describe('classReport', () => {
  test('the teacher\'s quizzes by grade × subject and by week, nobody else\'s', async () => {
    seed();
    const r = await Data.classReport(TEACHER, { days: 60 });
    expect(r.quizzes.map((q) => q.id)).toEqual([QUIZ, QUIZ2]);
    expect(r.quizzes[0]).toMatchObject({ topic: 'Plants', played: 2, avg: 63 });
    const cells = Object.fromEntries(r.cells.map((c) => [`${c.grade}|${c.subject}`, c]));
    expect(cells['3|science']).toMatchObject({ quizzes: 1, played: 2, avg: 63 });
    expect(cells['5|maths']).toMatchObject({ quizzes: 1, played: 1, avg: 50 });
    expect(r.quizzes.some((q) => q.topic === 'Secret')).toBe(false);
    // each quiz row says how many children its ONE class has (grade 3 → the 3-B list); unknown class → null
    expect(r.quizzes[0].of).toBe(4);
    expect(r.quizzes[1].of).toBeNull();
    expect(r.weeks.length).toBeGreaterThanOrEqual(1);
    expect(r.weeks.reduce((n, w) => n + w.quizzes, 0)).toBe(2);
  });
});

describe('classReport rows count the class list for "N of M"', () => {
  test('a child not on the list played: of stays the class size, onList counts only the class', async () => {
    const fake = seed();
    fake.db.quiz_sessions.push(session('s7', 'b0000000-0000-4000-8000-0000000000ee', 'Typed Testwala', 3, 6));
    const r = await Data.classReport(TEACHER, { days: 60 });
    expect(r.quizzes[0]).toMatchObject({ played: 3, onList: 2, of: 4 });
  });
});

describe('teacher report token (kind tr)', () => {
  test('round-trips a quiz scope and an all-classes scope', () => {
    const t = Token.signTeacherReport({ teacherId: TEACHER, quizId: QUIZ });
    expect(Token.verifyTeacherReport(t)).toMatchObject({ teacherId: TEACHER, quizId: QUIZ });
    const all = Token.signTeacherReport({ teacherId: TEACHER });
    expect(Token.verifyTeacherReport(all)).toMatchObject({ teacherId: TEACHER, quizId: null });
    expect(t).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{22}$/);
  });

  test('a child-page preview token, a tampered token, and an expired token are refused', () => {
    const WQT = require('../../../shared/services/quiz/web-quiz-token');
    const preview = WQT.signPreview({ shareCodeId: SC, teacherUserId: TEACHER });
    expect(Token.verifyTeacherReport(preview)).toBeNull();
    const t = Token.signTeacherReport({ teacherId: TEACHER, quizId: QUIZ });
    const [body, sig] = t.split('.');
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url')), t: OTHER })).toString('base64url');
    expect(Token.verifyTeacherReport(`${forged}.${sig}`)).toBeNull();
    const old = Token.signTeacherReport({ teacherId: TEACHER, quizId: QUIZ, now: Date.now() - 31 * 86400000 });
    expect(Token.verifyTeacherReport(old)).toBeNull();
    expect(Token.explain(old)).toBe('expired');
    expect(Token.explain('garbage')).toBe('bad');
  });

  test('a short-lived token for links printed in a PDF: 48 h, and never longer than 30 days', () => {
    const now = Date.now();
    const short = Token.signTeacherReport({ teacherId: TEACHER, quizId: QUIZ, ttlS: 48 * 3600, now: now - 49 * 3600 * 1000 });
    expect(Token.verifyTeacherReport(short)).toBeNull();
    expect(Token.explain(short)).toBe('expired');
    const fresh = Token.signTeacherReport({ teacherId: TEACHER, quizId: QUIZ, ttlS: 48 * 3600, now: now - 47 * 3600 * 1000 });
    expect(Token.verifyTeacherReport(fresh)).toMatchObject({ teacherId: TEACHER, quizId: QUIZ });
    const greedy = Token.signTeacherReport({ teacherId: TEACHER, quizId: QUIZ, ttlS: 365 * 86400, now: now - 31 * 86400 * 1000 });
    expect(Token.verifyTeacherReport(greedy)).toBeNull();
    expect(Token.PDF_TTL_S).toBe(48 * 3600);
  });

  test('no secret: nothing is signed (fails closed)', () => {
    delete process.env.INTERNAL_API_KEY;
    jest.resetModules();
    const T2 = require('../../../shared/services/quiz/teacher-report-token');
    expect(T2.signTeacherReport({ teacherId: TEACHER, quizId: QUIZ })).toBeNull();
  });
});
