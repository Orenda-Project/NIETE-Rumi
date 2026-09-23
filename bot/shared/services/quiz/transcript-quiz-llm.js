'use strict';
/**
 * Transcript quiz — the one LLM call shape both passes use.
 *
 * Model comes from TRANSCRIPT_QUIZ_MODEL (an OpenRouter id, or an
 * `anthropic-direct/` id for the grant lane), read at CALL time so an env
 * flip on Railway takes effect without a code change. The default is the
 * winner of the offline eval (40 real transcripts × 9 flash-tier models).
 *
 * Two findings from that eval are encoded here rather than left to luck:
 *   - reasoning models (gpt-5*, gemini-3.5-flash, claude, deepseek) spend
 *     the completion budget on thinking; at 6k tokens they truncated the
 *     JSON on most Urdu transcripts. Everyone gets a large budget and the
 *     reasoning ones are asked for low effort.
 *   - a truncated reply (finish_reason 'length', empty content) is a
 *     different failure from bad JSON and is reported as such.
 */

const { getClientForModel } = require('../llm-client');
const { logToFile } = require('../../utils/logger');

const DEFAULT_MODEL = 'google/gemini-2.5-flash';
const REASONING_RE = /(^|\/)(gpt-5|o[1-9]|gemini-3\.5-flash$|gemini-3-flash|claude|deepseek)/i;

function modelId() {
  return (process.env.TRANSCRIPT_QUIZ_MODEL || '').trim() || DEFAULT_MODEL;
}

function extractJson(text) {
  let t = String(text || '').trim();
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('no JSON object in reply');
  return JSON.parse(t.slice(start, end + 1));
}

/**
 * A reply the model can simply be asked for again: nothing came back, it was cut
 * off, or it was not a JSON object. A thrown transport/API error is NOT in this
 * set — the client and the fallback ladder own those.
 */
const RETRYABLE = new Set(['EMPTY', 'TRUNCATED', 'BAD_JSON']);
/** One retry. The call is idempotent; it costs a second call only when the first was unusable. */
const MAX_ATTEMPTS = 2;

async function completeJsonOnce({ prompt, maxTokens, label }) {
  const requested = modelId();
  // bd-b8k7h: naming the job arms the fallback ladder with THIS job's frozen fallback, the
  // model it already works with. A no-op while TRANSCRIPT_QUIZ_MODEL still names that same
  // model; live protection the moment the job is moved to another supplier.
  const { client, model } = getClientForModel(requested, { job: 'quiz.transcript' });
  const reasoning = REASONING_RE.test(requested);
  const params = {
    model,
    messages: [{ role: 'user', content: prompt }],
    response_format: { type: 'json_object' },
    max_tokens: maxTokens,
    // OpenRouter: returns the priced cost on the usage object.
    usage: { include: true },
  };
  if (reasoning) params.reasoning = { effort: 'low' };
  else params.temperature = 0.4;

  const t0 = Date.now();
  const res = await client.chat.completions.create(params);
  const latencyMs = Date.now() - t0;
  const choice = res?.choices?.[0] || {};
  const raw = choice.message?.content || '';
  const usage = res?.usage || {};
  const costUsd = typeof usage.cost === 'number' ? usage.cost : null;

  if (!raw.trim()) {
    const why = choice.finish_reason === 'length' ? 'truncated' : 'empty';
    logToFile(`⚠️ ${label}: model returned ${why} reply`, { model: requested, finish: choice.finish_reason, usage });
    const err = new Error(`${label}: ${why} reply from ${requested}`);
    err.code = why.toUpperCase();
    err.costUsd = costUsd;
    throw err;
  }
  let json;
  try {
    json = extractJson(raw);
  } catch (e) {
    logToFile(`⚠️ ${label}: unusable JSON`, { model: requested, error: e.message, preview: raw.slice(0, 200) });
    const err = new Error(`${label}: bad JSON from ${requested}: ${e.message}`);
    err.code = 'BAD_JSON';
    err.costUsd = costUsd;
    throw err;
  }
  return { json, model: requested, costUsd, latencyMs, usage };
}

/**
 * The call every quiz pass makes. A reply that came back empty, cut off or
 * unparseable is asked for once more before anything fails: bd-mg9c7.159.17 — a
 * single `{ "topic":` reply from a model that had answered the same lesson an
 * hour earlier failed a teacher's quiz for good, and told them their lesson
 * plan could not be read. The cost of every attempt is reported.
 *
 * @param {object} args
 * @param {string} args.prompt      the whole prompt (user turn)
 * @param {number} [args.maxTokens]
 * @param {string} [args.label]     for logs
 * @returns {Promise<{json:object, model:string, costUsd:number|null, latencyMs:number, usage:object}>}
 */
async function completeJson({ prompt, maxTokens = 16000, label = 'transcript_quiz' }) {
  let spent = null;
  let lastErr = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const out = await completeJsonOnce({ prompt, maxTokens, label });
      if (spent != null && out.costUsd != null) out.costUsd += spent;
      else if (spent != null) out.costUsd = spent;
      if (attempt > 1) logToFile(`✅ ${label}: usable reply on attempt ${attempt}`, { model: out.model });
      return out;
    } catch (err) {
      if (!RETRYABLE.has(err && err.code)) throw err;
      if (typeof err.costUsd === 'number') spent = (spent || 0) + err.costUsd;
      lastErr = err;
      if (attempt < MAX_ATTEMPTS) {
        logToFile(`↻ ${label}: retrying after ${err.code}`, { attempt, error: err.message });
      }
    }
  }
  throw lastErr;
}

module.exports = { completeJson, modelId, extractJson, DEFAULT_MODEL, REASONING_RE, MAX_ATTEMPTS };
