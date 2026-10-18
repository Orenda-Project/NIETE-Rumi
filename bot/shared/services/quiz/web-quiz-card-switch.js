'use strict';
/**
 * THE FINISH CARD'S SWITCHES AND ITEM REFS (app_settings web_quiz_card_v3, web_quiz_share_v4; both default OFF).
 *
 * Kept apart from web-quiz-card-image.js (which re-exports all of it) so the bot's join and home paths can ask "is the
 * one share on?" and "which item is this ref?" without loading the picture's renderer and its quiz requires.
 *
 *   on() / shareOn() / joinedOn() / field()  the card's one settings read (30 s cache, fails closed); never throws
 *   ref(item) / byRef(ref)      pure / one read: the ref the join words carry (`jb1a2b3c4d` a book, `jv…` a video) and back
 */
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');

const KEY = 'web_quiz_card_v3';
// The one share on top of the card (finish's `share_v4`): read in the card's own settings read, never a read of its own.
const SHARE_KEY = 'web_quiz_share_v4';
// "A friend joined from your card!" on top of the one share: the same read and cache, never a read of its own.
const JOINED_KEY = 'web_quiz_share_joined';
// The card's result (score, stars, words, badge) sealed at mint (web-quiz-card-data.js): the same read and cache.
const DATA_KEY = 'web_quiz_share_data';
// Short share links /s/<id> (web-quiz-card-image.js shortUrl): the same read and cache.
const SHORT_KEY = 'web_quiz_share_short';
// The card's picture in design A (web-quiz-card-a.js): the same read and cache.
const CARD_A_KEY = 'web_quiz_share_card_a';
// The card's picture and page drawn and stored at mint (web-quiz-card-image.js prepare): the same read and cache.
const READY_KEY = 'web_quiz_card_ready';
// The page's facts also kept in Redis at mint, so any portal copy answers the link in a few ms: the same read and cache.
const FAST_KEY = 'web_quiz_card_fast';
const TTL_MS = 30 * 1000;
// Both reads failed (the settings store down): the card stays off, and that answer is kept 10 s, so an outage costs at
// most two reads per 10 s per worker and the card comes back within 10 s of the store.
const DOWN_TTL_MS = 10 * 1000;
const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ─── the switch ─────────────────────────────────────────────────────────────

let cache = null;
// On only as JSON true: a string "true" row is off, as every child-page switch reads it (one truth across the pages).
function isTrue(value) {
  return value === true;
}
/** true only with app_settings web_quiz_card_v3 literally true; 30 s cache; fails closed. Never throws. */
async function on(now = Date.now()) {
  if (cache && now - cache.at < (cache.down ? DOWN_TTL_MS : TTL_MS)) return cache.on;
  try {
    const { data, error } = await supabase.from('app_settings').select('key, value').in('key', [KEY, SHARE_KEY, JOINED_KEY, DATA_KEY, SHORT_KEY, CARD_A_KEY, READY_KEY, FAST_KEY]);
    if (error) throw new Error(error.message || 'app_settings read failed');
    const val = (k) => ((data || []).find((r) => r && r.key === k) || {}).value;
    cache = { at: now, on: isTrue(val(KEY)), share: isTrue(val(SHARE_KEY)), joined: isTrue(val(JOINED_KEY)), data: isTrue(val(DATA_KEY)), short: isTrue(val(SHORT_KEY)), cardA: isTrue(val(CARD_A_KEY)), ready: isTrue(val(READY_KEY)), fast: isTrue(val(FAST_KEY)) };
    return cache.on;
  } catch (err) {
    // the read that names the share failed: the card reads its own key as before, and only the share is off
    try {
      const { data, error } = await supabase.from('app_settings').select('key, value').eq('key', KEY);
      if (error) throw new Error(error.message || 'app_settings read failed');
      cache = { at: now, on: isTrue(((data || [])[0] || {}).value), share: false };
      return cache.on;
    } catch (err2) {
      logToFile('⚠️ web quiz card v3: settings lookup failed — card off', { error: err2.message, first: err.message });
      cache = { at: now, on: false, share: false, down: true };
      return false;
    }
  }
}
/** true only with the card on AND app_settings web_quiz_share_v4 literally true (the same read and cache). */
async function shareOn(now = Date.now()) {
  return (await on(now)) && cache.share === true;
}
/** true only with the one share on AND app_settings web_quiz_share_joined literally true (the same read and cache). */
async function joinedOn(now = Date.now()) {
  return (await shareOn(now)) && cache.joined === true;
}
/** The joined switch as the last read left it (a caller that has just read shareOn()); false with no read yet. */
/** The result switch as the last read left it (a caller that has just read shareOn()); false with no read yet. */
function dataCached() {
  return Boolean(cache && cache.share === true && cache.data === true);
}
/** The short-link switch as the last read left it (a caller that has just read shareOn()); false with no read yet. */
function shortCached() {
  return Boolean(cache && cache.share === true && cache.short === true);
}
/** The design-A switch as the last read left it (a caller that has just read shareOn()); false with no read yet. */
function cardACached() {
  return Boolean(cache && cache.share === true && cache.cardA === true);
}
/** The ready switch as the last read left it (a caller that has just read shareOn()); false with no read yet. */
function readyCached() {
  return Boolean(cache && cache.share === true && cache.ready === true);
}
/** The fast switch as the last read left it (on top of ready); false with no read yet. */
function fastCached() {
  return Boolean(cache && cache.share === true && cache.ready === true && cache.fast === true);
}
function joinedCached() {
  return Boolean(cache && cache.joined === true);
}
async function field() {
  try {
    if (!(await on())) return {};
    return cache.share === true ? { card_v3: true, share_v4: true } : { card_v3: true };
  } catch (_) { return {}; }
}

// ─── the item refs ──────────────────────────────────────────────────────────

// The ref the child's join words carry: `j`, b (book) or v (video), and the first 8 hex of the id (never the whole id);
// `jg00000000` the Games door. A quiz needs none: its card's link is the class link, the class's own way in.
const REF_RX = /^j([bvg])([0-9a-f]{8})$/;
const GAMES_REF = 'jg00000000';
function ref(item) {
  if (item && item.type === 'door' && item.id === 'games') return GAMES_REF;
  if (!item || (item.type !== 'book' && item.type !== 'video') || !UUID_RX.test(String(item.id || ''))) return null;
  return `j${item.type === 'book' ? 'b' : 'v'}${String(item.id).slice(0, 8).toLowerCase()}`;
}
/** A ref from the join words, back to its item: a ready book, a live video, the Games door; null else (two books on one ref: none). */
async function byRef(r) {
  const m = REF_RX.exec(String(r || '').toLowerCase());
  if (!m) return null;
  if (m[1] === 'g') return m[0] === GAMES_REF ? { type: 'door', id: 'games' } : null;
  try {
    if (m[1] === 'b') {
      // a uuid has no LIKE: the ids that start with these 8 hex are one range
      const { data } = await supabase.from('story_books').select('id').eq('status', 'ready')
        .gte('id', `${m[2]}-0000-0000-0000-000000000000`).lte('id', `${m[2]}-ffff-ffff-ffff-ffffffffffff`).limit(2);
      return data && data.length === 1 ? { type: 'book', id: data[0].id } : null;
    }
    const ix = await require('./web-quiz-bank').bank();
    const hits = ((ix && ix.rows) || []).filter((x) => String(x.id).toLowerCase().startsWith(m[2]));
    return hits.length === 1 ? { type: 'video', id: hits[0].id } : null;
  } catch (_) {
    return null;
  }
}

function _reset() { cache = null; }

module.exports = { KEY, SHARE_KEY, JOINED_KEY, DATA_KEY, SHORT_KEY, CARD_A_KEY, READY_KEY, FAST_KEY, UUID_RX, REF_RX, on, shareOn, joinedOn, joinedCached, dataCached, shortCached, cardACached, readyCached, fastCached, field, ref, byRef, _reset };
