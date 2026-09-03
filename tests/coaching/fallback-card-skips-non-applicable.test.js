/**
 * The rule-based fallback card must never name a NON-APPLICABLE indicator, and
 * must read the scale from the framework rather than a fourth hard-coded copy.
 *
 * RED FIRST. Staging, 3 Sep: an Urdu grammar lesson scored on FICO v4 got the
 * fallback card "dedicate 5 minutes to Mathematical Discourse & Reasoning" (F4).
 * F4–F7 are subject-gated and were stored applicable:false / score:null — exactly
 * as intended — but extractIndicators pushed them with score null against a
 * hard-coded maxScore of 4, and null/4 reads as 0, so a maths-only row became
 * "the weakest" indicator of an Urdu lesson. The scorer itself had chosen C3.
 *
 * The fixture mirrors that session's shape (v4: 0–2 scale, C3 at rung 1).
 */
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const { extractIndicators, findWeakestIndicator } = require('../../bot/shared/services/coaching/coaching-card/prioritized-action.service');
const fico = require('../../bot/shared/services/coaching/frameworks/fico-framework');

const NA = (id, name) => ({ id, name, score: null, applicable: false, evidence: 'Not applicable — lesson subject is Urdu' });
const ok = (id, name, score) => ({ id, name, score, applicable: true, evidence: 'Quote: "…"' });

const analysis = {
  framework: 'fico',
  domains: {
    lesson_plan_fidelity: { indicators: [ok('B1', 'Instructional Clarity & Learning Objectives', 2), ok('B2', 'Lesson Structure & Sequence', 1)] },
    high_leverage_practices: { indicators: [ok('C1', 'Quality Questioning', 2), ok('C2', 'Responsive Re-explanation', 1), ok('C3', 'Effective Feedback', 1), ok('C4', 'Student Agency & Voice', 2)] },
    student_engagement: { indicators: [ok('D1', 'Diversity of Conceptual Expression', 1), ok('D2', 'Student Reasoning in Responses', 2)] },
    teacher_subject_knowledge: {
      indicators: [
        ok('F1', 'Content Accuracy', 2), ok('F2', 'Use of Academic Language', 1), ok('F3', 'Anticipation of Student Misconceptions', 1),
        NA('F4', 'Mathematical Discourse & Reasoning'), NA('F5', 'Problem-Solving & Productive Struggle'),
        NA('F6', 'Inquiry-Based Approach'), NA('F7', 'Science Talk & Student Sense-Making'),
        ok('F8', 'Explicit Phonics / Decoding', 1), ok('F9', 'Comprehension Strategy Instruction', 2), ok('F10', 'Reading-Writing Connections', 1),
      ],
    },
  },
  focus_area: { domain: 'high_leverage_practices', indicator: 'C3', title: 'Feedback that names the next step', try_this_tomorrow: 'ہر غلطی پر ایک جملہ' },
  scores: { overall_marks: 25, overall_max_marks: 44, overall_percentage: 56.8 },
};

describe('fallback card — applicability and scale', () => {
  test('never a non-applicable indicator', () => {
    const w = findWeakestIndicator(analysis);
    expect(w).not.toBeNull();
    expect(['F4', 'F5', 'F6', 'F7']).not.toContain(w.id);
  });

  test('the scale is the framework\'s own, not a literal', () => {
    const { scaleMax } = fico.getScoringConstants();
    const rows = extractIndicators(analysis);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.maxScore).toBe(scaleMax);
  });

  test('a null score is not a candidate', () => {
    const rows = extractIndicators(analysis);
    expect(rows.some((r) => r.score === null || r.score === undefined)).toBe(false);
    expect(rows.map((r) => r.id)).not.toContain('F4');
  });

  test('a row with no applicable flag at all is still a candidate (pre-cutover sessions)', () => {
    const legacy = { framework: 'fico', domains: { c: { indicators: [{ id: 'C1', name: 'Q', score: 1 }] } } };
    expect(extractIndicators(legacy).map((r) => r.id)).toEqual(['C1']);
  });

  test('non-FICO domain shapes keep their scale', () => {
    const mewaka = { framework: 'mewaka', domains: { a: { indicators: [{ id: 'M1', name: 'x', score: 3 }] } } };
    expect(extractIndicators(mewaka)[0].maxScore).toBe(4);
  });
});
