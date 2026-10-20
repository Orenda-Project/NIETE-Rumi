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

// The one share's room for the ink (web_quiz_share_v4, as `ui.ink`): its own version, so its pictures are drawn afresh.
const ART_INK_V = 1;

// Urdu digits on an Urdu picture (app_settings web_quiz_share_ur_digits, as `ui.ud`): its own version, so its pictures
// get new keys and are drawn afresh; with the switch off the key is today's.
const ART_UD_V = 1;

// The card's name fits its picture (app_settings web_quiz_share_name_fit, as `ui.nf`): its own version.
const ART_NF_V = 1;

// The Urdu card and challenge pictures as one stack, with the English pill's size (app_settings web_quiz_share_ur_stack,
// as `ui.us`): its own version.
const ART_US_V = 1;

// door: the invite drawn for the friend's door ("Your turn!" in place of the link pill); only then is it in the input,
// so every other picture's key is today's.
function artInput(kind, size, brand, f, ui, door = false) {
  const u = {
    ...(ui && ui.ur2 === true ? { ur2: true, v: ART_UR2_V } : {}),
    ...(ui && ui.ink === true ? { ink: true, iv: ART_INK_V } : {}),
    ...(ui && ui.ud === true ? { ud: true, dv: ART_UD_V } : {}),
    ...(ui && ui.nf === true ? { nf: true, nv: ART_NF_V } : {}),
    ...(ui && ui.us === true ? { us: true, sv: ART_US_V } : {}),
  };
  return { kind, size, brand, lang: f.lang, d: f.d, ...(Object.keys(u).length ? { ui: u } : {}), ...(door && kind === 'invite' ? { door: true } : {}) };
}

module.exports = { artInput, ART_UR2_V, ART_INK_V, ART_UD_V, ART_NF_V, ART_US_V };
