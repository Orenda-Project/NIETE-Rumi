'use strict';
/**
 * What "on" means for an R8 nudge switch — one reading, shared.
 *
 * The sweeper, the coaching ask and the afternoon offer each used to parse their
 * own flag, and they disagreed: the ask took only the literal `'true'`, so on
 * sandbox (every flag set to `1`) the sweeper ran, the offer went out, and the
 * ask never scheduled a row or logged a line (bd-mg9c7.159.10). Read at call
 * time and never cached, so a flag flipped on Railway takes effect on the next
 * tick.
 *
 * @param {string} name  the environment variable
 * @returns {boolean}    true for `1`, `true` or `yes` (any case, trimmed)
 */
function flagOn(name) {
  const raw = String(process.env[name] || '').trim().toLowerCase();
  return raw === 'true' || raw === '1' || raw === 'yes';
}

module.exports = { flagOn };
