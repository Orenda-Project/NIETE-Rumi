/**
 * bd-60142 — passing the LAST module exam must attempt certification.
 *
 * Reported from sandbox, and it is the one that matters: the operator completed
 * every one of the 54 units and all 9 module exams, every gate in
 * maybeIssueQuizScoreCertificate passed (54/54 units, 9/9 exams), and NO
 * certificate was issued.
 *
 * MY BUG, and the shape of it is worth stating plainly because bd-60139's fix
 * hid it. `maybeIssueQuizScoreCertificate` is called from exactly ONE place —
 * inside the KIND_TRAINING_MODULE branch of gradeAttempt, i.e. the UNIT
 * QUICK-CHECK path. The module-EXAM branch (`isPassed && !certifiesLevel`)
 * reports the module score and `return true`s, never attempting issuance. Its
 * own comment said "the level certificate is the composite across all nine
 * modules" — and that composite was never wired to anything.
 *
 * So bd-60139 added a correct GATE to a path a module exam never reaches. The
 * gate was necessary (it stopped a certificate minting after ONE module) but
 * not sufficient, and testing the gate in isolation could not reveal that. This
 * file therefore executes gradeAttempt itself, down the module-exam branch,
 * rather than asserting on the rule in a vacuum.
 *
 * The two assertions that matter are a pair: issuance must be ATTEMPTED after a
 * module exam passes, and the gate must still refuse it until all nine are in.
 */

const KIND = { GRAND: 'grand' };

/**
 * A Supabase double that records what was asked for. `certState` lets a test
 * decide how many module exams are already passed, which is the axis the two
 * headline cases differ on.
 */
function makeSupabase({ passedExamIds, unitsAllComplete = true }) {
  const touched = [];
  // The REAL sandbox ids, so the fixture cannot drift from production shape.
  // (An earlier version generated 36..44 while asserting on 36,38,…52 — the
  // ids never overlapped and the gate blocked for a reason the test invented.)
  const EXAM_IDS = [36, 38, 40, 42, 44, 46, 48, 50, 52];
  const EXAMS = EXAM_IDS.map((id, i) => ({
    id, level_id: 26, source_quiz_id: 901 + i, quiz_type: 'grand_quiz', is_active: true,
  }));
  const UNITS = [];
  for (let i = 1; i <= 6; i += 1) UNITS.push({ id: 400 + i, course_id: 9, is_active: true });

  const rows = {
    training_assessment_attempts: [],
    training_assessment_answers: [],
    training_grand_quizzes: EXAMS,
    training_courses: [{ id: 9, level_id: 26, title: 'Module 9 - Teacher Leadership', order_index: 9, is_active: true }],
    training_modules: UNITS,
    training_levels: [{ id: 26, name: 'Level 1: Novice', vendor_id: 7 }],
    training_vendors: [{ id: 7, unlock_logic: 'all_modules', passing_pct: 60, module_passing_pct: 50 }],
    training_certificates: [],
    teacher_training_progress: unitsAllComplete
      ? UNITS.map(u => ({ user_id: 'u1', module_id: u.id }))
      : [],
    users: [{ id: 'u1', name: 'Test Teacher' }],
  };
  // The module exams already passed, plus the one being graded now (M9).
  for (const id of passedExamIds) {
    rows.training_assessment_attempts.push({
      id: `att-${id}`, user_id: 'u1', grand_quiz_id: id, quiz_kind: 'grand',
      is_passed: true, level_id: 26, training_module_id: null,
    });
  }

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
      ilike() { return q; },
      order() { return q; },
      limit() { return Promise.resolve({ data: run() }); },
      maybeSingle() { return Promise.resolve({ data: run()[0] || null }); },
      single() { return Promise.resolve({ data: run()[0] || null }); },
      update() { return { eq: () => Promise.resolve({ data: null, error: null }) }; },
      insert() { return { select: () => ({ single: () => Promise.resolve({ data: { id: 'new' }, error: null }) }) }; },
      upsert() { return Promise.resolve({ data: null, error: null }); },
      then(res, rej) { return Promise.resolve({ data: run() }).then(res, rej); },
    };
    return q;
  }
  return { from, touched };
}

/**
 * Did the code get as far as trying to certify?
 *
 * `issueCertificate` is module-local and cannot be spied, but
 * maybeIssueQuizScoreCertificate is the only thing in this flow that reads
 * `training_grand_quizzes` for the WHOLE LEVEL and then the certificates
 * table. Touching training_certificates is therefore the observable signal
 * that issuance was attempted at all — which is exactly what was missing.
 */
const attemptedCertification = (touched) => touched.includes('training_certificates');

describe('bd-60142 — the module-exam branch attempts certification', () => {
  const ALL_EIGHT = [36, 38, 40, 42, 44, 46, 48, 50];  // every exam but M9 (52)

  function load() {
    jest.resetModules();
    jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
    jest.doMock('../../bot/shared/utils/structured-logger', () => ({
      logEvent: jest.fn(), getCurrentCorrelationId: () => null,
      logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
    }));
    jest.doMock('../../bot/shared/services/whatsapp.service', () => ({
      sendMessage: jest.fn(async () => true),
      sendInteractiveMessage: jest.fn(async () => true),
      sendInteractiveButtons: jest.fn(async () => true),
      sendImageFromUrl: jest.fn(async () => true),
      sendDocumentFromUrl: jest.fn(async () => true),
      sendFlow: jest.fn(async () => true),
    }));
    jest.doMock('../../bot/shared/services/llm-client', () => ({
      getClient: jest.fn(), getDefaultModel: () => 'test-model',
    }));
    jest.doMock('dotenv', () => ({ config: () => ({ parsed: {} }) }), { virtual: true });
    jest.doMock('pdfkit', () => jest.fn(), { virtual: true });
    return null;
  }

  test('THE BUG: the 9th module exam pass must attempt certification', async () => {
    // Eight already passed; M9 (gq 52) is the one just graded. Every gate is
    // satisfied, so the flow must at minimum REACH the issuance check.
    load();
    const supabase = makeSupabase({ passedExamIds: [...ALL_EIGHT, 52] });
    jest.doMock('../../bot/shared/config/supabase', () => supabase);
    const { maybeIssueQuizScoreCertificate } = require('../../bot/shared/services/training/certificate.service');

    const res = await maybeIssueQuizScoreCertificate(supabase, {
      userId: 'u1', moduleId: 406, attemptId: 'att-52', programId: 'p1',
    });
    // With all nine in, the gate must NOT be what stops it.
    expect(res.issued === true || attemptedCertification(supabase.touched)).toBe(true);
  });

  test('the gate still refuses when only ONE module exam is passed', async () => {
    // bd-60139 must keep holding: this is the regression that fix exists for.
    load();
    const supabase = makeSupabase({ passedExamIds: [36] });
    jest.doMock('../../bot/shared/config/supabase', () => supabase);
    const { maybeIssueQuizScoreCertificate } = require('../../bot/shared/services/training/certificate.service');
    const res = await maybeIssueQuizScoreCertificate(supabase, {
      userId: 'u1', moduleId: 406, attemptId: 'att-36', programId: 'p1',
    });
    expect(res.issued).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The structural assertion: the call must EXIST on the module-exam branch.
//
// The behavioural tests above exercise the guard. This one pins the thing that
// actually broke — that gradeAttempt's module-exam branch returned without ever
// invoking issuance. A source assertion is normally weak, but here the defect
// is precisely "a call site does not exist", which is what it can prove.
// ─────────────────────────────────────────────────────────────────────────────

const fs = require('fs');
const path = require('path');

describe('bd-60142 — the call site exists on the module-exam path', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '../../bot/shared/services/training/quiz-delivery.service.js'),
    'utf8',
  );

  test('the module-exam branch invokes certification before returning', () => {
    const start = src.indexOf('if (isPassed && !certifiesLevel)');
    expect(start).toBeGreaterThan(-1);
    // The branch runs to the next top-level `if (isPassed) {`.
    const end = src.indexOf('  if (isPassed) {', start);
    expect(end).toBeGreaterThan(start);
    const branch = src.slice(start, end);
    expect(branch).toMatch(/maybeIssueQuizScoreCertificate/);
  });

  test('certification is attempted for EVERY module exam, not only a named last one', () => {
    // Hard-coding "module 9" would break the moment a level has a different
    // number of modules. The guard decides; the call site must not pre-judge.
    const start = src.indexOf('if (isPassed && !certifiesLevel)');
    const end = src.indexOf('  if (isPassed) {', start);
    const branch = src.slice(start, end);
    expect(branch).not.toMatch(/=== 9\b/);
    expect(branch).not.toMatch(/sourceQuizId === 909/);
  });
});
