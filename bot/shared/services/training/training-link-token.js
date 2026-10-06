'use strict';
/**
 * TRAINING LINK TOKENS (pure).
 *
 * The link in the training template's button logs one teacher into the
 * portal's training pages, inside WhatsApp's own browser:
 *
 *   t  training link  {k:'t', u, exp}   24 h; u = users.id
 *
 * Format and checks are the web quiz's (web-quiz-token.js): base64url(JSON
 * payload) + "." + base64url(HMAC-SHA256)[:22], compared in constant time,
 * the kind and the expiry both checked.
 *
 * THE SECRET. WEB_TRAINING_TOKEN_SECRET when set, else derived from the
 * existing INTERNAL_API_KEY under its OWN label, so a web quiz token can never
 * pass as a training link (or the other way round) and no new variable is
 * needed on any environment. The bot signs and the portal verifies, so both
 * services read the same key. Read at call time. With neither, signing returns
 * null (the caller sends the Flow) and every verify fails — fail closed, never
 * a token signed with an empty key.
 *
 * The link is the login every time: WhatsApp's browser keeps its own cookies,
 * which we cannot make it keep, so a teacher whose session is gone asks for
 * Training again and gets a fresh link.
 */

const crypto = require('crypto');

const DERIVE_LABEL = 'web-training-token-v1';
const SIG_LEN = 22;
const LINK_TTL_S = 24 * 60 * 60;
const KIND = 't';

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

/** A link token for this teacher, or null (no teacher, or no secret here). */
function signTrainingLink(userId) {
  const key = secret();
  if (!key || !userId) return null;
  const body = Buffer.from(JSON.stringify({ k: KIND, u: String(userId), exp: nowS() + LINK_TTL_S })).toString('base64url');
  return `${body}.${mac(key, body)}`;
}

/** The payload when the token is genuine, a training link, and unexpired; else null. */
function verifyTrainingLink(token) {
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
    return payload;
  } catch {
    return null;
  }
}

module.exports = { signTrainingLink, verifyTrainingLink };
