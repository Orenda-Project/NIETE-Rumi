'use strict';
/**
 * A tap while offline stays on the page (app_settings web_quiz_offline_guard, default off, fail off, 30 s cache).
 *
 * On: the hub (the child home), the challenge menu (the Jugnu page) and the quiz answers carry `offline_guard: true`,
 * and those pages check the connection before every full navigation the child starts (the home's tile and doors, the
 * finish card's Next and Home, the fold's links, a lesson's link): offline, the page stays with the offline line and
 * Try again. Off: the key is absent, so every answer is today's, byte for byte, and the pages navigate as today. Only
 * the stored JSON boolean true turns it on: the string 'true', '"true"', 'yes', 1, {enabled:true}, no row or a failed
 * read are all off.
 *
 * on() never waits: it answers from the cache and refreshes it in the background (web-quiz-fast.js's shape), so the
 * switch adds no database round trip to a child's page. The first answer after a start is off; a value older than
 * twice the cache time is off too (a refresh that never comes back cannot keep the switch on).
 *
 * mount(router): one small step before the three answers' own routes, so their lines stay as they are; with the switch
 * off it only calls next(). hubSwitches: this module's row for the hub's one settings read (the seam's shape).
 */
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');

const KEY = 'web_quiz_offline_guard';
const FIELD = 'offline_guard';
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
        logToFile('⚠️ web quiz offline guard: settings lookup failed — off', { error: err.message });
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
 * The step before a page answer's route: when on, the answer's JSON object gets `offline_guard: true` (a 200 answer
 * only, never an error body); when off, nothing is touched. The switch is looked at as the request arrives.
 */
function step(req, res, next) {
  if (on()) {
    const json = res.json.bind(res);
    res.json = (body) => json(res.statusCode === 200 && body && typeof body === 'object' && !Array.isArray(body) && !body.error
      ? Object.assign(body, { [FIELD]: true }) : body);
  }
  next();
}

/** The hub (GET and POST), the challenge menu and the quiz answers: registered before their own routes. */
function mount(router) {
  router.get(['/hub/:token', '/ch/:token', '/quiz/:code'], step);
  router.post('/hub/:token', step);
}

const ageOf = (now) => (!cache ? 'cold' : now - cache.at < TTL_MS ? 'fresh' : 'stale');
const hubSwitches = { name: FIELD, keys: [KEY], swr: [], age: ageOf,
  prime: (rows, now) => fromRow((rows || []).find((r) => r && r.key === KEY) || null, now), read: () => flag(), peek: () => cache };

module.exports = { on, flag, step, mount, hubSwitches, KEY, FIELD, TTL_MS, _reset: () => { cache = null; reading = null; } };
