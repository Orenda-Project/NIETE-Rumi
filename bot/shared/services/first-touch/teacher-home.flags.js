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
 * changes behaviour never rides `quiz_teacher_home`: it gets its own read, or joins PAGE_KEYS
 * (the strict page read below).
 *
 * The page switches are one list, PAGE_KEYS = [paged, grade_fast, wait, portal_link, practice] (`quiz_teacher_home_grade_fast`:
 * the grade chips answer from the page; `quiz_teacher_home_portal_link`: "Open my portal" in the foot;
 * `web_quiz_practice_play`: "Try it as a student" for every teacher), read together in one `.in('key', PAGE_KEYS)` read,
 * so no new read. JSON `true` ONLY; the
 * string "true", an absent row, any other value and a failed read are OFF.
 */
const supabase = require('../../config/supabase');
const Snap = require('../settings/settings-snapshot'); // web_quiz_page_keep: the page switches in one read
const { logToFile } = require('../../utils/logger');

const KEY = 'quiz_teacher_home';
const PAGED_KEY = 'quiz_teacher_home_paged';
const GRADE_FAST_KEY = 'quiz_teacher_home_grade_fast';
const WAIT_KEY = 'quiz_teacher_home_wait';
// app_settings web_quiz_practice_play (the class preview that plays): "Try it as a student" for every teacher (JSON true)
const PRACTICE_KEY = 'web_quiz_practice_play';
const TIMING_KEY = 'quiz_teacher_server_timing';
// the quiz home's way to the portal Home: "Open my portal" in the foot, its signed link in the home's JSON (JSON true only)
const PORTAL_LINK_KEY = 'quiz_teacher_home_portal_link';
// the page switches: one list, one read, one cache. A key added here is read in the same one `.in`.
const PAGE_KEYS = [PAGED_KEY, GRADE_FAST_KEY, WAIT_KEY, PORTAL_LINK_KEY, PRACTICE_KEY];
const TTL_MS = 30 * 1000;
let cache = null; // { at, on }
let pageCache = null; // { at, on: { [key]: boolean } }
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
    const { data, error } = await Snap.rows([KEY, TIMING_KEY], () => supabase.from('app_settings').select('key, value').in('key', [KEY, TIMING_KEY]));
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

/**
 * → { [key]: boolean } for every key of PAGE_KEYS: each true only when its row is JSON `true` (never a string form).
 * Never throws. One `.in('key', PAGE_KEYS)` read of every page switch, its own 30 s cache; a failed read → all off,
 * and nothing is held (the next call asks again).
 */
async function pageSwitches(now = Date.now()) {
  if (pageCache && now - pageCache.at < TTL_MS) return { ...pageCache.on };
  const off = () => Object.fromEntries(PAGE_KEYS.map((k) => [k, false]));
  try {
    const { data, error } = await supabase.from('app_settings').select('key, value').in('key', PAGE_KEYS);
    if (error) throw new Error(error.message || 'app_settings read failed');
    const rows = Array.isArray(data) ? data : [];
    const on = Object.fromEntries(PAGE_KEYS.map((k) => [k, rows.some((r) => r && r.key === k && r.value === true)]));
    pageCache = { at: now, on };
    return { ...on };
  } catch (err) {
    logToFile('⚠️ teacher home: paged switch lookup failed — the full answer', { error: err && err.message });
    return off();
  }
}

/** → true only when `quiz_teacher_home_paged` is JSON `true` (never a string form). Never throws. The page read. */
async function paged(now = Date.now()) {
  return (await pageSwitches(now))[PAGED_KEY] === true;
}

/** → true only when `quiz_teacher_home_grade_fast` is JSON `true`; the page read, no read of its own. */
async function gradeFast(now = Date.now()) {
  return (await pageSwitches(now))[GRADE_FAST_KEY] === true;
}

/** → true only when `quiz_teacher_home_wait` is JSON `true`; the page read, no read of its own. */
async function wait(now = Date.now()) {
  return (await pageSwitches(now))[WAIT_KEY] === true;
}

/** → true only when `web_quiz_practice_play` is JSON `true`; the page read, no read of its own. */
async function practice(now = Date.now()) {
  return (await pageSwitches(now))[PRACTICE_KEY] === true;
}

/** → true only when `quiz_teacher_server_timing` was JSON `true` at the home switch's last read (within 30 s). Never reads, never waits. */
function timing(now = Date.now()) {
  return Boolean(timingCache && now - timingCache.at < TTL_MS && timingCache.on);
}

/** Tests only: forget the timing reading alone (the home's stays). */
function resetTiming() { timingCache = null; }

/** Tests only: forget the cached readings. */
function reset() { cache = null; pageCache = null; timingCache = null; }

module.exports = {
  on, paged, gradeFast, wait, practice, pageSwitches, timing, reset, resetTiming, KEY, PAGED_KEY, GRADE_FAST_KEY, WAIT_KEY, PRACTICE_KEY, TIMING_KEY,
  PORTAL_LINK_KEY, PAGE_KEYS, TTL_MS,
};
