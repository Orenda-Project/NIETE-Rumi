'use strict';
/**
 * The teacher home's switches: app_settings `quiz_teacher_home` (the home itself: JSON true or the string "true") and
 * `quiz_teacher_home_paged` (the home's quick answer: every read started at once, the lessons read light, the page's
 * 15 s wait for its answer; JSON `true` ONLY). An absent row, `false`, any other value ("yes", 1, {}) and a failed read
 * are all OFF; the string "true" is OFF for the quick answer. 30 s cache each; the quick answer's is read only once the
 * home is on.
 *
 * The page switches are one list, PAGE_KEYS = [paged, grade_fast] (`quiz_teacher_home_grade_fast`: the grade chips
 * answer from the page), read together in one `.in('key', PAGE_KEYS)` read, so no new read. JSON `true` ONLY; the
 * string "true", an absent row, any other value and a failed read are OFF.
 */
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');

const KEY = 'quiz_teacher_home';
const PAGED_KEY = 'quiz_teacher_home_paged';
const GRADE_FAST_KEY = 'quiz_teacher_home_grade_fast';
// the page switches: one list, one read, one cache. A key added here is read in the same one `.in`.
const PAGE_KEYS = [PAGED_KEY, GRADE_FAST_KEY];
const TTL_MS = 30 * 1000;
let cache = null; // { at, on }
let pageCache = null; // { at, on: { [key]: boolean } }

function isTrue(value) {
  let v = value;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch (_) { /* a plain string */ } }
  return v === true || (typeof v === 'string' && v.trim().toLowerCase() === 'true');
}

/** → true only when the switch reads a real true. Never throws. */
async function on(now = Date.now()) {
  if (cache && now - cache.at < TTL_MS) return cache.on;
  try {
    const { data, error } = await supabase.from('app_settings').select('key, value').eq('key', KEY).maybeSingle();
    if (error) throw new Error(error.message || 'app_settings read failed');
    cache = { at: now, on: Boolean(data) && isTrue(data.value) };
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

/** Tests only: forget the cached readings. */
function reset() { cache = null; pageCache = null; }

module.exports = { on, paged, gradeFast, pageSwitches, reset, KEY, PAGED_KEY, GRADE_FAST_KEY, PAGE_KEYS, TTL_MS };
