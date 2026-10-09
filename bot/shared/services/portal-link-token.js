'use strict';
/**
 * PORTAL LINK TOKENS (pure).
 *
 * The link on a template's button logs one teacher into ONE area of the
 * portal, inside WhatsApp's own browser:
 *
 *   {k:'t', u, a?, i?, exp}   24 h; u = users.id; a = the area (absent = training);
 *                             i = the ITEM, for the 'ready' area only (see below)
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
const AREAS = Object.freeze(['training', 'lessons', 'probe', 'ready']);

/**
 * The 'ready' area (bd-fmf24g.15): the "Open in app" button on the WhatsApp message that follows a finished
 * paper or grades 6-12 lesson plan she did not see. Unlike the other areas it names ONE thing, so the link lands on
 * it: `paper:<assessment request uuid>` or `lesson:<segment id>:<en|ur>`. Nothing else may ride in a token — the
 * item is checked when it is signed and again when it is read, and a 'ready' token without a well-formed item is
 * no token at all.
 */
const ITEM_AREA = 'ready';
const ITEM_RE = /^(?:paper:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|lesson:[A-Za-z0-9._-]{1,120}:(?:en|ur))$/;
const validItem = (i) => typeof i === 'string' && ITEM_RE.test(i);

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

/**
 * A link token for this teacher and area, or null (no teacher, unknown area, or no secret here).
 * The 'ready' area takes `extra.i`, the item it opens, and is null without a well-formed one; any other area
 * ignores `extra`, so every link signed before this existed is signed exactly as it was.
 */
function signPortalLink(userId, area = DEFAULT_AREA, extra = undefined) {
  const key = secret();
  if (!key || !userId || !AREAS.includes(area)) return null;
  const item = area === ITEM_AREA ? (extra && extra.i) : undefined;
  if (area === ITEM_AREA && !validItem(item)) return null;
  const payload = {
    k: KIND, u: String(userId), ...(area === DEFAULT_AREA ? {} : { a: area }), ...(item ? { i: item } : {}), exp: nowS() + LINK_TTL_S,
  };
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
    if (area === ITEM_AREA && !validItem(payload.i)) return null;
    // Only the 'ready' area carries an item; anything a token of another area says about one is dropped.
    if (area !== ITEM_AREA && 'i' in payload) {
      const { i: _ignored, ...rest } = payload;
      return { ...rest, area };
    }
    return { ...payload, area };
  } catch {
    return null;
  }
}

module.exports = { signPortalLink, verifyPortalLink };
