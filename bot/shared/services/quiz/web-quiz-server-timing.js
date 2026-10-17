'use strict';
/**
 * The child home's step timings (app_settings web_quiz_server_timing, default off, fail off, 30 s cache).
 *
 * On: the bot's internal hub answer carries a Server-Timing header, one `name;dur=<ms>` per awaited step of the build
 * (fixed short names: ui, gate, kids, ctx, take, teacher, recs, play, home, other, tail, total), and the edge logs it,
 * forwards it on a page whose headers have not gone yet, and puts it in the flushed page's boot JSON (`st`) for the
 * home's home_view beacon. Timings only: no id, name, token or value of the child's ever goes in.
 * Off: no stopwatch, no header; every answer and every page is today's, byte for byte.
 * Only the stored JSON boolean true turns it on: the string 'true', '"true"', 1, no row or a failed read are all off.
 *
 * on() never waits: it answers from the cache and refreshes it in the background (web-quiz-one-face.js's shape), so
 * the switch adds no database round trip to a child's page. The first answer after a start is off; a value older than
 * twice the cache time is off too.
 */
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');

const KEY = 'web_quiz_server_timing';
const TTL_MS = 30 * 1000;
let cache = null; // { at, on }
let reading = null;

/** Only the JSON boolean the flip writes (app_settings.value is jsonb). */
const isTrue = (value) => value === true;

function refresh() {
  if (!reading) {
    reading = (async () => {
      try {
        const { data, error } = await supabase.from('app_settings').select('key, value').eq('key', KEY).maybeSingle();
        if (error) throw new Error(error.message || 'app_settings read failed');
        cache = { at: Date.now(), on: isTrue(data && data.value) };
      } catch (err) {
        logToFile('⚠️ web quiz server timing: settings lookup failed — off', { error: err.message });
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
  try {
    if (!cache || now - cache.at >= TTL_MS) refresh().catch(() => {});
    return Boolean(cache && cache.on && now - cache.at < 2 * TTL_MS);
  } catch (_) {
    return false;
  }
}

const clock = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** A stopwatch: mark(name) adds the time since the last mark to `name` (a name marked twice adds up); header() ends with total. */
function steps() {
  const t0 = clock();
  let last = t0;
  const d = {};
  return {
    mark(name) { const t = clock(); d[name] = (d[name] || 0) + (t - last); last = t; },
    header() {
      const parts = Object.keys(d).map((k) => `${k};dur=${Math.round(d[k])}`);
      parts.push(`total;dur=${Math.round(clock() - t0)}`);
      return parts.join(', ');
    },
  };
}

module.exports = { on, steps, KEY, _reset: () => { cache = null; reading = null; } };
