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
 * bd-b3pop (grader v2). Each knob is a Railway variable that is unset in production, so the request stays exactly
 * today's until one is set:
 *   LP_FIDELITY_PROMPT_VERSION=v2  the Eval 8 holistic2 brief + the code-measured recording facts (grader-prompt-v2.js)
 *   LP_FIDELITY_REASONING_EFFORT   minimal | low | medium | high → the provider `reasoning` param. Reasoning models
 *                                  (GLM, DeepSeek) spend the completion budget thinking and answer with EMPTY content
 *                                  without it (Eval 8); an empty answer is retried once at low effort even when unset.
 *   LP_FIDELITY_MAX_TOKENS         completion cap, default 4000. The v2 answer is ~12k characters: luna truncated its
 *                                  JSON at 4000 on every long lesson in the Eval 7 gate (bd-b3pop.2).
 *   opts.photoEvidence             the vision pass's reading of the lesson photos, handed over by the orchestrator only
 *                                  under LP_FIDELITY_PHOTO=on (D34): the photo rules on the brief, one block per photo.
 */
const { GRADER_BRIEF, buildUserPrompt } = require('./grader-prompt');
const { GRADER_BRIEF_V2, buildUserPromptV2 } = require('./grader-prompt-v2');
const { PHOTO_EVIDENCE_SECTION, buildPhotoEvidenceBlock, normalisePhotoEvidence } = require('./grader-photo-evidence');

// jsonrepair is a belt-and-suspenders repair for slightly-malformed model JSON (matches
// GPT5MiniService). Load it lazily so this module still loads where the optional dep isn't resolved.
let _jsonrepair = null;
try { _jsonrepair = require('jsonrepair').jsonrepair; } catch (_) { /* fall back to strict parse */ }

// gpt-5.6-luna: cheaper than the live gpt-4o on both axes, keeps per-session cost flat (D8).
// llm-client auto-prefixes 'openai/' when there is no '/'; the full slug is explicit here.
const FIDELITY_MODEL = process.env.LP_FIDELITY_MODEL || 'openai/gpt-5.6-luna';
const DEFAULT_MAX_TOKENS = 4000;
const EFFORTS = new Set(['minimal', 'low', 'medium', 'high']);

function promptVersion() {
  return String(process.env.LP_FIDELITY_PROMPT_VERSION || '').trim().toLowerCase() === 'v2' ? 'v2' : 'v1';
}

function reasoningEffort() {
  const e = String(process.env.LP_FIDELITY_REASONING_EFFORT || '').trim().toLowerCase();
  return EFFORTS.has(e) ? e : null;
}

function maxTokens() {
  const n = Number(process.env.LP_FIDELITY_MAX_TOKENS);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_MAX_TOKENS;
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

/**
 * @param {Array<object>} moves       prescribed move list (fidelity-moves-v1 objects)
 * @param {string}        transcript  the lesson transcript (Urdu/English, timestamped)
 * @param {object}        meta        { lesson_id, template, goal, total_minutes }
 * @param {object}        opts        { client, model, maxTokens, promptVersion, reasoningEffort, facts, photoEvidence }
 * @returns {Promise<{verdicts, narrative, language_note, moderators, usage, model, prompt_version, reasoning_effort,
 *                    recording, lesson_identity, lesson_stretches, photo_evidence_count}>}
 */
async function analyzeFidelity(moves, transcript, meta = {}, opts = {}) {
  const model = opts.model || FIDELITY_MODEL;
  const maxTok = opts.maxTokens || maxTokens();
  const client = opts.client || require('../../llm-client').getClient();
  const version = opts.promptVersion === 'v1' || opts.promptVersion === 'v2' ? opts.promptVersion : promptVersion();
  const effort = EFFORTS.has(opts.reasoningEffort) ? opts.reasoningEffort : reasoningEffort();
  const photos = normalisePhotoEvidence(opts.photoEvidence);

  let brief = version === 'v2' ? GRADER_BRIEF_V2 : GRADER_BRIEF;
  let user = version === 'v2'
    ? buildUserPromptV2(meta, moves, transcript, opts.facts || {})
    : buildUserPrompt(meta, moves, transcript);
  if (photos.length) {
    brief += PHOTO_EVIDENCE_SECTION;
    user += buildPhotoEvidenceBlock(photos);
  }

  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    const request = {
      model,
      temperature: 0, // luna accepts 0; minimises the ~±12pt run-to-run wobble (D23 — median on top)
      messages: [
        { role: 'system', content: brief },
        { role: 'user', content: user },
      ],
      max_completion_tokens: maxTok,
      response_format: { type: 'json_object' },
    };
    const retryEffort = !effort && lastErr && lastErr.code === 'empty_content' ? 'low' : null;
    if (effort || retryEffort) request.reasoning = { effort: effort || retryEffort };
    const response = await client.chat.completions.create(request);
    const choice = response.choices && response.choices[0];
    const content = choice && choice.message && choice.message.content;
    try {
      if (!content || !String(content).trim()) {
        const empty = new Error(`grader returned empty content (finish_reason=${(choice && choice.finish_reason) || 'unknown'})`);
        empty.code = 'empty_content';
        throw empty;
      }
      const parsed = safeJsonParse(content);
      // Some providers key the verdicts by move_id; the scorer reads an array.
      if (isPlainObject(parsed) && isPlainObject(parsed.verdicts)) {
        parsed.verdicts = Object.entries(parsed.verdicts)
          .map(([moveId, v]) => (isPlainObject(v) ? { move_id: moveId, ...v } : { move_id: moveId, verdict: v }));
      }
      // A usable grading MUST carry a verdicts array with at least one entry when moves were given.
      // (jsonrepair can coerce pure garbage into a verdict-less object; returning empty verdicts would
      // let the scorer read every move as not_done → a false 0% that blames the teacher — the D19 hazard.)
      if (!Array.isArray(parsed.verdicts) || (moves && moves.length > 0 && parsed.verdicts.length === 0)) {
        throw new Error('grader response has no usable verdicts');
      }
      return {
        verdicts: parsed.verdicts,
        narrative: parsed.narrative || null,
        language_note: parsed.language_note || null,
        moderators: parsed.moderators || null,
        usage: response.usage || {},
        model,
        prompt_version: version,
        reasoning_effort: request.reasoning ? request.reasoning.effort : null,
        recording: isPlainObject(parsed.recording) ? parsed.recording : null,
        lesson_identity: isPlainObject(parsed.lesson_identity) ? parsed.lesson_identity : null,
        lesson_stretches: Array.isArray(parsed.lesson_stretches) ? parsed.lesson_stretches : null,
        photo_evidence_count: photos.length,
      };
    } catch (e) {
      lastErr = e; // malformed / empty / no verdicts → retry once, then give up
    }
  }
  const err = new Error('fidelity_unavailable: grader returned unparseable JSON');
  err.cause = lastErr;
  err.code = 'fidelity_unavailable';
  throw err;
}

module.exports = { analyzeFidelity, FIDELITY_MODEL, safeJsonParse };
