'use strict';
/**
 * The teacher home's switches: app_settings `quiz_teacher_home` (the home itself: JSON true or the string "true") and
 * `quiz_teacher_home_paged` (the home's quick answer: every read started at once, the lessons read light, the page's
 * 15 s wait for its answer; JSON `true` ONLY). An absent row, `false`, any other value ("yes", 1, {}) and a failed read
 * are all OFF; the string "true" is OFF for the quick answer. 30 s cache each; the quick answer's is read only once the
 * home is on.
 *
 * The quick answer's read also answers `quiz_teacher_home_grade_fast` (the grade chips answer from the page): one
 * `.in('key', [paged, grade_fast])` read, so no new read. JSON `true` ONLY; the string "true", an absent row, any
 * other value and a failed read are OFF.
 */
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');

const KEY = 'quiz_teacher_home';
const PAGED_KEY = 'quiz_teacher_home_paged';
const GRADE_FAST_KEY = 'quiz_teacher_home_grade_fast';
const TTL_MS = 30 * 1000;
let cache = null; // { at, on }
let pagedCache = null; // { at, on, gradeFast }

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
 * → { paged, gradeFast }: each true only when its row is JSON `true` (never a string form). Never throws. One read of
 * both keys, its own 30 s cache.
 */
async function pagedSwitches(now = Date.now()) {
  if (pagedCache && now - pagedCache.at < TTL_MS) return { paged: pagedCache.on, gradeFast: pagedCache.gradeFast };
  try {
    const { data, error } = await supabase.from('app_settings').select('key, value').in('key', [PAGED_KEY, GRADE_FAST_KEY]);
    if (error) throw new Error(error.message || 'app_settings read failed');
    const rows = Array.isArray(data) ? data : [];
    const isOn = (k) => rows.some((r) => r && r.key === k && r.value === true);
    pagedCache = { at: now, on: isOn(PAGED_KEY), gradeFast: isOn(GRADE_FAST_KEY) };
    return { paged: pagedCache.on, gradeFast: pagedCache.gradeFast };
  } catch (err) {
    logToFile('⚠️ teacher home: paged switch lookup failed — the full answer', { error: err && err.message });
    return { paged: false, gradeFast: false };
  }
}

/** → true only when `quiz_teacher_home_paged` is JSON `true` (never a string form). Never throws. Its own 30 s cache. */
async function paged(now = Date.now()) {
  return (await pagedSwitches(now)).paged;
}

/** → true only when `quiz_teacher_home_grade_fast` is JSON `true`; the quick answer's reading, no read of its own. */
async function gradeFast(now = Date.now()) {
  return (await pagedSwitches(now)).gradeFast;
}

/** Tests only: forget the cached readings. */
function reset() { cache = null; pagedCache = null; }

module.exports = { on, paged, gradeFast, pagedSwitches, reset, KEY, PAGED_KEY, GRADE_FAST_KEY, TTL_MS };
