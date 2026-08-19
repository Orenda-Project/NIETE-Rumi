/**
 * bd-gr48y — the classroom photo must actually reach the FICO analysis prompt.
 *
 * Root cause: analyzePedagogy called `framework.buildAnalysisPrompt(t, meta, lp, null)`
 * — hardcoded `null` for the photoAnalysis arg — so even when a vision description
 * was produced it never entered the prompt. The framework's photoNote was dead.
 *
 * Fix: pass `metadata.photoAnalysis` through. This test stubs the framework and the
 * OpenAI client and asserts the 4th arg the framework receives IS the photo text.
 */

jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('jsonrepair', () => ({ jsonrepair: (s) => s }), { virtual: true });
jest.mock('dotenv', () => ({ config: () => ({}) }), { virtual: true });

const GPT5MiniService = require('../../bot/shared/services/gpt5-mini.service');

const CANNED = JSON.stringify({ executive_summary: 'ok' });
function stubOpenAI() {
  GPT5MiniService.openai = {
    chat: { completions: { create: async () => ({
      choices: [{ message: { content: CANNED }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }) } },
  };
}

describe('bd-gr48y — photoAnalysis reaches buildAnalysisPrompt', () => {
  const realOpenAI = GPT5MiniService.openai;
  afterAll(() => { GPT5MiniService.openai = realOpenAI; });

  test('metadata.photoAnalysis is passed as the 4th arg (NOT null)', async () => {
    stubOpenAI();
    const captured = {};
    const fakeFramework = {
      name: 'fico',
      getSystemPrompt: () => 'SYS',
      buildAnalysisPrompt: (t, meta, lp, photoAnalysis) => { captured.photo = photoAnalysis; return 'USER'; },
      computeScores: (a) => a,
    };

    await GPT5MiniService.analyzePedagogy('transcript', { photoAnalysis: 'PHOTO: chalkboard shows the lesson objective' }, null, fakeFramework);

    expect(captured.photo).toBe('PHOTO: chalkboard shows the lesson objective');
  });

  test('no photo → 4th arg is null/undefined (unchanged behaviour)', async () => {
    stubOpenAI();
    const captured = {};
    const fakeFramework = {
      name: 'fico', getSystemPrompt: () => 'SYS',
      buildAnalysisPrompt: (t, meta, lp, photoAnalysis) => { captured.photo = photoAnalysis; return 'USER'; },
      computeScores: (a) => a,
    };
    await GPT5MiniService.analyzePedagogy('transcript', {}, null, fakeFramework);
    expect(captured.photo == null).toBe(true);
  });
});
