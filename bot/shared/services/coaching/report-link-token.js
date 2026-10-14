'use strict';
/**
 * COACHING REPORT LINK (pure) — v10 coaching test, bd-v0toag.18.
 *
 * The link in group C and D's report: it opens ONE coaching report on the portal (`GET /cr/<token>`,
 * dashboard/routes/coaching-report.routes.js), read-only, and signs nobody in. So, unlike the 24 h
 * sign-in links (app-login-link.js, portal-link-token.js), it can last: 120 days, past the end of the
 * test and its reading. A forwarded link shows that one report and nothing else.
 *
 * TOKEN: base64url(JSON {k:'cr', s: session id, u: user id, exp}) "." base64url(HMAC-SHA256)[:22].
 *   - KEY: derived from INTERNAL_API_KEY (the bot and the portal both read it) under its OWN label, and
 *     bound to the environment's Supabase host the way app-login-link.js is (INTERNAL_API_KEY is the same
 *     on staging and production). No key or no host → sign returns null and every verify is bad.
 *   - verify tells an expired link from a bad one, so the page can send an expired one to sign-in
 *     instead of a dead page (Amena, 14 Oct).
 */
const crypto = require('crypto');

const DERIVE_LABEL = 'coaching-report-link-v1';
const KIND = 'cr';
const TTL_S = 120 * 24 * 60 * 60;
const SIG_LEN = 22;
const MAX_LEN = 600;
const REPORT_PATH = '/cr';
const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

const sign = (k, payload) => crypto.createHmac('sha256', k).update(payload).digest('base64url').slice(0, SIG_LEN);
const nowS = () => Math.floor(Date.now() / 1000);

function signReportLink(ids) {
  const { sessionId, userId } = ids || {};
  if (!UUID_RX.test(String(sessionId || '')) || !UUID_RX.test(String(userId || ''))) return null;
  const k = key();
  if (!k) return null;
  const payload = Buffer.from(JSON.stringify({ k: KIND, s: sessionId, u: userId, exp: nowS() + TTL_S })).toString('base64url');
  return `${payload}.${sign(k, payload)}`;
}

const BAD = Object.freeze({ ok: false, reason: 'bad' });

function verifyReportLink(token) {
  if (typeof token !== 'string' || token.length > MAX_LEN) return BAD;
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || parts[1].length !== SIG_LEN) return BAD;
  const k = key();
  if (!k) return BAD;
  const want = Buffer.from(sign(k, parts[0]));
  const got = Buffer.from(parts[1]);
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return BAD;
  let p;
  try {
    p = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
  } catch (_) {
    return BAD;
  }
  if (!p || p.k !== KIND || !UUID_RX.test(String(p.s)) || !UUID_RX.test(String(p.u)) || !Number.isFinite(p.exp)) return BAD;
  if (p.exp < nowS()) return { ok: false, reason: 'expired' };
  return { ok: true, sessionId: p.s, userId: p.u };
}

/** The full link for the report, or null when PORTAL_URL or the key is missing (the caller keeps today's report). */
function reportLinkUrl(ids) {
  const base = String(process.env.PORTAL_URL || '').trim().replace(/\/+$/, '');
  if (!base) return null;
  const token = signReportLink(ids);
  return token ? `${base}${REPORT_PATH}/${token}` : null;
}

module.exports = { signReportLink, verifyReportLink, reportLinkUrl, REPORT_PATH, TTL_S };
