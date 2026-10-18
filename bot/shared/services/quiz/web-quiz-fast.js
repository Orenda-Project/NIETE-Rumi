'use strict';
/**
 * Fast first page (app_settings web_quiz_fast, default off, fail closed, 30 s cache).
 *
 * On: getQuiz runs the reads that need only the resolved code together, and its payload says `fast: true` so the
 * edge sends the page's head (styles, scripts, the Jugnu boot frame) before the bot answers. Off: today's payload.
 *
 * on() never waits: it answers from the cache and refreshes it in the background (web-quiz-telemetry.js's shape),
 * so the switch itself never costs a child's page a database round trip. The first read after a start is off.
 *
 * The same one read answers web_quiz_story_board_refuse (story-board.js, JSON `true` only): storyBoard() waits for
 * this read (the one already running, or the cache), so the quiz finish reads no setting more for it.
 */
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');

const KEY = 'web_quiz_fast';
const STORY_BOARD_KEY = 'web_quiz_story_board_refuse';
const TTL_MS = 30 * 1000;
let cache = null; // { at, on, storyBoard }
let reading = null;

function isTrue(value) {
  let v = value;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch (_) { /* plain string */ } }
  return v === true || (typeof v === 'string' && v.trim().toLowerCase() === 'true');
}

function refresh(db = supabase) {
  if (!reading) {
    reading = (async () => {
      try {
        const { data, error } = await db.from('app_settings').select('key, value').in('key', [KEY, STORY_BOARD_KEY]);
        if (error) throw new Error(error.message || 'app_settings read failed');
        const by = (k) => (data || []).find((r) => r.key === k);
        const fast = by(KEY);
        const story = by(STORY_BOARD_KEY);
        cache = { at: Date.now(), on: isTrue(fast && fast.value), storyBoard: Boolean(story) && story.value === true };
      } catch (err) {
        logToFile('⚠️ web quiz fast: settings lookup failed — off', { error: err.message });
        cache = { at: Date.now(), on: false, storyBoard: false };
      } finally {
        reading = null;
      }
      return cache.on;
    })();
  }
  return reading;
}

/** The switch, never waited for: the cached value, refreshed in the background when stale. */
function on(now = Date.now()) {
  if (!cache || now - cache.at >= TTL_MS) refresh().catch(() => {});
  return Boolean(cache && cache.on);
}

/**
 * web_quiz_look_after on (the hub's switch cache, never read here): the read on() started before the hub's reads, awaited
 * once they are done (no new read when the cache is fresh), so a cold cache does not drop `fast` from the first answer.
 * Off: false at once (the hub keeps the look before only).
 */
async function late() {
  if (!require('./web-quiz-hub-flags').nowOf('lookAfter')) return false;
  if (reading) await reading.catch(() => {});
  return on();
}

/** web_quiz_story_board_refuse (JSON `true` only; a failed read is off): the cache, else this module's read, waited for. */
async function storyBoard(db = supabase, now = Date.now()) {
  if (cache && now - cache.at < TTL_MS) return Boolean(cache.storyBoard);
  await refresh(db);
  return Boolean(cache && cache.storyBoard);
}

/**
 * Start a read now and keep its rejection for whoever awaits it: a read started early must not become an
 * unhandled rejection while the request waits on something else.
 */
function early(promise) {
  promise.catch(() => {});
  return promise;
}

module.exports = { on, late, storyBoard, early, KEY, STORY_BOARD_KEY, _reset: () => { cache = null; reading = null; } };
