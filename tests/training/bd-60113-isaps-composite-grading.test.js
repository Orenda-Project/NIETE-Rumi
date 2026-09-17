/**
 * bd-60113 — I-SAPS weighted composite grading.
 *
 * I-SAPS ("Assessment Administration Process for Virtual Training of SSTs",
 * NIETE/FDE) grades a LEVEL, not a module: the three assessment streams across
 * all 9 modules are weighted into one composite, and a teacher must clear ALL
 * THREE component bars independently to pass the level.
 *
 *   Formative  25%  — pass at 50% of formative items
 *   MCQ        50%  — pass at 60% of summative MCQ items
 *   CRQ        25%  — pass at 50% of rubric-marked CRQ marks
 *
 * The document's own table reads 30/50/25 = 105%, and its summary section
 * contradicts that again with "40/60". Operator decision (2026-09-17): treat
 * the THREE PERCENTAGE BARS as authoritative (they are stated consistently
 * throughout) and correct the formative weight 30 -> 25 so the weights total
 * 100. The point values in §5.2 (15/30/12.5) are the broken arithmetic, not
 * the rule.
 *
 * Why this is new code rather than vendor config: the existing model has
 * exactly two gates — `module_passing_pct` per module quiz and `passing_pct`
 * per level exam — both plain percentage comparisons in
 * quiz-delivery.getVendorPassingPct. Nothing aggregates across modules, and
 * formative scores never contribute to a pass decision at all.
 *
 * These rules are PURE so the portal and WhatsApp share one implementation
 * (same reasoning as capstone-pure-rules: bd-2673).
 */

const {
  ISAPS_WEIGHTS,
  ISAPS_BARS,
  computeComponentPct,
  gradeIsapsLevel,
} = require('../../bot/shared/services/training/isaps-grading.rules');

describe('bd-60113 — I-SAPS weights', () => {
  test('weights sum to exactly 100', () => {
    const total = ISAPS_WEIGHTS.formative + ISAPS_WEIGHTS.mcq + ISAPS_WEIGHTS.crq;
    expect(total).toBe(100);
  });

  test('weights are 25/50/25 (formative corrected from the doc\'s 30)', () => {
    expect(ISAPS_WEIGHTS).toEqual({ formative: 25, mcq: 50, crq: 25 });
  });

  test('component bars are 50/60/50 percent', () => {
    expect(ISAPS_BARS).toEqual({ formative: 50, mcq: 60, crq: 50 });
  });
});

describe('bd-60113 — computeComponentPct', () => {
  test('returns a percentage from earned/possible', () => {
    expect(computeComponentPct(30, 50)).toBe(60);
    expect(computeComponentPct(12.5, 25)).toBe(50);
  });

  test('a component with nothing possible scores 0, never NaN or Infinity', () => {
    expect(computeComponentPct(0, 0)).toBe(0);
    expect(computeComponentPct(5, 0)).toBe(0);
  });

  test('never exceeds 100 even if earned overshoots possible', () => {
    expect(computeComponentPct(120, 100)).toBe(100);
  });

  test('negative earned clamps to 0', () => {
    expect(computeComponentPct(-5, 100)).toBe(0);
  });
});

describe('bd-60113 — gradeIsapsLevel', () => {
  const at = (f, m, c) => gradeIsapsLevel({
    formative: { earned: f, possible: 100 },
    mcq: { earned: m, possible: 100 },
    crq: { earned: c, possible: 100 },
  });

  test('all three bars cleared exactly at the bar => pass', () => {
    const r = at(50, 60, 50);
    expect(r.is_passed).toBe(true);
    // 50*0.25 + 60*0.50 + 50*0.25 = 12.5 + 30 + 12.5 = 55
    expect(r.composite_pct).toBe(55);
  });

  test('a high composite does NOT rescue a failed component bar', () => {
    // 100% formative and 100% MCQ, but CRQ at 49% — below its 50 bar.
    const r = at(100, 100, 49);
    expect(r.composite_pct).toBeGreaterThan(55);
    expect(r.is_passed).toBe(false);
    expect(r.failed_components).toEqual(['crq']);
  });

  test('formative below its bar fails the level', () => {
    const r = at(49, 100, 100);
    expect(r.is_passed).toBe(false);
    expect(r.failed_components).toEqual(['formative']);
  });

  test('MCQ bar is 60, not 50 — 55% MCQ fails', () => {
    const r = at(100, 55, 100);
    expect(r.is_passed).toBe(false);
    expect(r.failed_components).toEqual(['mcq']);
  });

  test('multiple failures are all reported, in a stable order', () => {
    const r = at(10, 10, 10);
    expect(r.is_passed).toBe(false);
    expect(r.failed_components).toEqual(['formative', 'mcq', 'crq']);
  });

  test('perfect scores pass with a 100 composite', () => {
    const r = at(100, 100, 100);
    expect(r.is_passed).toBe(true);
    expect(r.composite_pct).toBe(100);
  });

  test('per-component percentages are reported back for the result message', () => {
    const r = at(80, 70, 60);
    expect(r.components.formative.pct).toBe(80);
    expect(r.components.mcq.pct).toBe(70);
    expect(r.components.crq.pct).toBe(60);
    expect(r.components.formative.passed).toBe(true);
    expect(r.components.mcq.passed).toBe(true);
    expect(r.components.crq.passed).toBe(true);
  });

  test('a level with NO formative items yet cannot pass on the other two', () => {
    // Guard against "no items" silently reading as 0% and blocking forever,
    // OR as a free pass. Nothing possible => 0% => below the 50 bar => fail.
    const r = gradeIsapsLevel({
      formative: { earned: 0, possible: 0 },
      mcq: { earned: 100, possible: 100 },
      crq: { earned: 100, possible: 100 },
    });
    expect(r.is_passed).toBe(false);
    expect(r.failed_components).toContain('formative');
  });

  test('missing component input is treated as zero, not a crash', () => {
    const r = gradeIsapsLevel({});
    expect(r.is_passed).toBe(false);
    expect(r.composite_pct).toBe(0);
    expect(r.failed_components).toEqual(['formative', 'mcq', 'crq']);
  });

  test('composite is rounded to 1dp, not left as a float artefact', () => {
    // 33.333% across the board => 33.3, not 33.33333333333333
    const r = gradeIsapsLevel({
      formative: { earned: 1, possible: 3 },
      mcq: { earned: 1, possible: 3 },
      crq: { earned: 1, possible: 3 },
    });
    expect(r.composite_pct).toBe(33.3);
  });
});
