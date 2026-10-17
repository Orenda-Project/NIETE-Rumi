'use strict';
/**
 * The teacher home's switches: app_settings `quiz_teacher_home` (the home itself: JSON true or the string "true") and
 * `quiz_teacher_home_paged` (the home's quick answer: every read started at once, the lessons read light, the page's
 * 15 s wait for its answer; JSON `true` ONLY). An absent row, `false`, any other value ("yes", 1, {}) and a failed read
 * are all OFF; the string "true" is OFF for the quick answer. 30 s cache each; the quick answer's is read only once the
 * home is on.
 * `quiz_teacher_server_timing` (a Server-Timing header on the home's and the library's JSON; JSON `true` ONLY) is a
 * measurement-only rider on the home switch's own read: never a read of its own; cold or expired → OFF until that read
 * runs again (at most 30 s; a home cache refreshed from outside starts it only at the home's next own read). A key that
 * changes behaviour never rides `quiz_teacher_home`: it gets its own read, or rides the strict paged() read.
 */
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');

const KEY = 'quiz_teacher_home';
const PAGED_KEY = 'quiz_teacher_home_paged';
const TIMING_KEY = 'quiz_teacher_server_timing';
const TTL_MS = 30 * 1000;
let cache = null; // { at, on }
let pagedCache = null; // { at, on }
let timingCache = null; // { at, on }: set only by on()'s read

function isTrue(value) {
  let v = value;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch (_) { /* a plain string */ } }
  return v === true || (typeof v === 'string' && v.trim().toLowerCase() === 'true');
}

/** → true only when the switch reads a real true. Never throws. */
async function on(now = Date.now()) {
  if (cache && now - cache.at < TTL_MS) return cache.on;
  try {
    // one read, two rows: the home's switch and the timing rider, each picked by its key
    const { data, error } = await supabase.from('app_settings').select('key, value').in('key', [KEY, TIMING_KEY]);
    if (error) throw new Error(error.message || 'app_settings read failed');
    const row = (k) => (Array.isArray(data) ? data.find((r) => r && r.key === k) : null) || null;
    const host = row(KEY);
    cache = { at: now, on: Boolean(host) && isTrue(host.value) };
    const timed = row(TIMING_KEY);
    timingCache = { at: now, on: Boolean(timed) && timed.value === true };
    return cache.on;
  } catch (err) {
    logToFile('⚠️ teacher home: settings lookup failed — the home stays off', { error: err && err.message });
    return false;
  }
}

/** → true only when `quiz_teacher_home_paged` is JSON `true` (never a string form). Never throws. Its own 30 s cache. */
async function paged(now = Date.now()) {
  if (pagedCache && now - pagedCache.at < TTL_MS) return pagedCache.on;
  try {
    const { data, error } = await supabase.from('app_settings').select('key, value').eq('key', PAGED_KEY).maybeSingle();
    if (error) throw new Error(error.message || 'app_settings read failed');
    pagedCache = { at: now, on: Boolean(data) && data.value === true };
    return pagedCache.on;
  } catch (err) {
    logToFile('⚠️ teacher home: paged switch lookup failed — the full answer', { error: err && err.message });
    return false;
  }
}

/** → true only when `quiz_teacher_server_timing` was JSON `true` at the home switch's last read (within 30 s). Never reads. */
async function timing(now = Date.now()) {
  return Boolean(timingCache && now - timingCache.at < TTL_MS && timingCache.on);
}

/** Tests only: forget the timing reading alone (the home's stays). */
function resetTiming() { timingCache = null; }

/** Tests only: forget the cached readings. */
function reset() { cache = null; pagedCache = null; timingCache = null; }

module.exports = { on, paged, timing, reset, resetTiming, KEY, PAGED_KEY, TIMING_KEY, TTL_MS };
