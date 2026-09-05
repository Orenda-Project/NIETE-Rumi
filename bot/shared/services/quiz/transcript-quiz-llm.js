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
 * @param {object} args
 * @param {string} args.prompt      the whole prompt (user turn)
 * @param {number} [args.maxTokens]
 * @param {string} [args.label]     for logs
 * @returns {Promise<{json:object, model:string, costUsd:number|null, latencyMs:number, usage:object}>}
 */
async function completeJson({ prompt, maxTokens = 16000, label = 'transcript_quiz' }) {
  const requested = modelId();
  const { client, model } = getClientForModel(requested);
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
    throw err;
  }
  let json;
  try {
    json = extractJson(raw);
  } catch (e) {
    logToFile(`⚠️ ${label}: unusable JSON`, { model: requested, error: e.message, preview: raw.slice(0, 200) });
    const err = new Error(`${label}: bad JSON from ${requested}: ${e.message}`);
    err.code = 'BAD_JSON';
    throw err;
  }
  return { json, model: requested, costUsd, latencyMs, usage };
}

module.exports = { completeJson, modelId, extractJson, DEFAULT_MODEL, REASONING_RE };
