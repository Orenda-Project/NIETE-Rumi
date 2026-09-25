'use strict';
/**
 * THE RUNAWAY GUARD — at most QUIZ_DAILY_CAP quizzes made per teacher per PKT
 * day, both streams (transcript, lp_v8, lp612), counted where every path meets:
 * the generate step, before any model call.
 *
 * One teacher tapping every lesson in /quiz would otherwise author one quiz per
 * tap (≈$0.035–0.04 each, three attempts, a blind solve). The cap is a bound on
 * cost, not a product limit: the default (10) is far above what a class uses.
 *
 * Counted per QUIZ, not per job: the set `quizcap:<teacher>:<pkt date>` holds
 * quiz ids, so a redelivered job (SQS at-least-once) never counts twice. The
 * add-and-check is one Lua script, so two replicas cannot both take the last slot.
 *
 * FAILS OPEN. Redis down → the quiz is made (the guard is a bound, never the
 * reason a teacher who asked gets nothing). QUIZ_DAILY_CAP=off (or 0) turns it off.
 */

const DEFAULT_CAP = 10;
const TTL_SECONDS = 36 * 60 * 60;
const PKT_OFFSET_MS = 5 * 60 * 60 * 1000;

/** @returns {number|null} the cap, or null when switched off */
function cap() {
  const raw = String(process.env.QUIZ_DAILY_CAP || '').trim().toLowerCase();
  if (!raw) return DEFAULT_CAP;
  if (['off', 'false', 'no', '0'].includes(raw)) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_CAP;
}

function pktDate(now = new Date()) {
  return new Date(now.getTime() + PKT_OFFSET_MS).toISOString().slice(0, 10);
}

// KEYS[1] the set, ARGV[1] quiz id, ARGV[2] cap, ARGV[3] ttl.
// Returns the count including this quiz, or -count when this quiz is over the cap.
const CLAIM_LUA = `
local added = redis.call('SADD', KEYS[1], ARGV[1])
local n = redis.call('SCARD', KEYS[1])
if added == 1 and n > tonumber(ARGV[2]) then
  redis.call('SREM', KEYS[1], ARGV[1])
  return -(n - 1)
end
redis.call('EXPIRE', KEYS[1], tonumber(ARGV[3]))
return n
`;

/**
 * @returns {Promise<{allowed:boolean, count:number|null, limit:number|null, degraded?:boolean}>}
 */
async function claim(teacherId, quizId, { now = new Date() } = {}) {
  const limit = cap();
  if (limit === null || !teacherId || !quizId) return { allowed: true, count: null, limit };
  let r;
  try {
    // eslint-disable-next-line global-require
    r = require('../cache/railway-redis.service');
  } catch (_) {
    return { allowed: true, count: null, limit, degraded: true };
  }
  const res = await r.evalScript(CLAIM_LUA, [`quizcap:${teacherId}:${pktDate(now)}`], [String(quizId), limit, TTL_SECONDS]);
  if (res === null || res === undefined) return { allowed: true, count: null, limit, degraded: true };
  const n = Number(res);
  return n < 0 ? { allowed: false, count: -n, limit } : { allowed: true, count: n, limit };
}

module.exports = { cap, claim, pktDate, DEFAULT_CAP, CLAIM_LUA };
