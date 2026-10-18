'use strict';
/**
 * Two of the teacher home's own switches, each read on its own and each OFF unless it is the JSON boolean `true` (the
 * string "true" is off): `quiz_teacher_home_named_item` (the top card names what "Send again" sends: "Story:" or
 * "Quiz:" before the title, "Send this story again") and `quiz_teacher_home_early_pick` (a grade tapped before the
 * home has answered is kept and shown, not lost behind a false error). 30 s cache each; a failed read is off.
 */
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');

const NAMED_KEY = 'quiz_teacher_home_named_item';
const EARLY_KEY = 'quiz_teacher_home_early_pick';
const TTL_MS = 30 * 1000;
const cache = new Map(); // key → { at, on }

async function read(key, now) {
  const hit = cache.get(key);
  if (hit && now - hit.at < TTL_MS) return hit.on;
  try {
    const { data, error } = await supabase.from('app_settings').select('key, value').eq('key', key);
    if (error) throw new Error(error.message || 'app_settings read failed');
    const on = ((data || [])[0] || {}).value === true;
    cache.set(key, { at: now, on });
    return on;
  } catch (err) {
    logToFile(`⚠️ teacher home: ${key} lookup failed — off`, { error: err && err.message });
    return false;
  }
}

const namedOn = (now = Date.now()) => read(NAMED_KEY, now);
const earlyOn = (now = Date.now()) => read(EARLY_KEY, now);

module.exports = { namedOn, earlyOn, NAMED_KEY, EARLY_KEY, TTL_MS, _resetCache: () => cache.clear() };
