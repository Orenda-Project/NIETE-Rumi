'use strict';
/**
 * The coach app nudge's small state (bd-9652yj, queue #166): the reply-1 offer, the "WhatsApp today" choice and the
 * app's handoff code, all in the Redis the bot and the portal share. A LEAF module (Redis, the logger and the code's
 * definition only), so app-redirect and the report-ready sender can arm an offer without requiring the handlers that
 * answer it (coach-app-nudge.service): no require cycle.
 *
 *   coach_app:reply1:<id>          { kind: observe | menu | report, journeyId, sessionId?, at }   2 h
 *   coach_app:whatsapp_today:<id>  '1'                                                            until PKT midnight
 *   coach_handoff:<CODE>           { u, v?, o?, s, j, at } (written by the portal)                24 h
 */

const redis = require('./cache/railway-redis.service');
const { logToFile } = require('../utils/logger');
// The portal writes the code's key (dashboard/routes/coach-handoff.routes.js); one definition for both sides.
const { handoffKey, isCode } = require('./coach-handoff-code');

const REPLY_TTL_S = 2 * 60 * 60;
const replyKey = (userId) => `coach_app:reply1:${userId}`;
const todayKey = (userId) => `coach_app:whatsapp_today:${userId}`;
const KINDS = Object.freeze(['observe', 'menu', 'report']);

const PKT_OFFSET_S = 5 * 60 * 60;
const DAY_S = 24 * 60 * 60;

/** Seconds from `now` to the next midnight in Pakistan (UTC+5, no daylight saving). A full day exactly at midnight. */
function secondsToPktMidnight(now = Date.now()) {
  const pktSeconds = Math.floor(now / 1000) + PKT_OFFSET_S;
  const left = DAY_S - (((pktSeconds % DAY_S) + DAY_S) % DAY_S);
  return Math.max(60, left);
}

/** Arm the reply-1 offer: what the nudge or the report line offered, for 2 h. False when Redis is not there. */
async function armReply(userId, kind, { journeyId = null, sessionId = null, now = Date.now() } = {}) {
  if (!userId || !KINDS.includes(kind)) return false;
  try {
    return await redis.set(replyKey(userId), JSON.stringify({
      kind, journeyId: journeyId || null, ...(sessionId ? { sessionId } : {}), at: new Date(now).toISOString(),
    }), REPLY_TTL_S);
  } catch (err) {
    logToFile('⚠️ coach app nudge: the reply-1 offer could not be armed', { userId, kind, error: err?.message }, 'warn');
    return false;
  }
}

/** Has she chosen WhatsApp today (PKT)? A failed read is no: the worst case is one more nudge, never silence. */
async function choseWhatsappToday(userId) {
  if (!userId) return false;
  try { return Boolean(await redis.get(todayKey(userId))); } catch (_) { return false; }
}

async function markWhatsappToday(userId, now = Date.now()) {
  if (!userId) return false;
  try { return await redis.set(todayKey(userId), '1', secondsToPktMidnight(now)); } catch (_) { return false; }
}

async function readHandoff(code) {
  if (!isCode(code)) return null;
  try {
    let v = await redis.get(handoffKey(code));
    if (typeof v === 'string') { try { v = JSON.parse(v); } catch (_) { return null; } }
    return v && typeof v === 'object' && typeof v.u === 'string' ? v : null;
  } catch (_) { return null; }
}

/** Take the armed offer, if any. Any message from her ends it; the caller decides whether this one was the reply. */
async function takeOffer(userId) {
  let v = null;
  try { v = await redis.get(replyKey(userId)); } catch (_) { return null; }
  if (!v) return null;
  try { await redis.delete(replyKey(userId)); } catch (_) { /* expires in 2 h anyway */ }
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch (_) { return null; } }
  return v && typeof v === 'object' && KINDS.includes(v.kind) ? v : null;
}

module.exports = {
  REPLY_TTL_S, KINDS, replyKey, todayKey, handoffKey, secondsToPktMidnight,
  armReply, takeOffer, choseWhatsappToday, markWhatsappToday, readHandoff,
};
