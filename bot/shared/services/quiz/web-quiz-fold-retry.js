'use strict';
/**
 * app_settings `web_quiz_fold_retry` (default off; on only for the JSON true): the folded end card (the child home)
 * offers a 0-word read one way to read again (wq-trail.js foldEnd draws it; the reading moment's own Try again, with
 * web_quiz_read_feedback on, stays the only one).
 *
 *   on()          true only with the key literally true; 30 s cache; fails closed. Never throws.
 *   menuField()   the Jugnu page's menu's {fold_retry: true} with the key on, else {}
 */
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');

const KEY = 'web_quiz_fold_retry';
const TTL_MS = 30 * 1000;

let cache = null;
async function on(now = Date.now()) {
  if (cache && now - cache.at < TTL_MS) return cache.on;
  try {
    const { data, error } = await supabase.from('app_settings').select('key, value').eq('key', KEY);
    if (error) throw new Error(error.message || 'app_settings read failed');
    cache = { at: now, on: ((data || [])[0] || {}).value === true };
  } catch (err) {
    logToFile('⚠️ web quiz fold retry: settings lookup failed — off', { error: err.message });
    cache = { at: now, on: false };
  }
  return cache.on;
}
async function menuField() {
  try { return (await on()) ? { fold_retry: true } : {}; } catch (_) { return {}; }
}

module.exports = { on, menuField, KEY, _reset: () => { cache = null; } };
