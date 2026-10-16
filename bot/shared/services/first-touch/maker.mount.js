'use strict';
/**
 * Mounts the quiz-maker router at /api/internal/ft. A maker module that throws at load costs exactly this mount:
 * the bot starts, every other route is today's, and the failure is logged once. → true when mounted.
 */
const MOUNT_PATH = '/api/internal/ft';

function mountMaker(app, load = () => require('./maker.routes')) {
  try {
    app.use(MOUNT_PATH, load());
    return true;
  } catch (err) {
    try {
      require('../../utils/logger').logToFile('❌ quiz maker routes failed to load — not mounted', { error: err && err.message }, 'error');
    } catch (_) { /* the bot still starts */ }
    return false;
  }
}

module.exports = { mountMaker, MOUNT_PATH };
