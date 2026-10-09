'use strict';
/**
 * What a share picture is drawn from, and what its cache key is hashed from (web-quiz-art.js). The Urdu polish switch
 * (web-quiz-ur-polish.js) rides in as `ui` ONLY when on: off, the input — and so every key already in R2 — is exactly today's.
 * Its own module so a test of the input never loads the picture service (sharp, R2, the database).
 */
// The polished look's own version. Bump it when the polished template changes its look (sizes, lines, the pill): every
// picture drawn under the switch gets a new key and is drawn afresh; pictures with the switch off keep their keys.
// 2: the school line on the wide card.
const ART_UR2_V = 2;

function artInput(kind, size, brand, f, ui) {
  return { kind, size, brand, lang: f.lang, d: f.d, ...(ui && ui.ur2 === true ? { ui: { ur2: true, v: ART_UR2_V } } : {}) };
}

module.exports = { artInput, ART_UR2_V };
