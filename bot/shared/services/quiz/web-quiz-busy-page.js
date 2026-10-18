'use strict';
/**
 * The child pages' busy page (app_settings web_quiz_busy_page, default off, fail off).
 *
 * On: the hub answers and the quiz answer carry `busy_page: true`; the portal learns it from the last one (like
 * `wait_ux`) and, when a later call to the bot fails (no answer, too slow, or a 5xx other than 503), draws the busy
 * page (503, Retry-After: 5, Jugnu slow right now, one Try again to the same page) instead of "not open".
 * Off: the key is absent, every answer is today's, byte for byte.
 * Only the stored JSON boolean true turns it on: the string 'true', 1, an object, no row or a failed read are all off.
 *
 * on() never waits and never reads: it answers from the cache the hub's own batched switch read keeps warm
 * (web-quiz-hub-flags.js; the quiz build reads it too, for its nav), so the switch adds no database read.
 */
const Flags = require('./web-quiz-hub-flags');

const KEY = Flags.BUSY_PAGE_KEY;
const FIELD = 'busy_page';

/** The switch, never waited for: the batch's cached value, off when there is none. Never throws. */
function on(now = Date.now()) {
  try { return Flags.busyPageNow(now); } catch (_) { return false; }
}

/** The answer (or its promise) with the field added while on; the same answer, untouched, while off. */
function carry(outP) {
  return Promise.resolve(outP).then((out) => {
    if (on() && out && typeof out === 'object' && !Array.isArray(out)) out[FIELD] = true;
    return out;
  });
}

module.exports = { on, carry, KEY, FIELD };
