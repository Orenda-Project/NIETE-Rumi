'use strict';

/**
 * The coach's place in the child test (Redis, one key per coach). Context only — never a
 * permission check: every button re-validates against the draw and the store.
 *
 *   ctst:state:<coachUserId> → {
 *     ctx:      { visitId, schoolId, observedGrade, observedClassId },
 *     step:     'list' | 'presence' | 'block' | 'closed',
 *     listOpenedAt,
 *     current:  { drawId, rollNumber, childNo, total, tappedAt, sessionId?, grade?, form?, block?, promptAt? },
 *     pendingPhotos: [{ sessionId, rollNumber, schoolId, grade, form }]   // maths strips still to come
 *   }
 *
 * Side keys (per session): ctst:scored:<sessionId> (count of finished scoreBlock calls),
 * ctst:check:<sessionId> (the check was sent — set once), ctst:media:<mediaId> (a webhook re-send
 * is not stored twice).
 */

const redis = require('../../cache/railway-redis.service');

const TTL_SECONDS = 8 * 3600;   // a school day
const key = (userId) => `ctst:state:${userId}`;

async function get(userId) {
  const raw = await redis.get(key(userId));
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch { return null; }
}

async function set(userId, state) {
  return redis.setexWithCeiling(key(userId), TTL_SECONDS, JSON.stringify({ ...state, updatedAt: new Date().toISOString() }));
}

async function clear(userId) {
  return redis.delete(key(userId));
}

/** True the first time this media id is seen (12 h). */
async function firstSight(mediaId) {
  return redis.setNX(`ctst:media:${mediaId}`, '1', 12 * 3600);
}
async function forget(mediaId) {
  return redis.delete(`ctst:media:${mediaId}`);
}

async function countScored(sessionId) {
  const n = await redis.incr(`ctst:scored:${sessionId}`);
  await redis.expire(`ctst:scored:${sessionId}`, 2 * TTL_SECONDS);
  return n;
}

async function claimCheck(sessionId) {
  return redis.setNX(`ctst:check:${sessionId}`, new Date().toISOString(), 7 * 24 * 3600);
}
async function checkSent(sessionId) {
  return !!(await redis.get(`ctst:check:${sessionId}`));
}

module.exports = { get, set, clear, firstSight, forget, countScored, claimCheck, checkSent, TTL_SECONDS };
