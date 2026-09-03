'use strict';
/**
 * R165 — remember WHICH observation a coach's next photo or
 * lesson plan is for.
 *
 * A coach running 2-3 observations back-to-back taps "Yes" on the photo prompt
 * (`photo_yes_<sid>`) or "Upload" on the LP list (`lp_upload_<sid>`). Those taps
 * carry the exact observation id — until this module the code flipped that
 * row's status and threw the id away, and the media that followed was bound to
 * "this sender's NEWEST session at the gate". This is the small Redis-backed
 * memory that keeps the tapped id until the media arrives.
 *
 * Keys (per coach, TTL 2h like observe-state):
 *   media:target:<userId>  → { sessionId, kind: 'photo'|'lp', setAt }
 *   media:parked:<userId>  → { mediaId, mimeType, kind, parkedAt }
 *     (a photo/document held while the coach answers "which teacher?")
 *
 * Load (pre-merge Class R): one keyed Redis read/write per tap or media
 * arrival — no scans, no DB.
 */

const redisService = require('../cache/railway-redis.service');
const { logToFile } = require('../../utils/logger');

const TTL_SECONDS = 7200;
const KINDS = ['photo', 'lp'];

const targetKey = (userId) => `media:target:${userId}`;
const parkedKey = (userId) => `media:parked:${userId}`;

// railway-redis get() AUTO-PARSES JSON (returns an object; falls back to the
// raw string only when parsing fails). Handle both shapes — JSON.parse on the
// already-parsed object is the bug that silently dropped observe capture state
// on staging (observe-state.service, 2026-07-12).
function _parse(raw, label, userId) {
  try {
    if (!raw) return null;
    if (typeof raw === 'object') return raw;
    return JSON.parse(raw);
  } catch (err) {
    logToFile(`⚠️ media-target: unreadable ${label}, treating as none`, { userId, error: err.message });
    return null;
  }
}

async function setTarget(userId, sessionId, kind) {
  if (!userId || !sessionId || !KINDS.includes(kind)) return false;
  const payload = JSON.stringify({ sessionId, kind, setAt: new Date().toISOString() });
  return redisService.setexWithCeiling(targetKey(userId), TTL_SECONDS, payload);
}

async function getTarget(userId) {
  if (!userId) return null;
  return _parse(await redisService.get(targetKey(userId)), 'target', userId);
}

async function clearTarget(userId) {
  if (!userId) return false;
  return redisService.delete(targetKey(userId));
}

async function parkMedia(userId, { mediaId, mimeType, kind }) {
  if (!userId || !mediaId) return false;
  const payload = JSON.stringify({
    mediaId, mimeType: mimeType || null, kind: KINDS.includes(kind) ? kind : 'photo',
    parkedAt: new Date().toISOString(),
  });
  return redisService.setexWithCeiling(parkedKey(userId), TTL_SECONDS, payload);
}

async function getParked(userId) {
  if (!userId) return null;
  return _parse(await redisService.get(parkedKey(userId)), 'parked media', userId);
}

async function clearParked(userId) {
  if (!userId) return false;
  return redisService.delete(parkedKey(userId));
}

module.exports = {
  setTarget, getTarget, clearTarget,
  parkMedia, getParked, clearParked,
  TTL_SECONDS, KINDS,
};
