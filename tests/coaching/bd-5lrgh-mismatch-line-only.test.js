/**
 * bd-5lrgh follow-up — the lesson-mismatch Section B line is the catalogue sentence ONLY.
 *
 * #1408 added a model-written "what was taught" sentence after the fixed line. On the sandbox
 * re-analysis of the DC-row-142 session (d7196d60, 1 Oct) an English report then carried the
 * model's own Urdu translation of that sentence. The operator's call (2026-10-01): "we don't need
 * to give the reason at all — just need to have that why it was marked zero because of mismatch."
 *
 * So the model is no longer asked for that sentence, and if it volunteers one anyway it is dropped
 * before it can reach the report — the line says one true thing, in code, every time.
 */
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
const mockOpenAI = { chat: { completions: { create: jest.fn() } } };
jest.mock('../../bot/shared/services/gpt5-mini.service', () => ({ openai: mockOpenAI }));

const { buildPrompt, generateReportNarrative } =
  require('../../bot/shared/services/coaching/report-v2/narrative.service');

const SANDBOX_MIXED = 'You taught reading and grammar: phonics word changes, sentence-building activities, and comprehension about traffic and transport; آپ نے پڑھایا: فونکس سے لفظ بدلنا۔';

function mismatchAnalysis() {
  return {
    framework: 'fico',
    scores: { overall_percentage: 55 },
    domains: {
      lesson_plan_fidelity: { assessed: true, fidelity_derived: true, fidelity_pct: 0, domain_score: 0, domain_max: 14, indicators: [] },
      high_leverage_practices: { domain_score: 6, domain_max: 8, indicators: [] },
      student_engagement: { domain_score: 7, domain_max: 10, indicators: [] },
      teacher_subject_knowledge: { domain_score: 11, domain_max: 12, indicators: [] },
    },
    lp_fidelity: { status: 'ok', fidelity_pct: 0, moderators: { note: 'lesson_mismatch' }, moves: [] },
  };
}

describe('the model is not asked to explain the mismatched section', () => {
  test.each(['en', 'ur'])('%s: no taught-sentence field or instruction in the prompt', (language) => {
    const p = buildPrompt(mismatchAnalysis(), { transcript: '[00:05] x', language, teacherName: 'T' });
    expect(p).not.toContain('lesson_mismatch_taught');
    expect(p).toMatch(/LESSON MISMATCH/);
  });
});

describe('generateReportNarrative never passes a taught-sentence on', () => {
  beforeEach(() => mockOpenAI.chat.completions.create.mockReset());
  const reply = (extra) => ({ choices: [{ message: { content: JSON.stringify({
    topic: 'reading & grammar', affirmation: 'a', identity: 'b', moments: [],
    domain_whys: { high_leverage_practices: 'x' }, ...extra,
  }) } }] });

  test.each(['en', 'ur'])('%s: a volunteered lesson_mismatch_taught is dropped', async (language) => {
    mockOpenAI.chat.completions.create.mockResolvedValue(reply({ lesson_mismatch_taught: SANDBOX_MIXED }));
    const n = await generateReportNarrative(mismatchAnalysis(), { language, transcript: 'x' });
    expect(n).not.toHaveProperty('lesson_mismatch_taught');
    expect(n.domain_whys).toEqual({ high_leverage_practices: 'x' });
  });
});
