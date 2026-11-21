'use strict';
/**
 * The reminder push's two worker ticks (shared/services/push/web-quiz-push.service.js):
 *   due    every 60 s (first ~2 min after boot), only while WEB_QUIZ_PUSH_SEND_ENABLED is on (read per tick, so a
 *          Railway flip takes effect on the next tick); the service also sends nothing while web_quiz_push_remind is off
 *   expiry every 6 h, whatever the switches say (retention), but only on a tier with the push env set: a tier without
 *          it (no table either) is fully inert
 *   funnel every hour, on the same tiers as `due`; the service logs the day's counts once, after 21:00 PKT
 * Never throws: a failed tick logs one line and the next tick runs.
 */
const { flagOn } = require('../shared/services/nudges/flags');

const DUE_MS = 60 * 1000;
const EXPIRE_MS = 6 * 60 * 60 * 1000;
const FUNNEL_MS = 60 * 60 * 1000;
const FIRST_MS = 2 * 60 * 1000;

function schedulePushTicks({
  setIntervalFn = setInterval,
  setTimeoutFn = setTimeout,
  dueTick = (now) => require('../shared/services/push/web-quiz-push.service').dueTick(now),
  expireTick = (now) => require('../shared/services/push/web-quiz-push.service').expireTick(now),
  envReady = () => require('../shared/services/push/web-quiz-push.service').envReady(),
  funnelTick = (now) => require('../shared/services/push/web-quiz-push.service').funnelTick(now),
} = {}) {
  const safe = (label, fn) => async () => {
    try { await fn(Date.now()); } catch (err) {
      try { require('../shared/utils/logger').logToFile(`⚠️ push ${label} tick failed`, { error: err && err.message }); } catch (_) { /* next tick runs */ }
    }
  };
  const due = safe('due', (now) => (flagOn('WEB_QUIZ_PUSH_SEND_ENABLED') ? dueTick(now) : null));
  const expire = safe('expiry', (now) => (envReady() ? expireTick(now) : null));
  const funnel = safe('funnel', (now) => (flagOn('WEB_QUIZ_PUSH_SEND_ENABLED') ? funnelTick(now) : null));
  const unref = (t) => { if (t && typeof t.unref === 'function') t.unref(); return t; };
  unref(setTimeoutFn(async () => {
    await expire();
    await due();
    unref(setIntervalFn(due, DUE_MS));
    unref(setIntervalFn(expire, EXPIRE_MS));
    unref(setIntervalFn(funnel, FUNNEL_MS));
  }, FIRST_MS));
}

module.exports = { schedulePushTicks, DUE_MS, EXPIRE_MS, FUNNEL_MS };
