'use strict';
/**
 * The kid hub's switches as ONE read (only with app_settings web_quiz_fast on).
 *
 * The hub asks about a dozen modules for their app_settings switches, each with its own cache (30 s; the db deadline
 * 60 s, the brand 5 min) and its own read. With the fast page on, the hub calls ensure() first: ONE
 * `app_settings.select('key, value').in('key', [every hub key])` read, and each module is handed the RAW rows and fills
 * its own cache from them with its OWN parser (its isTrue, its parents, its fail-closed defaults), so a switch reads the
 * same through this read as through its own. Each module says how in its `hubSwitches`:
 *   { name, keys, swr: [its Swr names], age(now) -> 'cold'|'stale'|'fresh', prime(rows, now), read(), peek() }
 * (read and peek are for the tests: the module's own read, and its cache).
 *
 *   ensure()   any module cold or stale -> the one read, started first (not waited for by the hub), every module
 *                       primed from it. While it is in flight (Swr.cover): a module with no value yet (cold), or one
 *                       that waits on a stale value, waits for THIS read instead of making its own; a module that
 *                       answers a stale value at once (web-quiz-swr.js) skips its own background read.
 *              all fresh -> nothing
 *   (Not waited for in ensure itself: a cold module the request never asks for, e.g. the way back with its parent off,
 *   or every module but the few the locked hub reads, must not add a round trip to the request.)
 *   A failed read primes nothing: every module stays as it was and reads its own switch, by its own rules.
 *   Never throws.
 *
 * One timer per process (start/stop), started by the bot at boot: every 25 s, once a fast hub request has armed it, the
 * same one read (plus the fast switch's own row, so it keeps itself going through a quiet spell) primes every module:
 * a hub request finds every switch fresh, and a flipped switch, the fast one included, lands within 25 s. A switch is
 * never answered from a value older than twice its cache time (web-quiz-swr.js), so a flip lands within 60 s even with
 * the timer's reads failing. It never blocks a request and never keeps the process alive (unref); until a fast hub
 * request arms it, and from a tick that reads the fast switch off, it reads nothing (web_quiz_fast off = today).

 * web_quiz_fast off: nothing here runs; every module reads its own switch, exactly as before.
 * The fast switch itself is read here only by the timer (it decides whether this runs).
 */
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');
const Swr = require('./web-quiz-swr');

const EVERY_MS = 25 * 1000;

// The modules whose switches the hub reads, in priming order: a module whose parse reads another module's cache comes
// after it (identity flags read the hub flags' `hub`; student join reads the identity flags' `phoneBind`).
// Required on first use, so no module here depends on this one to load (no require cycle).
const MODULES = [
  () => require('./web-quiz-hub-flags'),
  () => require('./web-quiz-identity-flags'),
  () => require('./web-quiz-student-join'),
  () => require('./web-quiz-bind-way-back'),
  () => require('./web-quiz-book'),
  () => require('./web-quiz-home-flags'),
  () => require('./web-quiz-hub-play'),
  () => require('./web-quiz-challenge'),
  () => require('./web-quiz-telemetry'),
  () => require('./web-quiz-ur-polish'),
  () => require('./web-quiz-db-deadline'),
  () => require('../../config/web-quiz-brand'),
  () => require('./web-quiz-stories'),
  () => require('./web-quiz-next-offer-state'),
  () => require('./web-quiz-card-image'),
  () => require('./web-quiz-return-lang'),
];

let list = null;
let keys = null;
let reading = null;
let timer = null;
// The timer reads only once a fast hub request has armed it (ensure()), and disarms itself when it reads the fast switch off.
let armed = false;

/** Each module's hubSwitches, in priming order. */
function entries() {
  if (!list) {
    list = MODULES.map((m) => { try { return m().hubSwitches || null; } catch (_) { return null; } }).filter(Boolean);
  }
  return list;
}

/** Every key the one read asks for. */
function ALL_KEYS() {
  if (!keys) keys = [...new Set(entries().flatMap((e) => e.keys))];
  return keys;
}

const fastOn = () => { try { return require('./web-quiz-fast').on() === true; } catch (_) { return false; } };
// The timer's check: never a read (the fast switch's cached value, which the timer's own read keeps fresh).
const fastCached = () => { try { return require('./web-quiz-fast').cachedOn() === true; } catch (_) { return false; } };

/**
 * The one read, then every module primed from its rows. Resolves true when primed, false when the read failed.
 * withFast (the timer): the fast switch's own row rides along and refreshes its cache too, so the timer keeps running
 * through a quiet spell and a flip of any switch, the fast one included, lands within one tick.
 */
function load(now, { withFast = false } = {}) {
  if (!reading) {
    const names = entries().flatMap((e) => e.swr);
    reading = (async () => {
      try {
        const Fast = require('./web-quiz-fast');
        const { data, error } = await supabase.from('app_settings').select('key, value').in('key', withFast ? [...ALL_KEYS(), Fast.KEY] : ALL_KEYS());
        if (error) throw new Error(error.message || 'app_settings read failed');
        const rows = Array.isArray(data) ? data : [];
        if (withFast) Fast.prime(rows, now);
        // From here a module's read is its own (a parent read while priming must not wait on this read).
        Swr.uncover(names);
        for (const e of entries()) {
          try { await e.prime(rows, now); } catch (err) { logToFile('⚠️ web quiz hub switches: a module was not primed', { name: e.name, error: err.message }); }
        }
        return true;
      } catch (err) {
        logToFile('⚠️ web quiz hub switches: the one read failed — each switch reads its own', { error: err.message });
        return false;
      } finally {
        reading = null;
      }
    })();
    Swr.cover(names, reading);
  }
  return reading;
}

const ageOf = (e, now) => { try { return e.age(now); } catch (_) { return 'cold'; } };

/**
 * Before the hub reads its switches (web_quiz_fast on): see the top of this file. Never waited for by the hub: it
 * starts the one read (when any module is cold or stale) and returns at once; each module then waits for it only where
 * it would have waited for its own read. Returns that read (resolves true when every module is primed, false when it
 * failed), or null when there is nothing to read. Never throws.
 */
function ensure(now = Date.now()) {
  try {
    if (!fastOn()) return null;
    armed = true;
    const ages = entries().map((e) => ageOf(e, now));
    return ages.includes('cold') || ages.includes('stale') ? load(now) : null;
  } catch (_) {
    return null;
  }
}

/**
 * One tick of the timer: the one read (with the fast switch's own row) once a fast hub request has armed it; nothing
 * (no read) until then, and from a tick that read the fast switch off until a fast hub request arms it again. A failed
 * read keeps it armed: the next tick tries again.
 */
async function tick() {
  try {
    if (!armed) return false;
    if (!fastCached()) { armed = false; return false; }
    const ok = await load(Date.now(), { withFast: true });
    if (!fastCached()) armed = false;
    return ok;
  } catch (_) {
    return false;
  }
}

/** The process's one timer (a second start is a no-op), started by the bot at boot (whatsapp-bot.js). Never keeps the process alive. */
function start({ everyMs = EVERY_MS } = {}) {
  if (timer) return;
  timer = setInterval(() => { tick(); }, everyMs);
  if (typeof timer.unref === 'function') timer.unref();
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = {
  ensure, start, stop, tick, entries, ALL_KEYS, EVERY_MS,
  running: () => Boolean(timer),
  armed: () => armed,
  _handle: () => timer,
  _reset: () => { stop(); armed = false; list = null; keys = null; reading = null; },
};
