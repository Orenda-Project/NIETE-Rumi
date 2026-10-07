'use strict';
/**
 * WHICH PHONE MAY SEE A HUB'S CHILDREN (a leaf module: supabase, the token signer and Redis only,
 * so web-quiz-hub, web-quiz.service and web-quiz-challenge can all require it without a cycle).
 *
 * A hub token is bound to the first phone (device_ref) that opens it — Redis SET NX for the
 * token's life, read back — and a phone that has already played as one of its children is
 * trusted too. Any other phone, no device, or Redis down for an unknown phone: not trusted.
 * Once trusted, the phone may name each of the token's children on a hub ?k= quiz link.
 *
 *   deviceTrusted(token, device)       {ok, why}
 *   deviceMayName(studentIds, device)  boolean
 */
const crypto = require('crypto');
const supabase = require('../../config/supabase');
const T = require('./web-quiz-token');

const BIND_PREFIX = 'wq:hub:dev:';
const bindKey = (token) => BIND_PREFIX + crypto.createHash('sha256').update(String(token)).digest('hex').slice(0, 32);
// "This phone may name this child": written for every child of a hub token once the phone is trusted,
// so the hub's /q/<code>?k=<chip> links name the child on THAT phone only (web-quiz.service startSession).
const KID_PREFIX = 'wq:hub:kid:';
const kidKey = (studentId, d) => KID_PREFIX + crypto.createHash('sha256').update(`${studentId}|${d}`).digest('hex').slice(0, 32);

/** Has this phone (device_ref) ever played as one of these children (any code)? */
async function deviceKnows(studentIds, deviceRef) {
  try {
    const { data } = await supabase.from('quiz_sessions').select('id').in('student_id', studentIds).eq('device_ref', deviceRef).limit(1);
    return Boolean(data && data.length);
  } catch (_) {
    return false;
  }
}

/**
 * May this phone see the hub's children? {ok, why}. A phone the children played on, or the
 * first phone that opens this link (bound for the token's life). No device, a foreign one,
 * or Redis down for an unknown one: not trusted.
 */
async function deviceTrusted(token, device) {
  const tok = T.verify(token, 'h');
  if (!tok || !Array.isArray(tok.ids) || !tok.ids.length) return { ok: false, why: 'bad_token' };
  const d = T.cleanDeviceRef(device);
  if (!d) return { ok: false, why: 'no_device' };
  const ids = tok.ids.map(String);
  const redis = require('../cache/railway-redis.service');
  const store = Boolean(redis && typeof redis.isAvailable === 'function' && redis.isAvailable());
  const ttl = Math.max(60, tok.exp - Math.floor(Date.now() / 1000));
  let out;
  if (await deviceKnows(ids, d)) {
    out = { ok: true, why: 'played' };
  } else if (!store) {
    return { ok: false, why: 'no_store' };
  } else {
    const key = bindKey(token);
    try {
      await redis.setNX(key, d, ttl);
      // Read back: setNX answers "claimed" when Redis errors, so only the stored value decides.
      const bound = await redis.get(key);
      if (bound !== d) return { ok: false, why: bound ? 'other_device' : 'no_store' };
      out = { ok: true, why: 'bound' };
    } catch (_) {
      return { ok: false, why: 'no_store' };
    }
  }
  if (store) {
    try { await Promise.all(ids.map((id) => redis.set(kidKey(id, d), '1', ttl))); } catch (_) { /* naming falls back to deviceKnows */ }
  }
  return out;
}

/** May this phone see these children's names on a hub ?k= link? A phone they played on, or one a hub of theirs was opened on. */
async function deviceMayName(studentIds, device) {
  const d = T.cleanDeviceRef(device);
  const ids = (studentIds || []).map(String).filter(Boolean);
  if (!d || !ids.length) return false;
  if (await deviceKnows(ids, d)) return true;
  try {
    const redis = require('../cache/railway-redis.service');
    if (!redis || typeof redis.isAvailable !== 'function' || !redis.isAvailable()) return false;
    const hits = await Promise.all(ids.map((id) => redis.get(kidKey(id, d))));
    return hits.some((v) => v === 1 || v === '1');
  } catch (_) {
    return false;
  }
}


module.exports = { deviceTrusted, deviceMayName };
