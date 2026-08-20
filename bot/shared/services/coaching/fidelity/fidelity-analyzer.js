'use strict';
/**
 * P3.1 — the fidelity LLM grader. Given the prescribed moves + the lesson transcript, calls
 * gpt-5.6-luna (decision D8) and returns per-move VERDICTS ONLY — it never computes a score
 * (that is fidelity-scorer's job; D6 keeps the rubric drift-free in code).
 *
 * Model, prompt and cross-language behaviour are the offline-validated ones (Evals 5 & 6). The call
 * mirrors GPT5MiniService.completeJson: OpenRouter client via getClient(), json_object mode,
 * jsonrepair on parse. The client is injectable (opts.client) so unit tests never hit the network.
 */
const { GRADER_BRIEF, buildUserPrompt } = require('./grader-prompt');

// jsonrepair is a belt-and-suspenders repair for slightly-malformed model JSON (matches
// GPT5MiniService). Load it lazily so this module still loads where the optional dep isn't resolved.
let _jsonrepair = null;
try { _jsonrepair = require('jsonrepair').jsonrepair; } catch (_) { /* fall back to strict parse */ }

// gpt-5.6-luna: cheaper than the live gpt-4o on both axes, keeps per-session cost flat (D8).
// llm-client auto-prefixes 'openai/' when there is no '/'; the full slug is explicit here.
const FIDELITY_MODEL = process.env.LP_FIDELITY_MODEL || 'openai/gpt-5.6-luna';

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
 * @param {object}        opts        { client, model, maxTokens }
 * @returns {Promise<{verdicts, narrative, language_note, moderators, usage, model}>}
 */
async function analyzeFidelity(moves, transcript, meta = {}, opts = {}) {
  const model = opts.model || FIDELITY_MODEL;
  const maxTokens = opts.maxTokens || 4000;
  const client = opts.client || require('../../llm-client').getClient();
  const user = buildUserPrompt(meta, moves, transcript);

  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await client.chat.completions.create({
      model,
      temperature: 0, // luna accepts 0; minimises the ~±12pt run-to-run wobble (D23 — median on top)
      messages: [
        { role: 'system', content: GRADER_BRIEF },
        { role: 'user', content: user },
      ],
      max_completion_tokens: maxTokens,
      response_format: { type: 'json_object' },
    });
    const choice = response.choices && response.choices[0];
    const content = choice && choice.message && choice.message.content;
    try {
      const parsed = safeJsonParse(content || '');
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
      };
    } catch (e) {
      lastErr = e; // malformed / no verdicts → retry once, then give up
    }
  }
  const err = new Error('fidelity_unavailable: grader returned unparseable JSON');
  err.cause = lastErr;
  err.code = 'fidelity_unavailable';
  throw err;
}

module.exports = { analyzeFidelity, FIDELITY_MODEL, safeJsonParse };
