'use strict';
/**
 * bd-5n1a2 — the hero report showed "0%" while every domain bar rendered a real
 * score (prod session 57484afc, 2026-08-21 ~01:42 PKT).
 *
 * Root cause: the enhance LLM sometimes emits its OWN `scores` object with the
 * real numbers restructured under a nested `overall` key. The preserve guard in
 * gpt5-mini only restored the framework-computed scores when the LLM OMITTED
 * the key (`!enhancedAnalysis.scores`), so the junk shape survived to
 * analysis_data and the adapter's flat `scores.overall_percentage` read → 0.
 *
 * Two-layer fix, both locked here:
 *  1. _preserveFrameworkShape: for non-OECD frameworks the framework-computed
 *     domains/scores ALWAYS overwrite whatever the enhance LLM emitted.
 *  2. buildScoreViewModel: derives overall from the groups' marks when
 *     scores.overall_percentage is missing — so already-persisted bad rows
 *     (like tonight's) still render truthfully on re-render.
 */

const { buildScoreViewModel } = require('../../bot/shared/services/coaching/report-v2/score-adapter.service');

// The EXACT scores shape persisted on prod session 57484afc (junk survived).
const PROD_BAD_ROW = {
  framework: 'fico',
  domains: {
    lesson_plan_fidelity:      { domain_score: 18, domain_max: 40, fidelity_derived: true, fidelity_pct: 45.8, indicators: [] },
    high_leverage_practices:   { domain_score: 32, domain_max: 48, indicators: [] },
    student_engagement:        { domain_score: 21, domain_max: 28, indicators: [] },
    teacher_subject_knowledge: { domain_score: 19, domain_max: 32, indicators: [] },
  },
  scores: {
    domains: {},
    overall: { max_marks: 117, overall_marks: 90, overall_max_marks: 148, overall_percentage: 60.8 },
    grand_total: null,
    debrief_total: 8.33,
    max_marks_with_debrief: 123,
    percentage_with_debrief: null,
  },
};

describe('adapter fallback: overall derived from groups when flat pct is absent (bd-5n1a2)', () => {
  beforeAll(() => { process.env.OBSERVE_FRAMEWORK = 'fico'; });

  test('the prod bad row renders 61%, not 0%', () => {
    const vm = buildScoreViewModel(PROD_BAD_ROW);
    expect(vm.overall).toBe(61); // round(90/148)
    expect(vm.marks).toBe(90);
    expect(vm.max).toBe(148);
  });

  test('a healthy flat-scores row is untouched', () => {
    const vm = buildScoreViewModel({
      framework: 'fico',
      domains: PROD_BAD_ROW.domains,
      scores: { overall_marks: 90, overall_max_marks: 148, overall_percentage: 60.8 },
    });
    expect(vm.overall).toBe(61);
    expect(vm.marks).toBe(90);
  });

  test('no scores at all → still derives from domain groups', () => {
    const vm = buildScoreViewModel({ framework: 'fico', domains: PROD_BAD_ROW.domains });
    expect(vm.overall).toBe(61);
  });
});

describe('_preserveFrameworkShape: framework truth ALWAYS beats enhance-LLM output (bd-5n1a2)', () => {
  const { _preserveFrameworkShape } = require('../../bot/shared/services/gpt5-mini.service');

  test('LLM-emitted junk scores/domains are overwritten for non-OECD frameworks', () => {
    const analysisData = {
      framework: 'fico',
      domains: { lesson_plan_fidelity: { domain_score: 18, domain_max: 40 } },
      scores: { overall_marks: 90, overall_max_marks: 148, overall_percentage: 60.8 },
    };
    const enhanced = {
      // the LLM "kept" the numbers but invented its own nesting
      scores: { overall: { overall_percentage: 60.8 }, domains: {} },
      domains: { some_mangled_key: {} },
      executive_summary: 'kept',
    };
    _preserveFrameworkShape(enhanced, analysisData);
    expect(enhanced.framework).toBe('fico');
    expect(enhanced.scores).toEqual(analysisData.scores);      // flat truth restored
    expect(enhanced.domains).toEqual(analysisData.domains);    // framework structure restored
    expect(enhanced.executive_summary).toBe('kept');            // enrichment kept
  });

  test('OECD analyses keep the enhance output (debrief math depends on it)', () => {
    const enhanced = { scores: { overall_marks: 50 } };
    _preserveFrameworkShape(enhanced, { framework: 'oecd', scores: { overall_marks: 40 } });
    expect(enhanced.scores.overall_marks).toBe(50); // untouched for oecd
  });
});
