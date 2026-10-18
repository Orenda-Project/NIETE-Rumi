'use strict';
/**
 * The teacher home's one switch: app_settings `quiz_teacher_home`. Only a real `true` (JSON true or the string
 * "true") is on; an absent row, `false`, any other value ("yes", 1, {}) and a failed read are all OFF. 30 s cache.
 */
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');

const KEY = 'quiz_teacher_home';
const TTL_MS = 30 * 1000;
let cache = null; // { at, on }

function isTrue(value) {
  let v = value;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch (_) { /* a plain string */ } }
  return v === true || (typeof v === 'string' && v.trim().toLowerCase() === 'true');
}

/** → true only when the switch reads a real true. Never throws. */
async function on(now = Date.now()) {
  if (cache && now - cache.at < TTL_MS) return cache.on;
  try {
    const { data, error } = await supabase.from('app_settings').select('key, value').eq('key', KEY).maybeSingle();
    if (error) throw new Error(error.message || 'app_settings read failed');
    cache = { at: now, on: Boolean(data) && isTrue(data.value) };
    return cache.on;
  } catch (err) {
    logToFile('⚠️ teacher home: settings lookup failed — the home stays off', { error: err && err.message });
    return false;
  }
}

/** Tests only: forget the cached reading. */
function reset() { cache = null; }

module.exports = { on, reset, KEY, TTL_MS };
