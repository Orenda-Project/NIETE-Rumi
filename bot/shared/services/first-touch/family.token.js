'use strict';
/**
 * The family door's signed link: `<web base>/f/<token>`, the token signed exactly as the hub's (`web-quiz-token`'s
 * sign / verify, its secret), kind `f`, 24 hours. Claims: the users row id (`uid`), the reply's language (`lang`,
 * ur | bi), the phone's event key (`uk`, the sister's ukeyOf, or null) and `exp`. Never a phone, a name or a child key.
 * The base is the one the hub's /h/ links use (web-quiz-link webBaseUrl: WEB_QUIZ_BASE_URL, else PORTAL_URL).
 * null whenever a link cannot be made (no secret, no base, no token): the caller sends the plain-text fallback.
 */
const T = require('../quiz/web-quiz-token');
const Link = require('../quiz/web-quiz-link');

const FAMILY_KIND = 'f';
const FAMILY_TTL_S = 24 * 60 * 60;
const nowS = () => Math.floor(Date.now() / 1000);

/** → the signed token, or null (no secret). */
function mintFamilyToken({ uid, lang, ukey } = {}) {
  if (!uid) return null;
  return T.sign({ k: FAMILY_KIND, uid, lang: lang || null, uk: ukey || null, exp: nowS() + FAMILY_TTL_S });
}

/** → the claims when the token is genuine and of kind f (and unexpired unless `allowExpired`); else null. Never throws. */
function verifyFamilyToken(token, { allowExpired = false } = {}) {
  return T.verify(token, FAMILY_KIND, { allowExpired });
}

/** `<base>/f/<token>`, or null. Never throws. */
function familyUrl(token) {
  try {
    const base = Link.webBaseUrl();
    return token && base ? `${base}/f/${token}` : null;
  } catch (_) {
    return null;
  }
}

module.exports = { FAMILY_KIND, FAMILY_TTL_S, mintFamilyToken, verifyFamilyToken, familyUrl };
