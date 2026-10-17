'use strict';
/**
 * The adventure look on the child pages (app_settings web_quiz_adventure_look, default off, fail off, 30 s cache).
 *
 * On: the quiz, hub and challenge menu answers carry `adv: true`, and the edge puts ONE class on <html> (`wq-adv`) and
 * links the look's stylesheet and kit (wq-adventure.css, wq-adv.js) after the page's own. Off: the key is absent, so
 * every answer and every page is today's, byte for byte. Only the stored JSON boolean true turns it on: the string
 * 'true', '"true"', 'yes', 1, {enabled:true}, no row or a failed read are all off.
 *
 * on() never waits: it answers from the cache and refreshes it in the background (web-quiz-one-face.js's shape), so
 * the switch adds no database round trip to a child's page. The first answer after a start is off; a value older than
 * twice the cache time is off too (a refresh that never comes back cannot keep the switch on).
 */
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');
// The look only re-colours the one button system's buttons, so it is on only when that switch is on too.
const OneButton = require('./web-quiz-one-button');

const KEY = 'web_quiz_adventure_look';
const FIELD = 'adv';
const TTL_MS = 30 * 1000;
let cache = null; // { at, on }
let reading = null;

/** Only the JSON boolean the flip writes (app_settings.value is jsonb). */
function isTrue(value) {
  return value === true;
}

function fromRow(row, now) {
  cache = { at: now, on: isTrue(row && row.value) };
  return cache.on;
}

function refresh() {
  if (!reading) {
    reading = (async () => {
      try {
        const { data, error } = await supabase.from('app_settings').select('key, value').eq('key', KEY).maybeSingle();
        if (error) throw new Error(error.message || 'app_settings read failed');
        fromRow(data, Date.now());
      } catch (err) {
        logToFile('⚠️ web quiz adventure look: settings lookup failed — off', { error: err.message });
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

/** The switch, waited for (tests, and the seam's own-read check). */
async function flag(now = Date.now()) {
  if (cache && now - cache.at < TTL_MS) return cache.on;
  return refresh();
}

/**
 * A page answer with the switch's field: `adv: true` only when on AND the one button system is on, nothing added
 * otherwise (with web_quiz_one_button off the look's own row is not even read). The switches are looked at when this
 * is called (before the answer is awaited), so a background refresh starts beside the page's own reads.
 */
function carry(answerP) {
  const one = OneButton.on() && on();
  return Promise.resolve(answerP).then((out) => (one && out && typeof out === 'object' && !Array.isArray(out) ? Object.assign(out, { [FIELD]: true }) : out));
}

const ageOf = (now) => (!cache ? 'cold' : now - cache.at < TTL_MS ? 'fresh' : 'stale');
const hubSwitches = { name: FIELD, keys: [KEY], swr: [], age: ageOf,
  prime: (rows, now) => fromRow((rows || []).find((r) => r && r.key === KEY) || null, now), read: () => flag(), peek: () => cache };

module.exports = { on, flag, carry, hubSwitches, KEY, FIELD, TTL_MS, _reset: () => { cache = null; reading = null; } };
