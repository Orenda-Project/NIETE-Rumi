'use strict';
/**
 * Stale-while-revalidate for the web quiz's 30 s switch caches, only with app_settings web_quiz_fast on.
 *
 * A switch read with a cached value older than its TTL is answered from the cache at once and read again in the
 * background (one read in flight per switch); a failed background read keeps the cached value (the switch logs it
 * once, as its own read does). With no cached value yet (a cold start) the caller waits for the read, as today.
 * With web_quiz_fast off nothing here is used: every switch waits on a stale cache, exactly as before.
 */
const inflight = new Map();

/** True when `cache` holds a value older than ttlMs and web_quiz_fast is on: serve it, revalidate in the background. */
function stale(cache, ttlMs, now = Date.now()) {
  if (!cache || now - cache.at < ttlMs) return false;
  try {
    return require('./web-quiz-fast').on() === true;
  } catch (_) {
    return false;
  }
}

// The hub's one switch read in flight (web-quiz-hub-switches.js), by switch name: its own map, so a switch's own
// background read never waits on itself.
const seam = new Map();

/** Run read() in the background unless a read of this switch is already in flight (its own, or the hub's one switch read). */
function revalidate(name, read) {
  if (inflight.has(name) || seam.has(name)) return;
  const p = Promise.resolve().then(read).catch(() => {}).then(() => { inflight.delete(name); });
  inflight.set(name, p);
}

/**
 * The hub's one switch read is in flight for these switches (web_quiz_fast on; the seam runs only then): each one's own
 * revalidate(name) reads nothing, and a switch with no fresh value waits for covered(name) before its own read.
 * Never throws, never rejects.
 */
function cover(names, promise) {
  const p = Promise.resolve(promise).catch(() => {});
  names.forEach((name) => {
    const q = p.then(() => { if (seam.get(name) === q) seam.delete(name); });
    seam.set(name, q);
  });
}

/** The seam's rows are in: a read of these switches from here on is its own (the priming itself may read a parent). */
function uncover(names) {
  names.forEach((name) => seam.delete(name));
}

/** The hub's one switch read in flight for this switch, else null. Resolves (never rejects) once its rows are primed. */
function covered(name) {
  return seam.get(name) || null;
}

/** 'cold' (no cached value), 'stale' (older than ttlMs) or 'fresh'. */
function ageOf(cache, ttlMs, now = Date.now()) {
  if (!cache) return 'cold';
  return now - cache.at < ttlMs ? 'fresh' : 'stale';
}

module.exports = { stale, revalidate, cover, uncover, covered, ageOf, _reset: () => { inflight.clear(); seam.clear(); } };
