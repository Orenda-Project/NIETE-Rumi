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
// bd-oak77.29 — the OFFICIAL Anthropic SDK, for the direct lane only. Required at module
// load (not lazily) so the repo's unresolved-require audit and the boot proof both see it:
// a dependency that only appears on the first cache-enabled author call is a dependency that
// reaches production as a runtime MODULE_NOT_FOUND with a green test suite.
const Anthropic = require('@anthropic-ai/sdk');
const {
  toNativeRequest,
  fromNativeResponse,
  isCreditClassError,
} = require('./anthropic-native-facade');

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


/**
 * Direct-to-Anthropic lane (bd-yoc6i, rebuilt on the official SDK by bd-oak77.29).
 *
 * A model id prefixed `anthropic-direct/` is billed against ANTHROPIC_API_KEY (the prepaid
 * credit) instead of the OpenRouter balance. It is a PER-MODEL seam, not a global provider
 * switch, because `LLM_PROVIDER` is process-wide and we need one lane on the credit while
 * another stays on OpenRouter.
 *
 * WHY THIS IS NO LONGER THE OPENAI SDK. bd-yoc6i pointed the OpenAI SDK at Anthropic's
 * OpenAI-compatibility endpoint so "the existing SDK, call sites and response shape are
 * unchanged". That endpoint CANNOT CACHE: it accepts `cache_control` with HTTP 200 and silently
 * ignores it, and returns no cache fields at all (measured twice — 11_cost/evidence/
 * shim_vs_native.json, 16_direct_lane/evidence/probe_native_cache.txt). Prompt caching is live on
 * production and saving 38.3% per lesson, so routing the author ladder through the shim would
 * have traded a measured saving for the ability to spend credit. The lane is therefore rebuilt on
 * `@anthropic-ai/sdk` against `/v1/messages`, where caching demonstrably works, with
 * `anthropic-native-facade.js` keeping the `chat.completions.create` shape every call site
 * already speaks.
 *
 * OFF UNTIL A MODEL ID SAYS OTHERWISE. Nothing routes here by the mere presence of the key —
 * activation is naming a prefixed model in config, and `LP_AUTHOR_MODEL` is that single switch:
 * `anthropic-direct/claude-sonnet-5` turns it on, `anthropic/claude-sonnet-5` turns it off, with
 * no deploy either way.
 */
const ANTHROPIC_DIRECT_PREFIX = 'anthropic-direct/';
/**
 * NO TRAILING `/v1/`. That path segment belonged to the OpenAI SDK, which appends
 * `chat/completions` to whatever baseURL it is given; `@anthropic-ai/sdk` appends `/v1/messages`
 * itself, so the old constant produced `https://api.anthropic.com/v1/v1/messages` — a 404 on the
 * very first author call. Caught by the network-boundary test, not by inspection, which is the
 * whole reason that test doubles `fetch` instead of the client.
 */
const ANTHROPIC_BASE_URL = 'https://api.anthropic.com';

/**
 * WHERE A CREDIT-EXHAUSTED CALL GOES INSTEAD.
 *
 * The operator is spending a FINITE prepaid balance. When it runs dry, lesson generation must not
 * stop, so the same call is re-issued on OpenRouter. Anthropic's own model ids carry no vendor
 * segment (`claude-sonnet-5`); OpenRouter's are `anthropic/claude-sonnet-5`, so the default
 * mapping is that one prefix. `LLM_DIRECT_FALLBACK_MODEL` overrides it exactly, for a model whose
 * two ids do not line up that way.
 */
const OPENROUTER_ANTHROPIC_PREFIX = 'anthropic/';

function directFallbackModel(directModel) {
  const override = (process.env.LLM_DIRECT_FALLBACK_MODEL || '').trim();
  if (override) return override;
  return OPENROUTER_ANTHROPIC_PREFIX + directModel;
}

/**
 * THE FALLBACK IS NOT OPTIONAL, AND THIS IS WHAT MAKES THAT TRUE IN CODE.
 *
 * The operator's instruction on approving this lane for production was, verbatim, *"Keep the fall
 * back on"*. There is deliberately no flag that turns it off — but "no off switch" is not the same
 * as "cannot be disabled", and the two ways it could quietly stop working are both environmental:
 *
 *   1. `OPENROUTER_API_KEY` absent. `getClient()` would build a client with no key and the first
 *      fallback call would die inside the OpenAI SDK with a message about `OPENAI_API_KEY` — a
 *      confusing error, raised at the worst possible moment, on a lesson a teacher is waiting for.
 *   2. `LLM_PROVIDER=openai`. `getClient()` is then a DIRECT OpenAI client, and the fallback would
 *      post `anthropic/claude-sonnet-5` to api.openai.com and 404. The fallback would fire, fail,
 *      and the lesson would die — the failure mode of a safety net that is present but not
 *      attached to anything.
 *
 * So the lane refuses to start at all unless its net is wired. This runs at RESOLUTION time, before
 * a single token is spent, and it fails CLOSED: a misconfigured deployment cannot author one
 * credit-funded lesson and then strand the next when the balance runs out — it authors none, and
 * says why. Since prod's rollback is `LP_AUTHOR_MODEL=anthropic/claude-sonnet-5`, the cost of this
 * refusal is one variable, and the cost of not having it is a silent lesson failure at 3am.
 */
function assertFallbackUsable(directModel) {
  const to = directFallbackModel(directModel);
  const problems = [];
  if (PROVIDER !== 'openrouter') {
    problems.push(
      `LLM_PROVIDER is "${PROVIDER}", so the OpenRouter client the fallback needs is not the one ` +
      `getClient() builds — "${to}" would be sent to the wrong vendor and 404`);
  }
  if (!(process.env.OPENROUTER_API_KEY || '').trim()) {
    problems.push('OPENROUTER_API_KEY is not set, so the fallback has nothing to fall back to');
  }
  if (problems.length) {
    throw new Error(
      'llm-client: refusing the direct-Anthropic lane because its MANDATORY credit-exhaustion ' +
      `fallback is not usable — ${problems.join('; ')}. ` +
      'Fix the environment, or set LP_AUTHOR_MODEL to an OpenRouter model id.'
    );
  }
}

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
 * Get the singleton `@anthropic-ai/sdk` client for the direct lane.
 *
 * The key is read at CALL time, not at module load, so a process that is configured after
 * require() still works and so a test can assert the missing-key behaviour without reloading the
 * module.
 *
 * `timeout` is passed explicitly for two reasons: it is bd-v60qf's per-call budget, and the
 * Anthropic SDK refuses a NON-STREAMING request whose `max_tokens` implies a long generation
 * unless a timeout is stated. The author asks for 24,000 output tokens, so without this the very
 * first direct-lane call would throw before it reached the network.
 */
function getAnthropicDirectClient() {
  const apiKey = (process.env.ANTHROPIC_API_KEY || '').trim();
  if (!apiKey) {
    // A THROW, not a fallback to OpenRouter. Falling back HERE would spend the wrong budget and —
    // worse — mislabel every measurement taken in that window: a run recorded as "on the credit"
    // would actually be OpenRouter. Naming the missing variable is the whole value of this error.
    //
    // This is NOT the credit-exhaustion fallback below, and the two must not be confused: a
    // MISSING key is a misconfiguration nobody meant, and it is silent-forever; an EXHAUSTED
    // balance is the expected end state of a prepaid grant, it is loud, and it is per-call.
    throw new Error(
      'llm-client: a model was requested on the direct-Anthropic lane ' +
      `("${ANTHROPIC_DIRECT_PREFIX}…") but ANTHROPIC_API_KEY is not set. ` +
      'Set it, or use an OpenRouter model id without the prefix.'
    );
  }
  if (!_anthropicDirectClient) {
    _anthropicDirectClient = new Anthropic({
      apiKey,
      baseURL: ANTHROPIC_BASE_URL,
      timeout: resolveRequestTimeoutMs(),
      maxRetries: resolveMaxRetries(),
    });
  }
  return _anthropicDirectClient;
}

/**
 * The direct lane dressed as an OpenAI client, with the credit-exhaustion fallback.
 *
 * Returns `{ chat: { completions: { create } } }` — the ONLY surface any caller in this repo uses
 * — so no call site changes shape. `create` does three things in order:
 *
 *   1. translate the OpenAI-shaped payload to `/v1/messages` (dropping `temperature`, which this
 *      model rejects, and turning `reasoning:{enabled:false}` into `thinking:{type:'disabled'}`),
 *      passing `cache_control` blocks through UNTOUCHED — that pass-through is the entire reason
 *      this lane was rebuilt;
 *   2. map the reply back, including the cache split and a LIST-PRICE cost, because Anthropic
 *      returns no `cost` field and `accumulateUsage` reads one;
 *   3. on a credit-class failure, re-issue the SAME call on OpenRouter, mark the returned usage,
 *      and emit `lp612.llm.fallback_provider` — so a dry balance costs a few seconds, not the
 *      lesson.
 *
 * Built per call rather than memoised: it is three closures over a singleton HTTP client, which
 * costs nothing beside a 60-second model call, and it lets the caller hand in the correlationId
 * and stage that make the fallback event queryable instead of anonymous.
 */
function buildDirectLaneClient(directModel, ctx) {
  const context = ctx || {};

  async function create(params) {
    const payload = { ...params, model: directModel };
    try {
      const msg = await getAnthropicDirectClient().messages.create(toNativeRequest(payload));
      return fromNativeResponse(msg);
    } catch (e) {
      if (!isCreditClassError(e)) throw e;

      const to = directFallbackModel(directModel);
      const status = e && (e.status != null ? e.status : e.statusCode);
      const reason = String((e && e.message) || 'unknown').slice(0, 300);

      // Two channels on purpose. `logEvent` is the queryable name the watcher and any Axiom
      // query use; `logToFile` is the human sentence beside it in the same correlation trace.
      // Required at call time so the module graph here stays a leaf — llm-client is required by
      // almost everything, and a top-level require of the loggers has bitten the circular-deps
      // suite before.
      // eslint-disable-next-line global-require
      const { logEvent } = require('../utils/structured-logger');
      // eslint-disable-next-line global-require
      const { logToFile } = require('../utils/logger');
      logEvent('lp612.llm.fallback_provider', {
        correlationId: context.correlationId || null,
        stage: context.stage || null,
        from: `${ANTHROPIC_DIRECT_PREFIX}${directModel}`,
        to,
        reason,
        status: status == null ? null : status,
      });
      logToFile(
        'llm-client: the direct-Anthropic lane could not spend — falling back to OpenRouter',
        { correlationId: context.correlationId || null, stage: context.stage || null,
          from: `${ANTHROPIC_DIRECT_PREFIX}${directModel}`, to, status: status == null ? null : status, reason },
        'warn'
      );

      let res;
      try {
        res = await getClient().chat.completions.create({ ...params, model: to });
      } catch (fallbackErr) {
        // BOTH PROVIDERS FAILED. Whoever reads this needs the FIRST failure as much as the
        // second: "OpenRouter returned 502" on its own sends the next engineer at OpenRouter,
        // when the story is "the prepaid balance ran out AND the fallback was down". `cause` is
        // where node's own error chain puts it and where the logger already looks.
        fallbackErr.cause = fallbackErr.cause || e;
        fallbackErr.message =
          `${fallbackErr.message} (after the direct-Anthropic lane could not spend: ${reason})`;
        throw fallbackErr;
      }
      // THE LESSON MUST SAY WHERE IT WAS AUTHORED. A fallback that produced a perfect lesson and
      // reported it as credit-funded would make the whole point of this lane unmeasurable, and
      // would tell the operator his balance was draining when it was not.
      if (res && typeof res === 'object') {
        res.usage = { ...(res.usage || {}), provider_fallback: true, provider_fallback_to: to };
      }
      return res;
    }
  }

  return { chat: { completions: { create } } };
}

/**
 * Resolve the client AND the model id to send, for one model.
 *
 * Returns `{ client, model }`. The caller must use the RETURNED model id: the
 * `anthropic-direct/` prefix is our routing token and Anthropic 404s on it.
 *
 * An unprefixed id is returned untouched on the shared OpenRouter client, so
 * every existing caller keeps its current behaviour.
 *
 * `ctx` ({correlationId, stage}) is OPTIONAL and used only to label a provider fallback. Callers
 * that pass nothing behave exactly as before.
 */
function getClientForModel(model, ctx) {
  const id = String(model || '');
  if (id.startsWith(ANTHROPIC_DIRECT_PREFIX)) {
    const directModel = id.slice(ANTHROPIC_DIRECT_PREFIX.length);
    // Fail fast on a missing key here, at resolution time, exactly as before — the error must not
    // wait until the first await inside `create`.
    getAnthropicDirectClient();
    // ...and fail just as fast if the mandatory fallback could not run. See above: a net that is
    // present but not attached is worse than no net, because it is invisible until it is needed.
    assertFallbackUsable(directModel);
    return { client: buildDirectLaneClient(directModel, ctx), model: directModel };
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
  getAnthropicDirectClient,
  directFallbackModel,
  assertFallbackUsable,
  getDefaultModel,
  getProviderInfo,
  ANTHROPIC_DIRECT_PREFIX,
};
