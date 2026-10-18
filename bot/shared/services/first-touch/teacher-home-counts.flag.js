'use strict';
/**
 * The library card's story counts line on the teacher home (app_settings `quiz_teacher_story_counts`). On, the home
 * reads the teacher's story sends and their readers once per open and the card shows one line; off, the counts are
 * never read and the home's JSON is today's. Only the JSON boolean `true` is on (the string "true" is off). 30 s
 * cache; fails closed (a read error is off).
 */
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');

const KEY = 'quiz_teacher_story_counts';
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
    logToFile('⚠️ teacher home story counts: settings lookup failed — off', { error: err.message });
    return false;
  }
}

module.exports = { on, KEY, _resetCache: () => { cache = null; } };
