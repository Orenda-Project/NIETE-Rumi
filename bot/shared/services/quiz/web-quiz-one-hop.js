'use strict';
/**
 * The shelf, the videos door and a story open in one hop (app_settings web_quiz_one_hop, default off, fail closed,
 * 30 s cache). It builds on the fast first page (web_quiz_fast): only that page has a head sent before the bot answers,
 * and that head is where the early reads start. So it is on only when BOTH are on.
 *
 * On (both): the hub's answer says `one_hop: true` (the edge then sends the early head and the tail's early reads,
 * dashboard/routes/web-quiz-fast-hop.js), and a story's hub door also names the child's hub chip, so a class link to a
 * story starts the book before the hub has answered. Off (either): the hub's answer and the door's answer are today's
 * byte for byte (no `one_hop` key, the door's {href} alone).
 *
 * Only the JSON boolean the flip writes turns it on (app_settings.value is jsonb): the string 'true', '"true"', 'yes',
 * 1, {enabled:true}, no row, or a failed read is off.
 *
 * on() never waits: it answers from the cache and refreshes it in the background (web-quiz-fast.js's shape), so the
 * switch never costs a child's page a database round trip or a serial wave. With web_quiz_fast off it is never read
 * at all (the fast switch is asked first), so a fast-off hub makes no read for it. The first read after a start is off.
 *
 * The hub's one switch read (web-quiz-hub-switches.js, where present) can carry this switch too through `hubSwitches`
 * ({ name, keys, age, prime, read, peek }): its raw row fills this cache, parsed here as this module's own read parses
 * it, so a primed cache is fresh and on() reads nothing of its own.
 */
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');

const KEY = 'web_quiz_one_hop';
const TTL_MS = 30 * 1000;
const SEAM_NAME = 'one_hop';
let cache = null; // { at, on }
let reading = null;

function isTrue(value) {
  return value === true;
}

function fromRow(data, now) {
  cache = { at: now, on: isTrue(data && data.value) };
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
        logToFile('⚠️ web quiz one hop: settings lookup failed — off', { error: err.message });
        cache = { at: Date.now(), on: false };
      } finally {
        reading = null;
      }
      return cache.on;
    })();
  }
  return reading;
}

/** The switch alone, waited for (the tests and the hub's one switch read: this module's own read). */
async function flag(now = Date.now()) {
  if (cache && now - cache.at < TTL_MS) return cache.on;
  return refresh();
}

/** The switch alone, never waited for: the cached value, refreshed in the background when stale. */
function own(now = Date.now()) {
  if (!cache || now - cache.at >= TTL_MS) refresh().catch(() => {});
  return Boolean(cache && cache.on);
}

/** The behaviour's switch: web_quiz_fast on AND web_quiz_one_hop on. Never waits; fast off reads nothing here. */
function on(now = Date.now()) {
  return require('./web-quiz-fast').on(now) === true && own(now);
}

/** The hub's answer (the internal GET /hub/:token) with `one_hop: true` when on; off, the very same object (today's). */
function mark(out) {
  if (!out || typeof out !== 'object' || !on()) return out;
  return { ...out, one_hop: true };
}

/**
 * Express middleware for the internal GET /hub/:token (registered before that route): its 200 JSON answer is marked.
 * Every other answer (an error, a redirect) and every other route is untouched.
 */
function markHubAnswer(req, res, next) {
  const json = res.json.bind(res);
  res.json = (body) => json(res.statusCode === 200 ? mark(body) : body);
  next();
}

// The hub's one switch read (web-quiz-hub-switches.js): this module's key, its cache's age, and the cache from the
// raw row, parsed here exactly as this module's own read parses it.
const hubSwitches = {
  name: SEAM_NAME, keys: [KEY],
  age: (now = Date.now()) => (!cache ? 'cold' : (now - cache.at < TTL_MS ? 'fresh' : 'stale')),
  prime: (rows, now = Date.now()) => fromRow((rows || []).find((r) => r && r.key === KEY) || null, now),
  read: () => flag(), peek: () => cache,
};

module.exports = { on, own, flag, mark, markHubAnswer, hubSwitches, KEY, _reset: () => { cache = null; reading = null; } };
