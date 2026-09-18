/**
 * bd-60145 — the portal must certify through the bot's guard, not on its own.
 *
 * Port of bd-60139 / bd-60142 / bd-60144 to the portal. Two separate defects
 * were found reading `dashboard/routes/portal.routes.js`:
 *
 * (1) NOTHING on the portal can certify an I-SAPS teacher.
 *     Certification exists in exactly two places — the capstone route and the
 *     grand-quiz route — and both are LEVEL-scoped. There is no per-module-exam
 *     route at all, and neither /training/module/:id/quiz-attempts nor
 *     /training/module/:id/complete attempts issuance. A teacher who finishes
 *     every unit and every module exam on the portal is certified by nothing,
 *     exactly as on WhatsApp before bd-60142.
 *
 * (2) The two sites that DO certify have no completeness gate.
 *     Both call `issueCertificate` directly the moment `is_passed` is true.
 *     That is the portal's copy of bd-60139: a single level-exam pass mints a
 *     certificate without checking that the units are finished or that the
 *     per-module exams were passed.
 *
 * THE ARCHITECTURAL CONSTRAINT, which decides the shape of the fix:
 * `dashboard/services/training-rules.service.js` deliberately contains NO
 * decision logic — its own header says so and a test enforces it — because
 * every previous local copy of a training rule drifted from the bot's. So the
 * gate must NOT be re-implemented here. The portal asks the bot over
 * /api/internal/training/*, and this suite pins that: the portal calls the
 * guard, and the guard is the bot's.
 */

const fs = require('fs');
const path = require('path');

const ROUTES = fs.readFileSync(
  path.join(__dirname, '../../dashboard/routes/portal.routes.js'), 'utf8',
);
const RULES_CLIENT = fs.readFileSync(
  path.join(__dirname, '../../dashboard/services/training-rules.service.js'), 'utf8',
);
const INTERNAL_API = fs.readFileSync(
  path.join(__dirname, '../../bot/shared/routes/internal-api.routes.js'), 'utf8',
);

/** The body of a route handler, from its declaration to the next one. */
function routeBody(src, decl) {
  const start = src.indexOf(decl);
  if (start === -1) return '';
  const next = src.indexOf("\nrouter.", start + decl.length);
  return src.slice(start, next === -1 ? src.length : next);
}

describe('bd-60145 — the bot exposes certification as an internal rule', () => {
  test('there is a certify-level endpoint', () => {
    // The portal cannot require the bot's services (bd-2461: the queue driver
    // needs aws-sdk v2 and the dashboard carries only v3), so the guard has to
    // be reachable over the same internal API the other rules use.
    expect(INTERNAL_API).toMatch(/training\/certify-level/);
  });

  test('it delegates to maybeIssueQuizScoreCertificate — one implementation', () => {
    expect(INTERNAL_API).toMatch(/maybeIssueQuizScoreCertificate/);
  });

  test('it takes a levelId, because a module-exam attempt has no module', () => {
    // bd-60144: passing a null module made the guard bail on its first query.
    const i = INTERNAL_API.indexOf('training/certify-level');
    const block = INTERNAL_API.slice(i, i + 1600);
    expect(block).toMatch(/levelId/);
  });
});

describe('bd-60145 — the portal asks rather than deciding', () => {
  test('the rules client exposes certifyLevel', () => {
    expect(RULES_CLIENT).toMatch(/certifyLevel/);
  });

  test('certifyLevel goes over the internal API, with no local rule', () => {
    const i = RULES_CLIENT.indexOf('async function certifyLevel');
    expect(i).toBeGreaterThan(-1);
    const fn = RULES_CLIENT.slice(i, RULES_CLIENT.indexOf('\n}', i));
    expect(fn).toMatch(/ask\(/);
    // A local gate here would be a second implementation — the exact thing
    // this file's header says was removed.
    expect(fn).not.toMatch(/training_grand_quizzes|teacher_training_progress/);
  });

  test('the client still contains no decision logic at all', () => {
    // Guards the property the whole module exists for, now that it has grown
    // a certification call.
    expect(RULES_CLIENT).not.toMatch(/allModuleExamsPassed/);
    expect(RULES_CLIENT).not.toMatch(/source_quiz_id/);
  });
});

describe('bd-60145 — the two certifying routes are gated', () => {
  const CAPSTONE = "router.post('/training/level/:id/capstone/attempts'";
  const GRAND = "router.post('/training/level/:id/grand-quiz/attempts'";

  test('the capstone route no longer issues unconditionally', () => {
    const body = routeBody(ROUTES, CAPSTONE);
    expect(body).toBeTruthy();
    expect(body).toMatch(/certifyLevel/);
  });

  test('the grand-quiz route no longer issues unconditionally', () => {
    const body = routeBody(ROUTES, GRAND);
    expect(body).toBeTruthy();
    expect(body).toMatch(/certifyLevel/);
  });

  test('neither route calls issueCertificate directly any more', () => {
    // Calling the raw issuer bypasses every gate — that is defect (2).
    for (const decl of [CAPSTONE, GRAND]) {
      const body = routeBody(ROUTES, decl);
      expect(body).not.toMatch(/\bissueCertificate\(/);
    }
  });
});

describe('bd-60145 — a module exam on the portal can certify', () => {
  test('the module quiz-attempts route attempts certification', () => {
    // Defect (1): an I-SAPS level is finished by passing its ninth MODULE
    // exam, and no portal route noticed. This is the portal's equivalent of
    // the bd-60142 call site.
    const body = routeBody(ROUTES, "router.post('/training/module/:id/quiz-attempts'");
    expect(body).toBeTruthy();
    expect(body).toMatch(/certifyLevel/);
  });

  test('certification never decides the outcome of the submission', () => {
    // A failed certificate call must not lose a teacher's graded paper. The
    // attempt and its answers are already written by this point; issuance is
    // strictly an addition to the response.
    const body = routeBody(ROUTES, "router.post('/training/module/:id/quiz-attempts'");
    const i = body.indexOf('certifyLevel');
    expect(i).toBeGreaterThan(-1);
    expect(body.slice(Math.max(0, i - 400), i + 400)).toMatch(/try\s*\{|catch/);
  });
});
