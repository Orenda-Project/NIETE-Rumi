'use strict';
/**
 * The daily recording cap counts one-voice recordings too (app_settings `web_quiz_audio_cap_one`, default OFF).
 * web_quiz_audio_daily_cap counts quizzes stamped meta.web.audio_day today; a one-voice recording is stamped in its
 * own slot (meta.web_one.audio_day), so a busy one-voice day had no ceiling. With the switch on the cap counts quizzes
 * stamped today in either slot (web-quiz-audio-store.js recordingAllowed).
 * on(): read through the caller's client, 30 s cache, JSON `true` only, fails closed.
 */
const { logToFile } = require('../../utils/logger');

const KEY = 'web_quiz_audio_cap_one';
const TTL_MS = 30 * 1000;
let cache = null;

async function on({ db, now = Date.now() } = {}) {
  if (cache && now - cache.at < TTL_MS) return cache.on;
  try {
    const client = db || require('../../config/supabase');
    const { data, error } = await client.from('app_settings').select('key, value').eq('key', KEY);
    if (error) throw new Error(error.message || 'app_settings read failed');
    cache = { at: now, on: (data || []).some((r) => r && r.key === KEY && r.value === true) };
    return cache.on;
  } catch (err) {
    logToFile('⚠️ web quiz audio cap one: settings lookup failed — off', { error: err.message });
    return false;
  }
}

module.exports = { on, KEY, _resetCache: () => { cache = null; } };
