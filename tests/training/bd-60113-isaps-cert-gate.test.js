/**
 * bd-60113 — the I-SAPS certificate gate.
 *
 * Every other vendor certifies on one number: Beacon House through the capstone
 * pass, Oxbridge through `maybeIssueQuizScoreCertificate` (every module quiz
 * >= 70%), NIETE through the level exam. I-SAPS cannot use any of them, because
 * its rule spans three streams and all three bars must clear independently.
 *
 * `collectIsapsLevelTotals` is the piece that turns stored rows into the
 * earned/possible pairs `gradeIsapsLevel` needs. It is separated from the
 * grading arithmetic so the rule stays pure and this part — which is all
 * database shape — can be tested against fixtures.
 *
 * The behaviour that matters and is easy to get wrong: a formative item the
 * teacher never answered is a ZERO, not a skip. Oxbridge deliberately skips
 * unattempted modules (bd-43811) because legacy imports left teachers with
 * progress rows and no attempt rows. I-SAPS is the opposite case — formative
 * items are 25% of the composite, so skipping the unanswered ones would let a
 * teacher who answered two items out of 112 score 100% formative.
 */

const {
  collectIsapsLevelTotals,
} = require('../../bot/shared/services/training/isaps-grading.rules');

describe('bd-60113 — collectIsapsLevelTotals', () => {
  test('formative: possible counts every active item in the level, not just answered ones', () => {
    const totals = collectIsapsLevelTotals({
      formativeItemCount: 10,
      formativeCorrect: 4,
      mcqItemCount: 5,
      mcqCorrect: 5,
      crqEarned: 8,
      crqPossible: 10,
    });
    // 4 of 10, NOT 4 of 4.
    expect(totals.formative).toEqual({ earned: 4, possible: 10 });
    expect(totals.mcq).toEqual({ earned: 5, possible: 5 });
    expect(totals.crq).toEqual({ earned: 8, possible: 10 });
  });

  test('an unanswered level yields zero earned against the full possible', () => {
    const totals = collectIsapsLevelTotals({
      formativeItemCount: 112,
      formativeCorrect: 0,
      mcqItemCount: 68,
      mcqCorrect: 0,
      crqEarned: 0,
      crqPossible: 90,
    });
    expect(totals.formative.possible).toBe(112);
    expect(totals.formative.earned).toBe(0);
  });

  test('missing counts default to zero rather than undefined', () => {
    const totals = collectIsapsLevelTotals({});
    expect(totals.formative).toEqual({ earned: 0, possible: 0 });
    expect(totals.mcq).toEqual({ earned: 0, possible: 0 });
    expect(totals.crq).toEqual({ earned: 0, possible: 0 });
  });

  test('correct answers can never exceed the item count', () => {
    // Defensive: duplicate answer rows must not inflate a component over 100%.
    const totals = collectIsapsLevelTotals({
      formativeItemCount: 10,
      formativeCorrect: 14,
      mcqItemCount: 5,
      mcqCorrect: 5,
    });
    expect(totals.formative.earned).toBe(10);
  });

  test('feeds gradeIsapsLevel to produce the level verdict', () => {
    const { gradeIsapsLevel } = require('../../bot/shared/services/training/isaps-grading.rules');
    // 60% formative, 80% MCQ, 60% CRQ — all three bars cleared.
    const totals = collectIsapsLevelTotals({
      formativeItemCount: 10, formativeCorrect: 6,
      mcqItemCount: 10, mcqCorrect: 8,
      crqEarned: 6, crqPossible: 10,
    });
    const r = gradeIsapsLevel(totals);
    expect(r.is_passed).toBe(true);
    // 60*.25 + 80*.50 + 60*.25 = 15 + 40 + 15 = 70
    expect(r.composite_pct).toBe(70);
  });

  test('a teacher who aced formative and MCQ but skipped the CRQ fails', () => {
    const totals = collectIsapsLevelTotals({
      formativeItemCount: 10, formativeCorrect: 10,
      mcqItemCount: 10, mcqCorrect: 10,
      crqEarned: 0, crqPossible: 10,
    });
    const { gradeIsapsLevel } = require('../../bot/shared/services/training/isaps-grading.rules');
    const r = gradeIsapsLevel(totals);
    expect(r.is_passed).toBe(false);
    expect(r.failed_components).toEqual(['crq']);
    // 100*.25 + 100*.50 + 0 = 75 composite, and still a fail. The component
    // bars are the rule; the composite is reporting.
    expect(r.composite_pct).toBe(75);
  });
});
