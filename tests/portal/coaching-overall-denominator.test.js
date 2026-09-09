/**
 * The max a score is out of must be the max its parts add up to.
 *
 * getOverall preferred `scores.max_marks` over `scores.overall_max_marks`.
 * Measured across 172 completed sessions on the sandbox corpus:
 *
 *   overall_max_marks == sum of domain_max : 172 / 172   (100%)
 *   max_marks         == sum of domain_max :   0 / 172   (0%)
 *
 * `max_marks` is a fixed 103 or 117 on every row regardless of the lesson,
 * while FICO's real denominator is computed per session from the subject and
 * from which indicators applied. So the headline read out of a different
 * scale than the domain bars underneath it — and on 4 of 172 sessions
 * `overall_marks` EXCEEDS `max_marks`, which renders as a score above 100%.
 *
 * Caught by seeding a teacher's account and reading the list back: one card
 * said 106/103 and another 32/117 beside a breakdown summing to 32/44.
 */

const { getOverall } = require('../../dashboard/services/coaching-frameworks.service');

/** A FICO row shaped exactly like production: both keys present, disagreeing. */
const FICO = {
  scores: {
    max_marks: 103,             // stale, same on every row
    overall_marks: 106,
    overall_max_marks: 148,     // the real denominator; matches the domains
    overall_percentage: 71.6,
  },
  domains: {
    student_engagement:        { domain_score: 20, domain_max: 28 },
    lesson_plan_fidelity:      { domain_score: 29, domain_max: 40 },
    high_leverage_practices:   { domain_score: 37, domain_max: 56 },
    teacher_subject_knowledge: { domain_score: 20, domain_max: 24 },
  },
};

const domainSum = (a) => Object.values(a.domains)
  .reduce((t, d) => t + d.domain_max, 0);

describe('the headline agrees with the bars beneath it', () => {
  test('the max is the one the domains add up to', () => {
    expect(getOverall(FICO).maxPoints).toBe(domainSum(FICO));  // 148, not 103
  });

  test('a score never exceeds its own max', () => {
    const { points, maxPoints } = getOverall(FICO);
    expect(points).toBeLessThanOrEqual(maxPoints);
  });

  test('the stored percentage is preserved, not recomputed', () => {
    // 106/148 rounds to 71.6, which is what the bot itself recorded. Deriving
    // it from the wrong max produced 102.9%.
    expect(getOverall(FICO).percentage).toBe(71.6);
  });

  test('a legacy OECD row with only max_marks still works', () => {
    // The shape getOverall was originally written for. Nothing here may break
    // it: the leader dashboard reads the same function.
    const legacy = { scores: { grand_total: 80, max_marks: 118, percentage: 67.8 } };
    const o = getOverall(legacy);
    expect(o.points).toBe(80);
    expect(o.maxPoints).toBe(118);
    expect(o.percentage).toBe(67.8);
  });

  test('percentage is derived only when neither key carries one', () => {
    const bare = { scores: { overall_marks: 21, overall_max_marks: 42 } };
    expect(getOverall(bare).percentage).toBe(50);
  });

  test('an unscored session reports zeros rather than throwing', () => {
    expect(getOverall(null)).toEqual({ points: 0, maxPoints: 0, percentage: 0 });
    expect(getOverall({}).maxPoints).toBe(0);
  });
});
