'use strict';
/**
 * Faster child screens and a designed wait (app_settings web_quiz_wait_ux, default off, fail off, 30 s cache).
 *
 * On:
 *   - the Games door reads what it needs side by side instead of one after another, and waits at most SAY_WAIT_MS for
 *     the rows' spoken labels (a label not ready in time is said another way, and is ready on the next open);
 *   - every /api/internal/wq answer carries `Server-Timing: app;dur=<ms>, db;desc="<round trips>"` (web-quiz-internal.routes.js),
 *     and the edge forwards it beside its own time, so a walk can split the wait into edge, bot and database;
 *   - the hub answer carries `wait_ux: true`, so the page draws a thin progress bar for a wait over 400 ms and Jugnu's
 *     waiting moment for one over 1.5 s (dashboard/public/wq/wq-wait.js).
 * Off: the key is absent, no header is sent, the doors read in today's order, so every answer is today's, byte for byte.
 * Only the stored JSON boolean true turns it on: the string 'true', '"true"', 1, {enabled:true}, no row or a failed read
 * are all off.
 *
 * on() never waits: it answers from the cache and refreshes it in the background (web-quiz-one-face.js's shape), so the
 * switch adds no database round trip to a child's request. The first answer after a start is off; a value older than
 * twice the cache time is off too.
 */
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');

const KEY = 'web_quiz_wait_ux';
const FIELD = 'wait_ux';
const TTL_MS = 30 * 1000;
const SAY_WAIT_MS = 150;
let cache = null; // { at, on }
let reading = null;

function refresh() {
  if (!reading) {
    reading = (async () => {
      try {
        const { data, error } = await supabase.from('app_settings').select('key, value').eq('key', KEY).maybeSingle();
        if (error) throw new Error(error.message || 'app_settings read failed');
        cache = { at: Date.now(), on: Boolean(data) && data.value === true };
      } catch (err) {
        logToFile('⚠️ web quiz wait ux: settings lookup failed — off', { error: err.message });
        cache = { at: Date.now(), on: false };
      } finally {
        reading = null;
      }
      return cache.on;
    })();
  }
  return reading;
}

/** The switch, never waited for: the cached value, refreshed in the background when stale. Never throws. */
function on(now = Date.now()) {
  if (!cache || now - cache.at >= TTL_MS) refresh().catch(() => {});
  return Boolean(cache && cache.on && now - cache.at < 2 * TTL_MS);
}

/** The hub answer (or its promise) with the page's field added while on; the same answer, untouched, while off. */
function carry(outP) {
  return Promise.resolve(outP).then((out) => {
    if (on() && out && typeof out === 'object' && !Array.isArray(out)) out[FIELD] = true;
    return out;
  });
}

module.exports = { on, carry, refresh, KEY, FIELD, SAY_WAIT_MS, TTL_MS, _resetCache: () => { cache = null; reading = null; } };
