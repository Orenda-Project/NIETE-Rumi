'use strict';
/**
 * Mounts the teacher home's router at /api/internal/th. A module that throws at load costs exactly this mount: the
 * bot starts, every other route is today's, and the failure is logged once. → true when mounted.
 */
const MOUNT_PATH = '/api/internal/th';

function mountTeacherHome(app, load = () => require('./teacher-home.routes')) {
  try {
    app.use(MOUNT_PATH, load());
    return true;
  } catch (err) {
    try {
      require('../../utils/logger').logToFile('❌ teacher home routes failed to load — not mounted', { error: err && err.message }, 'error');
    } catch (_) { /* the bot still starts */ }
    return false;
  }
}

module.exports = { mountTeacherHome, MOUNT_PATH };
