'use strict';
/**
 * The late-finisher report switch: app_settings `video_quiz_late_report`. On, a class code whose report already went
 * gets one more report at the next 07:00 PKT when at least K children first-finished since the last automatic report,
 * at most `cap_per_day` per code per day (video-quiz-report.service lateCheck).
 * On = JSON true (the defaults) or an object `{ k, cap_per_day }`. An absent row, false, a string ("true" too), a
 * number and a failed read are all OFF, and OFF is today's one automatic report per code exactly. 30 s cache.
 */
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');

const KEY = 'video_quiz_late_report';
const TTL_MS = 30 * 1000;
const DEFAULTS = Object.freeze({ k: 5, cap_per_day: 1 });
let cache = null; // { at, value }

/** → `{ k, cap_per_day }` when on, else null. Out-of-range numbers fall back to the defaults. */
function parse(value) {
  if (value === true) return { ...DEFAULTS };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const whole = (n, d) => (Number.isInteger(n) && n >= 1 && n <= 100 ? n : d);
  return { k: whole(value.k, DEFAULTS.k), cap_per_day: whole(value.cap_per_day, DEFAULTS.cap_per_day) };
}

/** → the switch's settings, or null when off. Never throws. */
async function settings(now = Date.now()) {
  if (cache && now - cache.at < TTL_MS) return cache.value;
  try {
    const { data, error } = await supabase.from('app_settings').select('key, value').eq('key', KEY).maybeSingle();
    if (error) throw new Error(error.message || 'app_settings read failed');
    cache = { at: now, value: data ? parse(data.value) : null };
    return cache.value;
  } catch (err) {
    logToFile('⚠️ class report: late-report setting unreadable — one automatic report, as before', { error: err && err.message });
    return null;
  }
}

/** Tests only: forget the cached reading. */
function reset() { cache = null; }

module.exports = { settings, parse, reset, KEY, DEFAULTS, TTL_MS };
