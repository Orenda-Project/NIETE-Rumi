'use strict';
/**
 * P4.1 (bd-wmfsp.9, D27) — when a lesson plan is linked and the executed÷prescribed
 * fidelity engine produced a usable score, FICO Section B (Lesson Plan Fidelity) is
 * DERIVED from that measurement, NOT from the legacy B indicators, and the overall is
 * recomputed. No-LP / unusable-recording sessions keep the legacy indicator-summed
 * Section B (the proxy).
 *
 * Section B's max is now derived per session from the APPLICABLE indicators rather than a
 * constant, so this suite reads it off the analysis instead of hardcoding a number.
 *
 * The legacy B indicators are still emitted by the LLM (fidelity runs concurrently and
 * may fail — the proxy must be able to stand); they simply stop DRIVING the number when
 * a measured fidelity is present.
 */
const fico = require('../../../bot/shared/services/coaching/frameworks/fico-framework');

// A minimal FICO analysis already run through computeScores: every domain carries a
// domain_score, and scores.overall_* is the indicator sum. Shaped like the live rubric
// (B7 · C4 · D5 · F10) on the three-rung scale.
const SCALE = fico.getScoringConstants().scaleMax;
const MAX_B = 7 * SCALE;          // Section B's applicable max
const BASE_B = 7 * 1;             // every B indicator at rung 1
const BASE_TOTAL = BASE_B + 4 * 2 + 5 * 2 + 10 * 1;

function baseAnalysis() {
  const mk = (n, per) => Array.from({ length: n }, (_, i) => ({ id: `x${i}`, score: per }));
  const a = {
    framework: 'fico',
    domains: {
      lesson_plan_fidelity: { indicators: mk(7, 1) },
      high_leverage_practices: { indicators: mk(4, 2) },
      student_engagement: { indicators: mk(5, 2) },
      teacher_subject_knowledge: { indicators: mk(10, 1) },
    },
  };
  return fico.computeScores(a); // recompute so overall reflects the fixture
}

describe('applyLpFidelity — FICO Section B from measured fidelity (P4.1 / D27)', () => {
  test('exports the function', () => {
    expect(typeof fico.applyLpFidelity).toBe('function');
  });

  test('derives Section B marks from fidelity_pct and recomputes the overall', () => {
    const a = baseAnalysis();
    expect(a.scores.overall_marks).toBe(BASE_TOTAL);
    const denom = a.scores.overall_max_marks;

    const derivedB = Math.round(0.6 * MAX_B);
    fico.applyLpFidelity(a, { status: 'ok', fidelity_pct: 60, band: 'partial', source: 'corpus' });

    expect(a.domains.lesson_plan_fidelity.domain_score).toBe(derivedB);
    expect(a.domains.lesson_plan_fidelity.domain_max).toBe(MAX_B);
    const expected = BASE_TOTAL - BASE_B + derivedB;
    expect(a.scores.overall_marks).toBe(expected);
    // the denominator is the one computeScores derived, NOT a module constant
    expect(a.scores.overall_max_marks).toBe(denom);
    expect(a.scores.overall_percentage).toBeCloseTo((expected / denom) * 100, 1);
  });

  test('flags Section B as fidelity-derived and carries pct + band for the report', () => {
    const a = baseAnalysis();
    fico.applyLpFidelity(a, { status: 'ok', fidelity_pct: 80, band: 'high' });
    const b = a.domains.lesson_plan_fidelity;
    expect(b.fidelity_derived).toBe(true);
    expect(b.fidelity_pct).toBe(80);
    expect(b.fidelity_band).toBe('high');
    expect(b.domain_score).toBe(Math.round(0.8 * MAX_B));
  });

  test('100% → Section B\'s full applicable max; 0% → 0 marks', () => {
    const hi = baseAnalysis();
    fico.applyLpFidelity(hi, { status: 'ok', fidelity_pct: 100 });
    expect(hi.domains.lesson_plan_fidelity.domain_score).toBe(MAX_B);

    const lo = baseAnalysis();
    fico.applyLpFidelity(lo, { status: 'ok', fidelity_pct: 0 });
    expect(lo.domains.lesson_plan_fidelity.domain_score).toBe(0);
  });

  test('NO override when fidelity unusable — legacy Section B (the proxy) stands', () => {
    // status ok but fidelity_pct null (recording unusable → coreDen 0)
    const a = baseAnalysis();
    fico.applyLpFidelity(a, { status: 'ok', fidelity_pct: null, band: null });
    expect(a.domains.lesson_plan_fidelity.domain_score).toBe(BASE_B); // unchanged
    expect(a.domains.lesson_plan_fidelity.fidelity_derived).toBeFalsy();
    expect(a.scores.overall_marks).toBe(BASE_TOTAL);
  });

  test('NO override when fidelity absent / unavailable', () => {
    for (const blob of [null, undefined, { status: 'lp_absent' }, { status: 'fidelity_unavailable' }]) {
      const a = baseAnalysis();
      fico.applyLpFidelity(a, blob);
      expect(a.domains.lesson_plan_fidelity.domain_score).toBe(BASE_B);
      expect(a.scores.overall_marks).toBe(BASE_TOTAL);
    }
  });

  test('is a no-op on a non-FICO analysis with no Section B domain (guard)', () => {
    const a = { domains: { some_other: { domain_score: 5 } } };
    expect(() => fico.applyLpFidelity(a, { status: 'ok', fidelity_pct: 50 })).not.toThrow();
    expect(a.domains.some_other.domain_score).toBe(5);
  });
});
