/**
 * bd-60113 — capstone points-per-question becomes a per-vendor setting.
 *
 * Beacon House scores each open-ended answer 0–5 (POINTS_PER_QUESTION = 5, a
 * module constant since bd-2233). Every I-SAPS CRQ is worth 10 marks against
 * its own printed rubric, so a shared constant cannot serve both.
 *
 * The constant is not private: dashboard/routes/portal.routes.js imports it to
 * render the capstone in the portal and to compute total_score, and
 * tests/portal/portal-reaches-bot-modules.test.js asserts it is a number. So
 * this must stay backwards compatible — `POINTS_PER_QUESTION` keeps its value
 * as the DEFAULT, and the per-vendor value is an override read from
 * training_vendors.capstone_points_per_question.
 *
 * Operator decision 2026-09-17: make the scale per-vendor rather than scaling
 * a 0–5 score up to 10, so a marked answer matches the rubric the teacher was
 * shown.
 *
 * What must NOT change: Beacon House and Oxbridge keep scoring out of 5. A
 * vendor with no column value, a null, or a nonsense value falls back to 5 —
 * silently rescaling a live vendor's marking would corrupt its pass decisions.
 */

const {
  POINTS_PER_QUESTION,
  pointsPerQuestionFor,
} = require('../../bot/shared/services/training/capstone-points.rules');

describe('bd-60113 — pointsPerQuestionFor', () => {
  test('the exported default is still 5, for Beacon House and the portal', () => {
    expect(POINTS_PER_QUESTION).toBe(5);
  });

  test('a vendor with no override scores out of the default', () => {
    expect(pointsPerQuestionFor({ key: 'BEACONHOUSE' })).toBe(5);
    expect(pointsPerQuestionFor({ key: 'OXBRIDGE' })).toBe(5);
  });

  test('I-SAPS scores out of 10 when the column says so', () => {
    expect(pointsPerQuestionFor({ key: 'ISAPS', capstone_points_per_question: 10 })).toBe(10);
  });

  test('null / undefined / missing vendor all fall back to the default', () => {
    expect(pointsPerQuestionFor(null)).toBe(5);
    expect(pointsPerQuestionFor(undefined)).toBe(5);
    expect(pointsPerQuestionFor({})).toBe(5);
    expect(pointsPerQuestionFor({ capstone_points_per_question: null })).toBe(5);
  });

  test('a nonsense column value falls back rather than corrupting marking', () => {
    // A 0 or negative scale would make every answer worth nothing and every
    // capstone unpassable; a non-numeric would produce NaN totals.
    expect(pointsPerQuestionFor({ capstone_points_per_question: 0 })).toBe(5);
    expect(pointsPerQuestionFor({ capstone_points_per_question: -3 })).toBe(5);
    expect(pointsPerQuestionFor({ capstone_points_per_question: 'ten' })).toBe(5);
    expect(pointsPerQuestionFor({ capstone_points_per_question: NaN })).toBe(5);
  });

  test('a fractional or absurdly large value is rejected, not rounded silently', () => {
    expect(pointsPerQuestionFor({ capstone_points_per_question: 7.5 })).toBe(5);
    expect(pointsPerQuestionFor({ capstone_points_per_question: 1000 })).toBe(5);
  });

  test('the whole supported range works', () => {
    for (const n of [1, 2, 5, 10, 20, 100]) {
      expect(pointsPerQuestionFor({ capstone_points_per_question: n })).toBe(n);
    }
  });
});
