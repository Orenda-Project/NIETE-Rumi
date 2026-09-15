'use strict';
/**
 * P3.1 — the fidelity LLM grader. Given the prescribed moves + the lesson transcript, calls
 * gpt-5.6-luna (decision D8) and returns per-move VERDICTS ONLY — it never computes a score
 * (that is fidelity-scorer's job; D6 keeps the rubric drift-free in code).
 *
 * Model, prompt and cross-language behaviour are the offline-validated ones (Evals 5 & 6). The call
 * mirrors GPT5MiniService.completeJson: OpenRouter client via getClient(), json_object mode,
 * jsonrepair on parse. The client is injectable (opts.client) so unit tests never hit the network.
 *
 * bd-b3pop. Each knob is a Railway variable that is unset in production, so the request stays exactly today's until
 * one is set:
 *   LP_FIDELITY_REASONING_EFFORT   minimal | low | medium | high → OpenRouter's unified `reasoning: { effort }` request
 *                                  field. Reasoning models (GLM, DeepSeek) spend the completion budget thinking and
 *                                  answer with EMPTY content without it (Eval 8).
 *   LP_FIDELITY_MAX_TOKENS         completion cap, default 4000, at most 32000.
 *   opts.photoEvidence             the vision pass's reading of the lesson photos, handed over by the orchestrator only
 *                                  under LP_FIDELITY_PHOTO (D34): the photo rules on the brief, the reading after the
 *                                  transcript inside its data boundary.
 * And whatever the variables say:
 *   - an empty answer is retried once at low reasoning effort;
 *   - a grading cut off by the token cap (finish_reason length) with a prescribed move unjudged, or one whose verdicts
 *     name no prescribed move, is retried once and then reported, never scored: the scorer reads an unjudged move as
 *     not_done, a false miss that blames the teacher (the D19 hazard);
 *   - verdicts keyed by move_id become the array the scorer reads, and entries that are not objects are dropped;
 *   - a failure carries `reason` (empty_content | unparseable_json | no_verdicts | incomplete_verdicts | truncated),
 *     which the orchestrator persists as lp_fidelity.cause.
 */
const { GRADER_BRIEF, buildUserPrompt } = require('./grader-prompt');
const { PHOTO_EVIDENCE_SECTION, buildPhotoEvidenceBlock, normalisePhotoEvidence } = require('./grader-photo-evidence');

// jsonrepair is a belt-and-suspenders repair for slightly-malformed model JSON (matches
// GPT5MiniService). Load it lazily so this module still loads where the optional dep isn't resolved.
let _jsonrepair = null;
try { _jsonrepair = require('jsonrepair').jsonrepair; } catch (_) { /* fall back to strict parse */ }

// gpt-5.6-luna: cheaper than the live gpt-4o on both axes, keeps per-session cost flat (D8).
// llm-client auto-prefixes 'openai/' when there is no '/'; the full slug is explicit here.
const FIDELITY_MODEL = process.env.LP_FIDELITY_MODEL || 'openai/gpt-5.6-luna';
const DEFAULT_MAX_TOKENS = 4000;
const MAX_TOKENS_CEILING = 32000;
const EFFORTS = new Set(['minimal', 'low', 'medium', 'high']);

function reasoningEffort() {
  const e = String(process.env.LP_FIDELITY_REASONING_EFFORT || '').trim().toLowerCase();
  return EFFORTS.has(e) ? e : null;
}

function maxTokens() {
  const n = Math.floor(Number(process.env.LP_FIDELITY_MAX_TOKENS));
  return Number.isFinite(n) && n >= 1 ? Math.min(n, MAX_TOKENS_CEILING) : DEFAULT_MAX_TOKENS;
}

function isPlainObject(x) {
  return !!x && typeof x === 'object' && !Array.isArray(x);
}

function safeJsonParse(content) {
  try {
    return JSON.parse(content);
  } catch (e) {
    if (!_jsonrepair) throw e;
    return JSON.parse(_jsonrepair(content)); // throws if unrepairable — caller guards
  }
}

function failure(reason, message) {
  const e = new Error(message);
  e.reason = reason;
  return e;
}

/**
 * The verdicts a grading can be scored from, and how many prescribed moves it left unjudged — or a failure with its
 * reason. jsonrepair can coerce garbage into a verdict-less object, and a truncated answer can look complete; either
 * would let the scorer read every missing move as not_done.
 */
function readVerdicts(parsed, moves, finishReason) {
  if (!isPlainObject(parsed)) throw failure('no_verdicts', 'grader response is not a JSON object');
  let verdicts = parsed.verdicts;
  // Some providers key the verdicts by move_id; the scorer reads an array.
  if (isPlainObject(verdicts)) {
    verdicts = Object.entries(verdicts)
      .map(([moveId, v]) => (isPlainObject(v) ? { move_id: moveId, ...v } : { move_id: moveId, verdict: v }));
  }
  if (!Array.isArray(verdicts)) throw failure('no_verdicts', 'grader response has no verdicts');
  verdicts = verdicts.filter(isPlainObject);
  const prescribed = new Set((Array.isArray(moves) ? moves : []).map((m) => String(m && m.move_id)));
  if (!prescribed.size) return { verdicts, missing: 0 };
  if (!verdicts.length) throw failure('no_verdicts', 'grader response has no usable verdicts');
  const judged = new Set(verdicts.map((v) => String(v.move_id)).filter((id) => prescribed.has(id)));
  if (!judged.size) throw failure('incomplete_verdicts', 'no verdict names a prescribed move');
  const missing = prescribed.size - judged.size;
  if (missing > 0 && finishReason === 'length') {
    throw failure('truncated', `grading cut off by the token cap with ${missing} prescribed move(s) unjudged`);
  }
  return { verdicts, missing };
}

/**
 * @param {Array<object>} moves       prescribed move list (fidelity-moves-v1 objects)
 * @param {string}        transcript  the lesson transcript (Urdu/English, timestamped)
 * @param {object}        meta        { lesson_id, template, goal, total_minutes }
 * @param {object}        opts        { client, model, maxTokens, reasoningEffort, photoEvidence }
 * @returns {Promise<{verdicts, narrative, language_note, moderators, usage, model, reasoning_effort, missing_verdicts}>}
 */
async function analyzeFidelity(moves, transcript, meta = {}, opts = {}) {
  const model = opts.model || FIDELITY_MODEL;
  const maxTok = opts.maxTokens || maxTokens();
  const client = opts.client || require('../../llm-client').getClient();
  const effort = EFFORTS.has(opts.reasoningEffort) ? opts.reasoningEffort : reasoningEffort();
  const photos = normalisePhotoEvidence(opts.photoEvidence);

  let brief = GRADER_BRIEF;
  let user = buildUserPrompt(meta, moves, transcript);
  if (photos.length) {
    brief += PHOTO_EVIDENCE_SECTION;
    user += buildPhotoEvidenceBlock(photos);
  }

  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    const request = {
      model,
      // bd-27ort: names the spender; llm-client records it and strips it before the wire.
      job: 'lp.fidelity',
      temperature: 0, // luna accepts 0; minimises the ~±12pt run-to-run wobble (D23 — median on top)
      messages: [
        { role: 'system', content: brief },
        { role: 'user', content: user },
      ],
      max_completion_tokens: maxTok,
      response_format: { type: 'json_object' },
    };
    const retryEffort = !effort && lastErr && lastErr.reason === 'empty_content' ? 'low' : null;
    if (effort || retryEffort) request.reasoning = { effort: effort || retryEffort };
    const response = await client.chat.completions.create(request);
    const choice = response.choices && response.choices[0];
    const content = choice && choice.message && choice.message.content;
    const finishReason = (choice && choice.finish_reason) || null;
    try {
      if (!content || !String(content).trim()) {
        throw failure('empty_content', `grader returned empty content (finish_reason=${finishReason || 'unknown'})`);
      }
      let parsed;
      try {
        parsed = safeJsonParse(content);
      } catch (parseErr) {
        throw failure('unparseable_json', `grader returned unparseable JSON: ${parseErr.message}`);
      }
      const { verdicts, missing } = readVerdicts(parsed, moves, finishReason);
      return {
        verdicts,
        narrative: parsed.narrative || null,
        language_note: parsed.language_note || null,
        moderators: parsed.moderators || null,
        usage: response.usage || {},
        model,
        reasoning_effort: request.reasoning ? request.reasoning.effort : null,
        missing_verdicts: missing,
      };
    } catch (e) {
      lastErr = e; // empty / malformed / unusable → retry once, then give up
    }
  }
  const reason = (lastErr && lastErr.reason) || 'unparseable_json';
  const err = new Error(`fidelity_unavailable: ${reason}`);
  err.cause = lastErr;
  err.code = 'fidelity_unavailable';
  err.reason = reason;
  throw err;
}

module.exports = { analyzeFidelity, FIDELITY_MODEL, safeJsonParse };
