'use strict';
/**
 * The cache every app_settings switch reader can share, so a settings outage costs ONE read per the reader's own TTL,
 * not one per request:
 *
 *   const sw = cachedSwitch({ ttlMs, read, off, log });
 *   sw.get(now)      → the value. A good read is kept for ttlMs (an expired one AWAITS a fresh read, as today).
 *                      A failed read (read() throws or rejects) is kept for ttlMs too, answered as the last good
 *                      value this process read, else `off`. Callers that arrive while a read is out share it.
 *   sw.get(now, { retryFailed: true })  the same, but a cached failed read is read once more (a caller that must not
 *                    let one blip decide, and is not on a hot path)
 *   sw.fresh(now)    → true while a good read is younger than ttlMs (a reader's prime() asks this)
 *   sw.peek(now)     → that good read's value while fresh, else undefined; never reads (a never-waiting reader)
 *   sw.set(v, now)   another module's good read of the same rows (prime): kept as a good read
 *   sw.reset()       forget everything (tests)
 *
 * `read(now)` does the module's own query and returns its value; it throws on `{ error }`. `off` is the value (or a
 * function returning a fresh one) for a failed read with nothing read before. `log(err)` is called once per failed
 * read, so at most once per ttlMs per process. Never throws.
 */

function cachedSwitch({ ttlMs, read, off, log } = {}) {
  let good = null;      // { at, value } — the last read that succeeded
  let failedAt = null;  // when the last read failed (null once a read succeeds)
  let inflight = null;
  let gen = 0;          // reset() starts a new generation: a read begun before it writes nothing after it

  const offValue = () => (typeof off === 'function' ? off() : off);
  const fallback = () => (good ? good.value : offValue());
  const fresh = (now = Date.now()) => Boolean(good) && now - good.at < ttlMs;

  async function readOnce(now) {
    const mine = gen;
    try {
      const value = await read(now);
      if (mine === gen) { good = { at: now, value }; failedAt = null; }
      return value;
    } catch (err) {
      if (mine === gen) failedAt = now;
      try { if (log) log(err || new Error('settings read failed')); } catch (_) { /* never throws */ }
      return fallback();
    }
  }

  async function get(now = Date.now(), { retryFailed = false } = {}) {
    if (fresh(now)) return good.value;
    if (!retryFailed && failedAt !== null && now - failedAt < ttlMs) return fallback();
    if (!inflight) {
      const p = readOnce(now).finally(() => { if (inflight === p) inflight = null; });
      inflight = p;
    }
    return inflight;
  }

  function set(value, now = Date.now()) {
    good = { at: now, value };
    failedAt = null;
  }

  const peek = (now = Date.now()) => (fresh(now) ? good.value : undefined);

  function reset() { gen += 1; good = null; failedAt = null; inflight = null; }

  return { get, fresh, peek, set, reset };
}

module.exports = { cachedSwitch };
