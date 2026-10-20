'use strict';
/**
 * Each question's read-aloud clips written to the quiz the moment that question is whole (app_settings
 * `web_quiz_audio_each_question`, default OFF), not only question 1 early and the rest when the whole quiz is done.
 * A quiz recorded on its first open takes about a minute; a child on question 2 or 3 in that minute otherwise has no
 * clip (with one voice: no sound). on(): read through the caller's client, 30 s cache, JSON `true` only, fails closed.
 */
const { logToFile } = require('../../utils/logger');

const KEY = 'web_quiz_audio_each_question';
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
    logToFile('⚠️ web quiz audio each question: settings lookup failed — off', { error: err.message });
    return false;
  }
}

module.exports = { on, KEY, _resetCache: () => { cache = null; } };
