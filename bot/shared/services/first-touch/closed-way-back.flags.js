'use strict';
/**
 * The way back from a dead-end page: app_settings `web_quiz_closed_way_back`, default OFF.
 *
 *   ON  → go.stale / go.error (the one door's landing), mk.stale / mk.error (the quiz-maker and the teacher home)
 *         carry ONE tap back to WhatsApp (chat-tap.js), with or without a known number.
 *   OFF → every one of those pages is today's, byte for byte.
 *
 * Only the JSON boolean `true` (value === true) is on: the strings "true" / "\"true\"", 1, "yes", {}, null, no row and a
 * failed read are all OFF. ONE read of this key only, cached 30 s; a failed read is OFF and is not cached. Never throws.
 */
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');

const KEY = 'web_quiz_closed_way_back';
const TTL_MS = 30 * 1000;
let cache = null; // { at, on }

/** → true only when the row's value is the JSON boolean true. Never throws. */
async function on(now = Date.now()) {
  if (cache && now - cache.at < TTL_MS) return cache.on;
  try {
    const { data, error } = await supabase.from('app_settings').select('key, value').eq('key', KEY).maybeSingle();
    if (error) throw new Error(error.message || 'app_settings read failed');
    cache = { at: now, on: Boolean(data) && data.value === true };
    return cache.on;
  } catch (err) {
    try { logToFile('⚠️ closed way back: settings lookup failed — switch off', { error: err && err.message }); } catch (_) { /* never throws */ }
    return false;
  }
}

module.exports = { on, KEY, _resetCache: () => { cache = null; } };
