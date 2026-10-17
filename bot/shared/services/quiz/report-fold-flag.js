'use strict';
/**
 * The report's fold-by-child switch: app_settings `quiz_report_fold_by_child`. On, a child NOT on the class list is
 * one row per child (merged_into ?? student_id; the same typed name folds only on a shared phone or with no binding).
 * Only JSON `true` is on; an absent row, `false`, any other value (the strings "true" and "\"true\"", "yes", 1, {},
 * "TRUE", " true ") and a failed read are all OFF. 30 s cache.
 */
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');

const KEY = 'quiz_report_fold_by_child';
const TTL_MS = 30 * 1000;
let cache = null; // { at, on }

// exactly JSON true — never a string
function isTrue(value) {
  return value === true;
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
    logToFile('⚠️ teacher report: fold-by-child setting unreadable — same-name rows fold as before', { error: err && err.message });
    return false;
  }
}

/** Tests only: forget the cached reading. */
function reset() { cache = null; }

module.exports = { on, reset, isTrue, KEY, TTL_MS };
