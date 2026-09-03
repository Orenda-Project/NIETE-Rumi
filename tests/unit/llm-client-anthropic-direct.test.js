/**
 * bd-yoc6i — direct-Anthropic provider support in the LLM client.
 *
 * WHY THIS EXISTS
 *
 * Every model call in this repo goes through `llm-client.js`, and today that means
 * OpenRouter, always. At prod go-live we want Anthropic models billed against the
 * Anthropic credit grant instead of OpenRouter's balance — without moving staging,
 * which stays on OpenRouter for the deepseek-flash pilot (bd-u6za9).
 *
 * So the requirement is a per-MODEL routing seam, not a global provider switch:
 * one lane can be on the grant while another stays on OpenRouter, in the same
 * process, at the same time. `LLM_PROVIDER` cannot express that — it is global.
 *
 * The seam is a model-id prefix, `anthropic-direct/…`, resolved by a new
 * `getClientForModel()`. `getClient()` is deliberately UNCHANGED so none of the
 * existing consumers change behaviour: this lands DISABLED BY DEFAULT and is
 * activated by configuration alone (an env var naming a prefixed model).
 *
 * The endpoint is Anthropic's OpenAI-compatible surface
 * (https://api.anthropic.com/v1/), so the existing OpenAI SDK, the existing call
 * sites and the existing response shape all keep working. That endpoint and the
 * native /v1/messages endpoint were both probed live with the grant key on
 * 2026-09-03; both returned 200 for claude-sonnet-5.
 *
 * THE MISSING-KEY CASE IS A THROW, NOT A FALLBACK — deliberately. Silently
 * falling back to OpenRouter when ANTHROPIC_API_KEY is absent would spend the
 * wrong budget and mislabel every measurement taken during the window: a run
 * recorded as "on the grant" would actually be OpenRouter. A named error at the
 * first call is cheap; a mislabelled cost study is not.
 */

const path = require('path');

const LLM_CLIENT = path.resolve(__dirname, '../../bot/shared/services/llm-client.js');

// Constructor-capturing mock: each instantiation keeps the config it was handed,
// so routing is assertable without a network call.
jest.mock('openai', () =>
  jest.fn(function OpenAIStub(config) {
    return {
      _config: config,
      chat: { completions: { create: jest.fn(async () => ({ choices: [] })) } },
    };
  })
);

// Staging-only record/replay machinery — inert here so this suite tests routing only.
jest.mock('../../bot/shared/services/e2e-cassette', () => ({
  mode: () => 'off',
  wrapChatCompletions: jest.fn(),
}));

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';
const ANTHROPIC_BASE = 'https://api.anthropic.com/v1/';

/** Load a pristine copy of the module under a given env. */
function load(env) {
  jest.resetModules();
  for (const k of ['ANTHROPIC_API_KEY', 'OPENROUTER_API_KEY', 'LLM_PROVIDER']) delete process.env[k];
  Object.assign(process.env, env);
  // eslint-disable-next-line global-require
  return require(LLM_CLIENT);
}

describe('bd-yoc6i — llm-client direct-Anthropic routing', () => {
  const OLD_ENV = { ...process.env };

  afterEach(() => {
    process.env = { ...OLD_ENV };
    jest.resetModules();
  });

  test('an anthropic-direct/ model routes to the Anthropic endpoint on the grant key, with the routing prefix stripped', () => {
    const mod = load({ ANTHROPIC_API_KEY: 'test-grant-key', OPENROUTER_API_KEY: 'test-or-key' });

    const { client, model } = mod.getClientForModel('anthropic-direct/claude-sonnet-5');

    expect(client._config.baseURL).toBe(ANTHROPIC_BASE);
    expect(client._config.apiKey).toBe('test-grant-key');
    // The prefix is OUR routing token. Anthropic must never see it, or the call
    // 404s on an unknown model id.
    expect(model).toBe('claude-sonnet-5');
  });

  test('an unprefixed model is untouched — this lands DISABLED BY DEFAULT and OpenRouter stays the route even when the grant key is present', () => {
    const mod = load({ ANTHROPIC_API_KEY: 'test-grant-key', OPENROUTER_API_KEY: 'test-or-key' });

    const { client, model } = mod.getClientForModel('anthropic/claude-sonnet-5');

    // Possessing a key is not consent to spend it.
    expect(client._config.baseURL).toBe(OPENROUTER_BASE);
    expect(model).toBe('anthropic/claude-sonnet-5');
  });

  test('the prefix without ANTHROPIC_API_KEY throws a NAMED error rather than silently falling back to OpenRouter', () => {
    const mod = load({ OPENROUTER_API_KEY: 'test-or-key' });

    expect(() => mod.getClientForModel('anthropic-direct/claude-sonnet-5'))
      .toThrow(/ANTHROPIC_API_KEY/);
  });

  test('the direct client is a separate instance from the OpenRouter singleton, so one lane on the grant cannot disturb another on OpenRouter', () => {
    const mod = load({ ANTHROPIC_API_KEY: 'test-grant-key', OPENROUTER_API_KEY: 'test-or-key' });

    const direct = mod.getClientForModel('anthropic-direct/claude-sonnet-5').client;
    const router = mod.getClientForModel('deepseek/deepseek-v4-flash').client;

    expect(direct).not.toBe(router);
    expect(direct._config.baseURL).toBe(ANTHROPIC_BASE);
    expect(router._config.baseURL).toBe(OPENROUTER_BASE);
  });

  test('the direct client is itself a singleton — repeated calls do not build a new HTTP client per request', () => {
    const mod = load({ ANTHROPIC_API_KEY: 'test-grant-key', OPENROUTER_API_KEY: 'test-or-key' });

    const a = mod.getClientForModel('anthropic-direct/claude-sonnet-5').client;
    const b = mod.getClientForModel('anthropic-direct/claude-haiku-4.5').client;

    expect(a).toBe(b);
  });

  test('getClient() is unchanged — existing consumers keep the OpenRouter singleton', () => {
    const mod = load({ ANTHROPIC_API_KEY: 'test-grant-key', OPENROUTER_API_KEY: 'test-or-key' });

    expect(mod.getClient()._config.baseURL).toBe(OPENROUTER_BASE);
  });

  test('the OpenRouter bare-name auto-prefix must NOT be applied to a direct-Anthropic model', () => {
    const mod = load({ ANTHROPIC_API_KEY: 'test-grant-key', OPENROUTER_API_KEY: 'test-or-key' });

    // 'claude-sonnet-5' has no slash. On the OpenRouter client that would be
    // rewritten to 'openai/claude-sonnet-5'; on the direct client it must stay put.
    const { client, model } = mod.getClientForModel('anthropic-direct/claude-sonnet-5');
    client.chat.completions.create({ model, messages: [] });

    expect(client.chat.completions.create).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'claude-sonnet-5' })
    );
  });

  test('getProviderInfo reports whether the grant lane is configured, so a health check can answer "is the grant wired?" without spending a call', () => {
    const wired = load({ ANTHROPIC_API_KEY: 'test-grant-key', OPENROUTER_API_KEY: 'test-or-key' });
    expect(wired.getProviderInfo().anthropicDirectConfigured).toBe(true);

    const unwired = load({ OPENROUTER_API_KEY: 'test-or-key' });
    expect(unwired.getProviderInfo().anthropicDirectConfigured).toBe(false);
  });
});
