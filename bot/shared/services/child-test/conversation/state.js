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
 * Side keys (per session): ctst:check:<sessionId> (the check was claimed — set once; the check
 * itself is gated on the store, recovery.js, never on a count of scoring calls),
 * ctst:check_retry:<sessionId> (a check whose sender died is re-sent once), ctst:media:<mediaId> (a webhook re-send
 * is not stored twice), ctst:block:<sessionId>:<block> (the voice note that claimed this block, set
 * before any ack or upload so quick notes fill distinct blocks — bd-s1oo0.14), ctst:done:<sessionId>
 * (the child's three notes are stored and the after-maths step ran — set once).
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

async function claimCheck(sessionId) {
  return redis.setNX(`ctst:check:${sessionId}`, new Date().toISOString(), 7 * 24 * 3600);
}
async function checkSent(sessionId) {
  return !!(await redis.get(`ctst:check:${sessionId}`));
}
/** When the check was claimed (ISO), or null. */
async function checkClaimedAt(sessionId) {
  const v = await redis.get(`ctst:check:${sessionId}`);
  return v ? String(v) : null;
}
/** The one re-send of a check whose sender died between the claim and the send. */
async function claimCheckRetry(sessionId) {
  return redis.setNX(`ctst:check_retry:${sessionId}`, new Date().toISOString(), 7 * 24 * 3600);
}

const blockKey = (sessionId, block) => `ctst:block:${sessionId}:${block}`;

/** Atomic across instances: true for the one note that takes this block. `claim` = { audioId, sentAt, at }. */
async function claimBlock(sessionId, block, claim) {
  return redis.setNX(blockKey(sessionId, block), JSON.stringify(claim), 7 * 24 * 3600);
}
async function releaseBlock(sessionId, block) {
  return redis.delete(blockKey(sessionId, block));
}
/** → the claim object, or null when the block is free. */
async function blockClaim(sessionId, block) {
  const raw = await redis.get(blockKey(sessionId, block));
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch { return { audioId: String(raw) }; }
}

async function claimDone(sessionId) {
  return redis.setNX(`ctst:done:${sessionId}`, new Date().toISOString(), 7 * 24 * 3600);
}

module.exports = {
  get, set, clear, firstSight, forget, claimCheck, checkSent, checkClaimedAt, claimCheckRetry,
  claimBlock, releaseBlock, blockClaim, claimDone, TTL_SECONDS,
};
