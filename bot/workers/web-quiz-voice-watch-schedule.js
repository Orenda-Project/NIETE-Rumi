'use strict';
/**
 * Ticks the daily web quiz voice alarm (shared/services/monitoring/web-quiz-voice-watch.service.js) on the worker.
 * Main-queue replicas only; a boot tick FIRST_MS after boot, then hourly from that tick (the pattern of
 * teacher-activity-schedule.js; Class P: this service redeploys faster than a day). Every tick asks the run whether
 * yesterday is due: off unless WEB_QUIZ_VOICE_WATCH_ENABLED=true; one worker checks a day once (claim + marker).
 */
const { logToFile } = require('../shared/utils/logger');

const FIRST_MS = 5 * 60 * 1000;
const TICK_MS = 60 * 60 * 1000;

function scheduleWebQuizVoiceWatch({
  worker: w = null, hasMainQueue = false, setIntervalFn = setInterval, setTimeoutFn = setTimeout,
  run = (...a) => require('../shared/services/monitoring/web-quiz-voice-watch.service').run(...a),
} = {}) {
  if (!hasMainQueue) {
    logToFile('Web quiz voice alarm not scheduled on this replica', { reason: 'no main queue' });
    return null;
  }
  const tick = async () => {
    if (w && w.isShuttingDown) return null;
    try {
      return await run();
    } catch (error) {
      logToFile('Error in the web quiz voice alarm (non-fatal)', { error: error && error.message }, 'error');
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
  logToFile('Web quiz voice alarm scheduled (hourly + boot, main-queue replicas; a no-op until WEB_QUIZ_VOICE_WATCH_ENABLED=true)');
  return { tick, get timer() { return timer; } };
}

module.exports = { scheduleWebQuizVoiceWatch, FIRST_MS, TICK_MS };
