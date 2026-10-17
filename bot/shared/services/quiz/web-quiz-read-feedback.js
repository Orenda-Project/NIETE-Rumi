'use strict';
/**
 * app_settings `web_quiz_read_feedback` (default off; on only for the JSON true): every reading effort is answered.
 * The child page draws the moment (dashboard/public/wq/wq-moment.js); this module gives it what the server knows.
 *
 *   on()            true only with the key literally true; 30 s cache; fails closed. Never throws.
 *   menuField()     the Jugnu page's menu's {read_feedback: true} with the key on, else {} (the page loads the moment)
 *   band(out)       a scored read's coarse result {stars 0-3, badge 'try'|'reader'|'star', words_heard}: what the
 *                   reading itself shows (the words heard, how many were read right), worked out BEFORE the speed is
 *                   taken off for another phone, so a forwarded link or a cookie miss still gets stars and a badge.
 *                   Never the speed nor anything worked out from it (the lights, the growth line, a "faster" badge).
 *   withBand(out)   out + {feedback: band(out)} with the key on and a scored read; anything else back untouched
 *   storyReading(studentId, rows)  a storybook's read at its end, from the child's own page reads (`rows`: the
 *                   stories' counted events): {words_read, words_total, ms, wcpm|null, prev_wcpm|null}, the best read
 *                   of each page; the speed only on an honest read, the last book's speed from the child's own done
 *                   rows. null when no page was read aloud. Only on the child's own phone (the stories hub guard).
 *   OWNER_ONLY      the keys only the reading child's own phone may receive (the speed and what gives it back)
 */
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');

const KEY = 'web_quiz_read_feedback';
const TTL_MS = 30 * 1000;
// wcpm = correct / (60 - time_left) * 60, so correct + time_left give the speed back; previous is the last run's speed;
// the lights, the growth and a level each name the speed's band
const OWNER_ONLY = Object.freeze(['wcpm', 'previous', 'previous_wcpm', 'correct', 'time_left', 'finished_early', 'lights', 'level', 'growth']);
// the page's own numbers (wq-moment.js STAR_AT / MIN_WORDS); a test holds the two in step
const STAR_AT = [0.7, 0.9];
const MIN_WORDS = 15;
const MIN_MS = 6000;

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
  return { stars, badge: stars === 3 ? 'star' : 'reader', words_heard: tried };
}
async function withBand(out) {
  if (!out || typeof out !== 'object' || out.pending || out.later) return out;
  const b = band(out);
  if (!b || !(await on())) return out;
  return { ...out, feedback: b };
}

async function storyReading(studentId, rows) {
  const best = new Map();
  for (const r of rows || []) {
    if (r.event !== 'story_page_read') continue;
    const d = r.data || {};
    const cur = best.get(r.page_n);
    if (!cur || num(d.words_read) > num(cur.words_read)) best.set(r.page_n, d);
  }
  if (!best.size) return null;
  let words = 0, total = 0, ms = 0;
  for (const d of best.values()) { words += num(d.words_read); total += num(d.words_total); ms += num(d.ms); }
  const wcpm = words >= MIN_WORDS && ms >= MIN_MS ? Math.round(words / (ms / 60000)) : null;
  let prev = null;
  try {
    const { data } = await supabase.from('story_events').select('data, at').eq('child_id', studentId).eq('event', 'story_done').order('at', { ascending: false }).limit(20);
    const last = (data || []).find((r) => r.data && num(r.data.wcpm));
    prev = last ? num(last.data.wcpm) : null;
  } catch (_) { prev = null; }
  return { words_read: words, words_total: total, ms, wcpm, prev_wcpm: prev };
}

module.exports = { storyReading, MIN_MS, on, menuField, band, withBand, OWNER_ONLY, KEY, STAR_AT, MIN_WORDS, _reset: () => { cache = null; } };
