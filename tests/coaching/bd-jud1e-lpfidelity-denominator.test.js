'use strict';
/**
 * computeScores() is the ONLY thing allowed to write scores.overall_max_marks.
 *
 * The applicable-aware denominator landed in computeScores: an indicator marked
 * `applicable: false` leaves both sides of the fraction. But applyLpFidelity()
 * runs AFTERWARDS on every measured-fidelity session and rewrote the denominator
 * back to the flat framework constant (148). The exclusion therefore removed the
 * inapplicable rows from the NUMERATOR only: the teacher lost the marks and kept
 * the full divisor, and her reported percentage went DOWN for no change in her
 * teaching.
 *
 * Measured on production: 2,773 of 8,917 sessions carry overall_max_marks = 148
 * while the sum of their own four domain_max values is lower — mean 3.3 points
 * understated, max 6.7.
 *
 * These tests run the real functions in the real order, with no mocks.
 */
const fico = require('../../bot/shared/services/coaching/frameworks/fico-framework');

const rows = (prefix, n, score) =>
  Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i + 1}`, score }));

// A full FICO V3 analysis: B=10, C=12, D=7, F=8 indicators, scale 1-4 => 148.
// Section F excludes F5 (math) and F6 (science) — an Urdu lesson — so the honest
// denominator is 140.
function urduLessonAnalysis(perIndicator = 2) {
  return {
    framework: 'fico',
    domains: {
      lesson_plan_fidelity: { indicators: rows('B', 10, perIndicator) },
      high_leverage_practices: { indicators: rows('C', 12, perIndicator) },
      student_engagement: { indicators: rows('D', 7, perIndicator) },
      teacher_subject_knowledge: {
        indicators: [
          { id: 'F1', score: perIndicator }, { id: 'F2', score: perIndicator },
          { id: 'F3', score: perIndicator }, { id: 'F4', score: perIndicator },
          { id: 'F5', score: null, applicable: false, evidence: 'Not applicable — lesson subject is LITERACY/LANGUAGE, not MATH.' },
          { id: 'F6', score: null, applicable: false, evidence: 'Not applicable — lesson subject is LITERACY/LANGUAGE, not SCIENCE.' },
          { id: 'F7', score: perIndicator }, { id: 'F8', score: perIndicator },
        ],
      },
    },
  };
}

describe('applyLpFidelity keeps the applicable-aware denominator', () => {
  test('THE BUG: a measured session keeps the honest 140, not the flat 148', () => {
    const a = fico.computeScores(urduLessonAnalysis());
    expect(a.scores.overall_max_marks).toBe(140); // computeScores gets this right

    fico.applyLpFidelity(a, { status: 'ok', fidelity_pct: 50, band: 'partial' });

    // Section B is now measured: round(0.50 x 40) = 20.
    // C 24 + D 14 + F 12 = 50, plus B 20 = 70 of 140.
    expect(a.domains.lesson_plan_fidelity.domain_score).toBe(20);
    expect(a.scores.overall_max_marks).toBe(140);
    expect(a.scores.overall_marks).toBe(70);
    expect(a.scores.overall_percentage).toBe(50);
  });

  test('the percentage is computed over the same denominator it reports', () => {
    const a = fico.computeScores(urduLessonAnalysis(3));
    fico.applyLpFidelity(a, { status: 'ok', fidelity_pct: 100 });
    const { overall_marks: marks, overall_max_marks: max, overall_percentage: pct } = a.scores;
    expect(pct).toBe(parseFloat(((marks / max) * 100).toFixed(1)));
  });

  test('BACK-COMPAT LOCK: no applicable flag anywhere still divides by 148', () => {
    const legacy = {
      framework: 'fico',
      domains: {
        lesson_plan_fidelity: { indicators: rows('B', 10, 3) },
        high_leverage_practices: { indicators: rows('C', 12, 3) },
        student_engagement: { indicators: rows('D', 7, 3) },
        teacher_subject_knowledge: { indicators: rows('F', 8, 3) },
      },
    };
    const a = fico.computeScores(legacy);
    fico.applyLpFidelity(a, { status: 'ok', fidelity_pct: 75 });
    expect(a.scores.overall_max_marks).toBe(148);
  });

  test('an analysis that never went through computeScores falls back to the declared maxima', () => {
    const handBuilt = {
      framework: 'fico',
      domains: {
        lesson_plan_fidelity: { indicators: rows('B', 10, 2) },
        high_leverage_practices: { domain_score: 24, domain_max: 48 },
        student_engagement: { domain_score: 14, domain_max: 28 },
        teacher_subject_knowledge: { domain_score: 16, domain_max: 32 },
      },
    };
    fico.applyLpFidelity(handBuilt, { status: 'ok', fidelity_pct: 50 });
    expect(handBuilt.scores.overall_max_marks).toBe(148);
  });

  test('a domain the analysis omitted still carries its declared max', () => {
    const partial = {
      framework: 'fico',
      domains: { lesson_plan_fidelity: { indicators: rows('B', 10, 2) } },
    };
    fico.computeScores(partial);
    fico.applyLpFidelity(partial, { status: 'ok', fidelity_pct: 100 });
    // B measured at 40; C 48 + D 28 + F 32 declared but unscored.
    expect(partial.scores.overall_max_marks).toBe(148);
    expect(partial.scores.overall_marks).toBe(40);
  });
});
