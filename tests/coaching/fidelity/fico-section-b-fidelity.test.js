'use strict';
/**
 * P4.1 (bd-wmfsp.9, D27) — when a lesson plan is linked and the executed÷prescribed
 * fidelity engine produced a usable score, FICO Section B (Lesson Plan Fidelity) is
 * DERIVED from that measurement (fidelity_pct → /40), NOT from the 10 legacy B
 * indicators, and the overall /104 is recomputed. No-LP / unusable-recording sessions
 * keep the legacy indicator-summed Section B (the proxy).
 *
 * The legacy B indicators are still emitted by the LLM (fidelity runs concurrently and
 * may fail — the proxy must be able to stand); they simply stop DRIVING the number when
 * a measured fidelity is present.
 */
const fico = require('../../../bot/shared/services/coaching/frameworks/fico-framework');

// A minimal FICO analysis already run through computeScores: every domain carries a
// domain_score, and scores.overall_* is the indicator sum. Section B here sums to 20/40.
function baseAnalysis() {
  const mk = (n, per) => Array.from({ length: n }, (_, i) => ({ id: `x${i}`, score: per }));
  const a = {
    framework: 'fico',
    domains: {
      lesson_plan_fidelity: { indicators: mk(10, 2), domain_score: 20, domain_max: 40 }, // 10×2
      high_leverage_practices: { indicators: mk(12, 3), domain_score: 36, domain_max: 48 }, // 12×3
      student_engagement: { indicators: mk(7, 3), domain_score: 21, domain_max: 28 }, // 7×3
      teacher_subject_knowledge: { indicators: mk(8, 2), domain_score: 16, domain_max: 32 }, // 8×2
    },
  };
  return fico.computeScores(a); // recompute so overall reflects the fixture
}

describe('applyLpFidelity — FICO Section B from measured fidelity (P4.1 / D27)', () => {
  test('exports the function', () => {
    expect(typeof fico.applyLpFidelity).toBe('function');
  });

  test('derives Section B marks from fidelity_pct (→/40) and recomputes overall /104', () => {
    const a = baseAnalysis();
    const before = a.scores.overall_marks; // 20+36+21+16 = 93
    expect(before).toBe(93);

    // 60% fidelity → round(0.60×40) = 24 marks for Section B (was 20).
    fico.applyLpFidelity(a, { status: 'ok', fidelity_pct: 60, band: 'partial', source: 'corpus' });

    expect(a.domains.lesson_plan_fidelity.domain_score).toBe(24);
    expect(a.domains.lesson_plan_fidelity.domain_max).toBe(40);
    // overall = 24 + 36 + 21 + 16 = 97 of the framework max (FICO V3 = 37×4 = 148)
    expect(a.scores.overall_marks).toBe(97);
    expect(a.scores.overall_max_marks).toBe(fico.maxMarks); // 148, not the stale 104
    expect(a.scores.overall_percentage).toBeCloseTo((97 / fico.maxMarks) * 100, 1);
  });

  test('flags Section B as fidelity-derived and carries pct + band for the report', () => {
    const a = baseAnalysis();
    fico.applyLpFidelity(a, { status: 'ok', fidelity_pct: 80, band: 'high' });
    const b = a.domains.lesson_plan_fidelity;
    expect(b.fidelity_derived).toBe(true);
    expect(b.fidelity_pct).toBe(80);
    expect(b.fidelity_band).toBe('high');
    expect(b.domain_score).toBe(32); // round(0.80×40)
  });

  test('100% → full 40 marks; 0% → 0 marks', () => {
    const hi = baseAnalysis();
    fico.applyLpFidelity(hi, { status: 'ok', fidelity_pct: 100 });
    expect(hi.domains.lesson_plan_fidelity.domain_score).toBe(40);

    const lo = baseAnalysis();
    fico.applyLpFidelity(lo, { status: 'ok', fidelity_pct: 0 });
    expect(lo.domains.lesson_plan_fidelity.domain_score).toBe(0);
  });

  test('NO override when fidelity unusable — legacy Section B (the proxy) stands', () => {
    // status ok but fidelity_pct null (recording unusable → coreDen 0)
    const a = baseAnalysis();
    fico.applyLpFidelity(a, { status: 'ok', fidelity_pct: null, band: null });
    expect(a.domains.lesson_plan_fidelity.domain_score).toBe(20); // unchanged
    expect(a.domains.lesson_plan_fidelity.fidelity_derived).toBeFalsy();
    expect(a.scores.overall_marks).toBe(93);
  });

  test('NO override when fidelity absent / unavailable', () => {
    for (const blob of [null, undefined, { status: 'lp_absent' }, { status: 'fidelity_unavailable' }]) {
      const a = baseAnalysis();
      fico.applyLpFidelity(a, blob);
      expect(a.domains.lesson_plan_fidelity.domain_score).toBe(20);
      expect(a.scores.overall_marks).toBe(93);
    }
  });

  test('is a no-op on a non-FICO analysis with no Section B domain (guard)', () => {
    const a = { domains: { some_other: { domain_score: 5 } } };
    expect(() => fico.applyLpFidelity(a, { status: 'ok', fidelity_pct: 50 })).not.toThrow();
    expect(a.domains.some_other.domain_score).toBe(5);
  });
});
