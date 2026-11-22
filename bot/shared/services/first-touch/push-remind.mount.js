'use strict';
/**
 * Mounts the reminder push's router at /api/internal/wqpush (web_quiz_push_remind; off → 404 {off:true} and the edge
 * falls through). A module that throws at load costs exactly this mount: the bot starts, every other route is today's,
 * and the failure is logged once. → true when mounted.
 */
const MOUNT_PATH = '/api/internal/wqpush';

function mountPushRemind(app, load = () => require('../push/web-quiz-push.routes').createRouter()) {
  try {
    app.use(MOUNT_PATH, load());
    return true;
  } catch (err) {
    try {
      require('../../utils/logger').logToFile('❌ push remind routes failed to load — not mounted', { error: err && err.message }, 'error');
    } catch (_) { /* the bot still starts */ }
    return false;
  }
}

module.exports = { mountPushRemind, MOUNT_PATH };
