/**
 * LLM Client Factory
 *
 * Provides a unified interface to LLM providers using the OpenAI SDK.
 * Default: OpenRouter (one key for 500+ models).
 * Override: Direct OpenAI (set LLM_PROVIDER=openai + OPENAI_API_KEY).
 *
 * When using OpenRouter, model names are auto-prefixed with 'openai/' if no
 * provider prefix is present (e.g. 'gpt-4o-mini' → 'openai/gpt-4o-mini').
 * This means existing code can use bare OpenAI model names unchanged.
 *
 * Usage:
 *   const { getClient, getDefaultModel } = require('./llm-client');
 *   const client = getClient();
 *   const response = await client.chat.completions.create({
 *     model: 'gpt-4o-mini',  // auto-prefixed to 'openai/gpt-4o-mini' on OpenRouter
 *     messages: [{ role: 'user', content: 'Hello' }],
 *   });
 */

const OpenAI = require('openai');

const PROVIDER = (process.env.LLM_PROVIDER || 'openrouter').toLowerCase();
const DEFAULT_MODEL = process.env.LLM_MODEL || 'openai/gpt-4o';
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

/**
 * Per-call timeout + retry budget.
 *
 * Every client this module builds used to omit BOTH `timeout` and
 * `maxRetries`, so the openai SDK applied its own defaults: a 600000ms
 * (10 min) timeout and maxRetries: 2 (3 attempts). The lp612 author ladder
 * makes up to 5 calls inside a 14-minute job budget
 * (LP612_AUTHOR_TIMEOUT_MS=840000) — one stalled call could burn ~30
 * minutes, more than 2x the whole job, with `withTimeout(840s)` left as the
 * only effective bound and every remaining ladder round silently sacrificed.
 *
 * 180000ms (180s) is ~2x the measured p90 healthy call (~85s; round-0 p50
 * 72.3s / p90 85.3s, revision calls p50 ~56s, measured against a 6-12
 * lesson-plan simulation run) — generous enough that it never truncates a
 * slow-but-working call, while keeping 5 rounds x 180s = 900s worst case
 * bounded and comparable to the job budget instead of 30 minutes.
 * maxRetries: 1 (2 attempts total) halves the SDK's own default retry
 * budget for the same reason.
 *
 * Both are read at CALL time (inside the two functions below), matching the
 * anthropic-direct API-key comment further down: a value parsed once at
 * module load would be immune to a test (or a runtime env change) made
 * after require().
 */
const DEFAULT_REQUEST_TIMEOUT_MS = 180000;
const DEFAULT_MAX_RETRIES = 1;

/**
 * Parse an env var as a positive integer, falling back to `fallback` for
 * anything that isn't one: missing, blank/whitespace, non-numeric, zero, or
 * negative. `parseInt('', 10)` is `NaN` — that must never reach the SDK as
 * a `timeout`/`maxRetries` value (NaN silently disables the SDK's own
 * validation and produces undefined-ish behaviour).
 */
function _resolvePositiveIntEnv(envValue, fallback) {
  const n = parseInt(envValue, 10);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

function resolveRequestTimeoutMs() {
  return _resolvePositiveIntEnv(process.env.LLM_REQUEST_TIMEOUT_MS, DEFAULT_REQUEST_TIMEOUT_MS);
}

function resolveMaxRetries() {
  return _resolvePositiveIntEnv(process.env.LLM_MAX_RETRIES, DEFAULT_MAX_RETRIES);
}


let _client = null;

/**
 * Create a new LLM client configured for the current provider.
 * For OpenRouter, wraps chat.completions.create to auto-prefix model names.
 */
function createLLMClient() {
  if (PROVIDER === 'openai') {
    // Direct OpenAI — no baseURL override
    return new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      timeout: resolveRequestTimeoutMs(),
      maxRetries: resolveMaxRetries(),
    });
  }

  // Default: OpenRouter — uses OpenAI-compatible API
  const client = new OpenAI({
    apiKey: process.env.OPENROUTER_API_KEY,
    baseURL: OPENROUTER_BASE_URL,
    timeout: resolveRequestTimeoutMs(),
    maxRetries: resolveMaxRetries(),
    defaultHeaders: {
      'HTTP-Referer': process.env.APP_URL || '',
      'X-Title': 'Rumi Teaching Assistant',
    },
  });

  // Auto-prefix model names for OpenRouter (e.g. 'gpt-4o-mini' → 'openai/gpt-4o-mini')
  const originalCreate = client.chat.completions.create.bind(client.chat.completions);
  client.chat.completions.create = (params, options) => {
    if (params.model && !params.model.includes('/')) {
      params = { ...params, model: `openai/${params.model}` };
    }
    return originalCreate(params, options);
  };

  return client;
}

/**
 * Get a singleton LLM client instance.
 */
function getClient() {
  if (!_client) {
    _client = createLLMClient();
  }
  return _client;
}

/**
 * Get the default model name.
 */
function getDefaultModel() {
  return DEFAULT_MODEL;
}

/**
 * Get current provider info (for diagnostics/health checks).
 */
function getProviderInfo() {
  return {
    provider: PROVIDER,
    model: DEFAULT_MODEL,
    baseURL: PROVIDER === 'openrouter' ? OPENROUTER_BASE_URL : 'https://api.openai.com/v1',
  };
}

module.exports = {
  createLLMClient,
  getClient,
  getDefaultModel,
  getProviderInfo,
};
