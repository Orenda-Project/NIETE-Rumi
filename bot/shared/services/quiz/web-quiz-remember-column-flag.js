'use strict';
/**
 * app_settings `web_quiz_remember_column` (default OFF): the phone a child joined on is kept on the binding row
 * (child_phone_bindings.device_hash, child_phone_bindings_device.sql) and read there first. Apply the migration
 * before the flip. Only the JSON boolean `true` turns it on (the string 'true' is off). 30 s cache, fails closed.
 */
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');

const KEY = 'web_quiz_remember_column';
const TTL_MS = 30 * 1000;
let cache = null;

async function on(now = Date.now()) {
  if (cache && now - cache.at < TTL_MS) return cache.on;
  try {
    const { data, error } = await supabase.from('app_settings').select('key, value').eq('key', KEY);
    if (error) throw new Error(error.message || 'app_settings read failed');
    cache = { at: now, on: Boolean((data || []).find((r) => r.key === KEY && r.value === true)) };
    return cache.on;
  } catch (err) {
    logToFile('⚠️ home remember: column switch lookup failed — off', { error: err.message });
    return false;
  }
}

module.exports = { on, KEY, _resetCache: () => { cache = null; } };
