'use strict';
/**
 * Minified page files (app_settings web_quiz_minify, default off, fail closed, 30 s cache).
 *
 * On: the quiz and hub payloads say `min: true`, and the edge links the child pages' JS/CSS at `?v=<hex>m`: their
 * minified copies (made once at the edge's start-up), at their own immutable URLs. Off: today's payloads, so the
 * pages link today's raw files again (a real rollback: a raw copy and a minified copy never share a URL).
 *
 * on() never waits: it answers from the cache and refreshes it in the background (web-quiz-fast.js's shape),
 * so the switch itself never costs a child's page a database round trip. The first read after a start is off.
 *
 * With web_quiz_fast on, the hub's one switch read (web-quiz-hub-switches.js) carries this switch too: its raw row fills
 * this cache, parsed here as this module's own read parses it, and while that read is in flight on() starts no read of
 * its own. Off: nothing here changes (the module reads its own switch, as before).
 */
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');
const Swr = require('./web-quiz-swr');

const KEY = 'web_quiz_minify';
const TTL_MS = 30 * 1000;
let cache = null; // { at, on }
let reading = null;

// On only for JSON true (the value is jsonb: a string, 1, null or anything else is off).
function isTrue(value) {
  return value === true;
}

function refresh() {
  if (!reading) {
    reading = (async () => {
      try {
        const { data, error } = await supabase.from('app_settings').select('key, value').eq('key', KEY).maybeSingle();
        if (error) throw new Error(error.message || 'app_settings read failed');
        fromRow(data, Date.now());
      } catch (err) {
        logToFile('⚠️ web quiz minify: settings lookup failed — off', { error: err.message });
        cache = { at: Date.now(), on: false };
      } finally {
        reading = null;
      }
      return cache.on;
    })();
  }
  return reading;
}

function fromRow(data, now) { cache = { at: now, on: isTrue(data && data.value) }; return cache.on; }

/** The switch, waited for (the seam's tests: this module's own read). */
async function flag(now = Date.now()) {
  if (cache && now - cache.at < TTL_MS) return cache.on;
  const seam = Swr.covered(SEAM_NAME);
  if (seam) { await seam; if (cache && now - cache.at < TTL_MS) return cache.on; }
  return refresh();
}

// The hub's one switch read (web_quiz_fast on, web-quiz-hub-switches.js): this module's key, its cache's age, and the
// cache from the raw row, parsed here exactly as this module's own read parses it.
const SEAM_NAME = 'minify';
const hubSwitches = { name: SEAM_NAME, keys: [KEY], swr: [SEAM_NAME], age: (now) => Swr.ageOf(cache, TTL_MS, now),
  prime: (rows, now) => fromRow(rows.find((r) => r.key === KEY) || null, now), read: () => flag(), peek: () => cache };

/** The switch, never waited for: the cached value, refreshed in the background when stale. */
function on(now = Date.now()) {
  // web_quiz_fast on: the hub's one switch read is in flight for this switch and fills this cache; no second read.
  if ((!cache || now - cache.at >= TTL_MS) && !Swr.covered(SEAM_NAME)) refresh().catch(() => {});
  return Boolean(cache && cache.on);
}

module.exports = { on, flag, hubSwitches, KEY, _reset: () => { cache = null; reading = null; } };
