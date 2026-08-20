'use strict';
/**
 * P1.3 — extract a move-list from a teacher's OWN uploaded lesson plan ("Add my own lesson plan").
 * Free-form LP text → the same fidelity-moves-v1 schema the corpus projector emits, so the grader +
 * scorer are identical downstream. The LLM assigns the tags (no field-paths in an uploaded doc).
 * gpt-5.6-luna (D8), json_object mode, jsonrepair-tolerant, injectable client. Validated on 8 real
 * uploaded LPs (Eval 6). Refs: bd-wmfsp.4.
 *
 * NOTE (Eval 6 / D21): image-only PDFs (scanned/photographed LPs) have no text layer — the CALLER must
 * sniff the real type and run a vision read before this; here we require usable text and fail loudly if absent.
 */
const { UPLOAD_EXTRACTION_BRIEF, buildUploadPrompt } = require('./upload-extractor-prompt');

const FIDELITY_MODEL = process.env.LP_FIDELITY_MODEL || 'openai/gpt-5.6-luna';
const PHASES = new Set(['warm_up', 'hook', 'recall', 'announce', 'explain', 'guided', 'independent', 'peer_review', 'exit', 'homework']);
const BUCKETS = new Set(['must_happen', 'adaptive_set', 'optional_extension']);
const SELECTIONS = new Set(['none', 'choose_one', 'per_group']);

let _jsonrepair = null;
try { _jsonrepair = require('jsonrepair').jsonrepair; } catch (_) { /* strict parse fallback */ }
function safeJsonParse(content) {
  try { return JSON.parse(content); } catch (e) {
    if (!_jsonrepair) throw e;
    return JSON.parse(_jsonrepair(content));
  }
}

// Defensively normalise the LLM's move objects — never let a malformed tag reach the scorer.
function normalizeMoves(moves) {
  return (moves || []).map((m, i) => ({
    move_id: m.move_id || `m${i + 1}`,
    phase: PHASES.has(m.phase) ? m.phase : 'explain',
    type: m.type || 'instruction',
    text: (m.text || '').trim(),
    source_field: 'uploaded',
    bucket: BUCKETS.has(m.bucket) ? m.bucket : 'must_happen',
    selection: SELECTIONS.has(m.selection) ? m.selection : 'none',
    track_time_on_task: m.track_time_on_task === true,
    prescribed_minutes: Number.isFinite(m.prescribed_minutes) ? m.prescribed_minutes : null,
    adjudicable: m.adjudicable !== false,
    observable_in_photo: m.observable_in_photo === true,
  })).filter((m) => m.text.length > 0);
}

/**
 * @param {string} lpText  the uploaded LP's extracted text (must have a real text layer — D21)
 * @param {{lessonId?:string, client?:object, model?:string, maxTokens?:number}} opts
 * @returns {Promise<{template:'UPLOADED', goal, total_minutes, moves, usage, model}>}
 */
async function extractUploadedLp(lpText, opts = {}) {
  if (!lpText || lpText.trim().length < 40) {
    const err = new Error('lp_unparseable: uploaded LP has no usable text (scanned image-PDF? needs a vision read — D21)');
    err.code = 'lp_unparseable';
    throw err;
  }
  const model = opts.model || FIDELITY_MODEL;
  const client = opts.client || require('../../llm-client').getClient();
  const user = buildUploadPrompt(lpText, opts.lessonId);

  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await client.chat.completions.create({
      model,
      temperature: 0,
      messages: [{ role: 'system', content: UPLOAD_EXTRACTION_BRIEF }, { role: 'user', content: user }],
      max_completion_tokens: opts.maxTokens || 4000,
      response_format: { type: 'json_object' },
    });
    const choice = response.choices && response.choices[0];
    try {
      const parsed = safeJsonParse((choice && choice.message && choice.message.content) || '');
      const moves = normalizeMoves(parsed.moves);
      if (moves.length === 0) throw new Error('no moves extracted');
      return {
        template: 'UPLOADED',
        goal: parsed.goal || null,
        total_minutes: Number.isFinite(parsed.total_minutes) ? parsed.total_minutes : null,
        moves,
        usage: response.usage || {},
        model,
      };
    } catch (e) { lastErr = e; }
  }
  const err = new Error('lp_unparseable: extractor returned no usable moves');
  err.cause = lastErr;
  err.code = 'lp_unparseable';
  throw err;
}

module.exports = { extractUploadedLp, normalizeMoves, FIDELITY_MODEL };
