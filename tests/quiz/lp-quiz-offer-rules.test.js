/**
 * bd-vm5475: the 15:00 offer's pure rules live in their own module, so the 6-12 offer and the
 * lp612 provider can read them without requiring the offer service (which requires them back:
 * a require cycle, tests/setup/circular-deps).
 */
const Rules = require('../../bot/shared/services/nudges/lp-quiz-offer-rules');
const Offer = require('../../bot/shared/services/nudges/lp-quiz-offer.service');

describe('lp-quiz-offer-rules', () => {
  const saved = process.env.LP_QUIZ_OFFER_CUTOFF_HOUR_PKT;
  afterEach(() => {
    if (saved === undefined) delete process.env.LP_QUIZ_OFFER_CUTOFF_HOUR_PKT;
    else process.env.LP_QUIZ_OFFER_CUTOFF_HOUR_PKT = saved;
  });

  test('the offer service exports the same functions, so its callers see no change', () => {
    expect(Offer.cutoffHour).toBe(Rules.cutoffHour);
    expect(Offer.cohortRuleDate).toBe(Rules.cohortRuleDate);
    expect(Offer.classKey).toBe(Rules.classKey);
  });

  test('cutoff defaults to 14, reads the env, and ignores an unreadable value', () => {
    delete process.env.LP_QUIZ_OFFER_CUTOFF_HOUR_PKT;
    expect(Rules.cutoffHour()).toBe(14);
    process.env.LP_QUIZ_OFFER_CUTOFF_HOUR_PKT = '12';
    expect(Rules.cutoffHour()).toBe(12);
    process.env.LP_QUIZ_OFFER_CUTOFF_HOUR_PKT = 'x';
    expect(Rules.cutoffHour()).toBe(14);
  });

  test('a lesson before the cutoff is for that day; after it, the next school day', () => {
    delete process.env.LP_QUIZ_OFFER_CUTOFF_HOUR_PKT;
    // Tue 24 Nov 2026: 08:00Z = 13:00 PKT (before), 09:30Z = 14:30 PKT (after).
    expect(Rules.cohortRuleDate('2026-11-24T08:00:00Z')).toBe('2026-11-24');
    expect(Rules.cohortRuleDate(new Date('2026-11-24T09:30:00Z'))).toBe('2026-11-25');
  });

  test('classKey keeps to [A-Za-z0-9_] and has defaults', () => {
    expect(Rules.classKey('6', 'General Science')).toBe('g6_general_science');
    expect(Rules.classKey(null, '')).toBe('g0_lesson');
    expect(Rules.classKey('K-1', 'Math & Logic')).toBe('gk1_math_logic');
  });
});
