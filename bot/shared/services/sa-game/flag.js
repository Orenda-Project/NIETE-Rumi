'use strict';
/**
 * The Big Test in the games door: the reading battery as a game (app_settings `sa_game`, default OFF).
 *
 *   on()   30 s cache, JSON `true` only, fails closed (no row, any other value or a read error is off)
 *
 * Off, the games door's answer is today's byte for byte and /sa-game/* falls through at the edge.
 */
const supabase = require('../../config/supabase');
const Snap = require('../settings/settings-snapshot');
const { logToFile } = require('../../utils/logger');

const KEY = 'sa_game';
const TTL_MS = 30 * 1000;
let cache = null;

async function on(now = Date.now()) {
  if (cache && now - cache.at < TTL_MS) return cache.on;
  try {
    const { data, error } = await Snap.rows([KEY], () => supabase.from('app_settings').select('key, value').eq('key', KEY));
    if (error) throw new Error(error.message || 'app_settings read failed');
    cache = { at: now, on: (data || []).some((r) => r && r.key === KEY && r.value === true) };
    return cache.on;
  } catch (err) {
    logToFile('⚠️ sa game: settings lookup failed — off', { error: err.message });
    return false;
  }
}

module.exports = { on, KEY, _resetCache: () => { cache = null; } };
