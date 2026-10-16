'use strict';
/**
 * COACH CARD LINK (pure) — v10 coaching test, bd-v0toag.38.9.
 *
 * The link in the coach's WhatsApp ping: it opens ONE coach_visit_requests row's card on the portal
 * (`GET /cv/<token>`, dashboard/routes/coach-card.routes.js) — the teacher's score, section scores, reasons
 * and voice note — and signs nobody in. Built like report-link-token.js but under its own label and kind,
 * so a report link never opens a coach card and a coach card never opens a report.
 *
 * TOKEN: base64url(JSON {k:'cv', r: request id, exp}) "." base64url(HMAC-SHA256)[:22]. 30 days.
 * KEY: from INTERNAL_API_KEY, bound to the environment's Supabase host. No key or host → no link.
 */
const crypto = require('crypto');

const DERIVE_LABEL = 'coach-card-link-v1';
const KIND = 'cv';
const TTL_S = 30 * 24 * 60 * 60;
const SIG_LEN = 22;
const MAX_LEN = 400;
const CARD_PATH = '/cv';
const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BAD = Object.freeze({ ok: false });

function key() {
  const k = process.env.INTERNAL_API_KEY;
  let host = null;
  try { host = new URL(String(process.env.SUPABASE_URL || '').trim()).host.toLowerCase() || null; } catch (_) { host = null; }
  if (!k || !host) return null;
  return crypto.createHmac('sha256', k).update(`${DERIVE_LABEL}\u0000${host}`).digest();
}

const sign = (k, payload) => crypto.createHmac('sha256', k).update(payload).digest('base64url').slice(0, SIG_LEN);
const nowS = () => Math.floor(Date.now() / 1000);

function signCoachCard(requestId) {
  if (!UUID_RX.test(String(requestId || ''))) return null;
  const k = key();
  if (!k) return null;
  const payload = Buffer.from(JSON.stringify({ k: KIND, r: requestId, exp: nowS() + TTL_S })).toString('base64url');
  return `${payload}.${sign(k, payload)}`;
}

function verifyCoachCard(token) {
  if (typeof token !== 'string' || token.length > MAX_LEN) return BAD;
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || parts[1].length !== SIG_LEN) return BAD;
  const k = key();
  if (!k) return BAD;
  const want = Buffer.from(sign(k, parts[0]));
  const got = Buffer.from(parts[1]);
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return BAD;
  let p;
  try { p = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')); } catch (_) { return BAD; }
  if (!p || p.k !== KIND || !UUID_RX.test(String(p.r)) || !Number.isFinite(p.exp) || p.exp < nowS()) return BAD;
  return { ok: true, requestId: p.r };
}

/** The full link, or null when PORTAL_URL or the key is missing. */
function coachCardUrl(requestId) {
  const base = String(process.env.PORTAL_URL || '').trim().replace(/\/+$/, '');
  const token = base ? signCoachCard(requestId) : null;
  return token ? `${base}${CARD_PATH}/${token}` : null;
}

module.exports = { signCoachCard, verifyCoachCard, coachCardUrl, CARD_PATH };
