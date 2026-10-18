'use strict';
/**
 * The child home's step timings (app_settings web_quiz_server_timing, default off, fail off).
 *
 * On: the bot's internal hub answer carries a Server-Timing header, one `name;dur=<ms>` per awaited step of the build
 * (fixed short names from web-quiz-server-timing-names.js), and the edge logs it and passes it on. Timings only: no id, name, token or value of
 * the child's ever goes in.
 * Off: no stopwatch, no header; every answer is today's, byte for byte.
 * Only the stored JSON boolean true turns it on: the string 'true', '"true"', 1, no row or a failed read are all off.
 *
 * The switch is one more key in the hub's own batched settings read (web-quiz-hub-flags.js), so it adds no settings
 * read at all; on() only looks at that read's cache and never waits.
 *
 * Another Server-Timing on the same answer (another switch's `app;dur=…, db;dur=…, dbq;desc=…`) is kept: these items are added
 * after it, in one header, whichever is set first (attach()).
 */
const Flags = require('./web-quiz-hub-flags');
const Timing = require('./web-quiz-timing');
const { NAMES, COUNT, appendTiming } = require('./web-quiz-server-timing-names');

const KEY = Flags.SERVER_TIMING_KEY;
const TTL_MS = 30 * 1000;
// Every name this stopwatch writes is in the one shared list the portal passes on (web-quiz-server-timing-names.js).

/**
 * The switch, never waited for. Off until the hub's batched settings read lands, off on a failed read, off when that
 * cache is older than twice its life. `refresh: true` (a route that does not read the hub's switches itself) starts that
 * same batched read in the background when the cache is stale: at most one read per 30 s, never waited for.
 * Never throws.
 */
function on(now = Date.now(), { refresh = false } = {}) {
  try {
    if (refresh && !Flags.serverTimingNow(now - TTL_MS)) Flags.flags().catch(() => {});
    return Flags.serverTimingNow(now);
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

/**
 * Write the stopwatch's items when the answer's headers go out, after any Server-Timing already set on it (by this
 * route or later by the shared answer code), in one header. Nothing is written if the headers have gone.
 */
function attach(res, st) {
  const writeHead = res.writeHead;
  res.writeHead = function writeHeadWithSteps(...args) {
    res.writeHead = writeHead;
    appendTiming(res, st.header());
    return writeHead.apply(this, args);
  };
}

/**
 * The running web-quiz request's own numbers (web-quiz-timing.js): `app;dur=<ms since it began>` and the database
 * round-trip count `dbq;desc="<n>"`, plus `db;dur=<ms>` when the caller measured it. [] outside a web-quiz request.
 */
function requestEntries({ dbMs } = {}) {
  const ms = Timing.elapsed();
  if (ms == null) return [];
  const out = [`app;dur=${ms}`];
  if (Number.isFinite(dbMs) && dbMs >= 0) out.push(`db;dur=${Math.round(dbMs)}`);
  out.push(`${COUNT};desc="${Timing.peek() || 0}"`);
  return out;
}

/**
 * One line for any bot route: with web_quiz_server_timing on, append the request's numbers (and `extra` listed items,
 * e.g. `th_home;dur=<ms>`) to the answer's Server-Timing; off, nothing at all. `refresh` as in on().
 */
function timeRequest(res, extra = [], { refresh = false, dbMs } = {}) {
  if (!on(Date.now(), { refresh })) return;
  appendTiming(res, [...requestEntries({ dbMs }), ...[].concat(extra)]);
}

module.exports = { on, steps, attach, requestEntries, timeRequest, appendTiming, KEY, NAMES };
