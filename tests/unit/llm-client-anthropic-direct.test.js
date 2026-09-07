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
 * REBUILT 2026-09-07 (bd-oak77.29). The lane still routes by the SAME prefix and is still
 * explicit-opt-in-only — the properties this file was written to protect are unchanged and are
 * still asserted below. What changed is the CLIENT: the OpenAI SDK pointed at Anthropic's
 * OpenAI-compatibility endpoint could not do prompt caching (it accepts `cache_control` with
 * HTTP 200 and silently ignores it, returning no cache fields at all), and caching is live on
 * production saving 38.3% per lesson. So the lane is now `@anthropic-ai/sdk` on `/v1/messages`,
 * behind a facade that keeps the `chat.completions.create` shape. The mechanism assertions below
 * moved with it; the routing assertions did not.
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

// The direct lane's real client, stubbed the same way.
jest.mock('@anthropic-ai/sdk', () =>
  jest.fn(function AnthropicStub(config) {
    return {
      _config: config,
      messages: {
        create: jest.fn(async () => ({
          content: [{ type: 'text', text: '' }], model: 'claude-sonnet-5',
          stop_reason: 'end_turn', usage: {},
        })),
      },
    };
  })
);

// Staging-only record/replay machinery — inert here so this suite tests routing only.
jest.mock('../../bot/shared/services/e2e-cassette', () => ({
  mode: () => 'off',
  wrapChatCompletions: jest.fn(),
}), { virtual: true });

// `virtual: true` because `e2e-cassette.js` exists on `develop` but NOT on `main` — the lp612
// extraction left it behind. Without it this file cannot be cherry-picked to prod at all: jest
// resolves a mocked path even when a factory is supplied, and a MODULE_NOT_FOUND here would fail
// the whole suite for a module the test never uses.

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';
// No trailing `/v1/`: `@anthropic-ai/sdk` appends `/v1/messages` itself.
const ANTHROPIC_BASE = 'https://api.anthropic.com';

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

    const { model } = mod.getClientForModel('anthropic-direct/claude-sonnet-5');
    const sdk = mod.getAnthropicDirectClient();

    expect(sdk._config.baseURL).toBe(ANTHROPIC_BASE);
    expect(sdk._config.apiKey).toBe('test-grant-key');
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
    expect(mod.getAnthropicDirectClient()._config.baseURL).toBe(ANTHROPIC_BASE);
    expect(router._config.baseURL).toBe(OPENROUTER_BASE);
  });

  test('the direct HTTP client is a singleton — repeated calls do not build a new one per request', () => {
    const mod = load({ ANTHROPIC_API_KEY: 'test-grant-key', OPENROUTER_API_KEY: 'test-or-key' });

    mod.getClientForModel('anthropic-direct/claude-sonnet-5');
    mod.getClientForModel('anthropic-direct/claude-haiku-4-5');

    // The per-call object IS new each time by design — it closes over the correlationId and stage
    // that make a provider fallback traceable, and costs three closures beside a 60-second model
    // call. The thing that must not be rebuilt is the HTTP client underneath it.
    // eslint-disable-next-line global-require
    const AnthropicCtor = require('@anthropic-ai/sdk');
    expect(AnthropicCtor).toHaveBeenCalledTimes(1);
    expect(mod.getAnthropicDirectClient()).toBe(mod.getAnthropicDirectClient());
  });

  test('getClient() is unchanged — existing consumers keep the OpenRouter singleton', () => {
    const mod = load({ ANTHROPIC_API_KEY: 'test-grant-key', OPENROUTER_API_KEY: 'test-or-key' });

    expect(mod.getClient()._config.baseURL).toBe(OPENROUTER_BASE);
  });

  test('the OpenRouter bare-name auto-prefix must NOT be applied to a direct-Anthropic model', async () => {
    const mod = load({ ANTHROPIC_API_KEY: 'test-grant-key', OPENROUTER_API_KEY: 'test-or-key' });

    // 'claude-sonnet-5' has no slash. On the OpenRouter client that would be
    // rewritten to 'openai/claude-sonnet-5'; on the direct lane it must stay put — and it must
    // reach `/v1/messages` as the model, since Anthropic 404s on our routing prefix.
    const { client, model } = mod.getClientForModel('anthropic-direct/claude-sonnet-5');
    await client.chat.completions.create({ model, max_tokens: 16, messages: [] });

    expect(mod.getAnthropicDirectClient().messages.create).toHaveBeenCalledWith(
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

/**
 * HAZARD GUARD (raised by the bake-off lane, 2026-09-03).
 *
 * Their runner auto-detected ANTHROPIC_API_KEY from the environment and silently
 * rerouted to api.anthropic.com — so results produced on Anthropic were SCORED AS
 * OPENROUTER until an explicit backend pin was added. The cost was not the
 * routing; it was a set of measurements labelled with the wrong provider.
 *
 * This lane must never be able to do that. Routing here is EXPLICIT OPT-IN by
 * model id, and key presence is not a signal. These tests exist to make that
 * property hard to delete by accident.
 */
describe('bd-yoc6i — key presence is NOT a routing signal (explicit opt-in only)', () => {
  test('setting ANTHROPIC_API_KEY changes NOTHING about default routing', () => {
    const without = load({ OPENROUTER_API_KEY: 'test-or-key' });
    const baseline = {
      provider: without.getProviderInfo().provider,
      baseURL: without.getProviderInfo().baseURL,
      model: without.getDefaultModel(),
      clientBase: without.getClient()._config.baseURL,
    };

    const with_ = load({ OPENROUTER_API_KEY: 'test-or-key', ANTHROPIC_API_KEY: 'test-grant-key' });
    const after = {
      provider: with_.getProviderInfo().provider,
      baseURL: with_.getProviderInfo().baseURL,
      model: with_.getDefaultModel(),
      clientBase: with_.getClient()._config.baseURL,
    };

    // Byte-for-byte identical. The ONLY thing the key may change is the
    // `anthropicDirectConfigured` advertisement, which is asserted separately and
    // reports CONFIGURED, never IN USE.
    expect(after).toEqual(baseline);
    expect(after.clientBase).toBe(OPENROUTER_BASE);
  });

  test('every model id shape still routes to OpenRouter when only the key is present', () => {
    const mod = load({ OPENROUTER_API_KEY: 'test-or-key', ANTHROPIC_API_KEY: 'test-grant-key' });

    for (const id of [
      'anthropic/claude-sonnet-5',   // an Anthropic model — still OpenRouter
      'claude-sonnet-5',             // a bare Anthropic-looking id
      'deepseek/deepseek-v4-flash',
      'openai/gpt-4o',
    ]) {
      const { client, model } = mod.getClientForModel(id);
      expect(client._config.baseURL).toBe(OPENROUTER_BASE);
      expect(model).toBe(id);
    }
  });

  test('the ONLY thing that routes to the grant is the explicit prefix', () => {
    const mod = load({ OPENROUTER_API_KEY: 'test-or-key', ANTHROPIC_API_KEY: 'test-grant-key' });

    expect(mod.getClientForModel('anthropic/claude-sonnet-5').client._config.baseURL)
      .toBe(OPENROUTER_BASE);
    mod.getClientForModel('anthropic-direct/claude-sonnet-5');
    expect(mod.getAnthropicDirectClient()._config.baseURL).toBe(ANTHROPIC_BASE);
    // And the prefix is the documented constant, not a stringly-typed guess.
    expect(mod.ANTHROPIC_DIRECT_PREFIX).toBe('anthropic-direct/');
  });
});
