/**
 * bd-oak77.29 — the direct-Anthropic lane, on the OFFICIAL SDK, with caching that works.
 *
 * WHY THIS FILE EXISTS
 *
 * `llm-client.js` used to drive the `anthropic-direct/` lane with the **OpenAI SDK** pointed at
 * Anthropic's OpenAI-compatibility endpoint (`https://api.anthropic.com/v1/`). That endpoint
 * accepts `cache_control` with HTTP 200 and **silently ignores it**: its `usage` object carries
 * no `cache_creation_input_tokens`, no `cache_read_input_tokens` and no
 * `prompt_tokens_details.cached_tokens` (measured 2026-09-06,
 * `11_cost/evidence/shim_vs_native.json`; re-measured 2026-09-07,
 * `16_direct_lane/evidence/probe_native_cache.txt`). Prompt caching is LIVE on production and
 * saving 38.3% per lesson, so routing the author ladder through that shim would have traded a
 * measured 38% saving for the ability to spend prepaid credit — a net loss.
 *
 * Native `/v1/messages` caches (call 2 of the same prefix reports
 * `cache_read_input_tokens: 5724` against a 0 on call 1), so the direct lane is rebuilt on
 * `@anthropic-ai/sdk`. This module is the translation layer that keeps every existing call site
 * unchanged: it speaks the OpenAI `chat.completions.create` shape on the outside and
 * `/v1/messages` on the inside.
 *
 * WHAT THE TRANSLATION HAS TO GET RIGHT — each row measured against the live API on 2026-09-07,
 * `evidence/probe_params.txt`, not inferred from a doc:
 *
 *   | OpenAI-shaped input          | native /v1/messages           | why                          |
 *   |------------------------------|-------------------------------|------------------------------|
 *   | `messages[0].role==='system'` | top-level `system`            | 400: "use the top-level      |
 *   |                              |                               | 'system' parameter"          |
 *   | `temperature: 0.2`           | DROPPED                       | 400: "`temperature` is       |
 *   |                              |                               | deprecated for this model."  |
 *   | `reasoning:{enabled:false}`  | `thinking:{type:'disabled'}`  | 400: "reasoning: Extra       |
 *   |                              |                               | inputs are not permitted"    |
 *   | content blocks + cache_control | passed through UNCHANGED     | this is the whole point      |
 *
 * THE TEMPERATURE ROW IS NOT A BEHAVIOUR CHANGE. `temperature` is rejected outright by
 * `claude-sonnet-5` on the native surface, and OpenRouter returns 200 for the same request —
 * which it can only do by stripping the parameter before forwarding. Production has therefore
 * been authoring at the model's own default all along; dropping it here makes the two lanes
 * identical rather than different (`evidence/probe_native_cache.txt`, sections B and B2).
 *
 * COST. Anthropic does not return a `cost` field — OpenRouter does, and `accumulateUsage` in
 * lp612-author.service reads `usage.cost`. Without a price here every direct-lane lesson would
 * report `costUsd: 0` — a silent lie in the one telemetry field this whole lane exists to move.
 * So the list price is computed from the token split, at the rates the `claude-api` skill is
 * authoritative for, and an unpriced model sets `cost_unpriced: true` rather than pretending the
 * lesson was free.
 */

/**
 * Anthropic list price, $/MTok, per the `claude-api` skill (cached 2026-06-24).
 * OpenRouter bills exactly these rates for the same models with `is_byok:false`, which is why
 * this lane buys credit-burn and not a better rate — see `16_direct_lane/COST.md`.
 */
const LIST_PRICE_PER_MTOK = Object.freeze({
  'claude-sonnet-5': { input: 2.0, output: 10.0 },
  'claude-opus-5': { input: 5.0, output: 25.0 },
  'claude-opus-4-8': { input: 5.0, output: 25.0 },
  'claude-opus-4-7': { input: 5.0, output: 25.0 },
  'claude-opus-4-6': { input: 5.0, output: 25.0 },
  'claude-sonnet-4-6': { input: 3.0, output: 15.0 },
  'claude-haiku-4-5': { input: 1.0, output: 5.0 },
});

/** Cache multipliers on the INPUT rate. 5-minute writes are 1.25x, 1-hour writes 2.0x, reads 0.1x. */
const CACHE_READ_MULTIPLIER = 0.1;
const CACHE_WRITE_5M_MULTIPLIER = 1.25;
const CACHE_WRITE_1H_MULTIPLIER = 2.0;

/**
 * PARAMS THIS FACADE CANNOT FAITHFULLY TRANSLATE — a named THROW, never a silent drop.
 *
 * Rule 24(c): a prompt's input contract is asserted in code pre-flight, because a silently
 * dropped parameter is a quality regression that reports success. The live consumer that makes
 * this concrete is `quiz/transcript-quiz-llm.js`, which also calls `getClientForModel()` and
 * sends `response_format: {type:'json_object'}`. Dropping that on the way to `/v1/messages` would
 * remove JSON-mode enforcement from a path whose next line does `JSON.parse` — a bad-JSON bug
 * that only appears once someone points that model id at this lane, months from now, with no
 * error to read. Anthropic's equivalent is `output_config.format` (structured outputs); until
 * this facade implements it, configuring that lane must FAIL LOUDLY at the first call.
 *
 * Deliberately NOT on this list:
 *   `temperature`  — `claude-sonnet-5` REJECTS it (400 "`temperature` is deprecated for this
 *                    model"), and OpenRouter returns 200 for the same request, which it can only
 *                    do by stripping it. Production has been authoring at the model default all
 *                    along, so dropping it makes the lanes identical, not different.
 *   `reasoning`    — translated to `thinking`, which is what the caller meant.
 *   `usage`        — `{include:true}` only asks OpenRouter to attach usage; native always does.
 */
const UNTRANSLATABLE_PARAMS = Object.freeze([
  'response_format', 'tools', 'tool_choice', 'functions', 'function_call',
  'stream', 'n', 'logprobs', 'top_logprobs', 'presence_penalty', 'frequency_penalty',
  'seed', 'top_p', 'top_k', 'logit_bias',
]);

/**
 * Fold one OpenAI-shaped `system` message into the native top-level `system`.
 *
 * Both the string form (caching off) and the content-block form (caching on, carrying
 * `cache_control`) are valid native `system` values and are passed through unchanged — the
 * breakpoint the author service places must reach Anthropic byte for byte or the cache never
 * writes. Two system turns are concatenated in order rather than the second silently winning.
 */
function mergeSystem(existing, content) {
  if (existing === undefined) return content;
  const asBlocks = (v) => (Array.isArray(v) ? v : [{ type: 'text', text: String(v) }]);
  return asBlocks(existing).concat(asBlocks(content));
}

/**
 * OpenAI `chat.completions.create` params -> native `messages.create` params.
 *
 * Pure. Anything this function does not explicitly translate is DROPPED rather than forwarded:
 * a stray OpenAI-only key reaching `/v1/messages` is a 400 ("Extra inputs are not permitted"),
 * and a 400 on the author's round-0 call costs a teacher her lesson.
 */
function toNativeRequest(params) {
  const p = params || {};

  const untranslatable = UNTRANSLATABLE_PARAMS.filter((k) => p[k] !== undefined);
  if (untranslatable.length) {
    throw new Error(
      'anthropic-native-facade: the direct-Anthropic lane cannot faithfully translate '
      + `${untranslatable.join(', ')} to /v1/messages, and dropping ${untranslatable.length > 1 ? 'them' : 'it'} `
      + 'would change what the model does without saying so. Use an OpenRouter model id for this '
      + 'call, or implement the native equivalent here first.'
    );
  }

  const incoming = Array.isArray(p.messages) ? p.messages : [];
  let system;
  const messages = [];
  for (const m of incoming) {
    if (!m) continue;
    if (m.role === 'system') {
      system = mergeSystem(system, m.content);
      continue;
    }
    messages.push({ role: m.role, content: m.content });
  }

  const out = { model: p.model, max_tokens: p.max_tokens, messages };
  if (system !== undefined) out.system = system;

  // `reasoning:{enabled:false}` is the OPENROUTER spelling and is rejected by name on the native
  // surface. `thinking:{type:'disabled'}` is the native equivalent and is what the author means:
  // reasoning bills as output tokens and truncates the JSON before it closes.
  if (p.reasoning && p.reasoning.enabled === false) out.thinking = { type: 'disabled' };
  if (p.thinking) out.thinking = p.thinking;

  if (p.stop_sequences) out.stop_sequences = p.stop_sequences;
  if (p.metadata) out.metadata = p.metadata;
  return out;
}

/**
 * List cost in USD for one native response, or `null` for a model we hold no price for.
 *
 * The write premium is read from the TTL SPLIT the API returns (`cache_creation.ephemeral_5m…` /
 * `…_1h…`) rather than assumed, so a caller who ever switches to a 1-hour breakpoint is billed
 * at 2.0x in this number too instead of being quietly under-reported at 1.25x.
 */
function priceUsd(model, usage) {
  const price = LIST_PRICE_PER_MTOK[String(model || '').trim()];
  if (!price) return null;
  const u = usage || {};
  const creation = u.cache_creation || {};
  const write5m = Number.isFinite(creation.ephemeral_5m_input_tokens)
    ? creation.ephemeral_5m_input_tokens
    : (u.cache_creation_input_tokens || 0);
  const write1h = Number.isFinite(creation.ephemeral_1h_input_tokens)
    ? creation.ephemeral_1h_input_tokens
    : 0;
  const read = u.cache_read_input_tokens || 0;
  const fresh = u.input_tokens || 0;
  const out = u.output_tokens || 0;

  const inRate = price.input / 1e6;
  return (
    fresh * inRate
    + write5m * inRate * CACHE_WRITE_5M_MULTIPLIER
    + write1h * inRate * CACHE_WRITE_1H_MULTIPLIER
    + read * inRate * CACHE_READ_MULTIPLIER
    + out * (price.output / 1e6)
  );
}

/** Native `stop_reason` -> the OpenAI `finish_reason` the call sites already understand. */
function mapFinishReason(stopReason) {
  switch (stopReason) {
    case 'max_tokens': return 'length';
    case 'tool_use': return 'tool_calls';
    case 'refusal': return 'content_filter';
    case 'end_turn':
    case 'stop_sequence': return 'stop';
    default: return stopReason || 'stop';
  }
}

/**
 * Native message -> the OpenAI response shape, INCLUDING the usage fields the author's
 * `accumulateUsage` reads.
 *
 * `prompt_tokens` deliberately sums fresh + cache-read + cache-write. That is what OpenRouter
 * reports for the same call (a cached call bills less but still processes the same prompt), so
 * the two lanes' "share of prompt tokens served from cache" numbers are comparable rather than
 * being two different denominators wearing one name.
 */
function fromNativeResponse(msg) {
  const m = msg || {};
  const blocks = Array.isArray(m.content) ? m.content : [];
  const text = blocks
    .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('');

  const u = m.usage || {};
  const cachedTokens = u.cache_read_input_tokens || 0;
  const cacheWriteTokens = u.cache_creation_input_tokens || 0;
  const promptTokens = (u.input_tokens || 0) + cachedTokens + cacheWriteTokens;
  const completionTokens = u.output_tokens || 0;

  const usage = {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: promptTokens + completionTokens,
    prompt_tokens_details: {
      cached_tokens: cachedTokens,
      cache_write_tokens: cacheWriteTokens,
    },
    completion_tokens_details: {
      // The author asserts this is 0 and warns loudly when it is not — the same contract check
      // it runs against OpenRouter. Native reports thinking under a different name.
      reasoning_tokens: (u.output_tokens_details && u.output_tokens_details.thinking_tokens) || 0,
    },
    // The unmapped truth, kept verbatim beside the mapping, so a disagreement between the two is
    // answerable from one log line rather than by re-running the call.
    anthropic_usage: u,
  };

  const cost = priceUsd(m.model, u);
  if (cost === null) usage.cost_unpriced = true;
  else usage.cost = cost;

  return {
    id: m.id || null,
    model: m.model || null,
    object: 'chat.completion',
    choices: [{
      index: 0,
      finish_reason: mapFinishReason(m.stop_reason),
      message: { role: 'assistant', content: text },
    }],
    usage,
  };
}

/**
 * Is this the class of failure that means "the prepaid balance is gone / this key cannot spend"?
 *
 * The operator is spending a FINITE prepaid balance. When it runs dry, lesson generation must not
 * stop — it must fall back to the provider that still works. So this predicate has to fire on the
 * real shape of that failure, which is NOT a 401: the production key returns
 * **HTTP 400 with an org id** and the body "Your credit balance is too low to access the
 * Anthropic API." (re-verified 2026-09-07, `evidence/probe_keys.txt`).
 *
 * It deliberately does NOT fire on every 400. A malformed payload is also a 400, and silently
 * switching providers on one would hide a real bug behind a working lesson — so a 400 qualifies
 * only when the message says so.
 */
const CREDIT_MESSAGE_RE =
  /credit balance is too low|insufficient[\s_-]*(quota|credit|credits|funds|balance)|out of credits|payment required|billing/i;

function isCreditClassError(e) {
  if (!e) return false;
  const status = e.status != null ? e.status : e.statusCode;
  // 401 the key was revoked, 402 payment required, 429 the org is throttled or out of quota.
  if (status === 401 || status === 402 || status === 429) return true;
  const parts = [
    e.message,
    e.error && e.error.message,
    e.error && e.error.error && e.error.error.message,
  ].filter(Boolean).map(String).join(' ');
  return CREDIT_MESSAGE_RE.test(parts);
}

module.exports = {
  toNativeRequest,
  UNTRANSLATABLE_PARAMS,
  fromNativeResponse,
  priceUsd,
  isCreditClassError,
  mapFinishReason,
  LIST_PRICE_PER_MTOK,
  CACHE_READ_MULTIPLIER,
  CACHE_WRITE_5M_MULTIPLIER,
  CACHE_WRITE_1H_MULTIPLIER,
};
