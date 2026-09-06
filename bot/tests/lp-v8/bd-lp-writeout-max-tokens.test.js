/**
 * A lesson written out must not be cut mid-sentence by max_tokens.
 *
 * Staging, 2026-08-30 22:15 PKT, on the un-clipped context block: "give me
 * the whole lesson plan in brief, all sections" came back complete through
 * section 8 and then stopped at "C) Calculate" — max_tokens: 500 for text.
 * A nine-phase lesson in brief is legitimately 700-900 tokens, more in Urdu
 * script. A conversational reply stays at 500; a reply that carries a lesson
 * block gets room to finish the lesson. WhatsApp's own cap (4,096 chars) is
 * the ceiling that matters, and 1,200 tokens sits under it in both scripts.
 */

/* eslint-disable global-require */

const mockCreate = jest.fn(async () => ({ choices: [{ message: { content: 'ok' } }] }));
jest.mock('openai', () => jest.fn().mockImplementation(() => ({
  chat: { completions: { create: mockCreate } },
})));
jest.mock('../../shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));

const OpenAIService = require('../../shared/services/openai.service');
const maxTokens = () => mockCreate.mock.calls[0][0].max_tokens;

describe('max_tokens when a lesson block rides with the turn', () => {
  beforeEach(() => {
    mockCreate.mockClear();
    jest.spyOn(OpenAIService, 'getConversationHistory').mockResolvedValue([]);
  });
  afterEach(() => jest.restoreAllMocks());

  test('text + lesson context: room to finish the lesson (≥ 1000)', async () => {
    await OpenAIService.getResponseWithFormat('all sections in brief', 'u1', 'text', 'en', 'Haroon', 'LP_BLOCK');
    expect(maxTokens()).toBeGreaterThanOrEqual(1000);
  });

  test('text, no context: the conversational cap is unchanged (500)', async () => {
    await OpenAIService.getResponseWithFormat('hi', 'u1', 'text', 'en', 'Haroon', null);
    expect(maxTokens()).toBe(500);
  });

  test('voice is untouched — the 60-second limit still binds, context or not', async () => {
    await OpenAIService.getResponseWithFormat('x', 'u1', 'voice', 'ur', 'Haroon', 'LP_BLOCK');
    expect(maxTokens()).toBe(400);
    mockCreate.mockClear();
    await OpenAIService.getResponseWithFormat('x', 'u1', 'voice', 'en', 'Haroon', null);
    expect(maxTokens()).toBe(250);
  });
});
