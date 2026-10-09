'use strict';
/**
 * APP LOGIN LINK (pure) — bd-fmf24g.35.
 *
 * The link a pilot teacher gets on WhatsApp in place of a feature: one tap opens the teacher app
 * ALREADY SIGNED IN, on the page for what she asked for (`GET /go/<token>`,
 * dashboard/routes/app-login.routes.js). It signs her into the WHOLE app, like a password login —
 * unlike the area-scoped portal links (portal-link-token.js), which is why this is its own module.
 *
 * TOKEN: base64url( iv[12] | AES-256-GCM ciphertext | tag[16] ) of {k:'app', u, f, exp}.
 *   - Encrypted, not merely signed: the user id (and so the phone) is not in the URL in the clear,
 *     not even as base64. Any change to any byte fails the GCM tag.
 *   - Nothing is stored, so there is no table; a tap consumes nothing, so the link is re-tappable
 *     until exp (24 h). The price: a link cannot be revoked before it expires. Whoever holds a
 *     forwarded link is her for those 24 h — the same exposure as the portal links.
 *   - KEY: derived from INTERNAL_API_KEY (the bot and the portal both read it) under its OWN label,
 *     so no other token family (web quiz, portal links) can pass as, or be forged from, this one.
 *     Read at call time. No key → sign returns null (the caller keeps the WhatsApp flow) and every
 *     verify fails.
 */
const crypto = require('crypto');

const DERIVE_LABEL = 'app-login-link-v1';
const KIND = 'app';
const TTL_S = 24 * 60 * 60;
const IV_LEN = 12;
const TAG_LEN = 16;
const MAX_LEN = 1024;

/** feature → the teacher-app (v2) page it lands on. The seven requests that have a v2 page; nothing else is linkable. */
const LANDINGS = Object.freeze({
  menu: '/portal/teacher',
  lesson_plan: '/portal/teacher/lessons',
  assessment_generator: '/portal/teacher/assessment',
  ai_coaching: '/portal/teacher/coaching',
  teacher_training: '/portal/teacher/training',
  attendance: '/portal/teacher/attendance',
  classes: '/portal/teacher/classes',
});
/** Where a teacher who is no longer on the teacher app lands instead (today's portal home). */
const LEGACY_LANDING = '/portal/dashboard';

function key() {
  const k = process.env.INTERNAL_API_KEY;
  if (!k) return null;
  return crypto.createHmac('sha256', k).update(DERIVE_LABEL).digest();
}

const nowS = () => Math.floor(Date.now() / 1000);

/** A link token for this teacher and feature, or null (no teacher, a feature with no v2 page, or no key here). */
function signAppLink(userId, feature) {
  const k = key();
  if (!k || !userId || !Object.prototype.hasOwnProperty.call(LANDINGS, feature)) return null;
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv('aes-256-gcm', k, iv);
  const plain = Buffer.from(JSON.stringify({ k: KIND, u: String(userId), f: feature, exp: nowS() + TTL_S }));
  const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([iv, enc, cipher.getAuthTag()]).toString('base64url');
}

/** {u, f, exp} when the token is genuine, for a linkable feature, and unexpired; else null. Never throws. */
function verifyAppLink(token) {
  try {
    const k = key();
    if (!k || typeof token !== 'string' || token.length < 40 || token.length > MAX_LEN) return null;
    if (!/^[A-Za-z0-9_-]+$/.test(token)) return null;
    const raw = Buffer.from(token, 'base64url');
    if (raw.length < IV_LEN + TAG_LEN + 2) return null;
    const decipher = crypto.createDecipheriv('aes-256-gcm', k, raw.subarray(0, IV_LEN));
    decipher.setAuthTag(raw.subarray(raw.length - TAG_LEN));
    const plain = Buffer.concat([decipher.update(raw.subarray(IV_LEN, raw.length - TAG_LEN)), decipher.final()]);
    const p = JSON.parse(plain.toString('utf8'));
    if (!p || p.k !== KIND || typeof p.u !== 'string' || !p.u) return null;
    if (!Object.prototype.hasOwnProperty.call(LANDINGS, p.f)) return null;
    if (!Number.isFinite(p.exp) || p.exp < nowS()) return null;
    return { u: p.u, f: p.f, exp: p.exp };
  } catch (_) {
    return null;
  }
}

module.exports = { signAppLink, verifyAppLink, LANDINGS, LEGACY_LANDING, TTL_S };
