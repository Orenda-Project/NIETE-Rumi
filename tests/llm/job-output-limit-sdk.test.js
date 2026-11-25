/**
 * bd-lk7e3f.26 — the real Anthropic SDK accepts the enhancement's 32,000-token limit on the direct lane.
 *
 * The SDK refuses a NON-STREAMING request whose max_tokens implies more than ten minutes of generation (above about
 * 21,333 tokens) unless a timeout is stated, and it refuses before any network call. The direct lane states one (the
 * 180 s per-call budget, llm-client.js getAnthropicDirectClient), so a 32,000-token request must reach the network.
 * This file uses the real SDK (no mock of it); the network itself is replaced by a fetch that records and refuses.
 */
jest.mock('../../bot/shared/config/supabase', () => ({
  from: () => ({ select: () => ({ in: async () => ({ data: [], error: null }) }) }),
}));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: () => {}, getCurrentCorrelationId: () => 'corr-1' }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: () => {} }));
jest.mock('../../bot/shared/services/e2e-cassette', () => ({ mode: () => 'off', wrapChatCompletions: () => {} }));

const OLD_ENV = { ...process.env };
afterEach(() => { process.env = { ...OLD_ENV }; });

const body = (maxTokens) => ({
  model: 'claude-haiku-5-5', max_tokens: maxTokens, messages: [{ role: 'user', content: 'hello' }],
});

test('the direct lane client sends a 32,000-token request to the network (the SDK does not refuse it first)', async () => {
  jest.resetModules();
  process.env.ANTHROPIC_API_KEY = 'test-key';
  // eslint-disable-next-line global-require
  const { getAnthropicDirectClient } = require('../../bot/shared/services/llm-client');
  const client = getAnthropicDirectClient();
  let reached = 0;
  client.fetch = async () => { reached += 1; throw new Error('network reached'); };
  const err = await (async () => client.messages.create(body(32000), { maxRetries: 0 }))().catch((e) => e);
  expect(reached).toBe(1);
  expect(String(err && err.message)).not.toMatch(/Streaming is required/);
});

test('the control: the same SDK with no timeout refuses 32,000 before the network, so the stated timeout is what lets it through', async () => {
  // eslint-disable-next-line global-require
  const Anthropic = require('@anthropic-ai/sdk');
  const Ctor = Anthropic.default || Anthropic;
  const bare = new Ctor({ apiKey: 'test-key' });
  let reached = 0;
  bare.fetch = async () => { reached += 1; throw new Error('network reached'); };
  // The SDK throws this one synchronously, before it returns a promise.
  const err = await (async () => bare.messages.create(body(32000), { maxRetries: 0 }))().catch((e) => e);
  expect(reached).toBe(0);
  expect(String(err && err.message)).toMatch(/Streaming is required/);
});
