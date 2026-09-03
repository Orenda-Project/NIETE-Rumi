/**
 * Phase 2 of the feedback-uptake loop: the PRIOR ACTION block rides inside the
 * existing scoring call (zero new LLM calls) and asks for a tally — and the
 * totals must be byte-identical with and without it. RED FIRST.
 */
const fico = require('../../bot/shared/services/coaching/frameworks/fico-framework');

const prior = {
  target: { indicator: 'C3', domain: 'high_leverage_practices', name: 'Effective Feedback' },
  action: 'After every wrong answer, say one sentence that names the next step.',
  action_spec: { count_target: { specific_feedback_moves: 3, next_step_feedback: 1 } },
  baseline: { rung: 1, count: { specific_feedback_moves: 1, next_step_feedback: 0 } },
  attempt: 1, angle: 'tell', created_at: '2026-09-01T08:00:00Z',
};

describe('buildAnalysisPrompt — the PRIOR ACTION block', () => {
  test('with a prior action: names the target, the ask, the bar, and asks for the "uptake" tally with the bar\'s keys', () => {
    const p = fico.buildAnalysisPrompt('TRANSCRIPT', { subject: 'Urdu', language: 'ur', priorAction: prior });
    expect(p).toContain('PRIOR ACTION');
    expect(p).toContain('C3');
    expect(p).toContain(prior.action);
    expect(p).toContain('"uptake"');
    expect(p).toContain('"specific_feedback_moves"');
    expect(p).toContain('"next_step_feedback"');
    expect(p).toMatch(/2026-09-01/);
  });
  test('the block forbids the prior action from moving any score', () => {
    const p = fico.buildAnalysisPrompt('TRANSCRIPT', { subject: 'Urdu', language: 'ur', priorAction: prior });
    expect(p).toMatch(/Do NOT let the prior action change any indicator score/i);
  });
  test('without a prior action the prompt carries neither the block nor the schema key', () => {
    const p = fico.buildAnalysisPrompt('TRANSCRIPT', { subject: 'Urdu', language: 'ur' });
    expect(p).not.toContain('PRIOR ACTION');
    expect(p).not.toContain('"uptake"');
    const q = fico.buildAnalysisPrompt('TRANSCRIPT', { subject: 'Urdu', language: 'ur', priorAction: null });
    expect(q).toBe(p);
  });
  test('the block sits before the JSON schema, never inside a section', () => {
    const p = fico.buildAnalysisPrompt('TRANSCRIPT', { subject: 'Urdu', language: 'ur', priorAction: prior });
    expect(p.indexOf('PRIOR ACTION')).toBeLessThan(p.indexOf('Return STRICT JSON'));
    // the SCHEMA key (last occurrence — the block's prose names the field too)
    expect(p.lastIndexOf('"uptake"')).toBeGreaterThan(p.indexOf('"recommendations"'));
  });
  test('a malformed prior (no target) is ignored, not rendered', () => {
    const p = fico.buildAnalysisPrompt('TRANSCRIPT', { language: 'en', priorAction: { action: 'x' } });
    expect(p).not.toContain('PRIOR ACTION');
  });
});

describe('computeScores never reads uptake', () => {
  const ok = (id, score) => ({ id, score, applicable: true });
  const base = () => ({
    framework: 'fico',
    domains: {
      lesson_plan_fidelity: { indicators: [ok('B1', 2), ok('B2', 1)] },
      high_leverage_practices: { indicators: [ok('C1', 1), ok('C3', 1)] },
      student_engagement: { indicators: [ok('D1', 2)] },
      teacher_subject_knowledge: { indicators: [ok('F1', 2), { id: 'F4', score: null, applicable: false }] },
    },
  });
  test('totals are byte-identical with and without a tally on the analysis', () => {
    const a = fico.computeScores(base());
    const b = fico.computeScores({ ...base(), uptake: { count: { specific_feedback_moves: 9, next_step_feedback: 9 }, evidence: 'x' } });
    expect(JSON.stringify(b.scores)).toBe(JSON.stringify(a.scores));
    expect(JSON.stringify(b.domains)).toBe(JSON.stringify(a.domains));
    expect(b.uptake).toBeDefined();
  });
});
