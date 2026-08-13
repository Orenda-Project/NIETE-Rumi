/**
 * bd-2673 — the portal route file must contain NO marking or pass-bar rule.
 *
 * This is the tripwire that keeps the extraction from decaying. Deleting the
 * portal's two grading copies is a one-time act; keeping them deleted is what
 * this file is for. bd-2469/2479/2480 moved the GATING rules to the bot and left
 * a guard test on the client — and grading still drifted back in twice, because
 * nothing was watching the route file itself.
 *
 * The precedent for the technique is tests/portal/training-rules-client.test.js,
 * which greps its own subject the same way. Comments are stripped first: the
 * route file SHOULD discuss the pass bar and msq set equality at length —
 * explaining which rules moved and why is the point of those docblocks. What
 * must not exist is code that decides.
 */

const fs = require('fs');
const path = require('path');

const ROUTES = path.join(__dirname, '../../dashboard/routes/portal.routes.js');

/** The route file with comments removed, so prose about rules is allowed. */
function codeOnly() {
  const raw = fs.readFileSync(ROUTES, 'utf8');
  return raw
    .replace(/\/\*[\s\S]*?\*\//g, '')    // block comments
    .replace(/(^|[^:])\/\/.*$/gm, '$1'); // line comments, leaving http:// alone
}

describe('bd-2673 — no grading logic in the portal routes', () => {
  it('does not re-implement multi-answer set parsing', () => {
    const code = codeOnly();
    // The two helpers that used to live here, plus any renamed revival of them.
    expect(code).not.toMatch(/_isMultiAnswerKey/);
    expect(code).not.toMatch(/_normalizeAnswerSet/);
    // The shape of the rule itself: splitting a key on commas and sorting it.
    expect(code).not.toMatch(/\.split\(','\)[\s\S]{0,120}\.sort\(/);
  });

  it('does not decide whether an answer is correct', () => {
    const code = codeOnly();
    // Assigning is_correct from a comparison is the marking rule. Passing
    // is_correct through from the bot's response (g.is_correct) is fine, so the
    // assertion targets assignment-from-comparison, not the identifier.
    expect(code).not.toMatch(/is_correct\s*[:=]\s*[^,;\n]*[=!]==/);
    expect(code).not.toMatch(/const\s+isCorrect\s*=/);
    expect(code).not.toMatch(/correctKey/);
  });

  it('does not derive a pass bar or compare a score against one', () => {
    const code = codeOnly();
    // bd-2483/bd-2393: the bar belongs to the vendor and the decision to the
    // bot. What must not happen is READING the bar out of the database here —
    // that is the derivation that drifted. Holding the bot's answer in a
    // variable (examPassPct = examVerdict.pass_pct) is the correct shape, so
    // the assertion targets the DB read and the arithmetic, not the name.
    // Reading training_vendors for DISPLAY metadata (id, key, name) is fine and
    // the vendor-cards endpoint does it. What must not be selected is a bar.
    expect(code).not.toMatch(/select\(\s*['"`][^'"`]*passing_pct/);
    expect(code).not.toMatch(/module_passing_pct/);
    // No percentage arithmetic against a threshold.
    expect(code).not.toMatch(/\/\s*totalQuestions\s*\)\s*\*\s*100/);
    expect(code).not.toMatch(/score\s*===\s*totalQuestions/);
    // No inequality comparing a score against a bar.
    expect(code).not.toMatch(/\*\s*100\s*>=/);
  });

  it('still delegates every training decision to the rules client', () => {
    // The positive half: the file must actually be calling the bot. A version
    // that satisfies the negatives by deleting the feature is not the goal.
    const code = codeOnly();
    expect(code).toMatch(/TrainingRules\.markPaper/);
    expect(code).toMatch(/TrainingRules\.getModuleQuizVerdict/);
    expect(code).toMatch(/TrainingRules\.checkModuleUnlocked/);
    expect(code).toMatch(/TrainingRules\.checkExamGateByLevel/);
  });
});
