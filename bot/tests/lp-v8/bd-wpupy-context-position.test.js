/**
 * bd-wpupy — the LP context must sit NEXT TO her message, not in the system prompt.
 *
 * Reproduced against the real failing conversation, with the real production
 * model (gpt-4.1-mini) and its real 10-turn history:
 *
 *   context appended to the system prompt  -> answered from the PREVIOUS REPLY
 *   context as a system message before the turn -> answered from the LESSON
 *
 * Same model, same history, same block. A stronger model (gpt-4o) resisted the
 * pull, and a prompt rule spelling out what "this" refers to did NOT fix it.
 * Position did. This test pins the position, because the next person to "tidy"
 * the message array would silently reintroduce the bug.
 */

/* eslint-disable global-require */

const mockCreate = jest.fn(async () => ({ choices: [{ message: { content: 'ok' } }] }));
// Staging talks to models through llm-client (sandbox still mocked the raw 'openai' package).
jest.mock('../../shared/services/llm-client', () => ({
  getClient: () => ({ chat: { completions: { create: mockCreate } } }),
}));
jest.mock('../../shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));

const OpenAIService = require('../../shared/services/openai.service');

describe('bd-wpupy — LP context position in the message array', () => {
  beforeEach(() => {
    // bd-zrdvmi.77.3: on staging the adjacent position rides the LP_CONTEXT_V2_ENABLED switch.
    process.env.LP_CONTEXT_V2_ENABLED = 'true';
    mockCreate.mockClear();
    jest.spyOn(OpenAIService, 'getConversationHistory').mockResolvedValue([
      { role: 'user', content: 'give this to me in simple format' },
      { role: 'assistant', content: 'اگر بچے زیادہ ہوں تو: بچوں کو چھوٹے گروپس میں بانٹ دیں۔' },
    ]);
  });
  afterEach(() => { jest.restoreAllMocks(); delete process.env.LP_CONTEXT_V2_ENABLED; });

  test('the context rides as its own message immediately before her turn', async () => {
    await OpenAIService.getResponseWithFormat('give this to me in text form', 'u1', 'text', 'ur', 'Haroon', 'LP_BLOCK');
    const { messages } = mockCreate.mock.calls[0][0];

    const last = messages[messages.length - 1];
    const beforeLast = messages[messages.length - 2];
    expect(last).toEqual({ role: 'user', content: 'give this to me in text form' });
    expect(beforeLast.role).toBe('system');
    // bd-eb1ec: the block now opens with the reply-language pin; the LP block
    // itself is still the body of that same adjacent message.
    expect(beforeLast.content).toMatch(/^REPLY LANGUAGE: Urdu\b/);
    expect(beforeLast.content).toMatch(/LP_BLOCK$/);
  });

  test('it is NOT appended to the base system prompt (that is the bug)', async () => {
    await OpenAIService.getResponseWithFormat('x', 'u1', 'text', 'ur', 'Haroon', 'LP_BLOCK');
    const { messages } = mockCreate.mock.calls[0][0];
    expect(messages[0].role).toBe('system');
    expect(messages[0].content).not.toMatch(/LP_BLOCK/);
  });

  test('the history still sits between the base prompt and the context', async () => {
    await OpenAIService.getResponseWithFormat('x', 'u1', 'text', 'ur', 'Haroon', 'LP_BLOCK');
    const { messages } = mockCreate.mock.calls[0][0];
    const roles = messages.map((m) => m.role);
    expect(roles).toEqual(['system', 'user', 'assistant', 'system', 'user']);
  });

  test('no context → the array is unchanged from before this fix', async () => {
    await OpenAIService.getResponseWithFormat('x', 'u1', 'text', 'ur', 'Haroon', null);
    const { messages } = mockCreate.mock.calls[0][0];
    expect(messages.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user']);
  });

  test('switch off → the context is appended to the system prompt exactly as before (one-step undo)', async () => {
    delete process.env.LP_CONTEXT_V2_ENABLED;
    await OpenAIService.getResponseWithFormat('x', 'u1', 'text', 'ur', 'Haroon', 'LP_BLOCK');
    const { messages, max_tokens: maxTokens } = mockCreate.mock.calls[0][0];
    expect(messages.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user']);
    expect(messages[0].content).toMatch(/LP_BLOCK$/);
    expect(maxTokens).toBe(500);
  });

  test('switch on → a text reply carrying a lesson block gets room to write the lesson out', async () => {
    await OpenAIService.getResponseWithFormat('x', 'u1', 'text', 'ur', 'Haroon', 'LP_BLOCK');
    expect(mockCreate.mock.calls[0][0].max_tokens).toBe(1200);
  });
});
