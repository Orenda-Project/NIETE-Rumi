'use strict';
/**
 * YOUR TURN IN A TEACHER'S PREVIEW (bd-21q0kr; app_settings `web_quiz_practice_your_turn`, default OFF, only the JSON
 * true turns it on, 30 s cache, a failed read is off).
 *
 * A teacher's "Try it as a student" link (web-quiz-practice-play.js: a hub token that names no child, `tu` = the
 * teacher's users id) opens a storybook as a child gets it. A child's "Your turn" needs a one-read speech key
 * (web-quiz-live-read-keys.js), counted against that child's day. With this switch on, a preview gets the same key,
 * counted against the TEACHER instead, with its own day cap, inside the same day's read budget, and never against any
 * child. Off, the preview's book has no microphone and its key is refused (401), exactly as before.
 *
 * Where the count lives: Redis, not web_quiz_live_read_keys. That table's student_id is NOT NULL and references
 * students(id) and its src is CHECK-limited to 'story_page' (checked live on sandbox and staging, 19 Nov 2026): a
 * teacher's id cannot go there without a schema change. A per-teacher, per-PKT-day count in Redis is the codebase's own
 * pattern for "N a teacher a day" (quiz-daily-cap.js), shared by every replica, and needs no migration.
 *   wq:lr:pv:<pkt day>:<teacher users id>   the set of the day's counted key ids (run ids), 36 h
 *   wq:lr:pv:<pkt day>:all                  how many preview keys the day counted, every teacher (the read budget), 36 h
 * The add-and-check is one Lua script, so two replicas cannot both take the teacher's last key. Nothing of the voice
 * and nothing that names a child is kept; the key path keeps no run row.
 *
 *   (the switch is read inside turnFor, entryOf and keysSince, cached 30 s)
 *   cap()                        the teacher's keys a day (app_settings `web_quiz_live_read_preview_keys_per_day`, a
 *                                JSON number, default 40; absent, junk or a failed read = the default)
 *   turnFor(who)                 does this preview's book offer Your turn? (a preview with a teacher, switch on)
 *   entryOf(token)               {teacherId} for a preview token while web_quiz_practice_play AND this switch are on
 *                                and the link names its teacher; null otherwise (the caller then answers as today)
 *   countToday(teacherId)        the teacher's counted keys today; null when Redis cannot answer
 *   claim(teacherId, run, cap)   count this key: n (> 0) kept, -n over the cap (not counted), null Redis unavailable
 *   keysSince(sinceIso)          every preview key of that PKT day, for the day's read budget: 0 off or unreadable
 */
const supabase = require('../../config/supabase');
const { logToFile, logError } = require('../../utils/logger');

const SWITCH_KEY = 'web_quiz_practice_your_turn';
const CAP_KEY = 'web_quiz_live_read_preview_keys_per_day';
// a story page is ~20-40 words: a teacher can read two whole books aloud in a day, as a child can (web-quiz-live-read-keys.js)
const PREVIEW_KEYS_PER_DAY = 40;
const TTL_MS = 30 * 1000;
const TTL_S = 36 * 3600;
const PK_OFFSET_MS = 5 * 3600 * 1000;
const PREFIX = 'wq:lr:pv:';
const TEACHER_RX = /^[A-Za-z0-9-]{1,64}$/;

// KEYS[1] the teacher's day set, KEYS[2] the day's total; ARGV[1] the key's run id, ARGV[2] the cap, ARGV[3] ttl.
// The count including this key, or -count when it is over the cap (then it is not kept and the total is untouched).
const CLAIM_LUA = `
local added = redis.call('SADD', KEYS[1], ARGV[1])
local n = redis.call('SCARD', KEYS[1])
if added == 1 and n > tonumber(ARGV[2]) then
  redis.call('SREM', KEYS[1], ARGV[1])
  return -(n - 1)
end
redis.call('EXPIRE', KEYS[1], tonumber(ARGV[3]))
if added == 1 then
  redis.call('INCR', KEYS[2])
  redis.call('EXPIRE', KEYS[2], tonumber(ARGV[3]))
end
return n
`;
// KEYS[1] the teacher's day set: how many keys it holds (0 when there is none)
const COUNT_LUA = `return redis.call('SCARD', KEYS[1])`;
// KEYS[1] the day's total: the number (0 when there is none)
const TOTAL_LUA = `return tonumber(redis.call('GET', KEYS[1]) or '0')`;

let cache = null;      // { at, on }
let capCache = null;   // { at, cap }

const pktDay = (ms) => new Date(ms + PK_OFFSET_MS).toISOString().slice(0, 10);
const setKey = (teacherId, now = Date.now()) => `${PREFIX}${pktDay(now)}:${teacherId}`;
const totalKey = (day) => `${PREFIX}${day}:all`;
const redis = () => require('../cache/railway-redis.service');

/** The switch: only the JSON boolean true turns it on; a failed read is off. */
async function on(now = Date.now()) {
  if (cache && now - cache.at < TTL_MS) return cache.on;
  let v = false;
  try {
    const { data, error } = await supabase.from('app_settings').select('key, value').eq('key', SWITCH_KEY);
    if (error) throw new Error(error.message || 'app_settings read failed');
    v = Boolean(data && data[0] && data[0].value === true);
  } catch (err) {
    logToFile('⚠️ web quiz preview your turn: settings lookup failed — off', { error: err.message });
    v = false;
  }
  cache = { at: now, on: v };
  return v;
}

/** The teacher's keys a day: a JSON number >= 0 (floored), else the default. */
async function cap(now = Date.now()) {
  if (capCache && now - capCache.at < TTL_MS) return capCache.cap;
  let c = PREVIEW_KEYS_PER_DAY;
  try {
    const { data, error } = await supabase.from('app_settings').select('key, value').eq('key', CAP_KEY);
    if (error) throw new Error(error.message || 'app_settings read failed');
    const raw = data && data[0] ? data[0].value : undefined;
    const v = raw === null || raw === undefined || raw === '' || typeof raw === 'boolean' ? NaN : Number(raw);
    if (Number.isFinite(v) && v >= 0) c = Math.floor(v);
  } catch (e) {
    logError('web_quiz.lr_preview_cap_read_failed', { error: String((e && e.message) || e).slice(0, 120) });
  }
  capCache = { at: now, cap: c };
  return c;
}

/** The preview's teacher (a users id) from the content routes' "who" (web-quiz-practice-play.js whoOf), or null. */
function teacherOf(who) {
  return who && who.practice === true && typeof who.teacherId === 'string' && TEACHER_RX.test(who.teacherId) ? who.teacherId : null;
}

/** Does this preview's book offer Your turn? Only a preview that names its teacher, with the switch on. Never throws. */
async function turnFor(who) {
  try { return Boolean(teacherOf(who)) && (await on()); } catch (_) { return false; }
}

/**
 * The key route's entry for a preview token: {teacherId} while this switch and web_quiz_practice_play are on and the
 * link names its teacher; otherwise null, and the caller answers the token as it does today. This switch is read first,
 * so with it off nothing more is read.
 */
async function entryOf(token) {
  if (!(await on())) return null;
  const teacherId = teacherOf(await require('./web-quiz-practice-play').who(token));
  return teacherId ? { teacherId } : null;
}

/** The teacher's counted keys today, or null when Redis cannot answer (the caller gives no key then). */
async function countToday(teacherId, now = Date.now()) {
  const n = await redis().evalScript(COUNT_LUA, [setKey(teacherId, now)], []);
  return n === null || n === undefined || !Number.isFinite(Number(n)) ? null : Number(n);
}

/** Count this key against the teacher: n kept (this one included), -n over the cap, null when Redis cannot answer. */
async function claim(teacherId, run, limit, now = Date.now()) {
  const n = await redis().evalScript(CLAIM_LUA, [setKey(teacherId, now), totalKey(pktDay(now))], [String(run), limit, TTL_S]);
  return n === null || n === undefined || !Number.isFinite(Number(n)) ? null : Number(n);
}

/**
 * Every preview key counted on the PKT day that starts at `sinceIso` (the day's read budget counts them beside the
 * children's story keys, web-quiz-challenge.js countAlso). 0 with the switch off (nothing more read) or unreadable.
 */
async function keysSince(sinceIso) {
  try {
    if (!(await on())) return 0;
    const n = await redis().evalScript(TOTAL_LUA, [totalKey(pktDay(Date.parse(sinceIso)))], []);
    return Number.isFinite(Number(n)) ? Number(n) : 0;
  } catch (e) {
    logError('web_quiz.lr_preview_total_failed', { error: String((e && e.message) || e).slice(0, 120) });
    return 0;
  }
}

function _reset() { cache = null; capCache = null; }

module.exports = {
  SWITCH_KEY, CAP_KEY, PREVIEW_KEYS_PER_DAY, CLAIM_LUA, COUNT_LUA, TOTAL_LUA,
  cap, turnFor, entryOf, countToday, claim, keysSince, _reset,
};
