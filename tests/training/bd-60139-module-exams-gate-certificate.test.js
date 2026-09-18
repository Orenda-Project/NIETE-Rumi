/**
 * bd-60139 — a per-module-assessed level must not certify on quick-checks.
 *
 * Reported from sandbox, with the transcript to prove it: answering the last
 * unit's 2-question QUICK CHECK produced
 *
 *     "📝 Module check — passed. Nice — 2/2 correct."
 *     "🏆 Congratulations, Hataf! You completed every Level 1: Novice
 *      training with 70%+ on each quiz."   ← certificate + PDF
 *     "🎓 Module 9 — every session is done. The module exam is 13 scenario
 *      questions."                          ← the exam it had not taken
 *
 * Eight of the nine module exams had never been taken; the ninth was still
 * in_progress. The certificate arrived BEFORE the assessment it certifies.
 *
 * Cause: maybeIssueQuizScoreCertificate is the Oxbridge rule — all units
 * complete + each unit quick-check >= 70%. It has no concept of a summative
 * exam per module, so for a per-module-assessed vendor it fires far too early.
 *
 * The second describe block executes the REAL function against a stubbed
 * Supabase. That is deliberate: this session has already shipped three
 * ReferenceErrors and a projection bug that every rules-only test passed.
 */

const {
  allModuleExamsPassed,
} = require('../../bot/shared/services/training/isaps-module-exam.rules');

const EXAM = (id, sq, active = true) => ({
  id, source_quiz_id: sq, quiz_type: 'grand_quiz', is_active: active,
});
const PASS = id => ({ grand_quiz_id: id, is_passed: true });

describe('bd-60139 — allModuleExamsPassed', () => {
  test('THE BUG: one exam passed of nine is not all of them', () => {
    const quizzes = [];
    for (let i = 1; i <= 9; i += 1) quizzes.push(EXAM(35 + i, 900 + i));
    expect(allModuleExamsPassed(quizzes, [PASS(36)])).toBe(false);
  });

  test('every active per-module exam passed → true', () => {
    const quizzes = [];
    const attempts = [];
    for (let i = 1; i <= 9; i += 1) {
      quizzes.push(EXAM(35 + i, 900 + i));
      attempts.push(PASS(35 + i));
    }
    expect(allModuleExamsPassed(quizzes, attempts)).toBe(true);
  });

  test('an IN-PROGRESS exam does not count as passed', () => {
    // Exactly the sandbox state: module 9's attempt existed but is_passed null.
    const quizzes = [EXAM(36, 901), EXAM(52, 909)];
    const attempts = [PASS(36), { grand_quiz_id: 52, is_passed: null }];
    expect(allModuleExamsPassed(quizzes, attempts)).toBe(false);
  });

  test('a FAILED exam does not count as passed', () => {
    const quizzes = [EXAM(36, 901)];
    expect(allModuleExamsPassed(quizzes, [{ grand_quiz_id: 36, is_passed: false }])).toBe(false);
  });

  test('INACTIVE exams are ignored — retired capstones must not block forever', () => {
    // I-SAPS carries a retired capstone row per module (is_active false).
    const quizzes = [EXAM(36, 901), EXAM(37, 901, false)];
    expect(allModuleExamsPassed(quizzes, [PASS(36)])).toBe(true);
  });

  test('a level with NO per-module exams is not gated by this rule', () => {
    // Oxbridge/Taleemabad: source_quiz_id below 900, or none at all. Returning
    // true keeps every other vendor on exactly its current behaviour.
    expect(allModuleExamsPassed([EXAM(33, 5)], [])).toBe(true);
    expect(allModuleExamsPassed([], [])).toBe(true);
    expect(allModuleExamsPassed(null, null)).toBe(true);
  });

  test('a level-wide exam (source_quiz_id < 900) does not gate either', () => {
    expect(allModuleExamsPassed([EXAM(33, 11)], [])).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The real function, against a stubbed DB.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A PostgREST-shaped stub that returns real rows, so the guard runs all the way
 * to its decision instead of bailing at the first lookup. The debug run that
 * motivated this: a stub returning null made the test pass for the WRONG
 * reason (`issued:false` because `training_modules` was empty), which would
 * have shipped a green test over an unfixed bug.
 */
function makeSupabase({ quizzes, examAttempts, moduleAttempts }) {
  const touched = [];
  const rows = {
    training_modules: [{ id: 438, course_id: 9, is_active: true }],
    training_courses: [{ id: 9, level_id: 26, is_active: true }],
    training_levels: [{ id: 26, name: 'Level 1: Novice', vendor_id: 7 }],
    training_vendors: [{ id: 7, unlock_logic: 'all_modules' }],
    training_certificates: [],
    training_grand_quizzes: quizzes,
    teacher_training_progress: [{ user_id: 'u1', module_id: 438 }],
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

describe('bd-60139 — maybeIssueQuizScoreCertificate, executed', () => {
  const activeExams = [];
  for (let i = 1; i <= 9; i += 1) {
    activeExams.push({ id: 35 + i, level_id: 26, source_quiz_id: 900 + i, quiz_type: 'grand_quiz', is_active: true });
  }
  // The unit quick-check that (wrongly) triggered certification on sandbox.
  const goodQuickCheck = [{
    user_id: 'u1', training_module_id: 438, score: 2, total_questions: 2,
    quiz_kind: 'training_module', is_passed: true,
  }];

  function load() {
    jest.resetModules();
    jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
    return require('../../bot/shared/services/training/certificate.service');
  }

  /**
   * The observable signal.
   *
   * `issueCertificate` is a module-local call, so it cannot be spied. But it is
   * the ONLY thing after the gates that reads training_assessment_attempts and
   * then touches training_certificates a second time. So "did the guard decide
   * to certify?" == "did it get past the gates to that second read?".
   *
   * Keying the assertion off `issued` alone is not enough: this stub cannot
   * complete an insert, so `issued:false` comes back either way, and the test
   * would pass on unfixed code — which is exactly what it did before this
   * comment existed.
   */
  const reachedIssue = (touched) => touched.filter(t => t === 'training_certificates').length > 1;

  test('THE BUG: it must NOT certify while module exams are unpassed', async () => {
    const { maybeIssueQuizScoreCertificate } = load();
    const supabase = makeSupabase({
      quizzes: activeExams,
      moduleAttempts: goodQuickCheck,
      // Exactly sandbox: one passed, one in progress, seven never taken.
      examAttempts: [
        { user_id: 'u1', grand_quiz_id: 36, is_passed: true, quiz_kind: 'grand' },
        { user_id: 'u1', grand_quiz_id: 52, is_passed: null, quiz_kind: 'grand' },
      ],
    });
    await maybeIssueQuizScoreCertificate(supabase, {
      userId: 'u1', moduleId: 438, attemptId: 'a1', programId: 'p1',
    });
    expect(reachedIssue(supabase.touched)).toBe(false);
  });

  test('all nine module exams passed → it DOES proceed to certify', async () => {
    const { maybeIssueQuizScoreCertificate } = load();
    const supabase = makeSupabase({
      quizzes: activeExams,
      moduleAttempts: goodQuickCheck,
      examAttempts: activeExams.map(e => ({ user_id: 'u1', grand_quiz_id: e.id, is_passed: true, quiz_kind: 'grand' })),
    });
    await maybeIssueQuizScoreCertificate(supabase, {
      userId: 'u1', moduleId: 438, attemptId: 'a1', programId: 'p1',
    });
    expect(reachedIssue(supabase.touched)).toBe(true);
  });

  test('a vendor with NO per-module exams is unaffected — it still certifies', async () => {
    // Oxbridge: the path this function was written for must not change.
    const { maybeIssueQuizScoreCertificate } = load();
    const supabase = makeSupabase({
      quizzes: [{ id: 33, level_id: 26, source_quiz_id: null, quiz_type: 'grand_quiz', is_active: false }],
      moduleAttempts: goodQuickCheck,
      examAttempts: [],
    });
    await maybeIssueQuizScoreCertificate(supabase, {
      userId: 'u1', moduleId: 438, attemptId: 'a1', programId: 'p1',
    });
    expect(reachedIssue(supabase.touched)).toBe(true);
  });
});
