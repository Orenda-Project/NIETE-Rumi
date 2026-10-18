'use strict';
/**
 * A fresh portal process learns the page switches before its first page (app_settings web_quiz_edge_learn, read by
 * the bot, default off). This is the portal's one learner of those switches: one route, one apply().
 *
 * The web quiz router remembers a few switches it learns only from a quiz or hub payload (`fast`: send the page's head
 * before the bot answers; the brand; `rt`; the Urdu look and the one face; `wait_ux`). After a deploy each process starts
 * knowing none of them, so its first page waits for the whole bot answer. This asks the bot once in the background when
 * the router is made (GET /api/internal/wq/edge):
 *   - `{ learn: true, ... }`: apply(body), the same fields a payload carries, and ask again every 60 s while it says so
 *     (a flip of those switches then reaches a process that serves no page);
 *   - `{ learn: false }`: stop asking. Switch off is one ask per process, never a stream. A hub answer saying
 *     `edge_learn: true` (the switch was flipped on) starts the 60 s asking again (arm());
 *   - a call that fails or times out (the bot is cold or restarting): nothing is applied, and the process asks again
 *     5 s later (one re-ask waiting at a time), until it gets an answer. Only an explicit `learn: false` stops asking;
 *   - any other answer (a bot without the route): nothing is applied; the 60 s timer keeps its state.
 * A page never waits on this call. A payload always wins: an answer to a call that started before the last payload was
 * learned is dropped (taught() marks a payload). The 60 s timer starts no call while one is on its way: a hanging call is
 * not called again. Each ask carries its number (the order it started in): a reply to ask N is dropped once a reply to a
 * later ask has been used, whatever order the replies arrive in. The call's own timeout timer is unref'd (`bg`), as are
 * the 60 s and 5 s timers, so none holds a process open.
 */
const EVERY_MS = 60 * 1000;
const RETRY_MS = 5 * 1000;
const PATH = '/api/internal/wq/edge';
// callBot needs a request for its forwarded address and agent; this call is the portal's own.
const SELF = Object.freeze({ ip: '', socket: null, get: () => undefined });

const defaultTimers = {
  set: (fn, ms) => setInterval(fn, ms),
  clear: (t) => clearInterval(t),
  after: (fn, ms) => setTimeout(fn, ms),
  cancel: (t) => clearTimeout(t),
};
const unref = (t) => { if (t && typeof t.unref === 'function') t.unref(); return t; };

/**
 * @param {object} o
 * @param {Function} o.callBot  the router's bot client (web-quiz.routes createBotClient)
 * @param {Function} o.apply    sets the router's learned switches from a `learn: true` answer (the only writer)
 * @param {object} [o.timers]   { set(fn, ms), clear(h), after(fn, ms), cancel(h) } (a test's own clock)
 * @returns {{ taught: Function, arm: Function, refresh: Function, stop: Function, apply: Function }}
 */
function startEdgeLearn({ callBot, apply, timers = defaultTimers, everyMs = EVERY_MS, retryMs = RETRY_MS }) {
  const after = timers.after || defaultTimers.after;
  const cancel = timers.cancel || defaultTimers.cancel;
  let payloads = 0;     // payloads learned so far (taught())
  let inFlight = 0;     // asks on their way
  let asked = 0;        // asks started so far: each ask's number
  let used = 0;         // the number of the ask whose reply was last used (applied, or learn: false)
  let timer = null;
  let retry = null;     // the one re-ask waiting after a failed or timed-out ask
  const arm = () => {
    if (timer) return;
    timer = unref(timers.set(() => { if (!inFlight) refresh(); }, everyMs));
  };
  const stop = () => {
    if (timer) timers.clear(timer);
    timer = null;
    if (retry) cancel(retry);
    retry = null;
  };
  const reask = () => {
    if (retry) return;
    retry = unref(after(() => { retry = null; refresh(); }, retryMs));
  };
  /** A `learn: true` answer's switches into the router (also for another car with the same answer). */
  const learn = (body) => {
    if (body && typeof body === 'object' && body.learn === true) apply(body);
  };
  const refresh = async () => {
    const n = ++asked;
    inFlight += 1;
    const seen = payloads;
    let out;
    try {
      out = await callBot('GET', PATH, SELF, null, { route: PATH, bg: true });
    } catch (_) {
      out = null; // failed or timed out: never decides a page
    } finally {
      inFlight -= 1;
    }
    if (!out || out.status >= 500) { reask(); return; }
    if (!(out.status === 200 && out.body)) return;
    if (n < used) return; // a later ask's reply was already used: this older one never overwrites it
    if (out.body.learn === false) { used = n; stop(); return; }
    if (out.body.learn === true && seen === payloads) { used = n; learn(out.body); }
  };
  arm();
  refresh();
  return { taught: () => { payloads += 1; }, arm, refresh, stop, apply: learn };
}

module.exports = { startEdgeLearn, EVERY_MS, RETRY_MS, PATH };
