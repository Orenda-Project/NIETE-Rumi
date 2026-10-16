'use strict';

/**
 * /observe2 — reading a model reply the way the moments call and the label check both need to (bd-08qvls.1).
 *
 *   JOB      the model job both calls go out under: observe2.moments (model-registry.js). Its own model is
 *            today's (gpt-5-mini); the app_settings row llm_per_job, or LLM_JOB_MODELS, moves it alone.
 *   unwrap   a reply as completeJson gives it ({result, usage, finishReason}); a seam may hand back bare JSON.
 *   cutOff   was the reply stopped at its output limit? The reply's own finish reason says so ('length', or
 *            Anthropic's 'max_tokens'). A reply that carries none is judged by its token count against the limit
 *            the model actually had: a job moved to Claude is given more than the call asked for, so a complete
 *            ~17,000-token Sonnet reply is not a cut-off (16 Oct eval: two visits failed on exactly that).
 */

const JOB = 'observe2.moments';
const TRUNCATED = new Set(['length', 'max_tokens']);

function unwrap(reply) {
  if (reply && typeof reply === 'object' && 'result' in reply && 'usage' in reply) {
    return { result: reply.result, usage: reply.usage, finishReason: reply.finishReason || null };
  }
  return { result: reply, usage: null, finishReason: null };
}

function limitFor(usage, requested) {
  const to = usage && usage.job_override && usage.job_override.to;
  if (!to) return requested;
  // eslint-disable-next-line global-require
  const { appliedOutputLimit } = require('../../llm-client');
  return typeof appliedOutputLimit === 'function' ? appliedOutputLimit(to, requested) : requested;
}

function cutOff({ usage, finishReason }, requested) {
  if (finishReason) return TRUNCATED.has(String(finishReason));
  const used = usage ? Number(usage.completion_tokens) : NaN;
  if (!Number.isFinite(used)) return false;
  return used >= limitFor(usage, requested);
}

module.exports = { JOB, unwrap, cutOff };
