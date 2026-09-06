/**
 * bd-v60qf — llm-client per-call timeout + maxRetries, wiring half.
 *
 * THE DEFECT: `llm-client.js` builds three `new OpenAI({...})` clients —
 * OpenAI-direct and OpenRouter-default inside `createLLMClient()`, and the
 * anthropic-direct lane inside `getAnthropicDirectClient()` (reached via
 * `getClientForModel()`) — and passes neither `timeout` nor `maxRetries`.
 * The installed openai SDK then falls through to ITS OWN defaults:
 * `timeout: 600000` (10 min) and `maxRetries: 2` (3 attempts). The lp612
 * author ladder makes up to 5 calls inside a 14-minute job budget
 * (LP612_AUTHOR_TIMEOUT_MS=840000), so one stalled call can burn ~30
 * minutes — more than 2x the whole job budget.
 *
 * THE FIX: every client this module builds gets an explicit
 * `timeout: 180000` (180s — ~2x the measured p90 healthy call of ~85s) and
 * `maxRetries: 1` (2 attempts total), each overridable via
 * `LLM_REQUEST_TIMEOUT_MS` / `LLM_MAX_RETRIES` and parsed defensively:
 * missing / blank / non-numeric / <=0 all fall back to the default.
 *
 * This file is the WIRING half — it proves the right numbers reach the SDK
 * constructor for all three construction sites, using the repo's existing
 * constructor-capturing `jest.mock('openai')` pattern (see
 * tests/unit/llm-client-anthropic-direct.test.js and
 * tests/unit/sprint-1/openrouter-llm.test.js). Wiring alone is NOT
 * sufficient proof per root CLAUDE.md Rule 6 — the companion file
 * tests/unit/llm-client-timeout-behavior.test.js exercises the REAL SDK
 * against a hung network call and is the one that actually runs the
 * changed line's effect.
 */

const path = require('path');

const LLM_CLIENT = path.resolve(__dirname, '../../bot/shared/services/llm-client.js');

// Constructor-capturing mock: each instantiation keeps the config it was
// handed, so the timeout/maxRetries actually passed to the SDK is assertable
// without a network call or a real client instance.
jest.mock('openai', () =>
  jest.fn(function OpenAIStub(config) {
    return {
      _config: config,
      chat: { completions: { create: jest.fn(async () => ({ choices: [] })) } },
    };
  })
);

jest.mock('../../bot/shared/services/e2e-cassette', () => ({
  mode: () => 'off',
  wrapChatCompletions: jest.fn(),
}));

const ENV_KEYS = [
  'LLM_PROVIDER',
  'OPENAI_API_KEY',
  'OPENROUTER_API_KEY',
  'ANTHROPIC_API_KEY',
  'LLM_REQUEST_TIMEOUT_MS',
  'LLM_MAX_RETRIES',
];

/** Load a pristine copy of the module under a given env (mirrors the sibling suite's `load()`). */
function load(env = {}) {
  jest.resetModules();
  for (const k of ENV_KEYS) delete process.env[k];
  process.env.OPENROUTER_API_KEY = 'test-openrouter-key';
  process.env.OPENAI_API_KEY = 'test-openai-key';
  process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
  Object.assign(process.env, env);
  // eslint-disable-next-line global-require
  return require(LLM_CLIENT);
}

describe('bd-v60qf — llm-client timeout/maxRetries wiring', () => {
  const OLD_ENV = { ...process.env };

  afterEach(() => {
    process.env = { ...OLD_ENV };
    jest.resetModules();
  });

  test('createLLMClient() on the OpenRouter (default) lane passes timeout:180000 / maxRetries:1 to the SDK', () => {
    const mod = load();
    const client = mod.createLLMClient();
    expect(client._config.timeout).toBe(180000);
    expect(client._config.maxRetries).toBe(1);
  });

  test('createLLMClient() on the OpenAI-direct lane (LLM_PROVIDER=openai) passes the same defaults', () => {
    const mod = load({ LLM_PROVIDER: 'openai' });
    const client = mod.createLLMClient();
    expect(client._config.timeout).toBe(180000);
    expect(client._config.maxRetries).toBe(1);
  });

  test('getClientForModel() on the anthropic-direct lane passes the same defaults', () => {
    const mod = load();
    const { client } = mod.getClientForModel(`${mod.ANTHROPIC_DIRECT_PREFIX}claude-sonnet-5`);
    expect(client._config.timeout).toBe(180000);
    expect(client._config.maxRetries).toBe(1);
  });

  test('LLM_REQUEST_TIMEOUT_MS and LLM_MAX_RETRIES env overrides reach the SDK', () => {
    const mod = load({ LLM_REQUEST_TIMEOUT_MS: '5000', LLM_MAX_RETRIES: '3' });
    const client = mod.createLLMClient();
    expect(client._config.timeout).toBe(5000);
    expect(client._config.maxRetries).toBe(3);
  });

  test.each([
    ['unset', undefined],
    ['blank', ''],
    ['whitespace', '   '],
    ['non-numeric', 'not-a-number'],
    ['zero', '0'],
    ['negative', '-50'],
  ])('LLM_REQUEST_TIMEOUT_MS %s falls back to the 180000ms default (do not let parseInt reach the SDK)', (_label, raw) => {
    const mod = load(raw === undefined ? {} : { LLM_REQUEST_TIMEOUT_MS: raw });
    expect(mod.createLLMClient()._config.timeout).toBe(180000);
  });

  test.each([
    ['unset', undefined],
    ['blank', ''],
    ['non-numeric', 'garbage'],
    ['zero', '0'],
    ['negative', '-1'],
  ])('LLM_MAX_RETRIES %s falls back to the default of 1', (_label, raw) => {
    const mod = load(raw === undefined ? {} : { LLM_MAX_RETRIES: raw });
    expect(mod.createLLMClient()._config.maxRetries).toBe(1);
  });

  test('the anthropic-direct client and the OpenRouter client each get their own timeout/maxRetries — this fix must not disturb bd-yoc6i routing', () => {
    const mod = load({ LLM_REQUEST_TIMEOUT_MS: '9000', LLM_MAX_RETRIES: '2' });
    const direct = mod.getClientForModel(`${mod.ANTHROPIC_DIRECT_PREFIX}claude-sonnet-5`).client;
    const router = mod.getClientForModel('deepseek/deepseek-v4-flash').client;

    expect(direct).not.toBe(router);
    expect(direct._config.timeout).toBe(9000);
    expect(router._config.timeout).toBe(9000);
    expect(direct._config.baseURL).toBe('https://api.anthropic.com/v1/');
    expect(router._config.baseURL).toBe('https://openrouter.ai/api/v1');
  });
});
