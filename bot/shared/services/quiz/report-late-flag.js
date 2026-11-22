'use strict';
/**
 * The late finishers on the teacher's own pages (app_settings `quiz_teacher_home_reports`, bd-5j1zaf). On, the teacher
 * home shows a "Quiz reports" section (each sent quiz with how many finished after its 12 h report) and the live
 * report page's quiz tab marks those children; off, both pages are today's byte for byte. The count itself is always
 * the report's own (teacher-report.data). Only the JSON boolean `true` is on (the string "true" is off). 30 s cache;
 * fails closed (a read error is off). The teacher home reads the same row in its page read (teacher-home.flags
 * PAGE_KEYS, no read of its own); this reader is the report page's and the report links'.
 */
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');

const KEY = 'quiz_teacher_home_reports';
const TTL_MS = 30 * 1000;
let cache = null;

/** Only the JSON boolean the flip writes turns the switch on (app_settings.value is jsonb); the string 'true' is off. */
function isTrue(value) {
  return value === true;
}

async function on(now = Date.now()) {
  if (cache && now - cache.at < TTL_MS) return cache.on;
  try {
    const { data, error } = await supabase.from('app_settings').select('key, value').eq('key', KEY);
    if (error) throw new Error(error.message || 'app_settings read failed');
    cache = { at: now, on: isTrue(((data || [])[0] || {}).value) };
    return cache.on;
  } catch (err) {
    logToFile('⚠️ teacher report: late-finishers setting unreadable — off', { error: err.message });
    return false;
  }
}

module.exports = { on, KEY, _resetCache: () => { cache = null; } };
