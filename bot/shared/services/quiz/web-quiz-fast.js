'use strict';
/**
 * Fast first page (app_settings web_quiz_fast, default off, fail closed, 30 s cache).
 *
 * On: getQuiz runs the reads that need only the resolved code together, and its payload says `fast: true` so the
 * edge sends the page's head (styles, scripts, the Jugnu boot frame) before the bot answers. Off: today's payload.
 *
 * on() never waits: it answers from the cache and refreshes it in the background (web-quiz-telemetry.js's shape),
 * so the switch itself never costs a child's page a database round trip. The first read after a start is off.
 */
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');

const KEY = 'web_quiz_fast';
const TTL_MS = 30 * 1000;
let cache = null; // { at, on }
let reading = null;

function isTrue(value) {
  let v = value;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch (_) { /* plain string */ } }
  return v === true || (typeof v === 'string' && v.trim().toLowerCase() === 'true');
}

function refresh() {
  if (!reading) {
    reading = (async () => {
      try {
        const { data, error } = await supabase.from('app_settings').select('key, value').eq('key', KEY).maybeSingle();
        if (error) throw new Error(error.message || 'app_settings read failed');
        cache = { at: Date.now(), on: isTrue(data && data.value) };
      } catch (err) {
        logToFile('⚠️ web quiz fast: settings lookup failed — off', { error: err.message });
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

/** On, from a fresh cache, with no read (the hub switches' timer, web-quiz-hub-switches.js): false when stale or unread. */
function fresh(now = Date.now()) {
  return Boolean(cache && now - cache.at < TTL_MS && cache.on);
}

/** The cached value, however old, with no read (the timer's own check): false when unread. */
function cachedOn() {
  return Boolean(cache && cache.on);
}

/** The timer's one read carries this switch too: the cache from its row (absent: off), parsed as this module's read. */
function prime(rows, now = Date.now()) {
  const row = (rows || []).find((r) => r && r.key === KEY);
  cache = { at: now, on: isTrue(row && row.value) };
  return cache.on;
}

/**
 * Start a read now and keep its rejection for whoever awaits it: a read started early must not become an
 * unhandled rejection while the request waits on something else.
 */
function early(promise) {
  promise.catch(() => {});
  return promise;
}

module.exports = { on, fresh, cachedOn, prime, early, KEY, _reset: () => { cache = null; reading = null; } };
