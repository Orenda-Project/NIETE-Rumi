'use strict';
/**
 * The child home's plain fallback (app_settings `web_quiz_home_fallback_v3`, default OFF): when the home's own script
 * (wq-home.js) never arrives, the page draws a plain home from the hub payload instead of the old hub. Read on its own,
 * beside the home's switches, so the home's read stays as it is. on(): 30 s cache, JSON `true` only, fails closed.
 */
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');

const KEY = 'web_quiz_home_fallback_v3';
const TTL_MS = 30 * 1000;
let cache = null;

async function on(now = Date.now()) {
  if (cache && now - cache.at < TTL_MS) return cache.on;
  try {
    const { data, error } = await supabase.from('app_settings').select('key, value').eq('key', KEY);
    if (error) throw new Error(error.message || 'app_settings read failed');
    cache = { at: now, on: (data || []).some((r) => r && r.key === KEY && r.value === true) };
    return cache.on;
  } catch (err) {
    logToFile('⚠️ web quiz home fallback: settings lookup failed — off', { error: err.message });
    return false;
  }
}

module.exports = { on, KEY, _resetCache: () => { cache = null; } };
