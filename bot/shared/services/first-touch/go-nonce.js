'use strict';
/**
 * The /quiz landing's nonce map: the ONE place a page-held link turns back into the phone that asked for it.
 *
 * The bot knows the sender of every `/quiz`; the page it opens does not. The reply's link therefore carries an
 * opaque nonce `n` (22 random base64url chars, never derived from anything), and this module keeps, server-side in
 * Redis, n → { phoneNorm, userId } for 24 hours (the landing is re-usable for that long). Never in a URL, a page or a
 * log: the key is a hash of n, the value is the phone and the users row id, and nothing here logs either.
 *
 *   mint({ phoneNorm, userId })  → n | null       null when Redis is down or the input is bad (the caller then links
 *                                                  without a nonce, and no page write can happen)
 *   peek(n)                      → { phoneNorm, userId } | null   read only; any number of times
 *   claim(n, purpose)            → { phoneNorm, userId } | null   once per purpose ('role' | 'join' | 'bind'): the
 *                                                  first caller gets the entry, every later one null. The entry itself
 *                                                  is never deleted, so one purpose never burns another's.
 *
 * Fails closed: Redis down, a bad nonce or an expired entry → null, never a guess.
 */
const crypto = require('crypto');
const T = require('../quiz/web-quiz-token');

const TTL_S = 24 * 60 * 60;
const NONCE_RX = /^[A-Za-z0-9_-]{22}$/;
const PURPOSES = Object.freeze(['role', 'join', 'bind']);
const hashOf = (n) => crypto.createHash('sha256').update(String(n)).digest('hex').slice(0, 32);
const mapKey = (n) => `ft:go:n:${hashOf(n)}`;
const usedKey = (n, purpose) => `ft:go:used:${hashOf(n)}:${purpose}`;

function store() {
  try {
    const redis = require('../cache/railway-redis.service');
    return redis && typeof redis.isAvailable === 'function' && redis.isAvailable() ? redis : null;
  } catch (_) {
    return null;
  }
}

const clean = (n) => (typeof n === 'string' && NONCE_RX.test(n) ? n : null);

async function mint({ phoneNorm, userId } = {}) {
  const redis = store();
  if (!redis || !phoneNorm || !userId) return null;
  const n = T.newNonce();
  try {
    const ok = await redis.set(mapKey(n), JSON.stringify({ p: String(phoneNorm), u: String(userId) }), TTL_S);
    return ok ? n : null;
  } catch (_) {
    return null;
  }
}

async function peek(n) {
  const nonce = clean(n);
  const redis = store();
  if (!nonce || !redis) return null;
  try {
    let v = await redis.get(mapKey(nonce));
    if (typeof v === 'string') { try { v = JSON.parse(v); } catch (_) { v = null; } }
    return v && v.p && v.u ? { phoneNorm: String(v.p), userId: String(v.u) } : null;
  } catch (_) {
    return null;
  }
}

async function claim(n, purpose) {
  if (!PURPOSES.includes(purpose)) return null;
  const entry = await peek(n);
  if (!entry) return null;
  const redis = store();
  if (!redis) return null;
  // a letter first, so the store's JSON-parsing get() always hands it back as this same string
  const mark = `m${T.newNonce()}`;
  try {
    await redis.setNX(usedKey(n, purpose), mark, TTL_S);
    // Read back: setNX answers "claimed" when Redis errors, so only the stored value decides who was first.
    return (await redis.get(usedKey(n, purpose))) === mark ? entry : null;
  } catch (_) {
    return null;
  }
}

module.exports = { mint, peek, claim, TTL_S, PURPOSES };
