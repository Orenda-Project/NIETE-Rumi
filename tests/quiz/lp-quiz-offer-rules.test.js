/**
 * bd-97daxo.34.12 — the offer's pure rules live in their own module, so the 6-12
 * offer and the lp612 provider read them without requiring the offer service
 * (that require closed an import cycle the baseline gate flags).
 */
const Rules = require('../../bot/shared/services/nudges/lp-quiz-offer-rules');
const Offer = require('../../bot/shared/services/nudges/lp-quiz-offer.service');

describe('lp-quiz-offer-rules', () => {
  const saved = process.env.LP_QUIZ_OFFER_CUTOFF_HOUR_PKT;
  afterEach(() => {
    if (saved === undefined) delete process.env.LP_QUIZ_OFFER_CUTOFF_HOUR_PKT;
    else process.env.LP_QUIZ_OFFER_CUTOFF_HOUR_PKT = saved;
  });

  test('the offer service exports the very same rule functions', () => {
    expect(Offer.cohortRuleDate).toBe(Rules.cohortRuleDate);
    expect(Offer.cutoffHour).toBe(Rules.cutoffHour);
    expect(Offer.classKey).toBe(Rules.classKey);
  });

  test('a lesson before the 14:00 PKT cutoff belongs to that day; after it, to the next school day', () => {
    delete process.env.LP_QUIZ_OFFER_CUTOFF_HOUR_PKT;
    expect(Rules.cohortRuleDate('2026-11-24T08:00:00Z')).toBe('2026-11-24'); // 13:00 PKT, Tue
    expect(Rules.cohortRuleDate('2026-11-24T10:00:00Z')).toBe('2026-11-25'); // 15:00 PKT, Tue
  });

  test('an unreadable cutoff falls back to 14', () => {
    process.env.LP_QUIZ_OFFER_CUTOFF_HOUR_PKT = 'soon';
    expect(Rules.cutoffHour()).toBe(14);
  });

  test('classKey is underscore-only and stable', () => {
    expect(Rules.classKey('6', 'General Science')).toBe('g6_general_science');
    expect(Rules.classKey(null, '')).toBe('g0_lesson');
  });
});
