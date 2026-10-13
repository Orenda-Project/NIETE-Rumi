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
 *   - BOUND TO THE ENVIRONMENT (bd-fmf24g.40): INTERNAL_API_KEY is the SAME on staging and production,
 *     so a key from it alone let a staging-minted link sign the same users.id into production. The key
 *     also takes the environment's Supabase host (SUPABASE_URL): every bot, worker and portal service of
 *     one environment carries the same one, and no two environments share it — so no new env var. A
 *     token from another environment fails the GCM tag. No SUPABASE_URL, or one that is not a URL → no key.
 *     The label moved to v2 with it, so a link minted before the change no longer opens anything.
 */
const crypto = require('crypto');
const { isJourneyId } = require('./app-journey');

const DERIVE_LABEL = 'app-login-link-v2';
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

/**
 * bd-fmf24g.52 — the COACH app's pages, for a pilot coach (app-redirect.service.js COACH_LINKS): /menu → coach Home,
 * /observe → the coach app's Observe page. Their own names, so a coach token can never be read as a teacher feature
 * and /go asks the coach-app question for them only. A coach no longer on the coach app lands on LEGACY_LANDING.
 */
const COACH_LANDINGS = Object.freeze({
  coach_menu: '/portal/coach',
  coach_observe: '/portal/coach/observe',
});

/** A feature a token may carry: a teacher page or a coach page. Anything else cannot be signed or verified. */
const linkable = (f) => typeof f === 'string'
  && (Object.prototype.hasOwnProperty.call(LANDINGS, f) || Object.prototype.hasOwnProperty.call(COACH_LANDINGS, f));

/** This environment, as its Supabase host (`<ref>.supabase.co`), or null when SUPABASE_URL is missing or not a URL. */
function environment() {
  const raw = process.env.SUPABASE_URL;
  if (!raw) return null;
  try {
    const { protocol, host } = new URL(String(raw).trim());
    if (!host || !/^https?:$/.test(protocol)) return null;
    return host.toLowerCase();
  } catch (_) {
    return null;
  }
}

function key() {
  const k = process.env.INTERNAL_API_KEY;
  const env = environment();
  if (!k || !env) return null;
  return crypto.createHmac('sha256', k).update(`${DERIVE_LABEL}\u0000${env}`).digest();
}

const nowS = () => Math.floor(Date.now() / 1000);

/**
 * A link token for this user and feature, or null (no user, a feature with no app page, or no key here).
 * bd-4r3rei: `journeyId` (app-journey.js) rides inside the encrypted payload so the portal can join her page views to
 * the WhatsApp message that sent her. Optional; anything that is not a journey id is not carried.
 */
function signAppLink(userId, feature, journeyId) {
  const k = key();
  if (!k || !userId || !linkable(feature)) return null;
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv('aes-256-gcm', k, iv);
  const body = { k: KIND, u: String(userId), f: feature, exp: nowS() + TTL_S };
  if (isJourneyId(journeyId)) body.j = journeyId;
  const plain = Buffer.from(JSON.stringify(body));
  const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([iv, enc, cipher.getAuthTag()]).toString('base64url');
}

/** {u, f, exp, j} when the token is genuine, for a linkable feature, and unexpired; else null. `j` is the journey id, or null for a link sent before bd-4r3rei. Never throws. */
function verifyAppLink(token) {
  try {
    const k = key();
    if (!k || typeof token !== 'string' || token.length < 40 || token.length > MAX_LEN) return null;
    if (!/^[A-Za-z0-9_-]+$/.test(token)) return null;
    const raw = Buffer.from(token, 'base64url');
    // Canonical form only: the last base64 character can carry spare bits, and a token that decodes to the same bytes
    // by a different spelling is not the token we issued.
    if (raw.toString('base64url') !== token) return null;
    if (raw.length < IV_LEN + TAG_LEN + 2) return null;
    const decipher = crypto.createDecipheriv('aes-256-gcm', k, raw.subarray(0, IV_LEN));
    decipher.setAuthTag(raw.subarray(raw.length - TAG_LEN));
    const plain = Buffer.concat([decipher.update(raw.subarray(IV_LEN, raw.length - TAG_LEN)), decipher.final()]);
    const p = JSON.parse(plain.toString('utf8'));
    if (!p || p.k !== KIND || typeof p.u !== 'string' || !p.u) return null;
    if (!linkable(p.f)) return null;
    if (!Number.isFinite(p.exp) || p.exp < nowS()) return null;
    return { u: p.u, f: p.f, exp: p.exp, j: isJourneyId(p.j) ? p.j : null };
  } catch (_) {
    return null;
  }
}

module.exports = { signAppLink, verifyAppLink, LANDINGS, COACH_LANDINGS, LEGACY_LANDING, TTL_S };
