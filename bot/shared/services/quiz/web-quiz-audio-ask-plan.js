'use strict';
/**
 * One clip job per quiz from the start (app_settings `web_quiz_audio_ask_plan`, default OFF). A quiz's clips are asked
 * for when its link is minted and when an old WhatsApp link is redirected, with no one-voice plan, and again when its
 * page opens, under the plan: two job ids, so the queue keeps both and two workers record the quiz at once. On, a request
 * that names no plan asks under the live plan for that quiz (web-quiz-publish requestQuizAudio), so the page's request
 * is the same job. on(): read through the caller's client, 30 s cache, JSON `true` only, fails closed.
 */
const { logToFile } = require('../../utils/logger');

const KEY = 'web_quiz_audio_ask_plan';
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
    logToFile('⚠️ web quiz audio ask plan: settings lookup failed — off', { error: err.message });
    return false;
  }
}

module.exports = { on, KEY, _resetCache: () => { cache = null; } };
