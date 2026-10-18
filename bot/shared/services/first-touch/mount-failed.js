'use strict';
/**
 * The bot's first-touch mount loop (bot/whatsapp-bot.js) calls this when a line of mounts.js did not mount. A line whose
 * own module file is absent stays silent, as before (a feature not in this build). Anything else (the module throws
 * while loading, a file it needs is missing, it has no such mount function) is logged once at error level with the
 * line's module, so a mount that did not happen shows in the deploy log. Never throws.
 */
function ownFileMissing(file, err) {
  if (!err || err.code !== 'MODULE_NOT_FOUND') return false;
  const asked = (/Cannot find module '([^']+)'/.exec(String(err.message || '')) || [])[1] || '';
  return asked.replace(/\\/g, '/').replace(/\.js$/, '').endsWith(`/${file}`); // the line's own file, not one it requires
}

module.exports = function mountFailed(file, err) {
  try {
    if (ownFileMissing(file, err)) return;
    require('../../utils/logger').logToFile('❌ first-touch mount failed — not mounted', { module: file, error: String((err && err.message) || err).split('\n')[0] }, 'error');
  } catch (_) { /* the bot still starts */ }
};
