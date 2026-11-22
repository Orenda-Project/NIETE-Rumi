'use strict';
/**
 * Schedules the class evening round writer (shared/services/quiz/web-quiz-evening-round.js tick) on the worker.
 * Main-queue replicas only; a boot run FIRST_MS after boot, then every TICK_MS. The tick itself writes only on a
 * school day between 16:00 and 19:59 PKT, at most EVENING_ROUND_MAX_PER_TICK rounds per tick (the rest wait for the
 * next tick), and reads its app_settings switch (web_quiz_evening_round) every time, so a flip needs no deploy.
 * Two replicas are safe: one round per class per day (a Redis lock and a partial unique index).
 */
const { logToFile } = require('../shared/utils/logger');

const FIRST_MS = 3 * 60 * 1000;
const TICK_MS = 5 * 60 * 1000;

function scheduleEveningRound({
  worker: w = null, hasMainQueue = false, setIntervalFn = setInterval, setTimeoutFn = setTimeout,
  tick: run = (...a) => require('../shared/services/quiz/web-quiz-evening-round').tick(...a),
} = {}) {
  if (!hasMainQueue) {
    logToFile('Evening round writer not scheduled on this replica', { reason: 'no main queue' });
    return null;
  }
  const tick = async () => {
    if (w && w.isShuttingDown) return null;
    try {
      return await run();
    } catch (error) {
      logToFile('Error in the evening round writer (non-fatal)', { error: error && error.message }, 'error');
      return null;
    }
  };
  let timer = null;
  const first = setTimeoutFn(() => {
    timer = setIntervalFn(tick, TICK_MS);
    if (timer && typeof timer.unref === 'function') timer.unref();
    return tick();
  }, FIRST_MS);
  if (first && typeof first.unref === 'function') first.unref();
  logToFile('Evening round writer scheduled (every 5 min + boot, main-queue replicas; a no-op until web_quiz_evening_round is on)');
  return { tick, get timer() { return timer; } };
}

module.exports = { scheduleEveningRound, FIRST_MS, TICK_MS };
