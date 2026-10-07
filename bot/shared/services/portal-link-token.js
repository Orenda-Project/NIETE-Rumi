'use strict';
/**
 * PORTAL LINK TOKENS (pure).
 *
 * The link on a template's button logs one teacher into ONE area of the
 * portal, inside WhatsApp's own browser:
 *
 *   {k:'t', u, a?, exp}   24 h; u = users.id; a = the area (absent = training)
 *
 * AREAS are the parts of the portal a link may open. Training came first, and
 * its links carry no area, so every training link already sent keeps working;
 * any other area is named in the token. The portal decides what each area may
 * reach (dashboard/routes/portal-link.routes.js); this module only signs and
 * checks.
 *
 * Format and checks are the web quiz's (web-quiz-token.js): base64url(JSON
 * payload) + "." + base64url(HMAC-SHA256)[:22], compared in constant time,
 * the kind, the area and the expiry all checked.
 *
 * THE SECRET. WEB_TRAINING_TOKEN_SECRET when set, else derived from the
 * existing INTERNAL_API_KEY under its OWN label (both names predate the second
 * area, and are kept so issued links stay valid), so a web quiz token can never
 * pass as a portal link. The bot signs and the portal verifies, so both services
 * read the same key. Read at call time. With neither, signing returns null (the
 * caller sends the Flow) and every verify fails.
 *
 * The link is the login every time: WhatsApp's browser keeps its own cookies,
 * which we cannot make it keep, so a teacher whose session is gone asks again
 * and gets a fresh link.
 */

const crypto = require('crypto');

const DERIVE_LABEL = 'web-training-token-v1';
const SIG_LEN = 22;
const LINK_TTL_S = 24 * 60 * 60;
const KIND = 't';
const DEFAULT_AREA = 'training';
// 'probe' is not a portal area: it opens only the phone test page (/iab/<token>,
// dashboard/routes/iab-probe.routes.js), and /t refuses it.
const AREAS = Object.freeze(['training', 'lessons', 'probe']);

function secret() {
  const own = process.env.WEB_TRAINING_TOKEN_SECRET;
  if (own) return Buffer.from(own);
  const key = process.env.INTERNAL_API_KEY;
  if (!key) return null;
  return crypto.createHmac('sha256', key).update(DERIVE_LABEL).digest();
}

function mac(key, body) {
  return crypto.createHmac('sha256', key).update(body).digest('base64url').slice(0, SIG_LEN);
}

const nowS = () => Math.floor(Date.now() / 1000);

/** A link token for this teacher and area, or null (no teacher, unknown area, or no secret here). */
function signPortalLink(userId, area = DEFAULT_AREA) {
  const key = secret();
  if (!key || !userId || !AREAS.includes(area)) return null;
  const payload = { k: KIND, u: String(userId), ...(area === DEFAULT_AREA ? {} : { a: area }), exp: nowS() + LINK_TTL_S };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${mac(key, body)}`;
}

/** {u, area, exp, …} when the token is genuine, a portal link for a known area, and unexpired; else null. */
function verifyPortalLink(token) {
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
    if (!payload || payload.k !== KIND || !payload.u) return null;
    if (!payload.exp || payload.exp < nowS()) return null;
    const area = payload.a === undefined ? DEFAULT_AREA : payload.a;
    if (!AREAS.includes(area)) return null;
    return { ...payload, area };
  } catch {
    return null;
  }
}

module.exports = { signPortalLink, verifyPortalLink };
