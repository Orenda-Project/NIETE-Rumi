'use strict';
/**
 * The teacher home's switches: app_settings `quiz_teacher_home` (the home itself: JSON true or the string "true") and
 * `quiz_teacher_home_paged` (the home's quick answer: every read started at once, the lessons read light, the page's
 * 15 s wait for its answer; JSON `true` ONLY) and `quiz_teacher_home_wait` (the page's slow-answer wait: «Try again»
 * re-uses the home read still on its way, the wait is WAIT_MS; JSON `true` ONLY). An absent row, `false`, any other
 * value ("yes", 1, {}) and a failed read are all OFF; the string "true" is OFF for the quick answer and the wait. The two
 * page switches come from ONE app_settings read (no read added for the wait). 30 s cache each; the page switches are
 * read only once the home is on.
 */
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');

const KEY = 'quiz_teacher_home';
const PAGED_KEY = 'quiz_teacher_home_paged';
const WAIT_KEY = 'quiz_teacher_home_wait';
const TTL_MS = 30 * 1000;
let cache = null; // { at, on }
let pagedCache = null; // { at, paged, wait }

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
 * The page switches, in ONE read → { paged, wait }: each true only when its row is JSON `true` (never a string form).
 * Never throws (a failed read → both off). Its own 30 s cache.
 */
async function pageSwitches(now = Date.now()) {
  if (pagedCache && now - pagedCache.at < TTL_MS) return { paged: pagedCache.paged, wait: pagedCache.wait };
  try {
    const { data, error } = await supabase.from('app_settings').select('key, value').in('key', [PAGED_KEY, WAIT_KEY]);
    if (error) throw new Error(error.message || 'app_settings read failed');
    const rows = Array.isArray(data) ? data : [];
    const isOn = (key) => rows.some((r) => r && r.key === key && r.value === true);
    pagedCache = { at: now, paged: isOn(PAGED_KEY), wait: isOn(WAIT_KEY) };
    return { paged: pagedCache.paged, wait: pagedCache.wait };
  } catch (err) {
    logToFile('⚠️ teacher home: paged switch lookup failed — the full answer', { error: err && err.message });
    return { paged: false, wait: false };
  }
}

/** → true only when `quiz_teacher_home_paged` is JSON `true` (never a string form). Never throws. */
async function paged(now = Date.now()) { return (await pageSwitches(now)).paged; }

/** → true only when `quiz_teacher_home_wait` is JSON `true` (never a string form). Never throws. */
async function wait(now = Date.now()) { return (await pageSwitches(now)).wait; }

/** Tests only: forget the cached readings. */
function reset() { cache = null; pagedCache = null; }

module.exports = { on, paged, wait, pageSwitches, reset, KEY, PAGED_KEY, WAIT_KEY, TTL_MS };
