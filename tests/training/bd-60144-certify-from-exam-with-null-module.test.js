/**
 * bd-60144 — a module-exam attempt has NO module, so certification must not
 * resolve the level through one.
 *
 * Third failed attempt at the same feature, and the cause was upstream of
 * everything already fixed. From the operator's real sandbox rows:
 *
 *     attempt.training_module_id = NULL   (module exams are keyed by
 *                                          grand_quiz_id, not by a module)
 *
 * maybeIssueQuizScoreCertificate opens with:
 *
 *     .from('training_modules').select('id, course_id').eq('id', moduleId)
 *     if (!mod || !mod.course_id) return { issued: false };
 *
 * bd-60142 wired the call onto the module-exam branch and passed
 * `attempt.training_module_id` as moduleId. That is null there, so the very
 * first lookup returns nothing and the guard bails BEFORE any gate — before the
 * units check, before allModuleExamsPassed, before anything that was verified.
 * Axiom showed "🎓 Module exam passed — no level certificate" with every gate
 * satisfied: 54/54 units, 9/9 exams, no certificate.
 *
 * WHY THE EARLIER CHECKS MISSED IT — the lesson, not an excuse. Each round
 * tested the piece that had just been changed: bd-60139 exercised the gate,
 * bd-60142 asserted the call site existed, and the "verified against real rows"
 * pass called allModuleExamsPassed directly. None of them ran the function's
 * own prologue, which is where it died. The fixture even hard-coded
 * `moduleId: 406` — a module that exists — so it could never reproduce
 * production, where that value is null.
 *
 * This file therefore fixes the shape of the input rather than the shape of the
 * assertion: every case passes an attempt row exactly as the database stores
 * one for a module exam.
 */

/** A module-EXAM attempt, verbatim from sandbox: no module, keyed by quiz. */
const EXAM_ATTEMPT = Object.freeze({
  id: 'att-52',
  user_id: 'u1',
  level_id: 26,
  grand_quiz_id: 52,
  training_module_id: null,   // ← the whole bug
  quiz_kind: 'grand',
  program_id: 'p1',
});

function makeSupabase({ passedExamIds = [], unitsComplete = true } = {}) {
  const touched = [];
  const EXAM_IDS = [36, 38, 40, 42, 44, 46, 48, 50, 52];
  const EXAMS = EXAM_IDS.map((id, i) => ({
    id, level_id: 26, source_quiz_id: 901 + i, quiz_type: 'grand_quiz', is_active: true,
  }));
  const UNITS = Array.from({ length: 6 }, (_, i) => ({ id: 401 + i, course_id: 9, is_active: true }));

  const rows = {
    training_grand_quizzes: EXAMS,
    training_courses: [{ id: 9, level_id: 26, title: 'Module 9', order_index: 9, is_active: true }],
    training_modules: UNITS,
    training_levels: [{ id: 26, name: 'Level 1: Novice', vendor_id: 7 }],
    training_vendors: [{ id: 7, unlock_logic: 'all_modules' }],
    training_certificates: [],
    teacher_training_progress: unitsComplete ? UNITS.map(u => ({ user_id: 'u1', module_id: u.id })) : [],
    users: [{ id: 'u1', name: 'Test Teacher', phone_number: '923000000000' }],
    training_assessment_attempts: passedExamIds.map(id => ({
      id: `att-${id}`, user_id: 'u1', grand_quiz_id: id, quiz_kind: 'grand',
      is_passed: true, level_id: 26, training_module_id: null,
    })),
    training_programs: [{ id: 'p1', name: 'Prog' }],
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
      select() { return q; }, eq(c, v) { eqs[c] = v; return q; },
      in(c, v) { ins[c] = v; return q; }, ilike() { return q; }, order() { return q; },
      limit() { return Promise.resolve({ data: run() }); },
      maybeSingle() { return Promise.resolve({ data: run()[0] || null }); },
      single() { return Promise.resolve({ data: run()[0] || null }); },
      insert(payload) {
        if (table === 'training_certificates') rows.training_certificates.push(payload);
        return {
          select: () => ({
            single: () => Promise.resolve({
              data: { id: 'cert-1', certificate_code: 'TEST-CODE', ...payload }, error: null,
            }),
          }),
        };
      },
      update() { return { eq: () => Promise.resolve({ data: null, error: null }) }; },
      then(res, rej) { return Promise.resolve({ data: run() }).then(res, rej); },
    };
    return q;
  }
  return { from, touched, rows };
}

function load() {
  jest.resetModules();
  jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
  jest.doMock('../../bot/shared/utils/structured-logger', () => ({
    logEvent: jest.fn(), getCurrentCorrelationId: () => null,
    logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
  }));
  jest.doMock('dotenv', () => ({ config: () => ({ parsed: {} }) }), { virtual: true });
  jest.doMock('pdfkit', () => jest.fn(), { virtual: true });
  return require('../../bot/shared/services/training/certificate.service');
}

const ALL_NINE = [36, 38, 40, 42, 44, 46, 48, 50, 52];

describe('bd-60144 — certification from a module-exam attempt', () => {
  test('THE BUG: a null training_module_id must not stop certification', async () => {
    const { maybeIssueQuizScoreCertificate } = load();
    const supabase = makeSupabase({ passedExamIds: ALL_NINE });

    const res = await maybeIssueQuizScoreCertificate(supabase, {
      userId: EXAM_ATTEMPT.user_id,
      moduleId: EXAM_ATTEMPT.training_module_id,   // null, as production stores it
      levelId: EXAM_ATTEMPT.level_id,              // what the exam branch actually knows
      attemptId: EXAM_ATTEMPT.id,
      programId: EXAM_ATTEMPT.program_id,
    });

    expect(res.issued).toBe(true);
    expect(res.certificate_code).toBeTruthy();
  });

  test('it gets past the prologue at all — training_modules must not be the blocker', async () => {
    // The precise failure: the FIRST query decided the outcome. If the level is
    // supplied, resolving it through a module is unnecessary, so the guard must
    // reach the tables that actually gate the decision.
    const { maybeIssueQuizScoreCertificate } = load();
    const supabase = makeSupabase({ passedExamIds: ALL_NINE });
    await maybeIssueQuizScoreCertificate(supabase, {
      userId: 'u1', moduleId: null, levelId: 26, attemptId: 'att-52', programId: 'p1',
    });
    expect(supabase.touched).toContain('training_grand_quizzes');
    // INVERTED 2026-09-23 (operator: the certificate waits on the module exams
    // ONLY). This used to assert the guard went on to read unit progress; on a
    // per-module-assessed level it now certifies without looking at units, so
    // proof it got past the prologue is that it reached issuance instead.
    expect(supabase.touched).not.toContain('teacher_training_progress');
    expect(supabase.touched.filter(t => t === 'training_certificates').length).toBeGreaterThan(1);
  });

  test('the gate STILL refuses with only one exam passed — bd-60139 holds', async () => {
    const { maybeIssueQuizScoreCertificate } = load();
    const supabase = makeSupabase({ passedExamIds: [36] });
    const res = await maybeIssueQuizScoreCertificate(supabase, {
      userId: 'u1', moduleId: null, levelId: 26, attemptId: 'att-36', programId: 'p1',
    });
    expect(res.issued).toBe(false);
  });

  // INVERTED 2026-09-23. Was "the gate STILL refuses when the units are not
  // finished". Operator: "no chaining between Units or Modules whatsoever ...
  // not ship certificate unless all Module Exams are finished" — so unfinished
  // units no longer block an I-SAPS certificate once all nine exams are passed.
  test('all nine exams passed certifies even with units unfinished', async () => {
    const { maybeIssueQuizScoreCertificate } = load();
    const supabase = makeSupabase({ passedExamIds: ALL_NINE, unitsComplete: false });
    const res = await maybeIssueQuizScoreCertificate(supabase, {
      userId: 'u1', moduleId: null, levelId: 26, attemptId: 'att-52', programId: 'p1',
    });
    expect(res.issued).toBe(true);
  });

  test('the QUICK-CHECK path is unchanged — moduleId still resolves the level', async () => {
    // The unit quick-check branch passes a real module and NO levelId. Every
    // other vendor (Oxbridge, Beacon House) certifies down this path, so it
    // must keep working exactly as before.
    const { maybeIssueQuizScoreCertificate } = load();
    const supabase = makeSupabase({ passedExamIds: ALL_NINE });
    const res = await maybeIssueQuizScoreCertificate(supabase, {
      userId: 'u1', moduleId: 401, attemptId: 'att-x', programId: 'p1',
    });
    expect(res.issued).toBe(true);
  });

  test('neither a module nor a level means it cannot proceed', async () => {
    const { maybeIssueQuizScoreCertificate } = load();
    const supabase = makeSupabase({ passedExamIds: ALL_NINE });
    const res = await maybeIssueQuizScoreCertificate(supabase, {
      userId: 'u1', moduleId: null, attemptId: 'att-52', programId: 'p1',
    });
    expect(res.issued).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// And the call site must actually hand over the level it already holds.
// ─────────────────────────────────────────────────────────────────────────────

const fs = require('fs');
const path = require('path');

describe('bd-60144 — the exam branch passes levelId', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '../../bot/shared/services/training/quiz-delivery.service.js'),
    'utf8',
  );

  test('the module-exam branch supplies attempt.level_id', () => {
    const start = src.indexOf('if (isPassed && !certifiesLevel)');
    const end = src.indexOf('  if (isPassed) {', start);
    const branch = src.slice(start, end);
    expect(branch).toMatch(/maybeIssueQuizScoreCertificate/);
    expect(branch).toMatch(/levelId:\s*attempt\.level_id/);
  });
});
