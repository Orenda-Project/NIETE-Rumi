/**
 * bd-gk7nrj — a spend limit set in the Anthropic Console falls back to OpenRouter, like an empty
 * balance does, instead of failing the call.
 *
 * When usage reaches a spend limit the organisation set itself, Anthropic answers HTTP 400,
 * `invalid_request_error`, with a message that starts "You have reached your specified API usage
 * limits", or "You have reached your specified workspace API usage limits" for a workspace limit,
 * and says when access resumes. The tier's own monthly cap reads "You have reached your API usage
 * limits: ..." (Anthropic's rate-limits page, read 27 Oct 2026). None of these matched the
 * credit-class pattern, so the direct lane threw: a call site that sends its model straight to the
 * lane (the lesson-plan author, the quiz key check) failed the teacher's request instead of
 * re-issuing it on OpenRouter. The Anthropic credits plan puts a monthly limit on the bot's
 * workspace, so reaching it must cost a few seconds, not the answer.
 *
 * Doubles the network, not the client: the real Anthropic and OpenAI SDKs run over a stubbed fetch.
 */
const mockLogEvent = jest.fn();

jest.mock('../../bot/shared/utils/logger', () => ({
  logToFile: () => {}, logError: jest.fn(), logWarn: jest.fn(),
}));
jest.mock('../../bot/shared/utils/structured-logger', () => ({
  logEvent: (...a) => mockLogEvent(...a), getCurrentCorrelationId: () => undefined,
}));
jest.mock('../../bot/shared/services/e2e-cassette', () => ({
  mode: () => 'off', wrapChatCompletions: jest.fn(),
}));

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

const limitBody = (message) => ({ type: 'error', error: { type: 'invalid_request_error', message } });
const WORKSPACE_LIMIT = 'You have reached your specified workspace API usage limits. You will regain access on 2026-11-01 at 00:00 UTC.';
const ORG_LIMIT = 'You have reached your specified API usage limits. You will regain access on 2026-11-01 at 00:00 UTC.';
const TIER_CAP = "You have reached your API usage limits: your organization has crossed its monthly API usage threshold, set based on your organization's API tier. You will regain access on 2026-11-01 at 00:00 UTC.";

/** What the Anthropic SDK throws for one of these: the status, its own message, and the parsed body. */
const sdkError = (status, message) => Object.assign(
  new Error(`${status} ${JSON.stringify(limitBody(message))}`),
  { status, error: limitBody(message) },
);

const orReply = (text) => ({
  id: 'gen-test',
  choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: text } }],
  usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, cost: 0.001 },
});

function installFetch(route) {
  const seen = [];
  const previous = global.fetch;
  global.fetch = jest.fn(async (url, init) => {
    const u = String(url && url.url ? url.url : url);
    seen.push({ url: u, body: init && init.body ? JSON.parse(init.body) : null });
    const [status, payload] = route(u);
    return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
  });
  return { seen, restore: () => { global.fetch = previous; } };
}

const ENV_KEYS = ['ANTHROPIC_API_KEY', 'OPENROUTER_API_KEY', 'LLM_PROVIDER', 'LLM_MAX_RETRIES', 'LLM_DIRECT_FALLBACK_MODEL', 'E2E_CASSETTE'];

function freshLlmClient() {
  jest.resetModules();
  for (const k of ENV_KEYS) delete process.env[k];
  Object.assign(process.env, { ANTHROPIC_API_KEY: 'test-credit-key', OPENROUTER_API_KEY: 'test-or-key', LLM_MAX_RETRIES: '1' });
  // eslint-disable-next-line global-require
  return require('../../bot/shared/services/llm-client');
}

let restoreFetch;
afterEach(() => {
  if (restoreFetch) { restoreFetch(); restoreFetch = undefined; }
  for (const k of ENV_KEYS) delete process.env[k];
  jest.clearAllMocks();
  jest.resetModules();
});

describe('a spend limit is a credit-class refusal', () => {
  const { isCreditClassError } = require('../../bot/shared/services/anthropic-native-facade');

  test('a workspace limit, an organisation limit and the tier cap all qualify, as the SDK throws them', () => {
    expect(isCreditClassError(sdkError(400, WORKSPACE_LIMIT))).toBe(true);
    expect(isCreditClassError(sdkError(400, ORG_LIMIT))).toBe(true);
    expect(isCreditClassError(sdkError(400, TIER_CAP))).toBe(true);
  });

  test('a malformed request is still not one: switching providers there would hide a bug behind a working answer', () => {
    expect(isCreditClassError(sdkError(400, 'max_tokens: Field required'))).toBe(false);
    expect(isCreditClassError(sdkError(400, 'messages: at least one message is required'))).toBe(false);
  });
});

describe('through the real direct-lane client', () => {
  test('a call refused by the workspace limit is re-issued once on OpenRouter and says so', async () => {
    const net = installFetch((url) => (url === ANTHROPIC_URL ? [400, limitBody(WORKSPACE_LIMIT)] : [200, orReply('{"ok":true}')]));
    restoreFetch = net.restore;
    const mod = freshLlmClient();

    const { client, model } = mod.getClientForModel('anthropic-direct/claude-sonnet-5', { correlationId: 'corr-limit', stage: 'author' });
    const res = await client.chat.completions.create({ model, max_tokens: 1000, messages: [{ role: 'user', content: 'hi' }] });

    expect(net.seen.filter((s) => s.url === OPENROUTER_URL)).toHaveLength(1);
    expect(net.seen.find((s) => s.url === OPENROUTER_URL).body.model).toBe('anthropic/claude-sonnet-5');
    expect(res.choices[0].message.content).toBe('{"ok":true}');
    expect(res.usage.provider_fallback).toBe(true);

    const events = mockLogEvent.mock.calls.filter((c) => c[0] === 'lp612.llm.fallback_provider');
    expect(events).toHaveLength(1);
    expect(events[0][1]).toMatchObject({ correlationId: 'corr-limit', from: 'anthropic-direct/claude-sonnet-5', to: 'anthropic/claude-sonnet-5', status: 400 });
    expect(String(events[0][1].reason)).toMatch(/specified workspace API usage limits/);
  });
});
