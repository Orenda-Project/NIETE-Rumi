'use strict';
/**
 * Ticks the A/B tracker's nightly rollup (shared/services/ab-tracker/ab-tracker-rollup.service.js) on the worker.
 * Main-queue replicas only; a boot tick FIRST_MS after boot, then hourly from that tick (the pattern of
 * teacher-activity-schedule.js). Every tick asks the run whether tonight's run is due: off unless a read replica is
 * configured and app_settings ab_tracker_rollup_enabled names a time; one worker runs it once per Pakistan date.
 */
const { logToFile } = require('../shared/utils/logger');

const FIRST_MS = 4 * 60 * 1000;
const TICK_MS = 60 * 60 * 1000;

function scheduleAbTracker({
  worker: w = null, hasMainQueue = false, setIntervalFn = setInterval, setTimeoutFn = setTimeout,
  run = (...a) => require('../shared/services/ab-tracker/ab-tracker-rollup.service').run(...a),
} = {}) {
  if (!hasMainQueue) {
    logToFile('A/B tracker rollup not scheduled on this replica', { reason: 'no main queue' });
    return null;
  }
  const tick = async () => {
    if (w && w.isShuttingDown) return null;
    try {
      return await run();
    } catch (error) {
      logToFile('Error in the A/B tracker rollup (non-fatal)', { error: error && error.message }, 'error');
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
  logToFile('A/B tracker rollup scheduled (hourly + boot, main-queue replicas; a no-op until ab_tracker_rollup_enabled is set and a replica is configured)');
  return { tick, get timer() { return timer; } };
}

module.exports = { scheduleAbTracker, FIRST_MS, TICK_MS };
