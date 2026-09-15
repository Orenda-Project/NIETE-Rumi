'use strict';
/**
 * bd-b3pop.15 — vision.service analyzeImage accepts systemPrompt / temperature / maxTokens / responseFormat / timeoutMs
 * for the coaching photo pass, and reports the finish reason. With none of them the request is exactly today's, for
 * every other caller (chat image analysis).
 */
const mockCalls = [];
jest.mock('../../bot/shared/services/llm-client', () => ({
  getClient: () => ({
    chat: {
      completions: {
        create: async (...args) => {
          mockCalls.push(args);
          return { choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } };
        },
      },
    },
  }),
}));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../bot/shared/utils/constants', () => ({ OPENAI_API_KEY: 'test' }));
jest.mock('../../bot/shared/config/model-settings', () => ({ configForRequest: () => ({}) }));

const { analyzeImage } = require('../../bot/shared/services/vision.service');

const IMG = Buffer.from('fake-jpeg');

beforeEach(() => { mockCalls.length = 0; delete process.env.VISION_MODEL; });

test("no new options → today's request: one argument, key order, the assistant system prompt, 1000 tokens, temperature 0.7", async () => {
  const r = await analyzeImage(IMG, 'image/jpeg', { prompt: 'describe', detail: 'low' });
  expect(r).toMatchObject({ success: true, finishReason: 'stop' });
  expect(mockCalls[0]).toHaveLength(1);
  const p = mockCalls[0][0];
  expect(Object.keys(p)).toEqual(['model', 'messages', 'max_tokens', 'temperature']);
  expect(p.max_tokens).toBe(1000);
  expect(p.temperature).toBe(0.7);
  expect(p.messages[0].content).toMatch(/^You are the NIETE Teaching Assistant/);
  expect(p.messages[1].content[1].image_url.detail).toBe('low');
});

test('the coaching photo pass options reach the request, with a time budget and no SDK retries', async () => {
  await analyzeImage(IMG, 'image/jpeg', {
    prompt: 'p', detail: 'high', systemPrompt: 'observer', temperature: 0, maxTokens: 1500,
    responseFormat: { type: 'json_object' }, timeoutMs: 30000,
  });
  const [p, requestOptions] = mockCalls[0];
  expect(p.messages[0].content).toBe('observer');
  expect(p.temperature).toBe(0);
  expect(p.max_tokens).toBe(1500);
  expect(p.response_format).toEqual({ type: 'json_object' });
  expect(p.messages[1].content[1].image_url.detail).toBe('high');
  expect(requestOptions).toEqual({ timeout: 30000, maxRetries: 0 });
});
