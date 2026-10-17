'use strict';
/**
 * The hub's switches kept warm (app_settings web_quiz_hub_fanout, default off; web-quiz-hub-flags.js).
 *
 * Each switch module on the hub's path keeps its own 30 s cache and, once that has expired, makes the next request
 * wait for a fresh read. A child who comes back after more than 30 s therefore waits for about a dozen settings reads,
 * one after another, before the hub's own reads start. While the switch is on and a hub answer was asked for in the
 * last IDLE_MS, a tick every TICK_MS asks each of those modules for its switches: a fresh cache answers at once (no
 * read), an expired one is read again in the background, so the next child finds it fresh.
 *
 * It never adds a read to a request: the tick runs on its own timer, unref'd (it never keeps the process alive). It
 * stops by itself once the hub has been idle for IDLE_MS, or once the switch reads off. Off, nothing here ever runs.
 */
const Flags = require('./web-quiz-hub-flags');

const TICK_MS = 1000;
const IDLE_MS = 10 * 60 * 1000;
let timer = null;
let lastHub = 0;
let busy = false;
let extra = [];

// The cached switch readers on the hub's path (each answers from its own cache while fresh). A reader that is not
// there (a module renamed) is skipped.
function readers() {
  const Challenge = () => require('./web-quiz-challenge');
  return [
    () => require('./web-quiz-ur-polish').ui(),
    () => require('./web-quiz-identity-flags').flags(),
    () => require('./web-quiz-student-join').flags(),
    () => require('./web-quiz-bind-way-back').on(),
    () => require('./web-quiz-return-lang').on(),
    () => require('./web-quiz-next-offer-state').raw(),
    () => require('./web-quiz-hub-play').switches(),
    () => Challenge().recordOn(),
    () => Challenge().missingOn(),
    () => Challenge().poolOn(),
    () => Challenge().listenOn(),
    () => require('./web-quiz-book').flags(),
    () => require('./web-quiz-telemetry').flag(),
    ...extra,
  ];
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

/** One pass: the hub's own switches first (off or idle stops the keeper), then every other reader side by side. */
async function tick(now = Date.now()) {
  if (busy) return;
  busy = true;
  try {
    if (now - lastHub > IDLE_MS) { stop(); return; }
    const f = await Flags.flags().catch(() => null);
    if (!f || !f.fanout) { stop(); return; }
    await Promise.all(readers().map((read) => {
      try { return Promise.resolve(read()).catch(() => null); } catch (_) { return null; }
    }));
  } finally {
    busy = false;
  }
}

/** A hub answer was asked for with the switch on: keep the switches warm from now (the hub's other readers in `more`). */
function touch(more = []) {
  lastHub = Date.now();
  if (more.length) extra = more;
  if (timer) return;
  timer = setInterval(() => { tick().catch(() => {}); }, TICK_MS);
  if (typeof timer.unref === 'function') timer.unref();
}

module.exports = { touch, tick, TICK_MS, IDLE_MS, _stop: () => { stop(); lastHub = 0; extra = []; busy = false; }, _running: () => Boolean(timer) };
