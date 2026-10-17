'use strict';
/**
 * The reminder's live class picture switch: app_settings `quiz_reminder_live_preview`. On, the teacher's quiz reminder
 * link /q/<CODE> carries ?v=<played> (how many children played), so WhatsApp previews it as the live class picture
 * (the page's ogImageFor: played, average, top) and a new count is a new preview. Never a storybook send, never at 0.
 * Only JSON `true` is on; an absent row, `false`, any other value (the strings "true" and "\"true\"", "yes", 1, {},
 * {enabled: true}, "TRUE", " true ") and a failed read are all OFF. 30 s cache.
 */
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');

const KEY = 'quiz_reminder_live_preview';
const TTL_MS = 30 * 1000;
let cache = null; // { at, on }

// exactly JSON true — never a string
function isTrue(value) {
  return value === true;
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
    logToFile('⚠️ teacher report: reminder live-preview setting unreadable — the reminder link stays plain', { error: err && err.message });
    return false;
  }
}

/** Tests only: forget the cached reading. */
function reset() { cache = null; }

module.exports = { on, reset, isTrue, KEY, TTL_MS };
