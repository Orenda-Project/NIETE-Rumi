'use strict';
/**
 * The designed wait across a page hop (app_settings web_quiz_wait_hops, default off, fail off, 30 s cache).
 *
 * On, with the designed wait on (web_quiz_wait_ux), the hub answers carry `wait_hops: true` (web-quiz-wait-ux.js
 * carry), and the page's bar also shows while the page is being left: a tap on «My class», «My school», a game or a
 * quiz, until the next page's first bytes (dashboard/routes/web-quiz-wait-ux.js). Off: the key is absent and every
 * answer is today's. Only the stored JSON boolean true turns it on.
 *
 * on() never waits: it answers from the cache and refreshes it in the background (web-quiz-one-face.js's shape), so the
 * switch adds no database round trip to a child's page. The first answer after a start is off; a value older than twice
 * the cache time is off too.
 */
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');

const KEY = 'web_quiz_wait_hops';
const FIELD = 'wait_hops';
const TTL_MS = 30 * 1000;
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
        logToFile('⚠️ web quiz wait hops: settings lookup failed — off', { error: err.message });
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

/** The switch, waited for (tests). */
async function flag(now = Date.now()) {
  if (cache && now - cache.at < TTL_MS) return cache.on;
  return refresh();
}

module.exports = { on, flag, KEY, FIELD, TTL_MS, _reset: () => { cache = null; reading = null; } };
