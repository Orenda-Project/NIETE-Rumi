'use strict';
/**
 * The child home's plain fallback (app_settings `web_quiz_home_fallback_v3`, default OFF): when the home's own script
 * (wq-home.js) never arrives, the page draws a plain home from the hub payload instead of the old hub. Read on its own,
 * beside the home's switches, so the home's read stays as it is. on(): 30 s cache, JSON `true` only, fails closed.
 */
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');
const Swr = require('./web-quiz-swr');

const KEY = 'web_quiz_home_fallback_v3';
const TTL_MS = 30 * 1000;
let cache = null;

async function on(now = Date.now()) {
  if (cache && now - cache.at < TTL_MS) return cache.on;
  // web_quiz_fast on: a stale cache is answered at once and read again in the background (web-quiz-swr.js).
  if (Swr.stale(cache, TTL_MS, now)) { Swr.revalidate('home-fallback', () => readOn(now, true)); return cache.on; }
  // web_quiz_fast on: the hub's one switch read is in flight for this switch; its answer, not a read of its own.
  const seam = Swr.covered('home-fallback');
  if (seam) { await seam; if (cache && now - cache.at < TTL_MS) return cache.on; }
  return readOn(now);
}

// keep: a background read that fails leaves the cached value as it was.
async function readOn(now, keep = false) {
  try {
    const { data, error } = await supabase.from('app_settings').select('key, value').eq('key', KEY);
    if (error) throw new Error(error.message || 'app_settings read failed');
    return fromRows(data, now);
  } catch (err) {
    logToFile('⚠️ web quiz home fallback: settings lookup failed — off', { error: err.message });
    if (keep && cache) return cache.on;
    return false;
  }
}

// The rows of the read (or of the hub's one switch read, web-quiz-hub-switches.js) -> the cache: JSON `true` only.
function fromRows(data, now) {
  cache = { at: now, on: (data || []).some((r) => r && r.key === KEY && r.value === true) };
  return cache.on;
}

// The hub's one switch read (web_quiz_fast on): this module's key, its cache's age, and the cache from the raw rows,
// parsed here exactly as this module's own read parses them.
const hubSwitches = { name: 'home-fallback', keys: ['web_quiz_home_fallback_v3'], swr: ['home-fallback'], age: (now) => Swr.ageOf(cache, TTL_MS, now),
  prime: (rows, now) => fromRows(rows.filter((r) => r.key === 'web_quiz_home_fallback_v3'), now), read: () => on(), peek: () => cache };

module.exports = { on, KEY, hubSwitches, _resetCache: () => { cache = null; } };
