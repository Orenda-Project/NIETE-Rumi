'use strict';
/**
 * WHICH PHONE MAY SEE A HUB'S CHILDREN (a leaf module: one read through web-quiz-db-deadline, the token signer and Redis only,
 * so web-quiz-hub, web-quiz.service and web-quiz-challenge can all require it without a cycle).
 *
 * A hub token is bound to the first phone (device_ref) that opens it — Redis SET NX for the
 * token's life, read back — and a phone that has already played as one of its children is
 * trusted too. Any other phone, no device, or Redis down for an unknown phone: not trusted.
 * Once trusted, the phone may name each of the token's children on a hub ?k= quiz link.
 *
 *   deviceTrusted(token, device)       {ok, why, ids}: ids = the children this phone may see
 *   deviceMayName(studentIds, device)  boolean
 *   deviceKids(device)                 the student ids this phone was trusted with (newest hubs), [] if none
 */
const crypto = require('crypto');
const { read: dbRead } = require('./web-quiz-db-deadline');   // a deadline + one retry on reads (web_quiz_db_deadline)
const T = require('./web-quiz-token');

const BIND_PREFIX = 'wq:hub:dev:';
const bindKey = (token) => BIND_PREFIX + crypto.createHash('sha256').update(String(token)).digest('hex').slice(0, 32);
// "This phone may name this child": written for every child of a hub token once the phone is trusted,
// so the hub's /q/<code>?k=<chip> links name the child on THAT phone only (web-quiz.service startSession).
const KID_PREFIX = 'wq:hub:kid:';
const kidKey = (studentId, d) => KID_PREFIX + crypto.createHash('sha256').update(`${studentId}|${d}`).digest('hex').slice(0, 32);
// The children a trusted phone may play as, so a hub ?k= chip resolves on THAT phone however long ago the child
// last played (the quiz page's own chip lookup only sees a teacher's 40 most recent players).
const DEVKIDS_PREFIX = 'wq:hub:devkids:';
const DEVKIDS_MAX = 8;
const devKidsKey = (d) => DEVKIDS_PREFIX + crypto.createHash('sha256').update(String(d)).digest('hex').slice(0, 32);

/** Has this phone (device_ref) ever played as one of these children (any code)? */
async function deviceKnows(studentIds, deviceRef) {
  return (await playedOn(studentIds, deviceRef)).length > 0;
}

/** Which of these children has this phone played as (any code)? [] on a read error. */
async function playedOn(studentIds, deviceRef) {
  try {
    const { data } = await dbRead('playedOn:quiz_sessions:1', (db) => db.from('quiz_sessions').select('student_id').in('student_id', studentIds).eq('device_ref', deviceRef).limit(50));
    const seen = new Set((data || []).map((r) => String(r.student_id)));
    return studentIds.filter((id) => seen.has(String(id)));
  } catch (_) {
    return [];
  }
}

/**
 * May this phone see the hub's children, and WHICH? {ok, why, ids}. The first phone to open this link
 * (bound for the token's life) is trusted for every child the token names; any other phone only for the
 * children it has itself played as (a shared or class phone that one sibling used never sees the others).
 * No device, a foreign phone that played as none of them, or Redis down for an unplayed phone: not trusted.
 */
async function deviceTrusted(token, device) {
  const tok = T.verify(token, 'h');
  if (!tok || !Array.isArray(tok.ids) || !tok.ids.length) return { ok: false, why: 'bad_token', ids: [] };
  const d = T.cleanDeviceRef(device);
  if (!d) return { ok: false, why: 'no_device', ids: [] };
  const ids = tok.ids.map(String);
  const redis = require('../cache/railway-redis.service');
  const store = Boolean(redis && typeof redis.isAvailable === 'function' && redis.isAvailable());
  const ttl = Math.max(60, tok.exp - Math.floor(Date.now() / 1000));
  let out = null;
  let boundTo = null;
  if (store) {
    const key = bindKey(token);
    try {
      await redis.setNX(key, d, ttl);
      // Read back: setNX answers "claimed" when Redis errors, so only the stored value decides.
      boundTo = await redis.get(key);
    } catch (_) { boundTo = null; }
    if (boundTo === d) out = { ok: true, why: 'bound', ids };
  }
  if (!out) {
    const played = await playedOn(ids, d);
    if (played.length) out = { ok: true, why: 'played', ids: played };
    else return { ok: false, why: !store || !boundTo ? 'no_store' : 'other_device', ids: [] };
  }
  if (store) {
    try {
      await Promise.all(out.ids.map((id) => redis.set(kidKey(id, d), '1', ttl)));
      const had = await redis.get(devKidsKey(d));
      const kids = [...new Set([...out.ids, ...(Array.isArray(had) ? had.map(String) : [])])].slice(0, DEVKIDS_MAX);
      await redis.set(devKidsKey(d), kids, ttl);
    } catch (_) { /* naming falls back to deviceKnows */ }
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


/** The student ids a hub trusted this phone with ([] when none, no device, or Redis is down). */
async function deviceKids(device) {
  const d = T.cleanDeviceRef(device);
  if (!d) return [];
  try {
    const redis = require('../cache/railway-redis.service');
    if (!redis || typeof redis.isAvailable !== 'function' || !redis.isAvailable()) return [];
    const v = await redis.get(devKidsKey(d));
    return Array.isArray(v) ? v.map(String).slice(0, DEVKIDS_MAX) : [];
  } catch (_) {
    return [];
  }
}

module.exports = { deviceTrusted, deviceMayName, deviceKids };
