'use strict';
/**
 * Mounts the teacher app's home-card router at /api/internal/thportal (its own path: the home's router at
 * /api/internal/th answers every path beneath it while its switch is off). A module that throws at load costs exactly
 * this mount: the bot starts, every other route is today's, and the failure is logged once. → true when mounted.
 */
const MOUNT_PATH = '/api/internal/thportal';

function mountTeacherHomePortal(app, load = () => require('./teacher-home.portal.routes')) {
  try {
    app.use(MOUNT_PATH, load());
    return true;
  } catch (err) {
    try {
      require('../../utils/logger').logToFile('❌ teacher home portal routes failed to load — not mounted', { error: err && err.message }, 'error');
    } catch (_) { /* the bot still starts */ }
    return false;
  }
}

module.exports = { mountTeacherHomePortal, MOUNT_PATH };
