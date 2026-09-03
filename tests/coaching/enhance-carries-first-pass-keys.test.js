/**
 * The reflection-enhancement pass must carry EVERY first-pass key it does not
 * itself emit — not an allowlist.
 *
 * RED FIRST. The enhance prompt is OECD-shaped, so its output lacks every
 * framework-native key. `_preserveFrameworkShape` restored framework/domains/
 * scores plus a fixed five-key allowlist — and silently dropped everything else.
 * In production the scorer's own `focus_area` (the ONE indicator to grow next,
 * with a concrete `try_this_tomorrow` in the teacher's language) was present on
 * 1,907 of 1,909 un-reflected sessions and on 0 of 1,853 reflected ones: the
 * reflection deleted the report's best next-step. The same allowlist would drop
 * the `uptake` tally the feedback-uptake loop reads.
 *
 * Invariant: additive only. A key the enhance pass DID emit is never overwritten.
 */
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('jsonrepair', () => ({ jsonrepair: (s) => s }), { virtual: true });
jest.mock('dotenv', () => ({ config: () => ({}) }), { virtual: true });

const G = require('../../bot/shared/services/gpt5-mini.service');

function firstPass() {
  return {
    framework: 'fico',
    domains: { high_leverage_practices: { indicators: [{ id: 'C3', score: 1, applicable: true }] } },
    scores: { overall_marks: 30, overall_max_marks: 44, overall_percentage: 68.2 },
    focus_area: { domain: 'high_leverage_practices', indicator: 'C3', title: 'Feedback that names the next step', try_this_tomorrow: 'ہر غلطی کے بعد ایک جملہ: اب یہ کریں' },
    uptake: { count: { specific_feedback: 2, next_step_feedback: 0 }, evidence: 'Quote: "…"' },
    executive_summary: 'first-pass summary',
    recommendations: ['r1'],
  };
}

function enhanceOutput() {
  return {
    framework: 'oecd',
    executive_summary: 'ENHANCED summary — the enhance pass rewrote it',
    debrief_reflection: { q1: {} },
    goal1_formative_assessment: { criteria: {} },
    domain4_professional_responsibilities: {},
  };
}

describe('_preserveFrameworkShape — every first-pass key survives the enhancement', () => {
  test('focus_area and uptake are carried (they were dropped by the allowlist)', () => {
    const first = firstPass();
    const enhanced = enhanceOutput();
    G._preserveFrameworkShape(enhanced, first);
    expect(enhanced.focus_area).toEqual(first.focus_area);
    expect(enhanced.uptake).toEqual(first.uptake);
    expect(enhanced.recommendations).toEqual(first.recommendations);
  });

  test('the framework-computed domains/scores still win over the enhance output', () => {
    const first = firstPass();
    const enhanced = { ...enhanceOutput(), scores: { overall: { pct: 0 } }, domains: {} };
    G._preserveFrameworkShape(enhanced, first);
    expect(enhanced.framework).toBe('fico');
    expect(enhanced.domains).toBe(first.domains);
    expect(enhanced.scores).toBe(first.scores);
  });

  test('a key the enhance pass DID emit is never overwritten (additive only)', () => {
    const first = firstPass();
    const enhanced = enhanceOutput();
    G._preserveFrameworkShape(enhanced, first);
    expect(enhanced.executive_summary).toBe('ENHANCED summary — the enhance pass rewrote it');
    expect(enhanced.debrief_reflection).toEqual({ q1: {} });
  });

  test('the OECD-shaped junk the enhance LLM emits is still dropped', () => {
    const enhanced = enhanceOutput();
    G._preserveFrameworkShape(enhanced, firstPass());
    expect(enhanced.goal1_formative_assessment).toBeUndefined();
    expect(enhanced.domain4_professional_responsibilities).toBeUndefined();
  });

  test('OECD sessions are untouched — the carry applies to framework modules only', () => {
    const enhanced = { framework: 'oecd', goal1_formative_assessment: { criteria: {} } };
    G._preserveFrameworkShape(enhanced, { framework: 'oecd', focus_area: { indicator: 'x' } });
    expect(enhanced.focus_area).toBeUndefined();
    expect(enhanced.goal1_formative_assessment).toEqual({ criteria: {} });
  });
});
