'use strict';
/**
 * The one door's landing token: kind 'go', 24 hours, signed and checked through the hub's signer (web-quiz-token.js
 * sign / verify; nothing is added to that file).
 *
 *   { k:'go', uid, side, n, lang, src, exp }
 *     uid   users.id of the phone that asked (getOrCreateUser's row) — an id, never the phone
 *     side  teacher | child | join | unknown — what the bot thought when it replied; a HINT: the landing re-resolves
 *     n     an opaque nonce (22 chars); the server keeps { phone_norm, user_id } under it (go.store) — never in the URL
 *     lang  ur | bi
 *     src   typed | class_msg | card_share | menu | home | other — which words asked (EVENTS_V3 quiz_cmd{src})
 *
 * The landing is RE-USABLE for the token's life (a teacher who leaves through wa.me comes back by the same chat
 * button, RULING F9) on the first device that opened it; the WRITES it signs (role, bind) are single-use (go.store).
 * verifyGo(t) → { ok: payload } | { stale: payload } (genuine but expired) | null (forged, garbled, another kind).
 */
const WebQuizToken = require('../quiz/web-quiz-token');

const KIND = 'go';
const GO_TTL_S = 24 * 60 * 60;
const SIDES = Object.freeze(['teacher', 'child', 'join', 'unknown']);
const LANGS = Object.freeze(['ur', 'bi']);
const SRCS = Object.freeze(['typed', 'class_msg', 'card_share', 'menu', 'home', 'other']);
const NONCE_RX = /^[A-Za-z0-9_-]{22}$/;

/** The payload's fields when every one is in its set; else null. */
function fieldsOf({ uid, side, n, lang, src } = {}) {
  if (typeof uid !== 'string' || !uid || uid.length > 64) return null;
  if (!SIDES.includes(side) || !LANGS.includes(lang) || !SRCS.includes(src)) return null;
  if (typeof n !== 'string' || !NONCE_RX.test(n)) return null;
  return { uid, side, n, lang, src };
}

/** → the token, or null (a field outside its set, or no signing secret). `now` (ms) is for tests of expiry. */
function signGo(fields, { now = Date.now() } = {}) {
  const f = fieldsOf(fields);
  if (!f) return null;
  return WebQuizToken.sign({ k: KIND, ...f, exp: Math.floor(now / 1000) + GO_TTL_S });
}

function verifyGo(t) {
  if (typeof t !== 'string' || !t) return null;
  const fresh = WebQuizToken.verify(t, KIND);
  if (fresh && fieldsOf(fresh)) return { ok: fresh };
  const old = fresh ? null : WebQuizToken.verify(t, KIND, { allowExpired: true });
  if (old && fieldsOf(old)) return { stale: old };
  return null;
}

module.exports = { signGo, verifyGo, fieldsOf, GO_TTL_S, KIND, SIDES, LANGS, SRCS, NONCE_RX };
