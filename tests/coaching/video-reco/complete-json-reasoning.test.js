'use strict';
/**
 * bd-gzfdu9 — GPT5MiniService.completeJson gains an OPTIONAL reasoningEffort (lead-converge 18:48Z): gpt-5-mini spent
 * 2,045–2,823 hidden reasoning tokens and 17–33 s on a 6-way clip choice. Sent only when set, in the shape the repo
 * already sends through OpenRouter (`reasoning: { effort }`, fidelity-analyzer.js:152). Every other consumer's request
 * body is byte-identical to origin/sandbox's (COS 19:05Z; root CLAUDE.md rule 10): the snapshot below is the body the
 * code on origin/sandbox builds, and this file was run against that file before the change.
 */
const mockCreate = jest.fn(async () => ({ choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }], usage: {} }));
jest.mock('../../../bot/shared/services/llm-client', () => ({ getClient: () => ({ chat: { completions: { create: (...a) => mockCreate(...a) } } }) }));

const G = require('../../../bot/shared/services/gpt5-mini.service');
const { modelFor } = require('../../../bot/shared/config/model-registry');

beforeEach(() => mockCreate.mockClear());

test.each([
  ['coaching.observeDebrief', { job: 'coaching.observeDebrief', maxTokens: 1200, label: 'debriefGuide' }],
  ['coaching.classCheck', { job: 'coaching.classCheck', maxTokens: 300 }],
  ['coaching.completeJson (no job)', {}],
])('an existing consumer (%s): the request body is byte-identical to origin/sandbox', async (_, opts) => {
  await G.completeJson('Return JSON for this lesson', opts);
  const job = opts.job || 'coaching.completeJson';
  const expected = {
    model: modelFor(job),
    job,
    messages: [{ role: 'user', content: 'Return JSON for this lesson' }],
    max_completion_tokens: opts.maxTokens || 4000,
    response_format: { type: 'json_object' },
  };
  expect(JSON.stringify(mockCreate.mock.calls[0][0])).toBe(JSON.stringify(expected));
});

test('with reasoningEffort the request carries reasoning: { effort }, nothing else changes', async () => {
  await G.completeJson('Return JSON', { job: 'coaching.videoReco', maxTokens: 4000, reasoningEffort: 'low' });
  const req = mockCreate.mock.calls[0][0];
  expect(Object.keys(req)).toEqual(['model', 'job', 'messages', 'max_completion_tokens', 'response_format', 'reasoning']);
  expect(req.reasoning).toEqual({ effort: 'low' });
});
