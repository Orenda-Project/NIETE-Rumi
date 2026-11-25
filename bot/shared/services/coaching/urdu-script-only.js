'use strict';

/**
 * No Devanagari in what a model writes for a coach or a teacher.
 *
 * The transcript guard keeps Devanagari out of TRANSCRIPTS (audio.service transcribe, three layers). The model still
 * writes the odd Hindi-script word into its own Urdu: FICO evidence, the report narrative, the focus area, strengths,
 * the reflective corpus and questions. We ship no Devanagari font, so the report image prints those words as boxes,
 * and a coach reading the review form, or a teacher reading her report, cannot read them.
 *
 * This runs devanagari-guard's one converter over every string of a model's reply, once, right where the reply is
 * produced and before it is stored, rendered or spoken. It is a pure post-process: English and Urdu pass through
 * unchanged, and a reply with no Devanagari comes back as the very same value.
 *
 * Wired in at: the analysis write (analysis-processor), the LP-fidelity grade,
 * the reflection pass (report-generator), the report narrative, and GPT5MiniService's completeJson, reflective
 * question, lesson topic/subject and voice-debrief script.
 *
 * A conversion is logged at warn with where it happened and how much, never the sentence: it is a model slip worth
 * counting, not an outage.
 */

const { ensureNoDevanagariDeep } = require('../../utils/devanagari-guard');
const { logToFile } = require('../../utils/logger');

/**
 * @param {*} value - a model reply (parsed JSON or a string)
 * @param {string} where - which reply this is, for the log ('analysis', 'narrative', 'completeJson:<label>', …)
 * @param {object} [ctx] - extra log fields, e.g. { coachingSessionId }
 * @returns {*} value with every Devanagari run transliterated to Urdu script
 */
function urduScriptOnly(value, where, ctx = {}) {
  return ensureNoDevanagariDeep(value, {
    onDetected: ({ count, strings, paths, sample }) => logToFile(
      '⚠️ Model wrote Devanagari into coaching text — converted to Urdu script before it is stored or shown',
      { where, ...ctx, devanagariChars: count, strings, paths, sample },
      'warn',
    ),
  });
}

module.exports = { urduScriptOnly };
