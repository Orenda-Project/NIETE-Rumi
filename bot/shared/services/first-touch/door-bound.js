'use strict';
/**
 * The one door's abuse bound (quiz_one_door ON). Both act only on the door reply (trigger one_door_reply); a known
 * child's Home reply and a code's answer never pass here.
 *
 *   repeat(phone, text, now)   web_quiz_door_dedupe: the same text from the same phone inside 10 s of the last ANSWERED
 *                              one → true (do not answer) + web_quiz.door_dedup{phone_hash, gap_ms}. Redis down or a
 *                              failed claim → false (answer): the dedupe never silences a person on its own failure.
 *   overCeiling(phone, ceiling, now)
 *                              web_quiz_door_ceiling: the phone's door replies this PKT day, counted in Redis under
 *                              wq:door_ceiling:<PKT day>:<keyed hash>; past the ceiling → { over:true, first } where
 *                              `first` is true for the first refusal only (the caller logs that one, then stays silent).
 *                              Redis down → a process-local count, so the ceiling never fails open.
 *
 * Keys hold the ledger's keyed phone hash, never the phone; the text is hashed too. The log carries the events
 * contract's unknown-phone key (ukey) or null, never the phone.
 */
const crypto = require('crypto');
const { logEvent } = require('../../utils/structured-logger');

const DEDUPE_WINDOW_MS = 10 * 1000;
const CEILING_WINDOW_SECS = 48 * 60 * 60;   // like the ledger's counters: outlives its PKT day

const localCounts = new Map();
function localIncr(key, now) {
  if (localCounts.size > 5000) for (const [k, v] of localCounts) if (v.exp <= now) localCounts.delete(k);
  const cur = localCounts.get(key);
  const next = cur && cur.exp > now ? { n: cur.n + 1, exp: cur.exp } : { n: 1, exp: now + CEILING_WINDOW_SECS * 1000 };
  localCounts.set(key, next);
  return next.n;
}

function keyedPhone(phone) {
  const h = require('../quiz/message-ledger').phoneHash(phone);
  return h ? h.hash : null;
}

function logHash(phone) {
  try { return require('../quiz/child-phone-bindings.repo').ukeyOf(phone) || null; } catch (_) { return null; }
}

/** true → a repeat inside the window: do not answer (logged). Never throws. */
async function repeat(phone, text, now = Date.now()) {
  try {
    const h = keyedPhone(phone);
    if (!h) return false;
    const textHash = crypto.createHash('sha256').update(String(text || '')).digest('hex').slice(0, 16);
    const key = `wq:door_dedup:${h}:${textHash}`;
    const redis = require('../cache/railway-redis.service');
    const ttl = Math.ceil(DEDUPE_WINDOW_MS / 1000);
    if (await redis.setNX(key, String(now), ttl)) return false;
    const last = Number(await redis.get(key));
    const gap = now - last;
    if (Number.isFinite(last) && last > 0 && gap >= 0 && gap < DEDUPE_WINDOW_MS) {
      logEvent('web_quiz.door_dedup', { phone_hash: logHash(phone), gap_ms: gap, w: 's' });
      return true;
    }
    await redis.set(key, String(now), ttl);   // the window ended (or the value was unreadable): this send opens a new one
    return false;
  } catch (_) {
    return false;
  }
}

/** → { over:false } | { over:true, first:boolean }. Counts this send. Never throws (a failure → not over). */
async function overCeiling(phone, ceiling, now = Date.now()) {
  try {
    const Ledger = require('../quiz/message-ledger');
    const h = keyedPhone(phone);
    if (!h || !ceiling) return { over: false };
    const key = `wq:door_ceiling:${Ledger.pktDay(new Date(now))}:${h}`;
    const redis = require('../cache/railway-redis.service');
    let count = null;
    try { count = await redis.incr(key); } catch (_) { count = null; }
    if (count === null || count === undefined || !Number.isFinite(Number(count))) count = localIncr(key, now);
    else if (Number(count) === 1) { try { await redis.expire(key, CEILING_WINDOW_SECS); } catch (_) { /* the count holds */ } }
    const n = Number(count);
    return n > ceiling ? { over: true, first: n === ceiling + 1 } : { over: false };
  } catch (_) {
    return { over: false };
  }
}

module.exports = { repeat, overCeiling, DEDUPE_WINDOW_MS, _reset: () => { localCounts.clear(); } };
