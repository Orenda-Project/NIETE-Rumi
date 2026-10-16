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
 */
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');

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
        cache = { at: Date.now(), on: isTrue(data && data.value) };
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

/** The switch, never waited for: the cached value, refreshed in the background when stale. */
function on(now = Date.now()) {
  if (!cache || now - cache.at >= TTL_MS) refresh().catch(() => {});
  return Boolean(cache && cache.on);
}

module.exports = { on, KEY, _reset: () => { cache = null; reading = null; } };
