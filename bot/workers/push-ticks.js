'use strict';
/**
 * The reminder push's two worker ticks (shared/services/push/web-quiz-push.service.js):
 *   due    every 60 s (first ~2 min after boot), only while WEB_QUIZ_PUSH_SEND_ENABLED is on (read per tick, so a
 *          Railway flip takes effect on the next tick); the service also sends nothing while web_quiz_push_remind is off
 *   expiry every 6 h, ungated: retention holds whatever the switches say
 * Never throws: a failed tick logs one line and the next tick runs.
 */
const { flagOn } = require('../shared/services/nudges/flags');

const DUE_MS = 60 * 1000;
const EXPIRE_MS = 6 * 60 * 60 * 1000;
const FIRST_MS = 2 * 60 * 1000;

function schedulePushTicks({
  setIntervalFn = setInterval,
  setTimeoutFn = setTimeout,
  dueTick = (now) => require('../shared/services/push/web-quiz-push.service').dueTick(now),
  expireTick = (now) => require('../shared/services/push/web-quiz-push.service').expireTick(now),
} = {}) {
  const safe = (label, fn) => async () => {
    try { await fn(Date.now()); } catch (err) {
      try { require('../shared/utils/logger').logToFile(`⚠️ push ${label} tick failed`, { error: err && err.message }); } catch (_) { /* next tick runs */ }
    }
  };
  const due = safe('due', (now) => (flagOn('WEB_QUIZ_PUSH_SEND_ENABLED') ? dueTick(now) : null));
  const expire = safe('expiry', expireTick);
  const unref = (t) => { if (t && typeof t.unref === 'function') t.unref(); return t; };
  unref(setTimeoutFn(async () => {
    await expire();
    await due();
    unref(setIntervalFn(due, DUE_MS));
    unref(setIntervalFn(expire, EXPIRE_MS));
  }, FIRST_MS));
}

module.exports = { schedulePushTicks, DUE_MS, EXPIRE_MS };
