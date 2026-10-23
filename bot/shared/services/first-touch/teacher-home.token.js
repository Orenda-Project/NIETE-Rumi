'use strict';
/**
 * The teacher home's only identity: a 24-hour bearer token of kind 'th', signed and checked through the hub's signer
 * (web-quiz-token.js sign / verify; nothing is added to that file). Re-usable for landing until it expires: a teacher
 * who leaves through wa.me comes back by tapping the same chat button.
 *
 *   { k:'th', uid, lang, via, exp }
 *     uid   users.id of the teacher the page acts as (the page greets from the users row, never from the URL)
 *     lang  en | ur | bi (bi → the Urdu page with an "English" switch)
 *     via   go | role | menu | maker | report | portal (which door the page was opened from; portal = the teacher app's home card)
 *
 * The one-door landing may sign this exact shape itself; verifyTeacherHome accepts it.
 * verifyTeacherHome(t) → { ok: payload } | { stale: payload } (genuine but expired) | null (forged, garbled, another kind).
 */
const WebQuizToken = require('../quiz/web-quiz-token');

const KIND = 'th';
const HOME_TTL_S = 24 * 60 * 60;
const LANGS = Object.freeze(['en', 'ur', 'bi']);
const VIAS = Object.freeze(['go', 'role', 'menu', 'maker', 'report', 'portal']);

function fieldsOf({ uid, lang, via } = {}) {
  if (typeof uid !== 'string' || !uid || uid.length > 64) return null;
  if (!LANGS.includes(lang) || !VIAS.includes(via)) return null;
  return { uid, lang, via };
}

/** → the token, or null (a field outside its set, or no signing secret). `now` (ms) is for tests of expiry. */
function signTeacherHome(fields, { now = Date.now() } = {}) {
  const f = fieldsOf(fields);
  if (!f) return null;
  return WebQuizToken.sign({ k: KIND, ...f, exp: Math.floor(now / 1000) + HOME_TTL_S });
}

function verifyTeacherHome(t) {
  if (typeof t !== 'string' || !t) return null;
  const fresh = WebQuizToken.verify(t, KIND);
  if (fresh && fieldsOf(fresh)) return { ok: fresh };
  const old = fresh ? null : WebQuizToken.verify(t, KIND, { allowExpired: true });
  if (old && fieldsOf(old)) return { stale: old };
  return null;
}

/** The page's path on the portal's web base (the caller prefixes the base, as the hub link does). */
const teacherHomePath = (token) => `/quiz/teacher/${token}`;

module.exports = { signTeacherHome, verifyTeacherHome, teacherHomePath, HOME_TTL_S, KIND, LANGS, VIAS };
