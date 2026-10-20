'use strict';
/**
 * The big flight: the reading and number battery as a game (app_settings `sa_game`, default OFF).
 *
 *   on()    the game page and its sink: 30 s cache, JSON `true` only, fails closed (no row, any other value or a read
 *           error is off)
 *   now()   the games door: the kid hub's warm switch cache only (web-quiz-hub-flags field `battery`), never a read of
 *           its own (cold, stale or not listed there: off), so the door costs no settings read
 *
 * Off, the games door's answer is today's byte for byte and /sa-game/* falls through at the edge.
 */
const supabase = require('../../config/supabase');
const Snap = require('../settings/settings-snapshot');
const { logToFile } = require('../../utils/logger');

const KEY = 'sa_game';
const TTL_MS = 30 * 1000;
let cache = null;

async function on(at = Date.now()) {
  if (cache && at - cache.at < TTL_MS) return cache.on;
  try {
    const { data, error } = await Snap.rows([KEY], () => supabase.from('app_settings').select('key, value').eq('key', KEY));
    if (error) throw new Error(error.message || 'app_settings read failed');
    cache = { at, on: (data || []).some((r) => r && r.key === KEY && r.value === true) };
    return cache.on;
  } catch (err) {
    logToFile('⚠️ sa game: settings lookup failed — off', { error: err.message });
    return false;
  }
}

function now() {
  try { return require('../quiz/web-quiz-hub-flags').nowOf('battery') === true; } catch (_) { return false; }
}

module.exports = { on, now, KEY, _resetCache: () => { cache = null; } };
