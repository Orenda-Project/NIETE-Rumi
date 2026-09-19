/**
 * bd-60149 — a module exam must be sittable on the portal.
 *
 * Operator, from production: "on the portal i dont actually see the Summative
 * Assessments from the end of the module."
 *
 * Confirmed by reading the routes: `source_quiz_id` appears NOWHERE in
 * dashboard/routes/portal.routes.js. The portal was built for one exam per
 * LEVEL — its /training/level/:id/grand-quiz route resolves a single level
 * exam — while I-SAPS has ZERO exams at level scope and NINE at module scope
 * (source_quiz_id 901..909). No portal route reads a module-scoped quiz, so a
 * teacher can finish all 54 units on the portal and never reach a summative
 * assessment.
 *
 * This is the half of bd-60145 that was flagged and not built: certification
 * was wired so the portal COULD issue a certificate, but the route to sit the
 * exam that earns it never existed.
 *
 * TWO OPERATOR DECISIONS ARE ENCODED HERE:
 *
 *   1. MIRROR THE BOT — an unpassed module exam BLOCKS the next module. The
 *      two surfaces must agree about what is open, because a teacher moves
 *      between them mid-level.
 *   2. THE CRQ MARKS IN THE BACKGROUND — the attempt and its answers are saved
 *      immediately and the rubric score lands when the marker returns. A ~10s
 *      LLM call must never be the reason a teacher's written answer is lost.
 *
 * AND THE ARCHITECTURAL CONSTRAINT, unchanged since bd-60145:
 * dashboard/services/training-rules.service.js holds NO decision logic — a
 * test enforces it — so the gate, the paper and the marking all come from the
 * bot over /api/internal/training/*. This file pins that the portal asks.
 */

const fs = require('fs');
const path = require('path');

const ROUTES = fs.readFileSync(
  path.join(__dirname, '../../dashboard/routes/portal.routes.js'), 'utf8');
const RULES_CLIENT = fs.readFileSync(
  path.join(__dirname, '../../dashboard/services/training-rules.service.js'), 'utf8');
const INTERNAL_API = fs.readFileSync(
  path.join(__dirname, '../../bot/shared/routes/internal-api.routes.js'), 'utf8');

/** A route handler's body, from its declaration to the next one. */
function routeBody(src, decl) {
  const start = src.indexOf(decl);
  if (start === -1) return '';
  const next = src.indexOf('\nrouter.', start + decl.length);
  return src.slice(start, next === -1 ? src.length : next);
}

describe('bd-60149 — the bot exposes the module exam as internal rules', () => {
  test('there is a module-exam GATE endpoint', () => {
    expect(INTERNAL_API).toMatch(/training\/module-exam-gate/);
  });

  test('there is a module-exam START endpoint', () => {
    expect(INTERNAL_API).toMatch(/training\/module-exam-start/);
  });

  test('there is a module-exam SUBMIT endpoint', () => {
    expect(INTERNAL_API).toMatch(/training\/module-exam-submit/);
  });

  test('the gate delegates to the endpoint slot the bot already uses', () => {
    // loadModuleExamSlot is what WhatsApp asks. Re-deriving the gate here
    // would be a second implementation, which is the bug bd-2480 removed.
    const i = INTERNAL_API.indexOf('training/module-exam-gate');
    expect(INTERNAL_API.slice(i, i + 1800)).toMatch(/loadModuleExamSlot/);
  });

  test('submit marks the CRQ with the bot’s grader, not a portal copy', () => {
    const i = INTERNAL_API.indexOf('training/module-exam-submit');
    const block = INTERNAL_API.slice(i, i + 3000);
    expect(block).toMatch(/scoreAnswer|capstone-delivery/);
  });

  test('submit runs the certification guard, so the portal can finish a level', () => {
    // NOT asserted on the endpoint: certification lives one hop down, inside
    // gradeAttempt's module-exam branch (bd-60142). submitModuleExamPaper
    // calls gradeAttempt, so the portal certifies through exactly the same
    // code WhatsApp does — a second call here would be a duplicate mint.
    const SERVICE = fs.readFileSync(
      path.join(__dirname, '../../bot/shared/services/training/quiz-delivery.service.js'), 'utf8');
    const i = SERVICE.indexOf('async function submitModuleExamPaper');
    expect(i).toBeGreaterThan(-1);
    expect(SERVICE.slice(i)).toMatch(/gradeAttempt\(attemptId/);
    // and gradeAttempt's module-exam branch is what certifies
    const g = SERVICE.indexOf('if (isPassed && !certifiesLevel)');
    expect(SERVICE.slice(g, SERVICE.indexOf('  if (isPassed) {', g))).toMatch(/maybeIssueQuizScoreCertificate/);
  });
});

describe('bd-60149 — the portal asks rather than deciding', () => {
  for (const fn of ['moduleExamGate', 'startModuleExam', 'submitModuleExam']) {
    test(`the rules client exposes ${fn}`, () => {
      expect(RULES_CLIENT).toMatch(new RegExp(`\\b${fn}\\b`));
    });
  }

  test('each one goes over the internal API', () => {
    for (const fn of ['moduleExamGate', 'startModuleExam', 'submitModuleExam']) {
      const i = RULES_CLIENT.indexOf(`async function ${fn}`);
      expect(i).toBeGreaterThan(-1);
      const body = RULES_CLIENT.slice(i, RULES_CLIENT.indexOf('\n}', i));
      expect(body).toMatch(/ask\(/);
    }
  });

  test('the client still contains NO decision logic', () => {
    // The property this whole module exists for. A local gate or a local
    // sampler here would drift from the bot exactly as three rules did before.
    expect(RULES_CLIENT).not.toMatch(/source_quiz_id/);
    expect(RULES_CLIENT).not.toMatch(/selectPaperWithOneCrq/);
    expect(RULES_CLIENT).not.toMatch(/loadModuleExamSlot/);
  });
});

describe('bd-60149 — the portal routes', () => {
  const GATE = "router.get('/training/module/:id/exam'";
  const QUESTIONS = "router.get('/training/module/:id/exam/questions'";
  const SUBMIT = "router.post('/training/module/:id/exam/attempts'";

  test('a module exposes its exam state', () => {
    expect(routeBody(ROUTES, GATE)).toBeTruthy();
  });

  test('a module exposes its exam paper', () => {
    expect(routeBody(ROUTES, QUESTIONS)).toBeTruthy();
  });

  test('a module accepts an exam submission', () => {
    expect(routeBody(ROUTES, SUBMIT)).toBeTruthy();
  });

  test('all three delegate to the rules client', () => {
    for (const decl of [GATE, QUESTIONS, SUBMIT]) {
      expect(routeBody(ROUTES, decl)).toMatch(/TrainingRules\./);
    }
  });

  test('the submit route never marks a written answer itself', () => {
    // Marking is an LLM call with a rubric. A portal-side copy would diverge
    // from what WhatsApp awards for the same answer.
    const body = routeBody(ROUTES, SUBMIT);
    expect(body).not.toMatch(/openai|chat\.completions|scoreAnswer\(/);
  });

  test('every route requires portal auth', () => {
    for (const decl of [GATE, QUESTIONS, SUBMIT]) {
      expect(routeBody(ROUTES, decl)).toMatch(/requirePortalAuth/);
    }
  });
});

describe('bd-60149 — the module list carries the exam, so the UI can block', () => {
  test('the modules listing reports each module’s exam state', () => {
    // Operator decision (1): the next module is locked until this one's exam
    // is passed. The UI cannot render that lock without the state, and the
    // portal must not compute it locally.
    const body = routeBody(ROUTES, "router.get('/training/modules'");
    expect(body).toMatch(/exam/i);
  });
});
