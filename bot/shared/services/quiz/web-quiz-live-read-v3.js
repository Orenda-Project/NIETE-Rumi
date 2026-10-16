'use strict';
/**
 * Live reading v3 (app_settings `web_quiz_live_read_v3`, off unless true). The page's live reading component
 * (dashboard/public/wq/wq-liveread.js) is told here how a reading finishes itself:
 *
 *   lr3.finish.tail_ms          the last word heard ends the reading this long after (the word's own end)
 *   lr3.finish.pct / quiet_ms   most of the passage heard, then a quiet this long, ends the reading ("quiet")
 *   lr3.finish.quiet            false on a counted read: the record's reading ends only on the last word, Done or the
 *                               timer, so the scorer judges every counted reading exactly as before (RULING #C1, #5)
 *   lr3.done / done_from        the Done button: always on a practice read; on a counted read only once this share of
 *                               the passage is heard (an early Done loses the reading)
 *   lr3.meter                   'glow': Jugnu glows brighter per word lit, never per second; no number, no bar
 *   lr3.counted                 this run is the record (the card says nothing it cannot keep)
 *
 * The words light up as the child reads wherever real-time works (Story Time included). The read-aloud's own key
 * route (POST /ch/live) is reused for a passage; a story page asks storyKey() for its own one-read temporary key
 * (single use, the run id as reference): no run row, no upload, nothing of the child's voice kept.
 * Off ⇒ forRead() and forMenu() add nothing (every payload is today's) and storyKey() is 404 'off'.
 */
const crypto = require('crypto');
const { logError } = require('../../utils/logger');
const { logEvent } = require('../../utils/structured-logger');
const { WqError } = require('./web-quiz.service');
const Budget = require('./web-quiz-challenge-budget');

const FLAG_KEY = 'web_quiz_live_read_v3';
const FINISH_PCT = 0.8;
const QUIET_MS = 4000;   // RULING #C1: every ORF protocol allows 3 s a word, and the stream adds lag
const TAIL_MS = 1000;
const UI_V = 3;
// how a reading ended, as the page says it (the row keeps it beside live_ui_v)
const ENDED = new Set(['last_word', 'quiet', 'done_tap', 'timer', 'line1', 'stuck', 'hidden', 'home', 'silent']);
// a story page is ~20-40 words: enough for a whole book's pages twice in a day, then "enough for today"
const STORY_KEYS_PER_DAY = 40;
const BOOK_RX = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_PAGE = 200;

const fail = (status, error) => { throw new WqError(status, { error }); };
const Ch = () => require('./web-quiz-challenge');
const on = () => Ch().settingOn(FLAG_KEY);

/** The read exercise's extra field: {} off; on, how the reading finishes itself (never the quiet end on a counted read). */
async function forRead({ counted } = {}) {
  if (!(await on())) return {};
  const isCounted = typeof counted === 'function' ? !!(await counted()) : !!counted;
  return { lr3: { meter: 'glow', done: true, done_from: isCounted ? FINISH_PCT : 0, counted: isCounted, finish: { pct: FINISH_PCT, quiet_ms: QUIET_MS, tail_ms: TAIL_MS, quiet: !isCounted } } };
}

/** What a reading's row keeps from the page under v3 (RULING #C1 line 11): the UI version and how it ended; {} off. */
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

// a child's story-page keys today (Pakistan day), in this process: a cap on what one link can spend
const perDay = new Map();
const pkDay = (now = Date.now()) => new Date(now + 5 * 3600 * 1000).toISOString().slice(0, 10);
function countKey(studentId) {
  const day = pkDay();
  const k = `${day}|${studentId}`;
  if (perDay.size > 5000) for (const key of perDay.keys()) if (!key.startsWith(day)) perDay.delete(key);
  return k;
}

/**
 * A temporary Soniox key for one story-page reading: the hub token's child on THIS phone (the read-aloud's own
 * entry rule), the child's day cap and the day's read budget checked before anything is spent.
 * → { api_key, expires_at, ws, model, lang, run }. Never logs a key.
 */
async function storyKey({ st, kid, book, page, lang, device } = {}) {
  if (!(await on())) fail(404, 'off');
  const p = Number(page);
  if (typeof book !== 'string' || !BOOK_RX.test(book) || !Number.isInteger(p) || p < 1 || p > MAX_PAGE) fail(400, 'bad_page');
  const C = Ch();
  const entry = await C.entryOf(st, kid, device);
  const k = countKey(entry.studentId);
  if ((perDay.get(k) || 0) >= STORY_KEYS_PER_DAY || !(await Budget.readOpen())) fail(429, 'enough_for_today');
  const Live = require('./web-quiz-soniox-live');
  if (!Live.configured()) fail(503, 'live_unavailable');
  const run = crypto.randomUUID();
  const minted = await Live.mintTempKey(run);
  if (!minted.ok) {
    logError('web_quiz.lr_key_failed', { status: minted.status, reason: minted.reason });
    fail(502, 'live_unavailable');
  }
  perDay.set(k, (perDay.get(k) || 0) + 1);
  Budget.noteStarted();
  const l = lang === 'ur' ? 'ur' : 'en';
  logEvent('web_quiz.lr_key', { src: 'story_page', lang: l, run });
  return { api_key: minted.api_key, expires_at: minted.expires_at, ws: Live.WS_URL, model: Live.MODEL, lang: l, run };
}

function _reset() { perDay.clear(); }

module.exports = { FLAG_KEY, FINISH_PCT, QUIET_MS, TAIL_MS, UI_V, STORY_KEYS_PER_DAY, on, forRead, forMenu, metaFor, storyKey, _reset };
