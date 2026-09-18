/**
 * bd-60143 — "scenario questions done: 12/3" is marks over questions.
 *
 * Operator, from sandbox: "in some messages it says Scenario Questions Done:
 * 12/3. It should be 3/3. It is conflating the count of all the questions from
 * the bank."
 *
 * The diagnosis is close but the conflation is one step earlier than the bank.
 * By the time this message is built:
 *
 *   score = MARKS earned  — 2 MCQs at 1 mark + a CRQ marked out of 10 = up to 12
 *   attempt.total_questions = QUESTION COUNT — 3
 *
 * So the message divides marks by questions and prints 12/3. The denominator it
 * should use already exists a few lines above as `examTotal` (mixedPossible —
 * MCQ count + CRQ max = 12), which is what the pass/fail decision itself is
 * computed against.
 *
 * Two readings of "correct" were possible and they disagree:
 *   - 3/3   → questions answered
 *   - 12/12 → marks earned
 *
 * This asserts MARKS over MARKS, i.e. 12/12, because the number beside it is
 * already a mark total (a 9/10 CRQ makes it 11), and because it is the figure
 * the pass bar is applied to — ISAPS §5.1 marks a module out of 12, not out of
 * 3. Printing "3/3" beside a score of 11 would be a different lie.
 *
 * The same conflation persisted into the attempt row and is tracked separately
 * as bd-60138 ("17/9"); this fixes only what the teacher is shown.
 */

const {
  moduleExamPassMessage,
} = require('../../bot/shared/services/training/isaps-module-exam.rules');

describe('bd-60143 — the pass message denominator is marks, not question count', () => {
  test('THE BUG: a perfect paper reads 12/12, never 12/3', () => {
    const msg = moduleExamPassMessage({
      moduleTitle: 'Module 9 - Teacher Leadership', score: 12, total: 12,
    });
    expect(msg).toContain('12/12');
    expect(msg).not.toContain('12/3');
  });

  test('a 9/10 CRQ plus two correct MCQs reads 11/12', () => {
    // The real shape of the operator's Module 1 attempt.
    const msg = moduleExamPassMessage({ moduleTitle: 'Module 1', score: 11, total: 12 });
    expect(msg).toContain('11/12');
  });

  test('the numerator is never larger than the denominator', () => {
    // The whole class of defect in one assertion: a score above its total is
    // always a unit mismatch. 17/9 (bd-60138) and 12/3 are the same bug.
    for (const [score, total] of [[12, 12], [11, 12], [2, 12], [0, 12]]) {
      const m = moduleExamPassMessage({ moduleTitle: 'M', score, total });
      const [, n, d] = m.match(/\*(\d+)\/(\d+)\*/).map(Number);
      expect(n).toBeLessThanOrEqual(d);
    }
  });

  test('missing or zero inputs degrade to 0/0 rather than NaN', () => {
    expect(moduleExamPassMessage({})).toContain('0/0');
    expect(moduleExamPassMessage({ score: null, total: undefined })).toContain('0/0');
  });

  test('the CRQ note still appears when one is outstanding', () => {
    const msg = moduleExamPassMessage({ moduleTitle: 'M', score: 2, total: 12, hasCrq: true });
    expect(msg).toMatch(/written answer/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// And the caller must pass the marks total. The rule above is pure, so it will
// happily render whatever it is handed — which is exactly how 12/3 shipped.
// ─────────────────────────────────────────────────────────────────────────────

const fs = require('fs');
const path = require('path');

describe('bd-60143 — the call site passes the marks denominator', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '../../bot/shared/services/training/quiz-delivery.service.js'),
    'utf8',
  );

  test('moduleExamPassMessage is not handed attempt.total_questions', () => {
    const i = src.indexOf('moduleExamPassMessage({');
    expect(i).toBeGreaterThan(-1);
    const call = src.slice(i, src.indexOf('}));', i));
    // total_questions is the QUESTION COUNT; passing it here is the bug.
    expect(call).not.toMatch(/total:\s*attempt\.total_questions/);
    expect(call).toMatch(/total:\s*examTotal/);
  });
});
