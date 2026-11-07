'use strict';
/**
 * v10 moves at runtime — a port of the offline extract_moves.py (bd-rj6w0n.14.16.6).
 * The model reads the v9 lesson and returns the move list; the tags the scorer relies on are applied in
 * code afterwards (applyTags), exactly as offline, so a model slip cannot change selection or timing.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const JOB = 'lp.v10moves';
const BRIEF = fs.readFileSync(path.join(__dirname, '../../../vendor/lp-v10/EXTRACTION_BRIEF.md'), 'utf8');
const BRIEF_SHA = crypto.createHash('sha1').update(BRIEF).digest('hex').slice(0, 12);

// A revision lesson renders only its panels; the spine fields would make the model invent moves for them.
const REVISION_DROP = ['iDo', 'weDo', 'youDo', 'exit', 'homework', 'hookConversation', 'hookTeacherScript',
  'hookObjects', 'boardWork', 'warmUpPeerMove', 'exitSuccessCriteria', 'exitSelfPredict', 'keyFacts',
  'reflection', 'navLocal', 'sloCode'];

let _jsonrepair = null;
try { _jsonrepair = require('jsonrepair').jsonrepair; } catch (_) { /* strict parse fallback */ }
function safeJsonParse(content) {
  const text = String(content).replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
  try { return JSON.parse(text); } catch (e) {
    if (!_jsonrepair) throw e;
    return JSON.parse(_jsonrepair(text));
  }
}

function normalize(lpDoc) {
  if (!lpDoc || !lpDoc.revisionPanels) return lpDoc;
  const out = { ...lpDoc };
  for (const k of REVISION_DROP) delete out[k];
  return out;
}

function buildPrompt(lpDoc, lessonId, brief = BRIEF) {
  return `FIDELITY-EXTRACT drone\n${brief}\n\nLESSON PLAN TEXT (lesson_id=${lessonId}):\n` + JSON.stringify(normalize(lpDoc));
}

function applyTags(moves, template) {
  const tagged = moves.map((m) => ({
    selection: 'none', track_time_on_task: false, adjudicable: true, observable_in_photo: false,
    prescribed_minutes: null, ...m,
  }));
  for (const m of tagged) {
    if (m.phase === 'independent' || m.phase === 'you_do') m.track_time_on_task = true;
  }
  const exits = tagged.filter((m) => m.phase === 'exit');
  if (template === 'REVISION') {
    for (const m of exits) { m.selection = 'per_group'; m.bucket = 'adaptive_set'; }
    return tagged;
  }
  if (exits.length > 1) {
    const [first] = exits;
    first.selection = 'choose_one';
    first.type = 'check';
    first.text = 'Run ONE exit check — teacher picks any one (or a better equivalent): '
      + exits.map((m, i) => `(${i + 1}) ${m.text}`).join(' | ');
    first.source_field = 'exit[] (choose one)';
    return tagged.filter((m) => m.phase !== 'exit' || m === first);
  }
  if (exits.length === 1) exits[0].selection = 'choose_one';
  return tagged;
}

async function extractMoves({ lpDoc, lessonId, client, model, maxTokens = 6000, sourcePath = null }) {
  const llm = client || require('../llm-client').getClient();
  const useModel = model || require('../../config/model-registry').modelFor(JOB);
  const prompt = buildPrompt(lpDoc, lessonId);
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await llm.chat.completions.create({
      model: useModel, job: JOB, temperature: 0,
      messages: [{ role: 'user', content: prompt }],
      max_completion_tokens: maxTokens,
      response_format: { type: 'json_object' },
    });
    const choice = response.choices && response.choices[0];
    try {
      const obj = safeJsonParse((choice && choice.message && choice.message.content) || '');
      const raw = obj.moves || obj.actions || [];
      if (!raw.length) throw new Error('no moves in the model reply');
      const template = obj.template || 'STANDARD';
      return {
        schema_version: 'fidelity-moves-v1', brief_sha: BRIEF_SHA, lesson_id: lessonId, template,
        total_minutes: obj.total_minutes || obj.totalMinutes || null, extracted_at: new Date().toISOString(),
        seat: 'runtime', model: useModel, lp_version: 'v9', source_format: 'lp_doc', source_path: sourcePath,
        moves: applyTags(raw, template), usage: response.usage || {},
      };
    } catch (e) { lastErr = e; }
  }
  const err = new Error(`v10 moves: no moves after 2 attempts (${lastErr && lastErr.message})`);
  err.cause = lastErr;
  throw err;
}

module.exports = { JOB, BRIEF_SHA, normalize, buildPrompt, applyTags, extractMoves };
