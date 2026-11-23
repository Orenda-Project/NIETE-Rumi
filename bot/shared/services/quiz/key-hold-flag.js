'use strict';
/**
 * Hold, never rewrite: app_settings `quiz_key_hold_on_disagree` (on only when JSON true).
 *
 * On, every generated quiz treats a blind-solve key disagreement the way a class's evening round already does
 * (transcript-quiz-generate runKeyVerify): the item ships as authored, the author's key kept, marked media.key_held,
 * and it gets one answer-key review queue row (quiz_item_reviews, blind_solve, open). Nothing reads a held item to a
 * child or prints it for the teacher while the switch is on: the web quiz's served set (web-quiz.service
 * loadQuestions) and the teacher's PDF (renderPdf) go through shown(). A hold a reviewer released (released_at) is shown.
 * Off (a missing row, false, the string "true", any other value, a failed read): today's rewrite exactly, and every
 * row is shown as before. 30 s cache; a reader that finds no held row makes no read at all.
 */
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');

const KEY = 'quiz_key_hold_on_disagree';
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
    logToFile('⚠️ quiz keys: hold-on-disagree setting unreadable — off (a disputed key is rewritten, as before)', { error: err && err.message });
    cache = { at: now, on: false };
  }
  return cache.on;
}

/**
 * A row the blind solve held (media.key_held), whatever held it, that a person has not released. The reviewer's
 * key_ok writes media.key_held.released_at (a timestamp) and its rollback removes exactly that key, so a released
 * item is served and printed again and a rolled-back one is held again.
 */
function isHeld(row) {
  const hold = row && row.media && row.media.key_held;
  return Boolean(hold) && !hold.released_at;
}

/** `rows` without the held ones while the switch is on; the same array otherwise (and no read when none is held). */
async function shown(rows) {
  if (!Array.isArray(rows) || !rows.some(isHeld) || !(await on())) return rows;
  return rows.filter((r) => !isHeld(r));
}

/** Tests only: forget the cached reading. */
function reset() { cache = null; }

module.exports = { on, isHeld, shown, reset, KEY, TTL_MS };
