'use strict';
/**
 * WHO a /quiz landing link was sent to — kept on the server, never in the URL, the page or a log line.
 *
 * The one /quiz reply's link carries an opaque nonce `n` (22 chars, random); this module keeps { p: phone_norm,
 * u: user_id } under a hash of it in Redis for 24 hours (the landing is re-usable for the link's life).
 *
 *   mint({ phoneNorm, userId }) → n | null      null when Redis cannot keep it (the reply then carries no write power)
 *   peek(n)                     → { phoneNorm, userId } | null      read only, any number of times
 *   claim(n, purpose)           → { phoneNorm, userId } | null      ONCE per purpose ('role' | 'join' | 'bind'):
 *                                 SET NX then READ BACK (the Redis wrapper answers "set" on an error; only the read-back
 *                                 decides), so one write never burns another purpose's
 *   bindDevice(n, ref)          → 'first' | 'same' | 'other' | 'none'   the link belongs to the first device that opens it
 *
 * The map itself is never deleted (it expires). Nothing here logs `n`, a phone or a user id.
 */
const crypto = require('crypto');

const TTL_S = 24 * 60 * 60;
const PURPOSES = Object.freeze(['role', 'join', 'bind']);
const NONCE_RX = /^[A-Za-z0-9_-]{22}$/;
const h = (n) => crypto.createHash('sha256').update(String(n)).digest('hex').slice(0, 32);
const KEY = {
  map: (n) => `ft:go:n:${h(n)}`,
  used: (n, purpose) => `ft:go:used:${h(n)}:${purpose}`,
  dev: (n) => `ft:go:dev:${h(n)}`,
};
const redis = () => require('../cache/railway-redis.service');

function parse(v) {
  try {
    const o = typeof v === 'string' ? JSON.parse(v) : v;
    return o && o.p && o.u ? { phoneNorm: String(o.p), userId: String(o.u) } : null;
  } catch (_) { return null; }
}

async function mint({ phoneNorm, userId } = {}) {
  if (!phoneNorm || !userId) return null;
  try {
    const n = crypto.randomBytes(16).toString('base64url');
    const r = redis();
    await r.set(KEY.map(n), JSON.stringify({ p: String(phoneNorm), u: String(userId) }), TTL_S);
    return parse(await r.get(KEY.map(n))) ? n : null;   // kept only if it reads back
  } catch (_) { return null; }
}

async function peek(n) {
  if (typeof n !== 'string' || !NONCE_RX.test(n)) return null;
  try { return parse(await redis().get(KEY.map(n))); } catch (_) { return null; }
}

/** SET NX a fresh value, then read it back: true only when this caller's value is the one stored. */
async function setOnce(key, ttl) {
  const mine = crypto.randomBytes(12).toString('base64url');
  const r = redis();
  await r.setNX(key, mine, ttl);
  const held = await r.get(key);
  return { mine: held != null && String(held) === mine, held: held == null ? null : String(held) };
}

async function claim(n, purpose) {
  if (!PURPOSES.includes(purpose)) return null;
  const who = await peek(n);
  if (!who) return null;
  try { return (await setOnce(KEY.used(n, purpose), TTL_S)).mine ? who : null; } catch (_) { return null; }
}

async function bindDevice(n, ref) {
  if (!ref) return 'none';
  try {
    const r = redis();
    await r.setNX(KEY.dev(n), String(ref), TTL_S);
    const held = await r.get(KEY.dev(n));
    if (held == null) return 'first';                     // Redis could not keep it: the landing is not refused for an outage
    return String(held) === String(ref) ? 'same' : 'other';
  } catch (_) { return 'first'; }
}

module.exports = { mint, peek, claim, bindDevice, PURPOSES, TTL_S, NONCE_RX, _key: KEY };
