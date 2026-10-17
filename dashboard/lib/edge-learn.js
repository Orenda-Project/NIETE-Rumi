'use strict';
/**
 * A fresh portal process learns the page switches before its first page (app_settings web_quiz_edge_learn, read by
 * the bot, default off).
 *
 * The web quiz router remembers a few switches it learns only from a quiz or hub payload (`fast`: send the page's head
 * before the bot answers; the brand; `rt`; the Urdu look). After a deploy each process starts knowing none of them, so
 * its first page waits for the whole bot answer. This asks the bot once in the background when the router is made
 * (GET /api/internal/wq/edge) and again every 60 s while the process lives:
 *   - `{ learn: true, ... }`: apply(body), the same fields a payload carries;
 *   - anything else (`{ learn: false }`, an error, a bot without the route, a call that never comes back): nothing.
 * A page never waits on this call. A payload always wins: an answer to a call that started before the last payload was
 * learned is dropped (taught() marks a payload). One call at a time: a hanging call is not called again.
 */
const EVERY_MS = 60 * 1000;
const PATH = '/api/internal/wq/edge';
// callBot needs a request for its forwarded address and agent; this call is the portal's own.
const SELF = Object.freeze({ ip: '', socket: null, get: () => undefined });

const defaultTimers = { set: (fn, ms) => setInterval(fn, ms), clear: (t) => clearInterval(t) };

/**
 * @param {object} o
 * @param {Function} o.callBot  the router's bot client (web-quiz.routes createBotClient)
 * @param {Function} o.apply    sets the router's learned switches from a `learn: true` answer
 * @param {object} [o.timers]   { set(fn, ms) → handle, clear(handle) } (a test's own clock)
 * @returns {{ taught: Function, refresh: Function, stop: Function }}
 */
function startEdgeLearn({ callBot, apply, timers = defaultTimers, everyMs = EVERY_MS }) {
  let payloads = 0;     // payloads learned so far (taught())
  let inFlight = false;
  const refresh = async () => {
    if (inFlight) return;
    inFlight = true;
    const seen = payloads;
    try {
      const out = await callBot('GET', PATH, SELF, null, { route: PATH });
      if (seen === payloads && out && out.status === 200 && out.body && out.body.learn === true) apply(out.body);
    } catch (_) {
      /* never decides a page */
    } finally {
      inFlight = false;
    }
  };
  refresh();
  const timer = timers.set(() => { refresh(); }, everyMs);
  if (timer && typeof timer.unref === 'function') timer.unref();
  return { taught: () => { payloads += 1; }, refresh, stop: () => timers.clear(timer) };
}

module.exports = { startEdgeLearn, EVERY_MS, PATH };
