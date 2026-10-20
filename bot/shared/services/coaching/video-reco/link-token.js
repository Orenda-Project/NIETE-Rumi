'use strict';
/**
 * VIDEO RECOMMENDATION LINK (pure) — bd-gzfdu9 (VIDREC).
 *
 * The link in the "watch this clip" message and on the /cr card: it opens ONE recommended training clip on
 * the portal (`GET /v/<token>`, dashboard/routes/video-reco.routes.js), signs nobody in, and lasts 120 days
 * like the report link it sits beside.
 *
 * TOKEN: base64url(JSON {k:'vr', r: recommendation id, u: user id, s: surface, exp}) "." base64url(HMAC-SHA256)[:22].
 * `s` is where the link was put — 'wa' (the WhatsApp message), 'cr' (the /cr card), 'portal' (the app) — so the
 * player's events say which surface the teacher came from (r-ab ab/EVENTS_SCHEMA.md §2).
 * The scheme of report-link-token.js under its OWN derive label and kind, so a /cr token never opens a clip
 * and a /v token never opens a report. Ids only: no name or phone ever rides in the URL.
 */
const crypto = require('crypto');

const DERIVE_LABEL = 'video-reco-link-v1';
const KIND = 'vr';
const TTL_S = 120 * 24 * 60 * 60;
const SIG_LEN = 22;
const MAX_LEN = 600;
const VIDEO_PATH = '/v';
const SURFACES = new Set(['wa', 'cr', 'portal']);
const surfaceOf = (v) => (SURFACES.has(v) ? v : 'wa');
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

function signVideoLink(ids) {
  const { recommendationId, userId, surface } = ids || {};
  if (!UUID_RX.test(String(recommendationId || '')) || !UUID_RX.test(String(userId || ''))) return null;
  const k = key();
  if (!k) return null;
  const payload = Buffer.from(JSON.stringify({ k: KIND, r: recommendationId, u: userId, s: surfaceOf(surface), exp: nowS() + TTL_S })).toString('base64url');
  return `${payload}.${sign(k, payload)}`;
}

const BAD = Object.freeze({ ok: false, reason: 'bad' });

function verifyVideoLink(token) {
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
  if (!p || p.k !== KIND || !UUID_RX.test(String(p.r)) || !UUID_RX.test(String(p.u)) || !Number.isFinite(p.exp)) return BAD;
  if (p.exp < nowS()) return { ok: false, reason: 'expired' };
  return { ok: true, recommendationId: p.r, userId: p.u, surface: surfaceOf(p.s) };
}

/** The full player link, or null when PORTAL_URL or the key is missing (the caller sends nothing). */
function videoLinkUrl(ids) {
  const base = String(process.env.PORTAL_URL || '').trim().replace(/\/+$/, '');
  if (!base) return null;
  const token = signVideoLink(ids);
  return token ? `${base}${VIDEO_PATH}/${token}` : null;
}

module.exports = { signVideoLink, verifyVideoLink, videoLinkUrl, VIDEO_PATH, TTL_S };
