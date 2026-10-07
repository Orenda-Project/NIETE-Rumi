'use strict';
/**
 * WEB QUIZ TOKENS (pure).
 *
 * The child's web page holds three things the server later trusts, and each is
 * signed here:
 *
 *   st  session token  {k:'s', sid, d, sc, exp}   7 days (SYNC_TTL_S): a child who finishes
 *                                                  offline still lands the result days later;
 *                                                  the resume window is quiz_sessions.expires_at
 *                                                  (SESSION_TTL_S, 24 h), not this
 *   p   preview token  {k:'p', sc, t, exp}         30 days, like the share code; the
 *                                                  teacher's own run (recorded as a
 *                                                  self-test, never a child)
 *   ct  challenge token {k:'c', sid, ex, r, exp}  2 h: one run of one Challenge
 *                                                  exercise (sid = the student, r = the
 *                                                  run id; web-quiz-challenge.js)
 *   h   hub token      {k:'h', ids, exp}           7 days; the WhatsApp /quiz link to a
 *                                                  phone's own children (≤4 student ids,
 *                                                  never a name, never the phone)
 *   x   handset link   {k:'x', n, sc, exp}         1 hour: rides the FRAGMENT of a web link the
 *                                                  bot sends to ONE phone (the old-link redirect);
 *                                                  n = a random nonce the server keeps that phone's
 *                                                  children under (Redis, web-quiz-handset.js),
 *                                                  sc = the share code it was sent for. Carries no
 *                                                  id, no name, no phone: the page redeems it once
 *   chip               HMAC(secret, shareCodeId|studentId)[:16] — a child's name
 *                      button; not reversible, recomputed over the class
 *
 * Format: base64url(JSON payload) + "." + base64url(HMAC-SHA256)[:22], compared
 * in constant time.
 *
 * THE SECRET. WEB_QUIZ_TOKEN_SECRET when set, else derived from the existing
 * INTERNAL_API_KEY (HMAC-SHA256(key, "web-quiz-token-v1")), so no new variable
 * is needed on any environment. Read at call time. With neither, every sign
 * returns null and every verify fails: the API answers "web quiz off" — fail
 * closed, never a token signed with an empty key.
 *
 * device_ref is minted here too: 16 random bytes, never derived from anything a
 * child typed, never a phone.
 */
const crypto = require('crypto');

const DERIVE_LABEL = 'web-quiz-token-v1';
const SIG_LEN = 22;
const SESSION_TTL_S = 24 * 60 * 60;
const SYNC_TTL_S = 7 * 24 * 60 * 60;
const PREVIEW_TTL_S = 30 * 24 * 60 * 60;
const CHALLENGE_TTL_S = 2 * 60 * 60;
const HUB_TTL_S = 7 * 24 * 60 * 60;
const HUB_MAX_KIDS = 4;
// From the measured tap delay after a redirect (median 20 s, max 15 min): one hour covers every tap seen.
const HANDSET_TTL_S = 60 * 60;
const NONCE_RX = /^[A-Za-z0-9_-]{22}$/;
const DEVICE_REF_RX = /^[A-Za-z0-9_-]{22}$/;

// Stable per child (hash of the student id), so the same animal shows on every
// phone; the page owns the pictures.
const ANIMALS = Object.freeze([
  'cat', 'dog', 'rabbit', 'parrot', 'fish', 'turtle',
  'lion', 'elephant', 'owl', 'butterfly', 'bee', 'horse',
]);

function secret() {
  const own = process.env.WEB_QUIZ_TOKEN_SECRET;
  if (own) return Buffer.from(own);
  const key = process.env.INTERNAL_API_KEY;
  if (!key) return null;
  return crypto.createHmac('sha256', key).update(DERIVE_LABEL).digest();
}

function mac(key, body) {
  return crypto.createHmac('sha256', key).update(body).digest('base64url').slice(0, SIG_LEN);
}

function sign(payload) {
  const key = secret();
  if (!key || !payload) return null;
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${mac(key, body)}`;
}

/** The payload when the token is genuine, of `kind`, and unexpired; else null. */
function verify(token, kind) {
  try {
    const key = secret();
    if (!key || typeof token !== 'string' || token.length > 1024) return null;
    const dot = token.indexOf('.');
    if (dot < 1) return null;
    const body = token.slice(0, dot);
    const sig = token.slice(dot + 1);
    const want = mac(key, body);
    if (sig.length !== want.length) return null;
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload || payload.k !== kind) return null;
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

const nowS = () => Math.floor(Date.now() / 1000);

function signSession({ sessionId, deviceRef, shareCodeId }) {
  return sign({ k: 's', sid: sessionId, d: deviceRef, sc: shareCodeId, exp: nowS() + SYNC_TTL_S });
}

function signPreview({ shareCodeId, teacherUserId }) {
  if (!shareCodeId || !teacherUserId) return null;
  return sign({ k: 'p', sc: shareCodeId, t: teacherUserId, exp: nowS() + PREVIEW_TTL_S });
}

function signChallenge({ studentId, ex, runId }) {
  if (!studentId || !ex || !runId) return null;
  return sign({ k: 'c', sid: studentId, ex, r: runId, exp: nowS() + CHALLENGE_TTL_S });
}

/** The kid hub's link token: this phone's children (≤4 ids). Null with none or no secret. */
function signHub(studentIds) {
  const ids = [...new Set((Array.isArray(studentIds) ? studentIds : []).map(String).filter(Boolean))].slice(0, HUB_MAX_KIDS);
  if (!ids.length) return null;
  return sign({ k: 'h', ids, exp: nowS() + HUB_TTL_S });
}

/** A handset-link nonce: 16 random bytes, never derived from anything. */
function newNonce() {
  return crypto.randomBytes(16).toString('base64url');
}

/** The handset link token for one bot-sent web link: the nonce, the code it is for (null = none), one hour. */
function signHandset({ n, shareCodeId = null } = {}) {
  if (typeof n !== 'string' || !NONCE_RX.test(n)) return null;
  return sign({ k: 'x', n, sc: shareCodeId || null, exp: nowS() + HANDSET_TTL_S });
}

function chipId(shareCodeId, studentId) {
  const key = secret();
  if (!key || !shareCodeId || !studentId) return null;
  return crypto.createHmac('sha256', key).update(`${shareCodeId}|${studentId}`).digest('hex').slice(0, 16);
}

function newDeviceRef() {
  return crypto.randomBytes(16).toString('base64url');
}

/** A device_ref the page sent back, if it is one we could have minted. */
function cleanDeviceRef(v) {
  return typeof v === 'string' && DEVICE_REF_RX.test(v) ? v : null;
}

function animalFor(studentId) {
  const h = crypto.createHash('sha256').update(String(studentId || '')).digest();
  return ANIMALS[h.readUInt32BE(0) % ANIMALS.length];
}

module.exports = {
  secret, sign, verify, signSession, signPreview, signChallenge, signHub, signHandset, newNonce, chipId,
  newDeviceRef, cleanDeviceRef, animalFor, ANIMALS,
  SESSION_TTL_S, SYNC_TTL_S, PREVIEW_TTL_S, CHALLENGE_TTL_S, HUB_TTL_S, HUB_MAX_KIDS, HANDSET_TTL_S,
};
