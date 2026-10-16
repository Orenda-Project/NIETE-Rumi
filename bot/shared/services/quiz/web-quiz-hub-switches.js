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
 * One timer per process (start/stop): every 25 s, while web_quiz_fast is on (its cache fresh: requests keep it so), the
 * same one read primes every module, so a hub request finds every switch fresh and a flipped switch lands within 25 s.
 * It never blocks a request, never keeps the process alive (unref), reads nothing and stops while web_quiz_fast is off
 * (the next fast hub request starts it again). It starts from the hub's first fast request, never at require time, and
 * never under jest unless a test calls start().
 *
 * web_quiz_fast off: nothing here runs; every module reads its own switch, exactly as before.
 * The fast switch itself is not read here (it decides whether this runs).
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
  () => require('./web-quiz-hub-home'),
  () => require('./web-quiz-hub-play'),
  () => require('./web-quiz-challenge'),
  () => require('./web-quiz-telemetry'),
  () => require('./web-quiz-ur-polish'),
  () => require('./web-quiz-db-deadline'),
  () => require('../../config/web-quiz-brand'),
  () => require('./web-quiz-stories'),
];

let list = null;
let keys = null;
let reading = null;
let timer = null;

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
// The timer's check: never a read (the fast switch's cache, fresh, on).
const fastFresh = () => { try { return require('./web-quiz-fast').fresh() === true; } catch (_) { return false; } };

/** The one read, then every module primed from its rows. Resolves true when primed, false when the read failed. */
function load(now) {
  if (!reading) {
    const names = entries().flatMap((e) => e.swr);
    reading = (async () => {
      try {
        const { data, error } = await supabase.from('app_settings').select('key, value').in('key', ALL_KEYS());
        if (error) throw new Error(error.message || 'app_settings read failed');
        const rows = Array.isArray(data) ? data : [];
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
    autoStart();
    const ages = entries().map((e) => ageOf(e, now));
    return ages.includes('cold') || ages.includes('stale') ? load(now) : null;
  } catch (_) {
    return null;
  }
}

/** One tick of the timer: the one read while web_quiz_fast is on; stops (reading nothing) while it is off. */
async function tick() {
  try {
    if (!fastFresh()) { stop(); return false; }
    return await load(Date.now());
  } catch (_) {
    return false;
  }
}

/** The process's one timer (a second start is a no-op). Never keeps the process alive. */
function start({ everyMs = EVERY_MS } = {}) {
  if (timer) return;
  timer = setInterval(() => { tick(); }, everyMs);
  if (typeof timer.unref === 'function') timer.unref();
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

// The hub's first fast request starts the timer; a test starts it itself.
function autoStart() {
  if (!timer && !process.env.JEST_WORKER_ID) start();
}

module.exports = {
  ensure, start, stop, tick, entries, ALL_KEYS, EVERY_MS,
  running: () => Boolean(timer),
  _handle: () => timer,
  _reset: () => { stop(); list = null; keys = null; reading = null; },
};
