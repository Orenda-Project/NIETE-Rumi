'use strict';
/**
 * The class report's "most missed" block and the answer-key review queue.
 *
 * app_settings `video_quiz_report_key_review` (on only when JSON true): a "most missed" question that keys' review
 * queue still holds (quiz-key-review.service heldQuestionIds: open, key_wrong, ambiguous) is printed with an "answer
 * key under review" line instead of its keyed answer, the class's pick and that pick's feedback, so a wrong key never
 * becomes the teacher's reteach lesson. Off, a missing table or a failed read: no question is held, and the report is
 * today's byte for byte. 30 s cache on the switch.
 */
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');

const KEY = 'video_quiz_report_key_review';
const TTL_MS = 30 * 1000;
let cache = null; // { at, on }

/** Whether the switch is on. Never throws: an unreadable row is off. */
async function on(now = Date.now()) {
  if (cache && now - cache.at < TTL_MS) return cache.on;
  try {
    const { data, error } = await supabase.from('app_settings').select('key, value').eq('key', KEY).maybeSingle();
    if (error) throw new Error(error.message || 'app_settings read failed');
    cache = { at: now, on: Boolean(data) && data.value === true };
  } catch (err) {
    logToFile('⚠️ class report: key-review setting unreadable — report as before', { error: err && err.message });
    cache = { at: now, on: false };
  }
  return cache.on;
}

/** The question ids among `ids` the review queue holds; an empty set when the switch is off or the queue unreadable. */
async function heldAmong(ids) {
  if (!Array.isArray(ids) || !ids.length || !(await on())) return new Set();
  try {
    return await require('./quiz-key-review.service').heldQuestionIds(supabase, ids);
  } catch (err) {
    logToFile('⚠️ class report: key-review queue unreadable — report as before', { error: err && err.message });
    return new Set();
  }
}

/** Tests only: forget the cached reading. */
function reset() { cache = null; }

module.exports = { on, heldAmong, reset, KEY, TTL_MS };
