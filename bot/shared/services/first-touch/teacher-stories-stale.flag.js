'use strict';
/**
 * The stories page's stale-link words: app_settings `quiz_teacher_stories_stale_words`. On, an expired or forged teacher
 * link on /quiz/teacher/<t>/stories gets the home's own stale page instead of the stories router's 401 JSON. Only a
 * JSON `true` is on; an absent row, `false`, the string "true", any other value and a failed read are all OFF. 30 s cache.
 */
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');

const KEY = 'quiz_teacher_stories_stale_words';
const TTL_MS = 30 * 1000;
let cache = null; // { at, on }

/** → true only when the switch reads JSON true. Never throws. */
async function on(now = Date.now()) {
  if (cache && now - cache.at < TTL_MS) return cache.on;
  try {
    const { data, error } = await supabase.from('app_settings').select('key, value').eq('key', KEY).maybeSingle();
    if (error) throw new Error(error.message || 'app_settings read failed');
    cache = { at: now, on: Boolean(data) && data.value === true };
    return cache.on;
  } catch (err) {
    logToFile('⚠️ teacher stories: stale-words setting unreadable — today\'s answer', { error: err && err.message });
    return false;
  }
}

/** Tests only: forget the cached reading. */
function reset() { cache = null; }

module.exports = { on, reset, KEY, TTL_MS };
