'use strict';
/**
 * Ticks the twice-a-day teacher activity job (shared/services/teacher-activity/teacher-activity-run.service.js) on the
 * worker. Main-queue replicas only; a boot tick FIRST_MS after boot, then hourly from that tick (the pattern of
 * quiz-retest-schedule.js). Every tick asks the run whether a slot is due: off unless a read replica is configured and
 * app_settings teacher_activity_slots names the slots; one worker runs a slot once per Pakistan date (claim + marker).
 */
const { logToFile } = require('../shared/utils/logger');

const FIRST_MS = 4 * 60 * 1000;
const TICK_MS = 60 * 60 * 1000;

function scheduleTeacherActivity({
  worker: w = null, hasMainQueue = false, setIntervalFn = setInterval, setTimeoutFn = setTimeout,
  run = (...a) => require('../shared/services/teacher-activity/teacher-activity-run.service').run(...a),
} = {}) {
  if (!hasMainQueue) {
    logToFile('Teacher activity job not scheduled on this replica', { reason: 'no main queue' });
    return null;
  }
  const tick = async () => {
    if (w && w.isShuttingDown) return null;
    try {
      return await run();
    } catch (error) {
      logToFile('Error in the teacher activity job (non-fatal)', { error: error && error.message }, 'error');
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
  logToFile('Teacher activity job scheduled (hourly + boot, main-queue replicas; a no-op until teacher_activity_slots is set and a replica is configured)');
  return { tick, get timer() { return timer; } };
}

module.exports = { scheduleTeacherActivity, FIRST_MS, TICK_MS };
