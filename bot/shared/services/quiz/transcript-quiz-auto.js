'use strict';
/**
 * bd-8267ps (eval #239) — the switch that writes a recording quiz without waiting for the teacher's "yes".
 *
 * WHY. Every quiz that is written gets a children's link (the hand-off mints it); the quizzes without one are
 * recording quizzes left at 'offered', because the quiz is only written after the teacher taps Yes on the offer.
 * With this switch on, the offer job takes the same yes path the report's "Make a quiz" tap already takes
 * (transcript-quiz-offer.service processOffer): the quiz is written and handed off with its web quiz link.
 *
 * THE SWITCH. `app_settings.quiz_offer_auto`, JSON true only. Missing, anything else, or unreadable = off (the
 * Yes / Not now offer, exactly as before). Read at most every 30 seconds; a failed read is not held.
 */

const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');

const KEY = 'quiz_offer_auto';
const TTL_MS = 30 * 1000;

let cache = null; // { at, on }

function _resetCache() { cache = null; }

/** @returns {Promise<boolean>} never throws */
async function on(now = Date.now()) {
  if (cache && now - cache.at < TTL_MS) return cache.on;
  try {
    const { data, error } = await supabase.from('app_settings').select('key, value').eq('key', KEY);
    if (error) throw new Error(error.message || 'app_settings read failed');
    cache = { at: now, on: ((data || [])[0] || {}).value === true };
    return cache.on;
  } catch (err) {
    logToFile('⚠️ transcript quiz auto: setting unreadable — off', { error: err && err.message }, 'warn');
    return false;
  }
}

module.exports = { on, KEY, _resetCache };
