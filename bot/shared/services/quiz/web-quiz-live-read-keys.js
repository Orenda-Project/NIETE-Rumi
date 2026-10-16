'use strict';
/**
 * Live reading v3: a story page's own one-read temporary speech key (POST /lr/key; web_quiz_live_read_v3 AND
 * web_quiz_challenge_realtime on, else 404 'off'). Single use, the run id as reference: no run row, no upload, nothing
 * of the child's voice kept. Before anything is spent:
 *   - the page must be one the child app can read: web_quiz_stories on, the book `ready`, the page there and not a
 *     picture-only page (else 404 'not_found');
 *   - the hub token's child on THIS phone (the read-aloud's own entry rule);
 *   - the child's day cap (app_settings `web_quiz_live_read_story_keys_per_day`, default 40) and the whole day's read
 *     budget (web-quiz-challenge-budget.js), both counted from web_quiz_live_read_keys: one row per key (who, when, the
 *     language; nothing else), so the caps hold across restarts and replicas.
 *   - the same page again soon (read one sentence at a time, or a retry): a fresh key (a key opens one stream) but
 *     no new count, up to REPEAT_MAX times within REPEAT_MS; held in this process, so a restart only ever counts more.
 * → { api_key, expires_at, ws, model, lang, run }. Never logs a key. A table that cannot be read or written ⇒ no key (503).
 */
const crypto = require('crypto');
const supabase = require('../../config/supabase');
const { logError } = require('../../utils/logger');
const { logEvent } = require('../../utils/structured-logger');
const { clampLanguage } = require('../../config/ux-strings');
const { WqError } = require('./web-quiz.service');
const Budget = require('./web-quiz-challenge-budget');
const LR = require('./web-quiz-live-read-v3');
// the read-aloud's entry rule, and (loaded with it) the Challenge's story-key count in the day's read budget
const Ch = require('./web-quiz-challenge');

const CAP_KEY = 'web_quiz_live_read_story_keys_per_day';
const STORIES_FLAG_KEY = 'web_quiz_stories';
// a story page is ~20-40 words: enough for a whole book's pages twice in a day, then "enough for today"
const STORY_KEYS_PER_DAY = 40;
const BOOK_RX = /^[A-Za-z0-9_-]{1,64}$/;
const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_PAGE = 200;
const CACHE_MS = 30 * 1000;
const PK_OFFSET_MS = 5 * 3600 * 1000;
// a page read sentence by sentence is ~3-12 keys in a few minutes; past either bound the page counts again
const REPEAT_MS = 15 * 60 * 1000;
const REPEAT_MAX = 12;

const fail = (status, error) => { throw new WqError(status, { error }); };
const pkMidnightIso = (now = Date.now()) => new Date(Date.parse(`${new Date(now + PK_OFFSET_MS).toISOString().slice(0, 10)}T00:00:00Z`) - PK_OFFSET_MS).toISOString();
let capCache = null;            // { at, cap }
const readable = new Map();     // `${book}|${page}` → { at, ok }
const counted = new Map();      // `${student}|${book}|${page}` → { at, free }: the page's counted key, its free repeats

async function storyCap(now = Date.now()) {
  if (capCache && now - capCache.at < CACHE_MS) return capCache.cap;
  let cap = STORY_KEYS_PER_DAY;
  try {
    const { data, error } = await supabase.from('app_settings').select('key, value').eq('key', CAP_KEY);
    if (error) throw new Error(error.message || 'app_settings read failed');
    const v = data && data[0] ? Number(data[0].value) : NaN;
    if (Number.isFinite(v) && v >= 0) cap = Math.floor(v);
  } catch (e) {
    logError('web_quiz.lr_cap_read_failed', { error: String((e && e.message) || e).slice(0, 120) });
  }
  capCache = { at: now, cap };
  return cap;
}

/** May the child app read this page? The book (its id or slug) ready, the page there, words on it. Cached 30 s. */
async function pageReadable(book, page, now = Date.now()) {
  if (!(await LR.settingOn(STORIES_FLAG_KEY))) return false;
  const k = `${book}|${page}`;
  const c = readable.get(k);
  if (c && now - c.at < CACHE_MS) return c.ok;
  const { data: books, error } = await supabase.from('story_books').select('id, status').eq(UUID_RX.test(book) ? 'id' : 'slug', book);
  if (error) throw new Error(error.message || 'story_books read failed');
  const b = (books || [])[0];
  let ok = false;
  if (b && b.status === 'ready') {
    const { data: pages, error: e2 } = await supabase.from('story_pages').select('id, is_picture').eq('book_id', b.id).eq('n', page);
    if (e2) throw new Error(e2.message || 'story_pages read failed');
    ok = !!((pages || [])[0] && !pages[0].is_picture);
  }
  if (readable.size > 2000) readable.clear();
  readable.set(k, { at: now, ok });
  return ok;
}

/** This child's story keys since Pakistan midnight; throws when the table cannot be read. */
async function keysToday(studentId, now = Date.now()) {
  const { count, error } = await supabase.from('web_quiz_live_read_keys').select('id', { count: 'exact', head: true }).eq('student_id', studentId).gte('created_at', pkMidnightIso(now));
  if (error) throw new Error(error.message || 'count failed');
  return Number(count) || 0;
}

async function storyKey({ st, kid, book, page, lang, device } = {}) {
  if (!(await LR.liveOn())) fail(404, 'off');
  const p = Number(page);
  if (typeof book !== 'string' || !BOOK_RX.test(book) || !Number.isInteger(p) || p < 1 || p > MAX_PAGE) fail(400, 'bad_page');
  let ok;
  try { ok = await pageReadable(book, p); } catch (e) {
    logError('web_quiz.lr_page_read_failed', { error: String((e && e.message) || e).slice(0, 120) });
    fail(503, 'live_unavailable');
  }
  if (!ok) fail(404, 'not_found');
  const entry = await Ch.entryOf(st, kid, device);
  const l = clampLanguage(lang, ['en', 'ur']);
  let mine;
  try { mine = await keysToday(entry.studentId); } catch (e) {
    logError('web_quiz.lr_keys_count_failed', { error: String((e && e.message) || e).slice(0, 120) });
    fail(503, 'live_unavailable');
  }
  const cap = await storyCap();
  const pk = `${entry.studentId}|${book}|${p}`;
  const seen = counted.get(pk);
  const repeat = !!(seen && Date.now() - seen.at < REPEAT_MS && seen.free < REPEAT_MAX);
  if (!repeat && (mine >= cap || !(await Budget.readOpen()))) {
    logEvent('web_quiz.lr_key_rest', { src: 'story_page', n: mine, cap });
    fail(429, 'enough_for_today');
  }
  const Live = require('./web-quiz-soniox-live');
  if (!Live.configured()) fail(503, 'live_unavailable');
  const run = crypto.randomUUID();
  // the row first: a key is never handed out that the caps did not count (a repeat was counted with its page)
  if (!repeat) {
    const { error } = await supabase.from('web_quiz_live_read_keys').insert({ id: run, student_id: entry.studentId, src: 'story_page', lang: l, created_at: new Date().toISOString() });
    if (error) {
      logError('web_quiz.lr_keys_write_failed', { error: String(error.message || error).slice(0, 120) });
      fail(503, 'live_unavailable');
    }
    if (counted.size > 5000) counted.clear();
    counted.set(pk, { at: Date.now(), free: 0 });
  } else {
    seen.free += 1;
  }
  const minted = await Live.mintTempKey(run);
  if (!minted.ok) {
    logError('web_quiz.lr_key_failed', { status: minted.status, reason: minted.reason });
    fail(502, 'live_unavailable');
  }
  if (!repeat) Budget.noteStarted(LR.STORY_KEY_WEIGHT);
  // n = this child's counted story keys today, this one included: the cap is set from that spread, not a guess
  logEvent('web_quiz.lr_key', { src: 'story_page', lang: l, run, n: repeat ? mine : mine + 1, cap, ...(repeat ? { repeat: true } : {}) });
  return { api_key: minted.api_key, expires_at: minted.expires_at, ws: Live.WS_URL, model: Live.MODEL, lang: l, run };
}

function _reset() { capCache = null; readable.clear(); counted.clear(); }

module.exports = { CAP_KEY, STORIES_FLAG_KEY, STORY_KEYS_PER_DAY, REPEAT_MS, REPEAT_MAX, storyKey, pageReadable, _reset };
