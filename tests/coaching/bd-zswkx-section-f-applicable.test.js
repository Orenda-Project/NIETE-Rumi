/**
 * bd-zswkx — Section F must stop charging every teacher for the subjects she
 * did not teach. (FICO V3, the rubric running in production.)
 *
 * Section F tags three of its eight indicators by subject — F5 MATH, F6 SCIENCE,
 * F7 LITERACY — and by construction at most ONE can apply to a lesson. The prompt
 * ordered the other two scored 1, and computeScores kept the denominator at a flat
 * indicatorCount * SCALE_MAX. So two rows were pinned at the floor inside a total
 * that still counted them:
 *
 *   · Section F was capped at 26/32 (81.3%) for a FLAWLESS lesson.
 *   · Every teacher lost ~6 of 148 marks for teaching one subject.
 *   · "Your next horizon" pointed at Teacher Subject Knowledge in 22.7% of
 *     delivered reports, against 2.4% once the denominator is honest.
 *
 * ICT's own rubric sheet says only "only relevant subject rows apply per lesson".
 * It never says to score the others 1, and states no per-lesson denominator — the
 * floor-to-1 rule was invented here and back-attributed to them.
 *
 * A non-applicable indicator leaves the total entirely: no numerator, no
 * denominator. FICO v4 on develop already works this way; this is the backport to
 * the rubric production actually runs.
 *
 * ON SANDBOX this file runs against FICO v4 (B7 · C4 · D5 · F10, scale 0-2), not V3.
 * The five V3-arithmetic cases (Section F 24/24, 140 of 148 marks, the legacy 32/148
 * totals, 4-mark rows, a two-row domain with nothing applicable) were removed in the
 * sandbox catch-up: bd-0c01q-fico-v4.test.js (".4 non-applicable indicators leave BOTH
 * sides of the fraction") pins the same rule in v4 terms. What stays holds on both
 * rubrics: the applicable count, and the prompt's contract for the flag.
 */
const fico = require('../../bot/shared/services/coaching/frameworks/fico-framework');

// A FULL analysis, the shape computeScores actually receives: all four scored
// sections present. B=10, C=12, D=7, F=8 indicators, scale 1-4 => 148 marks.
// This Urdu lesson is flawless, and F5 (math) + F6 (science) do not apply to it.
const rows = (prefix, n, score) =>
  Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i + 1}`, score }));

function urduLessonAnalysis() {
  return {
    domains: {
      lesson_plan_fidelity: { indicators: rows('B', 10, 4) },
      high_leverage_practices: { indicators: rows('C', 12, 4) },
      student_engagement: { indicators: rows('D', 7, 4) },
      teacher_subject_knowledge: {
        indicators: [
          { id: 'F1', score: 4 }, { id: 'F2', score: 4 }, { id: 'F3', score: 4 },
          { id: 'F4', score: 4 },
          { id: 'F5', score: null, applicable: false, evidence: 'Not applicable — lesson subject is Urdu.' },
          { id: 'F6', score: null, applicable: false, evidence: 'Not applicable — lesson subject is Urdu.' },
          { id: 'F7', score: 4 }, { id: 'F8', score: 4 },
        ],
      },
    },
  };
}

describe('bd-zswkx — a non-applicable indicator leaves the total', () => {
  it('records how many rows applied, so the report can render the right scale', () => {
    const a = fico.computeScores(urduLessonAnalysis());
    expect(a.domains.teacher_subject_knowledge.indicators_applicable).toBe(6);
  });
});

describe('bd-zswkx — the prompt asks for the flag instead of a floor score', () => {
  const sys = fico.getSystemPrompt();
  const analysis = fico.buildAnalysisPrompt('transcript', { language: 'ur' }, null, null);

  it('no longer orders a subject-mismatched row scored 1', () => {
    expect(sys).not.toMatch(/score it 1 with evidence/i);
    expect(analysis).not.toMatch(/subject mismatch\), score \d/i);
  });

  it('asks for applicable:false and a null score, and says the row leaves the total', () => {
    expect(sys).toMatch(/"applicable"/);
    expect(sys).toMatch(/leaves the total|LEAVES THE TOTAL/);
  });

  it('emits the applicable field in the JSON row contract', () => {
    expect(analysis).toMatch(/"applicable"/);
  });

  it('tells the scorer what to do when the subject cannot be determined', () => {
    expect(sys).toMatch(/cannot tell the subject|cannot determine the subject/i);
  });
});
