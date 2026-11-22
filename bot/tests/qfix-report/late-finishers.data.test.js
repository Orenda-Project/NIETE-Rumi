'use strict';
/**
 * bd-5j1zaf — the children who finished AFTER a quiz's 12 h report, counted by the report's own reader.
 *
 * A child is late when their counted attempt (the first finish on a web class, attemptRuleFor) completed after
 * `quiz_share_codes.report_sent_at` of the code they played on. No stamp → nobody is late (the report has not gone).
 * The count rides the reads the report already makes (teacher-report.data: quizReport, classReport; the teacher home's
 * playedOwn and libraryShares), so the home row, the quiz tab and the report agree. The keys are present only when
 * they say something (late ≥ 1, reported), so every page that does not read them is unchanged.
 *
 * Supabase is the faked boundary (an in-memory client that applies the filters); its select() does not project, so
 * the code read's column list is asserted separately (a missing column would read as "never reported").
 */
jest.mock('../../shared/config/supabase', () => ({}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
// the home's "prepared" marks (teacher-home.sent): none here, so every code is a real send
jest.mock('../../shared/services/cache/railway-redis.service', () => ({ get: async () => null, isAvailable: () => true }));

const { makeFake } = require('../quiz/web-quiz/fake-supabase');

const TEACHER = '11111111-1111-4111-8111-111111111111';
const QUIZ = '22222222-2222-4222-8222-222222222222';
const QUIZ2 = '22222222-2222-4222-8222-222222222223';
const LIBQ = '22222222-2222-4222-8222-2222222222bb';
const SC = '33333333-3333-4333-8333-333333333333';
const SC2 = '33333333-3333-4333-8333-333333333334';
const SCL = '33333333-3333-4333-8333-3333333333bb';
const LIST3B = 'a0000000-0000-4000-8000-00000000003b';
const kid = (n) => `b0000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;
const ago = (h) => new Date(Date.now() - h * 3600000).toISOString();
const NAMES = ['Amna', 'Bilal', 'Chand', 'Dua'];

const session = (id, studentId, name, correct, h, extra = {}) => ({
  id, quiz_id: QUIZ, share_code_id: SC, student_id: studentId, student_name: name, user_id: null,
  status: 'completed', correct_answers: correct, total_questions_answered: 4, mastery_percentage: correct * 25,
  completed_at: ago(h), created_at: ago(h + 0.1), invited_by_student_id: null, device_ref: `dev-${id}`, ...extra,
});

let selects;
function seed({ stamp = ago(10), stamp2 = null, libStamp = ago(1) } = {}) {
  const fake = makeFake({
    quizzes: [
      { id: QUIZ, teacher_id: TEACHER, topic: 'Plants', subject: 'science', grade: '3', language: 'en', quiz_source: 'transcript', status: 'report_sent',
        list_id: null, created_at: ago(30), meta: { share_code_id: SC } },
      { id: QUIZ2, teacher_id: TEACHER, topic: 'Fractions', subject: 'maths', grade: '3', language: 'ur', quiz_source: 'lp_v8', status: 'sent',
        list_id: null, created_at: ago(9), meta: { share_code_id: SC2 } },
      // a library quiz (the bank's: no author) this teacher sent from the home
      { id: LIBQ, teacher_id: null, topic: 'Animals', subject: 'science', grade: '3', language: 'en', quiz_source: 'video', status: 'sent',
        list_id: null, created_at: ago(200), meta: {} },
    ],
    quiz_share_codes: [
      { id: SC, code: 'AB12CD', quiz_id: QUIZ, teacher_user_id: TEACHER, invited_by_student_id: null, parent_share_code_id: null, created_at: ago(30), report_sent_at: stamp, active: true, expires_at: null, topic: 'Plants' },
      { id: SC2, code: 'EF34GH', quiz_id: QUIZ2, teacher_user_id: TEACHER, invited_by_student_id: null, parent_share_code_id: null, created_at: ago(9), report_sent_at: stamp2, active: true, expires_at: null, topic: 'Fractions' },
      { id: SCL, code: 'LB12CD', quiz_id: LIBQ, teacher_user_id: TEACHER, invited_by_student_id: null, parent_share_code_id: null, created_at: ago(20), report_sent_at: libStamp, active: true, expires_at: null, topic: 'Animals' },
    ],
    student_lists: [{ id: LIST3B, class_name: '3', section: 'B', user_id: TEACHER, is_active: true }],
    students: [1, 2, 3, 4].map((r) => ({ id: kid(r), list_id: LIST3B, roll_number: r, student_name: `${NAMES[r - 1]} Testwala`, student_name_urdu: null, is_active: true })),
    quiz_sessions: [
      // before the report (stamped 10 h ago): seen by it
      session('s1', kid(1), 'Amna Testwala', 4, 20),
      // first finish before the report, a replay after it: the first finish counts, so not late
      session('s2', kid(2), 'Bilal Testwala', 1, 19),
      session('s2b', kid(2), 'Bilal Testwala', 4, 2),
      // finished after the report: late
      session('s3', kid(3), 'Chand Testwala', 3, 3),
      // started after the report, not finished: not played, so not late
      session('s4', kid(4), 'Dua Testwala', 0, 1, { status: 'in_progress', completed_at: null }),
      // the unreported quiz: a finish, nobody late
      { ...session('t1', kid(1), 'Amna Testwala', 2, 4), quiz_id: QUIZ2, share_code_id: SC2 },
      // the library send: one finish before its report (stamped 1 h ago), one after
      { ...session('l1', kid(1), 'Amna Testwala', 2, 5), quiz_id: LIBQ, share_code_id: SCL },
      { ...session('l2', kid(2), 'Bilal Testwala', 3, 0.5), quiz_id: LIBQ, share_code_id: SCL },
    ],
    quiz_questions: [], quiz_answers: [], app_settings: [{ key: 'quiz_teacher_home', value: true }],
    teacher_home_sent: [],
  });
  selects = [];
  const from = (t) => {
    const b = fake.from(t);
    const sel = b.select;
    b.select = (cols, opts) => { selects.push([t, String(cols || '')]); return sel(cols, opts); };
    return b;
  };
  Object.assign(require('../../shared/config/supabase'), { from, rpc: fake.rpc });
  return fake;
}

let Data;
beforeEach(() => {
  jest.resetModules();
  Data = require('../../shared/services/quiz/teacher-report.data');
});

describe('quizReport: the late finishers', () => {
  test('a finish after the code\'s report is late; a replay after it is not (the first finish counts); unfinished is not', async () => {
    seed();
    const r = await Data.quizReport(TEACHER, QUIZ);
    expect(r.summary).toMatchObject({ played: 3, late: 1, reported: true });
    const byName = Object.fromEntries(r.played.map((p) => [p.first, p]));
    expect(byName.Chand.late).toBe(true);
    expect(byName.Amna).not.toHaveProperty('late');
    expect(byName.Bilal).not.toHaveProperty('late');
  });

  test('no report sent yet (no stamp, no /quiz request): nobody is late and the summary says nothing new', async () => {
    const fake = seed({ stamp: null });
    fake.db.quizzes.find((q) => q.id === QUIZ).status = 'sent';
    const r = await Data.quizReport(TEACHER, QUIZ);
    expect(r.summary.played).toBe(3);
    expect(r.summary).not.toHaveProperty('late');
    expect(r.summary).not.toHaveProperty('reported');
    r.played.forEach((p) => expect(p).not.toHaveProperty('late'));
  });

  test('reported, everyone in time: reported, no late key', async () => {
    seed({ stamp: ago(0.1) });
    const r = await Data.quizReport(TEACHER, QUIZ);
    expect(r.summary.reported).toBe(true);
    expect(r.summary).not.toHaveProperty('late');
  });

  test('the code read asks for report_sent_at (the boundary does not project, so the column list is the proof)', async () => {
    seed();
    await Data.quizReport(TEACHER, QUIZ);
    // the class codes read (classCodes: the codes the counting runs on); other reads of the table (identity v2's) ask other things
    const codeReads = selects.filter(([t, c]) => t === 'quiz_share_codes' && /\bcode\b/.test(c) && /\bcreated_at\b/.test(c)).map(([, c]) => c);
    expect(codeReads.length).toBeGreaterThan(0);
    codeReads.forEach((c) => expect(c).toMatch(/\breport_sent_at\b/));
  });
});

describe('classReport: the same count on every quiz row', () => {
  test('the reported quiz carries late and reported; the unreported one carries neither', async () => {
    seed();
    const r = await Data.classReport(TEACHER, { days: 60 });
    const plants = r.quizzes.find((q) => q.id === QUIZ);
    const fractions = r.quizzes.find((q) => q.id === QUIZ2);
    expect(plants).toMatchObject({ played: 3, late: 1, reported: true });
    expect(fractions.played).toBe(1);
    expect(fractions).not.toHaveProperty('late');
    expect(fractions).not.toHaveProperty('reported');
  });

  test('ownOnly (the home\'s quick answer) counts the same', async () => {
    seed();
    const r = await Data.classReport(TEACHER, { days: 60, ownOnly: true });
    expect(r.quizzes.find((q) => q.id === QUIZ)).toMatchObject({ late: 1, reported: true });
  });

  test('a teacher\'s own /quiz request (the quiz row is report_sent, no code stamped): reported, and nobody late (late stays the automatic report\'s)', async () => {
    const fake = seed({ stamp: null });
    fake.db.quizzes.find((q) => q.id === QUIZ).status = 'report_sent';
    const r = await Data.classReport(TEACHER, { days: 60 });
    const plants = r.quizzes.find((q) => q.id === QUIZ);
    expect(plants.reported).toBe(true);
    expect(plants).not.toHaveProperty('late');
    const q = await Data.quizReport(TEACHER, QUIZ);
    expect(q.summary.reported).toBe(true);
    expect(q.summary).not.toHaveProperty('late');
  });

  test('a quiz that is only sent (no request, no stamp) is not reported', async () => {
    const fake = seed({ stamp: null });
    fake.db.quizzes.find((q) => q.id === QUIZ).status = 'sent';
    const r = await Data.classReport(TEACHER, { days: 60 });
    expect(r.quizzes.find((q) => q.id === QUIZ)).not.toHaveProperty('reported');
  });

  test('a child who finished on two codes counts once (the earlier finish), late against that finish\'s own code', async () => {
    const fake = seed({ stamp: ago(10), stamp2: ago(50) });
    // kid 3 also played the quiz on a second code of this quiz, earlier (before that code's report): the earlier finish counts, and it was in time
    fake.db.quiz_share_codes.push({ id: '33333333-3333-4333-8333-3333333333cc', code: 'ZZ12CD', quiz_id: QUIZ, teacher_user_id: TEACHER, invited_by_student_id: null, parent_share_code_id: null, created_at: ago(60), report_sent_at: ago(50), active: true, expires_at: null });
    fake.db.quiz_sessions.push({ ...session('s3x', kid(3), 'Chand Testwala', 2, 55), share_code_id: '33333333-3333-4333-8333-3333333333cc' });
    const q = await Data.quizReport(TEACHER, QUIZ);
    expect(q.summary).not.toHaveProperty('late');
    expect(q.played.find((p) => p.first === 'Chand')).not.toHaveProperty('late');
  });
});

describe('the teacher home reads', () => {
  test('playedOwn carries late, reported and the class-list count beside played', async () => {
    seed();
    const Home = require('../../shared/services/first-touch/teacher-home.data');
    const full = await Home.playedOwn(TEACHER);
    expect(full.get(QUIZ)).toMatchObject({ played: 3, late: 1, reported: true, onList: 3, of: 4 });
    expect(full.get(QUIZ2)).not.toHaveProperty('late');
    const light = await Home.playedOwn(TEACHER, null, { light: true });
    expect(light.get(QUIZ)).toMatchObject({ played: 3, late: 1, reported: true, onList: 3 });
  });

  test('libraryShares carries the late count of each send\'s own code', async () => {
    seed();
    const Home = require('../../shared/services/first-touch/teacher-home.data');
    const shares = await Home.libraryShares(TEACHER);
    const lib = shares.find((s) => s.shareCodeId === SCL);
    expect(lib).toMatchObject({ quizId: LIBQ, played: 2, late: 1, reported: true });
    const codeReads = selects.filter(([t]) => t === 'quiz_share_codes').map(([, c]) => c);
    expect(codeReads.some((c) => /\breport_sent_at\b/.test(c) && /\bactive\b/.test(c))).toBe(true);
  });
});
