'use strict';
/**
 * bd-gzfdu9 — GPT5MiniService.completeJson gains an OPTIONAL reasoningEffort (lead-converge 18:48Z): gpt-5-mini spent
 * 2,045–2,823 hidden reasoning tokens and 22–33 s on a 6-way clip choice. Sent to the provider only when set: every
 * other consumer's request is byte-identical.
 */
const mockCreate = jest.fn(async () => ({ choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }], usage: {} }));
jest.mock('../../../bot/shared/services/llm-client', () => ({ getClient: () => ({ chat: { completions: { create: (...a) => mockCreate(...a) } } }) }));

const G = require('../../../bot/shared/services/gpt5-mini.service');

beforeEach(() => mockCreate.mockClear());

test('without reasoningEffort the request is exactly today\'s', async () => {
  await G.completeJson('Return JSON', { job: 'coaching.completeJson', maxTokens: 500 });
  const req = mockCreate.mock.calls[0][0];
  expect(Object.keys(req)).toEqual(['model', 'job', 'messages', 'max_completion_tokens', 'response_format']);
  expect(req).toMatchObject({ job: 'coaching.completeJson', max_completion_tokens: 500, response_format: { type: 'json_object' } });
});

test('with reasoningEffort it is sent as reasoning_effort, nothing else changes', async () => {
  await G.completeJson('Return JSON', { job: 'coaching.videoReco', maxTokens: 4000, reasoningEffort: 'low' });
  const req = mockCreate.mock.calls[0][0];
  expect(Object.keys(req)).toEqual(['model', 'job', 'messages', 'max_completion_tokens', 'response_format', 'reasoning_effort']);
  expect(req.reasoning_effort).toBe('low');
});
