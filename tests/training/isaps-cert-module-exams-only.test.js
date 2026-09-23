/**
 * I-SAPS Level 1 — the certificate asks ONE question: are all the module
 * exams passed?
 *
 * Operator, 2026-09-23: "there is going to be no chaining between Units or
 * Modules whatsoever. A teacher can pick whichever unit and module they want.
 * The only thing we want is to not ship certificate unless all Module Exams
 * are finished." Confirmed "finished" = PASSED (retakes are unlimited).
 *
 * Before this, a per-module-assessed level ALSO had to clear the Oxbridge rule
 * underneath — every unit ticked and every attempted unit quick-check >= 70% —
 * so a teacher who had passed all nine exams but skipped a unit video, or
 * scored 1/3 on a formative check she was told does not gate, got nothing.
 *
 * Executes the REAL guard against a stubbed Supabase (see bd-60139 for why a
 * rules-only test is not enough here).
 */

function makeSupabase({ quizzes, examAttempts, moduleAttempts, progress }) {
  const touched = [];
  const rows = {
    training_modules: [
      { id: 438, course_id: 9, is_active: true },
      { id: 439, course_id: 9, is_active: true },
    ],
    training_courses: [{ id: 9, level_id: 26, is_active: true }],
    training_levels: [{ id: 26, name: 'Level 1: Novice', vendor_id: 7 }],
    training_vendors: [{ id: 7, unlock_logic: 'all_modules' }],
    training_certificates: [],
    training_grand_quizzes: quizzes,
    teacher_training_progress: progress,
    training_assessment_attempts: [...(moduleAttempts || []), ...(examAttempts || [])],
  };
  function from(table) {
    touched.push(table);
    const eqs = {}; const ins = {};
    const run = () => {
      let out = rows[table] || [];
      for (const [c, v] of Object.entries(eqs)) out = out.filter(r => r[c] === v);
      for (const [c, v] of Object.entries(ins)) out = out.filter(r => v.includes(r[c]));
      return out;
    };
    const q = {
      select() { return q; },
      eq(c, v) { eqs[c] = v; return q; },
      in(c, v) { ins[c] = v; return q; },
      limit() { return Promise.resolve({ data: run() }); },
      maybeSingle() { return Promise.resolve({ data: run()[0] || null }); },
      then(res, rej) { return Promise.resolve({ data: run() }).then(res, rej); },
    };
    return q;
  }
  return { from, touched };
}

const EXAMS = [];
for (let i = 1; i <= 9; i += 1) {
  EXAMS.push({ id: 35 + i, level_id: 26, source_quiz_id: 900 + i, quiz_type: 'grand_quiz', is_active: true });
}
const ALL_PASSED = EXAMS.map(e => ({ user_id: 'u1', grand_quiz_id: e.id, is_passed: true, quiz_kind: 'grand' }));

function load() {
  jest.resetModules();
  jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
  return require('../../bot/shared/services/training/certificate.service');
}

// Past the gates == the second read of training_certificates (issueCertificate's
// own one-per-level check). The stub cannot complete an insert, so `issued`
// alone would read false either way.
const reachedIssue = touched => touched.filter(t => t === 'training_certificates').length > 1;

describe('I-SAPS certificate — module exams are the only gate', () => {
  test('all nine exams passed, NO unit ticked → certifies', async () => {
    const { maybeIssueQuizScoreCertificate } = load();
    const supabase = makeSupabase({ quizzes: EXAMS, examAttempts: ALL_PASSED, moduleAttempts: [], progress: [] });
    await maybeIssueQuizScoreCertificate(supabase, { userId: 'u1', levelId: 26, attemptId: 'a1', programId: 'p1' });
    expect(reachedIssue(supabase.touched)).toBe(true);
  });

  test('all nine exams passed, a unit quick-check at 1/3 → still certifies', async () => {
    const { maybeIssueQuizScoreCertificate } = load();
    const supabase = makeSupabase({
      quizzes: EXAMS,
      examAttempts: ALL_PASSED,
      moduleAttempts: [{ user_id: 'u1', training_module_id: 438, score: 1, total_questions: 3, quiz_kind: 'training_module' }],
      progress: [{ user_id: 'u1', module_id: 438 }],
    });
    await maybeIssueQuizScoreCertificate(supabase, { userId: 'u1', levelId: 26, attemptId: 'a1', programId: 'p1' });
    expect(reachedIssue(supabase.touched)).toBe(true);
  });

  test('eight of nine passed, every unit done → does NOT certify', async () => {
    const { maybeIssueQuizScoreCertificate } = load();
    const supabase = makeSupabase({
      quizzes: EXAMS,
      examAttempts: ALL_PASSED.slice(0, 8),
      moduleAttempts: [],
      progress: [{ user_id: 'u1', module_id: 438 }, { user_id: 'u1', module_id: 439 }],
    });
    await maybeIssueQuizScoreCertificate(supabase, { userId: 'u1', levelId: 26, attemptId: 'a1', programId: 'p1' });
    expect(reachedIssue(supabase.touched)).toBe(false);
  });

  test('a SUBMITTED but failed exam is not finished', async () => {
    const { maybeIssueQuizScoreCertificate } = load();
    const attempts = ALL_PASSED.slice(0, 8).concat([{ user_id: 'u1', grand_quiz_id: 44, is_passed: false, quiz_kind: 'grand' }]);
    const supabase = makeSupabase({ quizzes: EXAMS, examAttempts: attempts, moduleAttempts: [], progress: [] });
    await maybeIssueQuizScoreCertificate(supabase, { userId: 'u1', levelId: 26, attemptId: 'a1', programId: 'p1' });
    expect(reachedIssue(supabase.touched)).toBe(false);
  });

  test('a level WITHOUT per-module exams keeps the unit rule (Oxbridge untouched)', async () => {
    const { maybeIssueQuizScoreCertificate } = load();
    const supabase = makeSupabase({
      quizzes: [], examAttempts: [], moduleAttempts: [],
      progress: [{ user_id: 'u1', module_id: 438 }],   // 1 of 2 units
    });
    await maybeIssueQuizScoreCertificate(supabase, { userId: 'u1', levelId: 26, attemptId: 'a1', programId: 'p1' });
    expect(reachedIssue(supabase.touched)).toBe(false);
  });
});
