/**
 * bd-eb1ec — the reply language must survive an Urdu lesson block.
 *
 * Staging, 2026-08-30 21:41 PKT: the operator switched to English
 * (preferred_language='en', language_locked=true), asked "give me short
 * version of this lp", and got the whole reply in Urdu. The conversations row
 * says output_language='en' — the bot ASKED for English. Reproduced through
 * simulate_reply.js with the user on 'en': Tier B fired and the reply came
 * back Urdu.
 *
 * Mechanism, not a guess: since bd-wpupy the LP context rides as a system
 * message IMMEDIATELY before her turn — ~4,000 characters of Urdu lesson
 * script, with FRAMING saying "write the lesson out … in her language". The
 * only statement of the reply language is the base system prompt, ten turns
 * away. Position beat it — the same recency effect bd-wpupy documented, now
 * pulling the language instead of the referent.
 *
 * Fix: the adjacent context message opens with the reply language, in the
 * spot the model actually reads. Pinned here so the next tidy-up cannot drop it.
 */

/* eslint-disable global-require */

const mockCreate = jest.fn(async () => ({ choices: [{ message: { content: 'ok' } }] }));
jest.mock('openai', () => jest.fn().mockImplementation(() => ({
  chat: { completions: { create: mockCreate } },
})));
jest.mock('../../shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));

const OpenAIService = require('../../shared/services/openai.service');

const contextMessage = () => {
  const { messages } = mockCreate.mock.calls[0][0];
  return messages[messages.length - 2];
};

describe('bd-eb1ec — the context message names the reply language', () => {
  beforeEach(() => {
    mockCreate.mockClear();
    jest.spyOn(OpenAIService, 'getConversationHistory').mockResolvedValue([]);
  });
  afterEach(() => jest.restoreAllMocks());

  test('English teacher, Urdu lesson block: the block opens by pinning English', async () => {
    await OpenAIService.getResponseWithFormat('give me short version of this lp', 'u1', 'text', 'en', 'Haroon', 'اردو سبق کا متن');
    const ctx = contextMessage();
    expect(ctx.role).toBe('system');
    expect(ctx.content).toMatch(/^REPLY LANGUAGE: English\b/);
    expect(ctx.content).toMatch(/even if the reference material below is in another language/i);
    expect(ctx.content).toMatch(/اردو سبق کا متن$/);
  });

  test('Urdu teacher: the pin says Urdu', async () => {
    await OpenAIService.getResponseWithFormat('x', 'u1', 'text', 'ur', 'Haroon', 'BLOCK');
    expect(contextMessage().content).toMatch(/^REPLY LANGUAGE: Urdu\b/);
  });

  test('no context, no pin — the message array is unchanged', async () => {
    await OpenAIService.getResponseWithFormat('x', 'u1', 'text', 'en', 'Haroon', null);
    const { messages } = mockCreate.mock.calls[0][0];
    expect(messages.map((m) => m.role)).toEqual(['system', 'user']);
  });

  test('the pin sits INSIDE the adjacent message, not in the base prompt (position is the point)', async () => {
    await OpenAIService.getResponseWithFormat('x', 'u1', 'text', 'en', 'Haroon', 'BLOCK');
    const { messages } = mockCreate.mock.calls[0][0];
    expect(messages[0].content).not.toMatch(/REPLY LANGUAGE:/);
    expect(messages[messages.length - 1]).toEqual({ role: 'user', content: 'x' });
  });
});
