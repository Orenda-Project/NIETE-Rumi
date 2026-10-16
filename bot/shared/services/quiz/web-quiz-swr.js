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

/** Run read() in the background unless a read of this switch is already in flight. Never throws, never rejects. */
function revalidate(name, read) {
  if (inflight.has(name)) return;
  const p = Promise.resolve().then(read).catch(() => {}).then(() => { inflight.delete(name); });
  inflight.set(name, p);
}

module.exports = { stale, revalidate, _reset: () => inflight.clear() };
