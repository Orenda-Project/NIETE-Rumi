'use strict';
/**
 * The quiz-maker page's only identity: a 24-hour bearer token of kind 'm', signed and checked through the hub's
 * signer (web-quiz-token.js sign / verify; nothing is added to that file).
 *
 *   { k:'m', uid, lang, tour, pf?, via, uk?, exp }
 *     uid   users.id of the teacher the page acts as
 *     lang  en | ur | bi (bi → the Urdu page with an "English" switch)
 *     tour  0 | 1 (the tour seen or dismissed)
 *     pf    "grade_<n>|<subject code>" or absent (the pre-fill, computed when the cta is minted)
 *     via   door | menu | empty (which door the page was opened from)
 *     uk    the phone's event key (the sister's ukeyOf) or absent; never the phone
 *
 * verifyMaker(t) → { ok: payload } | { stale: payload } (genuine but expired) | null (forged, garbled, another kind).
 */
const WebQuizToken = require('../quiz/web-quiz-token');

const KIND = 'm';
const MAKER_TTL_S = 24 * 60 * 60;
const LANGS = Object.freeze(['en', 'ur', 'bi']);
const VIAS = Object.freeze(['door', 'menu', 'empty']);
const PF_RX = /^grade_[1-5]\|[a-z_]{2,40}$/;
const UK_RX = /^[0-9a-f]{16}$/;

/** The payload's fields when every one is in its set; else null. */
function fieldsOf({ uid, lang, tour, pf, via, uk } = {}) {
  if (typeof uid !== 'string' || !uid || uid.length > 64) return null;
  if (!LANGS.includes(lang) || !VIAS.includes(via) || (tour !== 0 && tour !== 1)) return null;
  const out = { uid, lang, tour, via };
  if (pf != null) { if (typeof pf !== 'string' || !PF_RX.test(pf)) return null; out.pf = pf; }
  if (uk != null) { if (typeof uk !== 'string' || !UK_RX.test(uk)) return null; out.uk = uk; }
  return out;
}

/** → the token, or null (a field outside its set, or no signing secret). `now` (ms) is for tests of expiry. */
function signMaker(fields, { now = Date.now() } = {}) {
  const f = fieldsOf(fields);
  if (!f) return null;
  return WebQuizToken.sign({ k: KIND, ...f, exp: Math.floor(now / 1000) + MAKER_TTL_S });
}

function verifyMaker(t) {
  if (typeof t !== 'string' || !t) return null;
  const fresh = WebQuizToken.verify(t, KIND);
  if (fresh && fieldsOf(fresh)) return { ok: fresh };
  const old = fresh ? null : WebQuizToken.verify(t, KIND, { allowExpired: true });
  if (old && fieldsOf(old)) return { stale: old };
  return null;
}

module.exports = { signMaker, verifyMaker, MAKER_TTL_S, KIND, LANGS, VIAS };
