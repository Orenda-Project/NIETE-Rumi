/**
 * analyzePedagogy framework-dispatch conformance test.
 *
 * Locks the customization foothold: the `framework` argument passed by the callers
 * (coaching.service / analysis-processor) must ACTUALLY drive the prompt + scoring.
 *
 * Background: the existing framework-wiring test fully mocks GPT5MiniService, so it only
 * proves the callers *pass* the arg — it never exercised the real body, which historically
 * dropped the 4th arg and hardcoded OECD. This test runs the REAL analyzePedagogy with a
 * stubbed OpenAI client and FAILS if a non-OECD framework's prompt/scoring is ignored.
 */

// Avoid the supabase env throw at require-time.
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const GPT5MiniService = require('../../bot/shared/services/gpt5-mini.service');

// Minimal valid analysis JSON the model "returns".
const CANNED = JSON.stringify({
  executive_summary: 'ok',
  goal1_formative_assessment: {},
  goal2_student_engagement: {},
  goal3_quality_content: {},
  goal4_classroom_interaction: {},
  goal5_classroom_management: {},
});

function stubOpenAI() {
  const captured = {};
  GPT5MiniService.openai = {
    chat: {
      completions: {
        create: async ({ messages }) => {
          captured.system = messages[0].content;
          captured.user = messages[1].content;
          return {
            choices: [{ message: { content: CANNED }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
          };
        },
      },
    },
  };
  return captured;
}

describe('analyzePedagogy framework dispatch (foothold)', () => {
  const realOpenAI = GPT5MiniService.openai;
  afterAll(() => { GPT5MiniService.openai = realOpenAI; });

  test('a non-OECD framework module drives the system + user prompt (arg is NOT dropped)', async () => {
    const captured = stubOpenAI();
    const fakeFramework = {
      name: 'faketest',
      getSystemPrompt: () => 'SENTINEL_SYSTEM_PROMPT',
      buildAnalysisPrompt: () => 'SENTINEL_USER_PROMPT',
      computeScores: (analysis) => ({ ...analysis, scores: { overall_marks: 42 } }),
    };

    const result = await GPT5MiniService.analyzePedagogy('transcript', {}, null, fakeFramework);

    // If the framework arg were ignored, these would be the inline OECD prompt instead.
    expect(captured.system).toBe('SENTINEL_SYSTEM_PROMPT');
    expect(captured.user).toBe('SENTINEL_USER_PROMPT');
    expect(result.analysis.framework).toBe('faketest');
    expect(result.analysis.scores.overall_marks).toBe(42);
  });

  test('no framework (default) uses the inline OECD path and stamps framework=oecd', async () => {
    const captured = stubOpenAI();
    const result = await GPT5MiniService.analyzePedagogy('transcript', {}, null);

    expect(captured.system).toBe(GPT5MiniService.getCachedFrameworkPrompt());
    expect(result.analysis.framework).toBe('oecd');
  });

  test('an explicit OECD framework still uses the canonical inline path (zero regression)', async () => {
    const captured = stubOpenAI();
    const oecd = require('../../bot/shared/services/coaching/frameworks/oecd-framework');
    const result = await GPT5MiniService.analyzePedagogy('transcript', {}, null, oecd);

    // OECD must NOT route through the (divergent) module — it uses the live inline prompt.
    expect(captured.system).toBe(GPT5MiniService.getCachedFrameworkPrompt());
    expect(result.analysis.framework).toBe('oecd');
  });
});
