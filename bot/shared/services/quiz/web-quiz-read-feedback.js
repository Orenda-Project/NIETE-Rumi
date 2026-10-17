'use strict';
/**
 * app_settings `web_quiz_read_feedback` (default off; on only for the JSON true): every reading effort is answered.
 * The child page draws the moment (dashboard/public/wq/wq-moment.js); this module gives it what the server knows.
 *
 *   on()            true only with the key literally true; 30 s cache; fails closed. Never throws.
 *   menuField()     the Jugnu page's menu's {read_feedback: true} with the key on, else {} (the page loads the moment)
 *   band(out)       a scored read's coarse result {stars 0-3, badge, words_heard}: the same bands as the page, worked
 *                   out from the full result BEFORE the speed is taken off for another phone, so a forwarded link or a
 *                   cookie miss still gets stars and a badge. Never the speed or anything it can be worked out from.
 *   withBand(out)   out + {feedback: band(out)} with the key on and a scored read; anything else back untouched
 *   OWNER_ONLY      the keys only the reading child's own phone may receive (the speed and what gives it back)
 */
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');

const KEY = 'web_quiz_read_feedback';
const TTL_MS = 30 * 1000;
// wcpm = correct / (60 - time_left) * 60, so correct + time_left give the speed back; previous is the last run's speed
const OWNER_ONLY = Object.freeze(['wcpm', 'previous', 'previous_wcpm', 'correct', 'time_left', 'finished_early']);
// the page's own numbers (wq-moment.js STAR_AT / GROWTH_UP / MIN_WORDS); a test holds the two in step
const STAR_AT = [0.7, 0.9];
const GROWTH_UP = 2;
const MIN_WORDS = 15;

let cache = null;
async function on(now = Date.now()) {
  if (cache && now - cache.at < TTL_MS) return cache.on;
  try {
    const { data, error } = await supabase.from('app_settings').select('key, value').eq('key', KEY);
    if (error) throw new Error(error.message || 'app_settings read failed');
    cache = { at: now, on: ((data || [])[0] || {}).value === true };
  } catch (err) {
    logToFile('⚠️ web quiz read feedback: settings lookup failed — off', { error: err.message });
    cache = { at: now, on: false };
  }
  return cache.on;
}
async function menuField() {
  try { return (await on()) ? { read_feedback: true } : {}; } catch (_) { return {}; }
}

const num = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0; };
function band(out) {
  const s = out && out.score;
  if (!s || typeof s !== 'object' || !('attempted' in s)) return null;
  const tried = num(s.attempted);
  const right = s.correct == null ? tried : Math.min(num(s.correct), tried);
  if (!right || s.stopped || out.implausible) return { stars: 0, badge: 'try', words_heard: 0 };
  const acc = right / tried;
  const stars = acc >= STAR_AT[1] ? 3 : acc >= STAR_AT[0] ? 2 : 1;
  const w = num(out.wcpm), prev = num(out.previous && out.previous.wcpm);
  const up = Boolean(w && prev && right >= MIN_WORDS && w - prev >= GROWTH_UP);
  return { stars, badge: up ? 'faster' : stars === 3 ? 'star' : 'reader', words_heard: tried };
}
async function withBand(out) {
  if (!out || typeof out !== 'object' || out.pending || out.later) return out;
  const b = band(out);
  if (!b || !(await on())) return out;
  return { ...out, feedback: b };
}

module.exports = { on, menuField, band, withBand, OWNER_ONLY, KEY, STAR_AT, GROWTH_UP, MIN_WORDS, _reset: () => { cache = null; } };
