'use strict';
/**
 * Mounts the one door's internal router at /api/internal/go. A module that throws at load costs exactly this mount:
 * the bot starts, every other route is today's, and the failure is logged once. → true when mounted.
 */
const MOUNT_PATH = '/api/internal/go';

function mountGo(app, load = () => require('./go.routes')) {
  try {
    app.use(MOUNT_PATH, load());
    return true;
  } catch (err) {
    try {
      require('../../utils/logger').logToFile('❌ one door routes failed to load — not mounted', { error: err && err.message }, 'error');
    } catch (_) { /* the bot still starts */ }
    return false;
  }
}

module.exports = { mountGo, MOUNT_PATH };
