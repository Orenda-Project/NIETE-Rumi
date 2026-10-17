'use strict';
/**
 * The read-along player fetched with the Jugnu page (app_settings `web_quiz_ra_preload`).
 *
 * On a menu that can serve a passage with the read-along on, the menu says `ra_pre: true` and the page head carries one
 * preload line for the player. On only for the stored JSON boolean `true` (the string 'true', 1, {enabled:true}, no row
 * and a failed read are off), and only while web_quiz_readalong is on too. Read like the other switches (30 s cache,
 * fails closed) but never waited for: the cached answer is used, refreshed in the background when stale, so the menu
 * adds no database wave; the first menu after a start is without the line.
 */
const supabase = require('../../config/supabase');

const KEY = 'web_quiz_ra_preload';
const READALONG_KEY = 'web_quiz_readalong';
const TTL_MS = 30 * 1000;
let cache = null;   // { at, on }
let inflight = null;

function refresh(now) {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const { data, error } = await supabase.from('app_settings').select('key, value').in('key', [KEY, READALONG_KEY]);
      if (error) throw new Error(error.message || 'app_settings read failed');
      const by = Object.fromEntries((data || []).map((r) => [r.key, r.value]));
      cache = { at: now, on: by[KEY] === true && by[READALONG_KEY] === true };
    } catch (_) {
      cache = { at: now, on: false };
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** The cached answer; a stale or missing one starts a background read and answers off meanwhile. Never throws, never waits. */
function nowOn(now = Date.now()) {
  try {
    if (!cache || now - cache.at >= TTL_MS) refresh(now).catch(() => {});
  } catch (_) { /* off */ }
  return Boolean(cache && cache.on);
}

/** The menu with `ra_pre: true` when it can serve a passage (a Story Time stop and a read stop), else the same object. */
function mark(menu) {
  if (!nowOn()) return menu;
  if (!menu || typeof menu !== 'object' || !(menu.v2 && menu.v2.story)) return menu;
  if (!Array.isArray(menu.exercises) || !menu.exercises.some((e) => e && e.id === 'read')) return menu;
  return { ...menu, ra_pre: true };
}

module.exports = { KEY, mark, nowOn, _reset: () => { cache = null; inflight = null; } };
