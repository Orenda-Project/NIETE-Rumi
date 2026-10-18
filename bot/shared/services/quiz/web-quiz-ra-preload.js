'use strict';
/**
 * The read-along player fetched with the Jugnu page (app_settings `web_quiz_ra_preload`).
 *
 * On a menu that can serve a passage with the read-along on, the menu says `ra_pre: true` and the page head carries one
 * preload line for the player. On only for the stored JSON boolean `true` (the string 'true', 1, {enabled:true}, no row
 * and a failed read are off), and only while web_quiz_readalong is on too. Read like the other switches (30 s cache,
 * fails closed). It adds no database read: its two keys ride the one settings read the menu already makes (the trail page flags; the menu
 * reads it before it answers, so the answer is the menu's own, at most 30 s old).
 */
const KEY = 'web_quiz_ra_preload';
const READALONG_KEY = 'web_quiz_readalong';
// Read with the settings the menu already reads (web-quiz-trail-page.js flags): the same one read, two more keys in it.
const KEYS = [KEY, READALONG_KEY];
let cache = null;   // { on }

/** The rows of the menu's own settings read (null when it failed, which is off). Never throws, never reads. */
function feed(rows) {
  try {
    const by = Object.fromEntries((Array.isArray(rows) ? rows : []).map((r) => [r.key, r.value]));
    cache = { on: by[KEY] === true && by[READALONG_KEY] === true };
  } catch (_) {
    cache = { on: false };
  }
}

/** The answer the last menu read left; off until one has. Never reads, never waits. */
function nowOn() {
  return Boolean(cache && cache.on);
}

/** The menu with `ra_pre: true` when it can serve a passage (a Story Time stop and a read stop), else the same object. */
function mark(menu) {
  if (!nowOn()) return menu;
  if (!menu || typeof menu !== 'object' || !(menu.v2 && menu.v2.story)) return menu;
  if (!Array.isArray(menu.exercises) || !menu.exercises.some((e) => e && e.id === 'read')) return menu;
  return { ...menu, ra_pre: true };
}

module.exports = { KEY, KEYS, feed, mark, nowOn, _reset: () => { cache = null; } };
