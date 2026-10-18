'use strict';
/**
 * The next-thing slot's leaf: its own three app_settings keys (30 s cache, fail closed), the events v3 switch read
 * synchronously for the page-event relay, and the per-child state in Redis (40 days) with the tap that resets a streak.
 * It requires no quiz module, so web-quiz.service.js's relay reaches the slot without closing a require loop through
 * the challenge and the home (whose switches web-quiz-next-offer.js reads through their owners). The slot itself is
 * web-quiz-next-offer.js, built on these.
 *
 *   raw(now)                 { on, events, weights }: on/events only for the JSON value true; weights = the VALUE as stored
 *   eventsV3Now(now)         the events switch from the cache, synchronously (a stale cache refreshes behind)
 *   loadState(key) / saveState(key, st)   the slot's per-child state ({} on any failure; a lost write is no state)
 *   noteTap(kid, offer)      a tap on an offer resets its "shown, not tapped" streak, is remembered as opened and not
 *                            yet finished (the carry-on: `t`), and spends the once-a-day tile its view showed
 *   noteDoor(kid)            a door tapped from the home spends the once-a-day tile that home showed
 *   noteDone(kid, card)      a finish card of the carried-on tile's kind: it was finished, so it is carried no more
 *   copyOf(tile)             the fields of a shown tile the state keeps (what the page drew, nothing else)
 */
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');

const KEYS = Object.freeze({ on: 'web_quiz_next_offer', weights: 'web_quiz_next_offer_weights', events: 'web_quiz_events_v3' });
const TTL_MS = 30 * 1000;
const STATE_TTL_S = 40 * 24 * 60 * 60;
// A switch is on only with the JSON value true: a string 'true' (or anything else) is off.
const isTrue = (value) => value === true;
const RAW_OFF = Object.freeze({ on: false, events: false, weights: null });
let cache = null;

async function raw(now = Date.now()) {
  if (cache && now - cache.at < TTL_MS) return cache.raw;
  try {
    const { data, error } = await supabase.from('app_settings').select('key, value').in('key', Object.values(KEYS));
    if (error) throw new Error(error.message || 'app_settings read failed');
    const by = Object.fromEntries((data || []).map((r) => [r.key, r.value]));
    const r = Object.freeze({ on: isTrue(by[KEYS.on]), events: isTrue(by[KEYS.events]), weights: by[KEYS.weights] === undefined ? null : by[KEYS.weights] });
    cache = { at: now, raw: r };
    return r;
  } catch (err) {
    logToFile('⚠️ web quiz next offer: settings lookup failed — off', { error: err.message });
    cache = { at: now, raw: RAW_OFF };   // off for the cache's life: an outage never costs a read per request
    return RAW_OFF;
  }
}

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

const PKT_MS = 5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const pktDay = (ms) => Math.floor((ms + PKT_MS) / DAY_MS);
const COPY_KEYS = ['kind', 'variant', 'id', 'href', 'title', 'title_ur', 'sub', 'sub_ur', 'minutes', 'art', 'tag', 'tag_ur'];
function copyOf(x) {
  const out = {};
  COPY_KEYS.forEach((k) => { if (x && x[k] != null) out[k] = x[k]; });
  return out;
}

// the once-a-day tile (`rs`, the view that showed it today) is spent by a tap from that view
const spend = (st, now) => (st.rs && st.rs.day === pktDay(now) ? { rd: st.rs.day, rs: null } : {});

/**
 * A tap on an offer (the page's next_tap, through the event relay, by the child's kid): its streak starts again; the
 * tapped tile is remembered as opened and not yet finished (`t`: id, variant, unfinished opens `u`, its copy `c`) —
 * the slot's carry-on, which counts it as one shown-without-a-tap; and its view's once-a-day tile is spent.
 */
async function noteTap(kid, offer, now = Date.now()) {
  try {
    if (!kid || typeof offer !== 'string') return false;
    const st = await loadState(kid);
    const id = st.of && st.of[offer];
    if (!id) return false;
    const c = st.vw && st.vw[offer] && st.vw[offer].id === id ? st.vw[offer] : null;
    const v = c ? c.variant || null : st.t && st.t.id === id ? st.t.v || null : null;
    const u = (st.t && st.t.id === id && (st.t.v || null) === v ? Number(st.t.u) || 0 : 0) + 1;
    await saveState(kid, {
      ...st,
      ...(st.s && st.s.id === id ? { s: { id, n: 0 } } : {}),
      t: { id, v, u, ...(c ? { c } : st.t && st.t.id === id && st.t.c ? { c: st.t.c } : {}) },
      ...spend(st, now),
    });
    return true;
  } catch (_) {
    return false;
  }
}

/** A door tapped from the home (the page's door_tap, by the child's kid): the once-a-day tile that home showed is spent. */
async function noteDoor(kid, now = Date.now()) {
  try {
    if (!kid) return false;
    const st = await loadState(kid);
    const sp = spend(st, now);
    if (!('rd' in sp)) return false;
    await saveState(kid, { ...st, ...sp });
    return true;
  } catch (_) {
    return false;
  }
}

// The finish card's kind (wq-finish-card.js) for each tile kind: the card that says the tile's activity was finished.
const DONE_BY = Object.freeze({ story: ['read', 'listen', 'story'], storybook: ['book', 'story'], game: ['game'], video: ['video'], quiz: ['quiz'] });

/** A finish card shown to the child (the page's card_shown, by kid): the carried-on tile of that kind is done. */
async function noteDone(kid, card) {
  try {
    if (!kid || typeof card !== 'string') return false;
    const st = await loadState(kid);
    const kind = st.t && (st.t.k || (st.t.c && st.t.c.kind));
    if (!kind || !(DONE_BY[kind] || []).includes(card)) return false;
    const { t, ...rest } = st;
    await saveState(kid, rest);
    return true;
  } catch (_) {
    return false;
  }
}

module.exports = { KEYS, TTL_MS, STATE_TTL_S, raw, eventsV3Now, loadState, saveState, noteTap, noteDoor, noteDone, copyOf, isTrue, _resetCache: () => { cache = null; } };
