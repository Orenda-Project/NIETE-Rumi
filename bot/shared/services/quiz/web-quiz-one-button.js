'use strict';
/**
 * One button system on the child pages (app_settings web_quiz_one_button, default off, fail off, 30 s cache).
 *
 * On: the quiz, hub, challenge menu and library answers carry `one_button: true`, and the page puts ONE class,
 * `wq-1b`, on <html> (wq-tel.js, the script every page loads first). Under it, wq.css draws every Home, back, share and
 * main button from one set of tokens (size, radius, shadow, press), centres every label, keeps every box 16 px off
 * both screen edges in either direction, and the home's grown-ups button says it is held, with a ring that fills.
 * Off: the key is absent, so every answer and every page is today's, byte for byte. Only the stored JSON boolean true
 * turns it on: the string 'true', 1, {enabled:true}, no row or a failed read are all off.
 *
 * on() never waits: it answers from the cache and refreshes it in the background (web-quiz-one-face.js's shape), so
 * the switch adds no database round trip to a child's page. The first answer after a start is off; a value older than
 * twice the cache time is off too.
 */
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');

const KEY = 'web_quiz_one_button';
const FIELD = 'one_button';
const TTL_MS = 30 * 1000;
let cache = null; // { at, on }
let reading = null;

/** Only the JSON boolean the flip writes (app_settings.value is jsonb). */
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
        logToFile('⚠️ web quiz one button: settings lookup failed — off', { error: err.message });
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

/**
 * A page answer with the switch's field: `one_button: true` only when on, nothing added when off. The switch is looked
 * at when this is called (before the answer is awaited), so its background refresh starts beside the page's own reads.
 */
function carry(answerP) {
  const one = on();
  return Promise.resolve(answerP).then((out) => (one && out && typeof out === 'object' && !Array.isArray(out) ? Object.assign(out, { [FIELD]: true }) : out));
}

module.exports = { on, flag, carry, KEY, FIELD, TTL_MS, _reset: () => { cache = null; reading = null; } };
