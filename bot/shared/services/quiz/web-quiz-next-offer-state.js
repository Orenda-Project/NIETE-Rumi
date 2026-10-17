'use strict';
/**
 * The next-thing slot's leaf: its own three app_settings keys (30 s cache, fail closed), the events v3 switch read
 * synchronously for the page-event relay, and the per-child state in Redis (40 days) with the tap that resets a streak.
 * It requires no quiz module but the switch caches' helper (web-quiz-swr.js, which loads none), so web-quiz.service.js's relay reaches the slot without closing a require loop through
 * the challenge and the home (whose switches web-quiz-next-offer.js reads through their owners). The slot itself is
 * web-quiz-next-offer.js, built on these.
 *
 *   raw(now)                 { on, events, weights }: on/events only for the JSON value true; weights = the VALUE as stored
 *   eventsV3Now(now)         the events switch from the cache, synchronously (a stale cache refreshes behind)
 *   loadState(key) / saveState(key, st)   the slot's per-child state ({} on any failure; a lost write is no state)
 *   noteTap(kid, offer)      a tap on an offer resets its "shown, not tapped" streak
 *   hubSwitches              its part of the hub's one switch read (web-quiz-hub-switches.js, web_quiz_fast on only)
 */
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');
const Swr = require('./web-quiz-swr');

const KEYS = Object.freeze({ on: 'web_quiz_next_offer', weights: 'web_quiz_next_offer_weights', events: 'web_quiz_events_v3' });
const TTL_MS = 30 * 1000;
const STATE_TTL_S = 40 * 24 * 60 * 60;
// A switch is on only with the JSON value true: a string 'true' (or anything else) is off.
const { isTrue } = require('./is-true');
const RAW_OFF = Object.freeze({ on: false, events: false, weights: null });
let cache = null;

// web_quiz_fast on: a stale cache is answered at once and read again in the background (web-quiz-swr.js).
async function raw(now = Date.now()) {
  if (Swr.stale(cache, TTL_MS, now)) { Swr.revalidate('next-offer', () => readRaw(now, true)); return cache.raw; }
  return readRaw(now);
}

// keep: a background read that fails leaves the cached value as it was.
async function readRaw(now, keep = false) {
  if (cache && now - cache.at < TTL_MS) return cache.raw;
  // web_quiz_fast on: the hub's one switch read is in flight for this switch; its answer, not a read of its own.
  const seam = Swr.covered('next-offer');
  if (seam) { await seam; if (cache && now - cache.at < TTL_MS) return cache.raw; }
  try {
    const { data, error } = await supabase.from('app_settings').select('key, value').in('key', Object.values(KEYS));
    if (error) throw new Error(error.message || 'app_settings read failed');
    return fromRows(data, now);
  } catch (err) {
    logToFile('⚠️ web quiz next offer: settings lookup failed — off', { error: err.message });
    if (keep && cache) return cache.raw;
    cache = { at: now, raw: RAW_OFF };   // off for the cache's life: an outage never costs a read per request
    return RAW_OFF;
  }
}

// The rows of the read (or of the hub's one switch read, web-quiz-hub-switches.js) -> the cache.
function fromRows(data, now) {
  const by = Object.fromEntries((data || []).map((r) => [r.key, r.value]));
  const r = Object.freeze({ on: isTrue(by[KEYS.on]), events: isTrue(by[KEYS.events]), weights: by[KEYS.weights] === undefined ? null : by[KEYS.weights] });
  cache = { at: now, raw: r };
  return r;
}

// The hub's one switch read (web_quiz_fast on): this module's keys, its cache's age, and the cache from the raw rows,
// parsed here exactly as this module's own read parses them.
const KEY_LIST = Object.values(KEYS);
const hubSwitches = { name: 'next-offer', keys: KEY_LIST, swr: ['next-offer'], age: (now) => Swr.ageOf(cache, TTL_MS, now),
  prime: (rows, now) => fromRows(rows.filter((r) => KEY_LIST.includes(r.key)), now), read: () => raw(), peek: () => cache };

/** The events v3 switch from the cache, synchronously (the page relay is synchronous); a stale cache refreshes behind. */
function eventsV3Now(now = Date.now()) {
  if (!cache || now - cache.at >= TTL_MS) raw(now).catch(() => {});
  return Boolean(cache && cache.raw && cache.raw.events);
}

const redisOf = () => require('../cache/railway-redis.service');
const stateKey = (key) => `wq:next:${key}`;

async function loadState(key) {
  try {
    const st = await redisOf().get(stateKey(key));
    return st && typeof st === 'object' ? st : {};
  } catch (_) {
    return {};
  }
}

async function saveState(key, st) {
  try { await redisOf().set(stateKey(key), st, STATE_TTL_S); } catch (_) { /* no state: rules still hold */ }
}

/** A tap on an offer (the page's next_tap, through the event relay, by the child's kid): its streak starts again. */
async function noteTap(kid, offer) {
  try {
    if (!kid || typeof offer !== 'string') return false;
    const st = await loadState(kid);
    const id = st.of && st.of[offer];
    if (!id || !st.s || st.s.id !== id) return false;
    await saveState(kid, { ...st, s: { id, n: 0 } });
    return true;
  } catch (_) {
    return false;
  }
}

module.exports = { KEYS, TTL_MS, STATE_TTL_S, raw, hubSwitches, eventsV3Now, loadState, saveState, noteTap, isTrue, _resetCache: () => { cache = null; } };
