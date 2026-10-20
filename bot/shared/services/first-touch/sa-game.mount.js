'use strict';
/**
 * Mounts the big flight's router (sa-game/routes.js, switch sa_game) at /api/internal/sagame. A module that throws at
 * load costs exactly this mount: the bot starts, every other route is today's, and the failure is logged once.
 * → true when mounted.
 */
const MOUNT_PATH = '/api/internal/sagame';

function mountSaGame(app, load = () => require('../sa-game/routes').createRouter()) {
  try {
    app.use(MOUNT_PATH, load());
    return true;
  } catch (err) {
    try {
      require('../../utils/logger').logToFile('❌ sa game routes failed to load — not mounted', { error: err && err.message }, 'error');
    } catch (_) { /* the bot still starts */ }
    return false;
  }
}

module.exports = { mountSaGame, MOUNT_PATH };
