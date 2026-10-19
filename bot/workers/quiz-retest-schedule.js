'use strict';
/**
 * bd-v0toag.10 (b) — schedules the day-3 quiz retest sweep (shared/services/quiz/quiz-retest-sweep.js)
 * on the worker. Main-queue replicas only; a boot run FIRST_MS after boot, then hourly from that run
 * (the pattern of scheduleLessonPlanHealth in sqs-worker.js). The sweep reads its app_settings switch
 * on every tick, so the timer runs even while the switch is off and a flip needs no deploy.
 */
const { logToFile } = require('../shared/utils/logger');

const FIRST_MS = 2 * 60 * 1000;
const TICK_MS = 60 * 60 * 1000;

function scheduleQuizRetest({
  worker: w = null, hasMainQueue = false, setIntervalFn = setInterval, setTimeoutFn = setTimeout,
  sweep = (...a) => require('../shared/services/quiz/quiz-retest-sweep').sweep(...a),
} = {}) {
  if (!hasMainQueue) {
    logToFile('Quiz retest sweep not scheduled on this replica', { reason: 'no main queue' });
    return null;
  }
  const tick = async () => {
    if (w && w.isShuttingDown) return null;
    try {
      return await sweep();
    } catch (error) {
      logToFile('Error in quiz retest sweep (non-fatal)', { error: error && error.message }, 'error');
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
  logToFile('Quiz retest sweep scheduled (hourly + boot, main-queue replicas; a no-op until quiz_slo_retest_enabled is on)');
  return { tick, get timer() { return timer; } };
}

module.exports = { scheduleQuizRetest, FIRST_MS, TICK_MS };
