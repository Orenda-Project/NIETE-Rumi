'use strict';
/**
 * Live reading v3 (app_settings `web_quiz_live_read_v3`, off unless true). The page's live reading component
 * (dashboard/public/wq/wq-liveread.js) is told here how a reading finishes itself:
 *
 *   lr3.finish.tail_ms          the last word heard ends the reading this long after (the word's own end)
 *   lr3.finish.pct / quiet_ms   most of the passage heard, then a quiet this long, ends the reading ("quiet")
 *   lr3.finish.quiet            false on a counted read: the record's reading ends only on the last word, Done or the
 *                               timer, so the scorer judges every counted reading exactly as before
 *   lr3.done / done_from        the Done button: always on a practice read; on a counted read only once this share of
 *                               the passage is heard (an early Done loses the reading)
 *   lr3.meter                   'glow': Jugnu glows brighter per word lit, never per second; no number, no bar
 *   lr3.counted                 this run is the record (the card says nothing it cannot keep)
 *
 * The words light up as the child reads wherever real-time works (Story Time included). The read-aloud's own key
 * route (POST /ch/live) is reused for a passage; a story page asks web-quiz-live-read-keys.js for its own one-read
 * temporary key. keysSince() counts every story key since a time, for the day's read budget (web-quiz-challenge-budget.js,
 * through the Challenge's countAlso).
 * Off (or web_quiz_challenge_realtime off) ⇒ forRead() and forMenu() add nothing (every payload is today's).
 * This module reads its two switches itself and requires no other quiz module, so nothing here closes a require loop.
 */
const supabase = require('../../config/supabase');
const { logError } = require('../../utils/logger');

const FLAG_KEY = 'web_quiz_live_read_v3';
const LIVE_FLAG_KEY = 'web_quiz_challenge_realtime';
const TABLE = 'web_quiz_live_read_keys';
const FINISH_PCT = 0.8;
// Urdu: real-time speech drops ~2 of 50 spoken Urdu words, so the quiet finish starts at 75 % (Done on a counted read stays 80 %)
const FINISH_PCT_UR = 0.75;
const QUIET_MS = 4000;   // every oral-reading protocol allows 3 s a word, and the stream adds lag
const TAIL_MS = 1000;
// a story page is 5-15 s of audio, a passage read ~60 s: in the day's read budget (money) a story key is a quarter of a read
const STORY_KEY_WEIGHT = 0.25;
const UI_V = 3;
// how a reading ended, as the page says it (the row keeps it beside live_ui_v)
const ENDED = new Set(['last_word', 'quiet', 'done_tap', 'timer', 'line1', 'stuck', 'hidden', 'home', 'silent']);
const SETTING_TTL_MS = 30 * 1000;

// a switch is on only for a literal true (or "true"); absent, anything else or a failed read is off
const cache = new Map();
function isTrue(v) {
  let x = v;
  if (typeof x === 'string') { try { x = JSON.parse(x); } catch (_) { /* plain string */ } }
  return x === true || (typeof x === 'string' && x.trim().toLowerCase() === 'true');
}
async function settingOn(key) {
  const c = cache.get(key);
  if (c && Date.now() - c.at < SETTING_TTL_MS) return c.v;
  let v = false;
  try {
    const { data, error } = await supabase.from('app_settings').select('key, value').eq('key', key);
    if (error) throw new Error(error.message || 'app_settings read failed');
    v = !!(data && data[0] && isTrue(data[0].value));
  } catch (e) {
    logError('web_quiz.lr_setting_read_failed', { key, error: String((e && e.message) || e).slice(0, 120) });
    v = false;
  }
  cache.set(key, { v, at: Date.now() });
  return v;
}
const on = () => settingOn(FLAG_KEY);
// live words need real-time: with web_quiz_challenge_realtime off nothing here mints a key or reads this switch
const liveOn = async () => (await settingOn(LIVE_FLAG_KEY)) && (await on());

/** The read exercise's extra field: {} off; on, how the reading finishes itself (never the quiet end on a counted read). */
async function forRead({ counted, lang } = {}) {
  if (!(await on())) return {};
  const isCounted = typeof counted === 'function' ? !!(await counted()) : !!counted;
  return { lr3: { meter: 'glow', done: true, done_from: isCounted ? FINISH_PCT : 0, counted: isCounted, finish: { pct: lang === 'ur' ? FINISH_PCT_UR : FINISH_PCT, quiet_ms: QUIET_MS, tail_ms: TAIL_MS, quiet: !isCounted } } };
}

/** What a reading's row keeps from the page under v3: the UI version and how it ended; {} off. Never a number. */
async function metaFor(body = {}, { record = false } = {}) {
  if (Number(body.live_ui_v) !== UI_V || !(await on())) return {};
  const ended = typeof body.ended === 'string' && ENDED.has(body.ended) ? body.ended : null;
  // under the record rule the page's ending is already kept (and judged) by the read guard's own field
  return { live_ui_v: UI_V, ...(!record && ended ? { ended } : {}) };
}

/** The menu's extra field: {} off; on, the page loads the live reading component. */
async function forMenu() {
  return (await on()) ? { lr3: true } : {};
}

/** Every story key since `sinceIso`, for the day's read budget (the caller checks the switches); 0 when unreadable (logged). */
async function keysSince(sinceIso) {
  try {
    const { count, error } = await supabase.from('web_quiz_live_read_keys').select('id', { count: 'exact', head: true }).gte('created_at', sinceIso);
    if (error) throw new Error(error.message || 'count failed');
    return Number(count) || 0;
  } catch (e) {
    logError('web_quiz.lr_keys_count_failed', { error: String((e && e.message) || e).slice(0, 120) });
    return 0;
  }
}

function _reset() { cache.clear(); }

module.exports = { FLAG_KEY, LIVE_FLAG_KEY, TABLE, STORY_KEY_WEIGHT, FINISH_PCT, FINISH_PCT_UR, QUIET_MS, TAIL_MS, UI_V, on, liveOn, settingOn, forRead, forMenu, metaFor, keysSince, _reset };
