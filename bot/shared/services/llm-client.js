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
 * Direct-to-Anthropic lane (bd-yoc6i).
 *
 * A model id prefixed `anthropic-direct/` is billed against ANTHROPIC_API_KEY
 * (the credit grant) instead of the OpenRouter balance. It is a PER-MODEL seam,
 * not a global provider switch, because `LLM_PROVIDER` is process-wide and we
 * need one lane on the grant while another stays on OpenRouter — at prod
 * go-live, coaching can move to the grant while the staging 6-12 pilot keeps
 * running deepseek-flash through OpenRouter.
 *
 * The endpoint is Anthropic's OpenAI-compatible surface, so the existing SDK,
 * call sites and response shape are unchanged. Verified live 2026-09-03: both
 * this endpoint and the native /v1/messages returned 200 for claude-sonnet-5.
 *
 * OFF UNTIL A MODEL ID SAYS OTHERWISE. Nothing routes here by the mere presence
 * of the key — activation is naming a prefixed model in config.
 */
const ANTHROPIC_DIRECT_PREFIX = 'anthropic-direct/';
const ANTHROPIC_BASE_URL = 'https://api.anthropic.com/v1/';

let _client = null;
let _anthropicDirectClient = null;

/**
 * Create a new LLM client configured for the current provider.
 * For OpenRouter, wraps chat.completions.create to auto-prefix model names.
 */
function createLLMClient() {
  if (PROVIDER === 'openai') {
    // Direct OpenAI — no baseURL override
    return new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }

  // Default: OpenRouter — uses OpenAI-compatible API
  const client = new OpenAI({
    apiKey: process.env.OPENROUTER_API_KEY,
    baseURL: OPENROUTER_BASE_URL,
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
    // Staging-only record/replay of every non-streaming completion (E2E_CASSETTE=replay|record).
    // Off by default and forced off against the production DB — see e2e-cassette.js.
    const cassette = require('./e2e-cassette');
    if (cassette.mode() !== 'off') cassette.wrapChatCompletions(_client);
  }
  return _client;
}

/**
 * Get a singleton client for the direct-Anthropic lane.
 *
 * The key is read at CALL time, not at module load, so a process that is
 * configured after require() still works and so a test can assert the
 * missing-key behaviour without reloading the module.
 */
function getAnthropicDirectClient() {
  const apiKey = (process.env.ANTHROPIC_API_KEY || '').trim();
  if (!apiKey) {
    // A THROW, not a fallback to OpenRouter. Falling back would spend the wrong
    // budget and — worse — mislabel every measurement taken in that window: a run
    // recorded as "on the grant" would actually be OpenRouter. Naming the missing
    // variable is the whole value of this error.
    throw new Error(
      'llm-client: a model was requested on the direct-Anthropic lane ' +
      `("${ANTHROPIC_DIRECT_PREFIX}…") but ANTHROPIC_API_KEY is not set. ` +
      'Set it, or use an OpenRouter model id without the prefix.'
    );
  }
  if (!_anthropicDirectClient) {
    _anthropicDirectClient = new OpenAI({ apiKey, baseURL: ANTHROPIC_BASE_URL });
  }
  return _anthropicDirectClient;
}

/**
 * Resolve the client AND the model id to send, for one model.
 *
 * Returns `{ client, model }`. The caller must use the RETURNED model id: the
 * `anthropic-direct/` prefix is our routing token and Anthropic 404s on it.
 *
 * An unprefixed id is returned untouched on the shared OpenRouter client, so
 * every existing caller keeps its current behaviour.
 */
function getClientForModel(model) {
  const id = String(model || '');
  if (id.startsWith(ANTHROPIC_DIRECT_PREFIX)) {
    return {
      client: getAnthropicDirectClient(),
      model: id.slice(ANTHROPIC_DIRECT_PREFIX.length),
    };
  }
  return { client: getClient(), model: id };
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
    // Lets a health check answer "is the grant wired?" without spending a call.
    // Reports CONFIGURED, not IN USE — nothing routes to the grant until a model
    // id carries the prefix.
    anthropicDirectConfigured: Boolean((process.env.ANTHROPIC_API_KEY || '').trim()),
  };
}

module.exports = {
  createLLMClient,
  getClient,
  getClientForModel,
  getDefaultModel,
  getProviderInfo,
  ANTHROPIC_DIRECT_PREFIX,
};
