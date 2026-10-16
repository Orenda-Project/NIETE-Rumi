'use strict';
/**
 * The one door's server-side memory of WHO a landing token was sent to: the token carries an opaque
 * nonce `n`; this module keeps { p: phone_norm, u: user_id } under it in Redis for the token's life. The phone is
 * never in the URL, the page, an event or a log line; keys hold a hash of the nonce, never the nonce itself.
 *
 *   put(n, {phoneNorm, userId})   → true when kept (24 h)
 *   who(n)                         → { phoneNorm, userId } | null
 *   device(n, ref)                 → 'first' (this device is now the token's) | 'same' | 'other' | 'none' (no ref given)
 *   consume(n, what)               → true ONCE per nonce per write kind ('role' | 'bind'), false after
 *
 * Redis down: put() returns false (the reply still goes; its landing then shows "send quiz again"); who() → null;
 * device() → 'first' (the landing is not refused for an outage); consume() → true (the write's own guards still run).
 */
const crypto = require('crypto');

const TTL_S = 24 * 60 * 60;
const PREFIX = 'wq:go:';
const keyOf = (kind, n) => `${PREFIX}${kind}:${crypto.createHash('sha256').update(String(n)).digest('hex').slice(0, 32)}`;
const redis = () => require('../cache/railway-redis.service');

async function put(n, { phoneNorm, userId } = {}) {
  if (!n || !phoneNorm || !userId) return false;
  try { return Boolean(await redis().set(keyOf('n', n), { p: String(phoneNorm), u: String(userId) }, TTL_S)); } catch (_) { return false; }
}

async function who(n) {
  if (!n) return null;
  try {
    const v = await redis().get(keyOf('n', n));
    const o = typeof v === 'string' ? JSON.parse(v) : v;
    return o && o.p && o.u ? { phoneNorm: String(o.p), userId: String(o.u) } : null;
  } catch (_) { return null; }
}

async function device(n, ref) {
  if (!ref) return 'none';
  try {
    const r = redis();
    if (await r.setNX(keyOf('d', n), String(ref), TTL_S)) return 'first';
    const held = await r.get(keyOf('d', n));
    return held == null || String(held) === String(ref) ? 'same' : 'other';
  } catch (_) { return 'first'; }
}

async function consume(n, what) {
  try { return Boolean(await redis().setNX(keyOf(`w${what}`, n), '1', TTL_S)); } catch (_) { return true; }
}

module.exports = { put, who, device, consume, TTL_S, _keyOf: keyOf };
