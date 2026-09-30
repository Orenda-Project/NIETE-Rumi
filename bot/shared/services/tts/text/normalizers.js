'use strict';
/**
 * Per-language text clean-up for the ElevenLabs and OpenAI voices.
 *
 * Language is data, not code: which language gets which clean-up is this table,
 * so adding one (a Kiswahili or Arabic number normaliser, say) is a row here and
 * no provider changes. A language with no row is spoken exactly as written.
 * Soniox has its own, fuller pipeline (soniox-text.js).
 */

const { normalizeForUrduTTS } = require('../../urdu-tts-normalizer');

// The Urdu voice renders bare digits as gibberish and reads Markdown markers
// aloud; decimals must be one number ("thirty-one point three").
const NORMALIZERS = Object.freeze({ ur: normalizeForUrduTTS });

/**
 * @param {string} language  e.g. 'ur', 'ur-PK', 'en'
 * @param {string} text
 * @returns {string} the text the voice should receive
 */
function normalizeFor(language, text) {
  const normalize = NORMALIZERS[String(language || '').toLowerCase().split('-')[0]];
  return normalize ? normalize(text) : text;
}

module.exports = { normalizeFor, NORMALIZERS };
