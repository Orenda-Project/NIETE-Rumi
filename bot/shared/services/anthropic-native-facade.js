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
  'claude-fable-5-1': { input: 10.0, output: 50.0 },
  'claude-fable-5': { input: 10.0, output: 50.0 },
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
 * dropped parameter is a quality regression that reports success. Each of these changes what the
 * caller gets back (a tool call, a stream, several choices, log-probabilities), so a caller that
 * sends one meaningfully must get an error here, and its fallback, rather than a different answer.
 *
 * JSON mode is no longer on this list (bd-gr4fy.2): `json_schema` maps to structured outputs
 * (`output_config.format`), and `json_object` to a system instruction plus a strict extraction on
 * the way back, with the caller's fallback behind an answer that still does not parse.
 *
 * Deliberately NOT on this list:
 *   `temperature`  — `claude-sonnet-5` and `claude-opus-5` REJECT it (400 "`temperature` is
 *                    deprecated for this model"), and OpenRouter returns 200 for the same request,
 *                    which it can only do by stripping it. Kept only for a model that accepts it.
 *   `reasoning`    — translated to `thinking` or `output_config.effort`, which is what it meant.
 *   `usage`        — `{include:true}` only asks OpenRouter to attach usage; native always does.
 */
const UNTRANSLATABLE_PARAMS = Object.freeze([
  'tools', 'tool_choice', 'functions', 'function_call',
  'stream', 'n', 'logprobs', 'top_logprobs', 'logit_bias',
]);

/**
 * Whether a caller actually asked for the thing a name on that list stands for. `n: 1` is the
 * default and `stream: false` is no stream, so neither is a reason to refuse the call.
 */
function asksFor(name, v) {
  if (v === undefined || v === null || v === false) return false;
  if (name === 'n') return Number(v) > 1;
  if (name === 'top_logprobs') return Number(v) > 0;
  if (name === 'tool_choice') return v !== 'none';
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'object') return Object.keys(v).length > 0;
  return true;
}

/** A request with no limit gets one: `/v1/messages` requires it. The claude-api default. */
const DEFAULT_MAX_TOKENS = 16000;

/**
 * Sampling. `claude-sonnet-5`, `claude-opus-5` and Fable reject `temperature` outright; Haiku 4.5
 * and older still take it, and a job tuned at temperature 0 (intent, language) keeps that there.
 */
const acceptsTemperature = (model) => /^claude-(haiku-4-5|3)/.test(String(model || ''));

/** Haiku 4.5 rejects the effort parameter ("this model does not support the effort parameter"). */
const acceptsEffort = (model) => !/^claude-(haiku|3)/.test(String(model || ''));

/**
 * Thinking, per model, because the rules differ and a wrong guess is a 400 on every call
 * (bd-gr4fy.6). Matched on the WHOLE id (an optional date suffix aside): `claude-opus-5-5` is not
 * `claude-opus-5`, and treating it as one sent it a request it rejects.
 *
 *   thinks by default   Sonnet 5, Opus 5, Opus 5.5, Fable 5 / 5.1: omitting `thinking` runs it
 *   can be switched off Haiku 4.5 (off unless asked), Sonnet 5, Opus 5 at effort high or below.
 *                       NOT Fable 5 / 5.1 or Opus 5.5: `thinking:{type:'disabled'}` is a 400 there,
 *                       and effort is the only lever.
 */
const bareModel = (model) => String(model || '').replace(/^.*\//, '').replace(/-\d{8}$/, '');
const thinksByDefault = (model) => /^claude-(sonnet-5|opus-5|opus-5-5|fable-5|fable-5-1)$/.test(bareModel(model));
const alwaysThinks = (model) => /^claude-(opus-5-5|fable-5|fable-5-1)$/.test(bareModel(model));
/** Opus 5 accepts thinking off only at effort high or below. */
const EFFORT_ABOVE_HIGH = new Set(['xhigh', 'max']);

/** OpenAI's `minimal` has no native level; `low` is the nearest. */
const EFFORT_MAP = Object.freeze({
  minimal: 'low', low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max',
});

const JSON_INSTRUCTION =
  'Respond with a single valid JSON object only. Do not wrap it in markdown or code fences, and '
  + 'write nothing before or after it.';

/** The image types `/v1/messages` accepts. */
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

/** OpenAI content parts with no `/v1/messages` equivalent: refused here, by name. */
const UNTRANSLATABLE_PARTS = new Set(['input_audio', 'file']);

/** One OpenAI content part -> its native block. Text passes through; images are translated. */
function toNativePart(part) {
  if (part && UNTRANSLATABLE_PARTS.has(part.type)) {
    throw new Error(`anthropic-native-facade: a ${part.type} content part has no /v1/messages equivalent`);
  }
  if (!part || part.type !== 'image_url') return part;
  const url = String((part.image_url && part.image_url.url) || part.image_url || '');
  const m = /^data:([^;,]+);base64,(.*)$/s.exec(url);
  if (m) {
    const mediaType = m[1].toLowerCase();
    if (!IMAGE_TYPES.has(mediaType)) {
      throw new Error(`anthropic-native-facade: ${mediaType} is not an image type /v1/messages accepts`);
    }
    return { type: 'image', source: { type: 'base64', media_type: mediaType, data: m[2] } };
  }
  if (/^https?:\/\//i.test(url)) return { type: 'image', source: { type: 'url', url } };
  throw new Error('anthropic-native-facade: an image_url part is neither a data URL nor an http(s) URL');
}

/** Message content -> native content. Strings pass through; part arrays have images translated. */
function toNativeContent(content) {
  return Array.isArray(content) ? content.map(toNativePart) : content;
}

/** The JSON instruction appended after whatever system prompt the caller sent, cache intact. */
function withJsonInstruction(system) {
  if (system === undefined) return JSON_INSTRUCTION;
  if (Array.isArray(system)) return system.concat([{ type: 'text', text: JSON_INSTRUCTION }]);
  return `${system}\n\n${JSON_INSTRUCTION}`;
}

/** True when the caller asked for JSON back, in either OpenAI spelling. */
function wantsJson(params) {
  const t = params && params.response_format && params.response_format.type;
  return t === 'json_object' || t === 'json_schema';
}

/**
 * The top-level JSON shape a request asked for: 'object', 'array', 'any', or null for no JSON.
 * `json_object` means an object, by definition; a schema says what it wants at its root.
 */
function jsonShapeFor(params) {
  const rf = params && params.response_format;
  if (!rf) return null;
  if (rf.type === 'json_object') return 'object';
  if (rf.type === 'json_schema') {
    const root = rf.json_schema && rf.json_schema.schema && rf.json_schema.schema.type;
    return root === 'array' ? 'array' : (root === 'object' ? 'object' : 'any');
  }
  return null;
}

/** Whether a parsed value has the shape asked for. A bare string, number or null never does. */
function hasShape(value, shape) {
  const isObject = value !== null && typeof value === 'object' && !Array.isArray(value);
  if (shape === 'object') return isObject;
  if (shape === 'array') return Array.isArray(value);
  return isObject || Array.isArray(value);
}

/**
 * The text from `start` (an opening bracket) to its own closing bracket, strings respected, or
 * null when the text ends first: an unclosed structure is a cut-off answer, not a short one.
 */
function balancedFrom(s, start) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

/** A candidate that reads like JSON (a quoted key and a colon) even though it does not parse. */
const looksLikeJson = (s) => /"[^"\n]*"\s*:/.test(s);

/**
 * The JSON inside an answer, or null. Fences first, then the one complete object or array of the
 * shape asked for, so a model that wraps its answer in markdown or a sentence still hands the
 * caller something `JSON.parse` accepts. Nothing is invented: if no such value is there, null.
 *
 * Each candidate is scanned to its OWN closing bracket (bd-gr4fy.6). An unclosed structure ends
 * the search: everything after its opening bracket is inside it, so a cut-off object never comes
 * back as one of its inner arrays.
 *
 * AND ONLY WHEN THERE IS NO DOUBT WHICH VALUE IS MEANT (bd-gr4fy.7). Taking the first value that
 * parsed handed a caller `{}` from "Filling the {} template: {...}", and handed it `{"score":0}`
 * from a malformed answer followed by a scale reminder, and the caller recorded 0. So: exactly one
 * candidate of the right shape, and no other candidate that reads like JSON but does not parse
 * (that one may be the real answer). Braces in plain prose ("{your rubric}") do not count. Anything
 * else is null, and the job's own model answers.
 */
function extractJson(text, shape = 'any') {
  const t = String(text || '').trim();
  const parse = (s) => { try { return { ok: true, value: JSON.parse(s) }; } catch (_) { return { ok: false }; } };
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(t);
  const body = fenced ? fenced[1].trim() : t;
  const whole = parse(body);
  if (whole.ok && hasShape(whole.value, shape)) return body;
  const fits = [];
  let brokenJson = 0;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c !== '{' && c !== '[') continue;
    const candidate = balancedFrom(body, i);
    if (candidate === null) return null;
    const got = parse(candidate);
    if (got.ok && hasShape(got.value, shape)) fits.push(candidate);
    else if (!got.ok && looksLikeJson(candidate)) brokenJson += 1;
    i += candidate.length - 1;
  }
  return fits.length === 1 && brokenJson === 0 ? fits[0] : null;
}

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
 * and a 400 on the author's round-0 call costs a teacher her lesson. That covers the OpenAI-only
 * knobs that change nothing a teacher reads (`seed`, `top_p`, the penalties, `user`, `verbosity`).
 */
function toNativeRequest(params) {
  const p = params || {};

  const untranslatable = UNTRANSLATABLE_PARAMS.filter((k) => asksFor(k, p[k]));
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
    messages.push({ role: m.role, content: toNativeContent(m.content) });
  }

  const format = p.response_format && p.response_format.type;
  // json_object has no native schema to enforce, so the instruction goes AFTER the caller's own
  // system prompt: a cached prefix stays byte-identical and the cache still reads.
  if (format === 'json_object') system = withJsonInstruction(system);

  const maxTokens = p.max_tokens != null ? p.max_tokens
    : (p.max_completion_tokens != null ? p.max_completion_tokens : DEFAULT_MAX_TOKENS);
  const out = { model: p.model, max_tokens: maxTokens, messages };
  if (system !== undefined) out.system = system;
  if (p.temperature !== undefined && acceptsTemperature(p.model)) out.temperature = p.temperature;

  // `reasoning:{enabled:false}` is the OPENROUTER spelling and is rejected by name on the native
  // surface. `thinking:{type:'disabled'}` is the native equivalent and is what the author means:
  // reasoning bills as output tokens and truncates the JSON before it closes.
  //
  // Except where the model refuses it (bd-gr4fy.6): Fable 5 / 5.1 and Opus 5.5 reject it at every
  // effort, and Opus 5 above `high`. There the parameter is LEFT OUT, which is what the API says
  // to do; the request then runs the model's own default rather than failing outright.
  const askedEffort = (p.reasoning && p.reasoning.effort) || p.reasoning_effort
    || (p.output_config && p.output_config.effort);
  const disableRefused = alwaysThinks(p.model)
    || (bareModel(p.model) === 'claude-opus-5' && EFFORT_ABOVE_HIGH.has(EFFORT_MAP[askedEffort]));
  if (p.reasoning && p.reasoning.enabled === false && !disableRefused) out.thinking = { type: 'disabled' };
  if (p.thinking) out.thinking = p.thinking;

  if (p.stop_sequences) out.stop_sequences = p.stop_sequences;
  else if (p.stop) out.stop_sequences = Array.isArray(p.stop) ? p.stop : [p.stop];
  if (p.metadata) out.metadata = p.metadata;
  // Already the native spelling (e.g. `{effort:'low'}` from the quiz passes):
  // passed through as given, so every caller that already used this lane is byte-identical.
  if (p.output_config) out.output_config = p.output_config;

  // OpenRouter's `reasoning: { effort }` and OpenAI's `reasoning_effort` are the native effort.
  const effort = EFFORT_MAP[(p.reasoning && p.reasoning.effort) || p.reasoning_effort];
  if (effort && acceptsEffort(p.model) && !(out.output_config && out.output_config.effort)) {
    out.output_config = { ...(out.output_config || {}), effort };
  }
  if (format === 'json_schema' && p.response_format.json_schema && p.response_format.json_schema.schema) {
    out.output_config = {
      ...(out.output_config || {}),
      format: { type: 'json_schema', schema: p.response_format.json_schema.schema },
    };
  }
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
  // Anthropic answers with the dated snapshot id (`claude-haiku-4-5-20251001` for a call to
  // `claude-haiku-4-5`), so the date is dropped before the lookup (bd-gr4fy.10). Without that every
  // direct-lane Haiku call was recorded unpriced. A model with no price still gets none.
  const id = String(model || '').trim();
  const price = LIST_PRICE_PER_MTOK[id] || LIST_PRICE_PER_MTOK[id.replace(/-\d{8}$/, '')];
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
function fromNativeResponse(msg, opts = {}) {
  const m = msg || {};
  const blocks = Array.isArray(m.content) ? m.content : [];
  const raw = blocks
    .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('');
  // JSON was asked for (bd-gr4fy.2): hand back the JSON itself, without the fences or the
  // sentence around it. Text that holds no JSON is returned as written, for the caller to judge.
  // A reply cut off at the limit is NEVER mined (bd-gr4fy.6): whatever complete piece sits inside
  // a cut-off object is not the answer, and `finish_reason: 'length'` says so to whoever checks.
  const shape = opts.json === true ? 'any' : opts.json;
  const text = opts.json && m.stop_reason !== 'max_tokens' ? (extractJson(raw, shape) || raw) : raw;

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
  wantsJson,
  jsonShapeFor,
  hasShape,
  extractJson,
  thinksByDefault,
  alwaysThinks,
  acceptsEffort,
  priceUsd,
  isCreditClassError,
  mapFinishReason,
  LIST_PRICE_PER_MTOK,
  CACHE_READ_MULTIPLIER,
  CACHE_WRITE_5M_MULTIPLIER,
  CACHE_WRITE_1H_MULTIPLIER,
};
