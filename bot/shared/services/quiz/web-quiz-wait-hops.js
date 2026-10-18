'use strict';
/**
 * The designed wait across a page hop (app_settings web_quiz_wait_hops, default off, fail off).
 *
 * On, with the designed wait on (web_quiz_wait_ux), the hub answers carry `wait_hops: true` (web-quiz-wait-ux.js
 * carry), and so does the portal's learn answer (web-quiz-edge-learn.js): the page's bar also shows while the page is
 * being left, a tap on «My class», «My school», a game or a quiz, until the next page's first bytes
 * (dashboard/routes/web-quiz-wait-ux.js). Off: the key is absent from the hub answers and every answer is today's.
 * Only the stored JSON boolean true turns it on.
 *
 * The switch is one more key in the hub's own batched settings read (web-quiz-hub-flags.js), so it adds no settings
 * read at all; on() only looks at that read's cache and never waits (as the designed wait's own switch).
 */
const Flags = require('./web-quiz-hub-flags');

const KEY = Flags.HOPS_KEY;
const FIELD = 'wait_hops';

/** The switch, never waited for: the hub's cached value, off when there is none or it is older than twice its life. */
function on(now = Date.now()) {
  try { return Flags.hopsNow(now); } catch (_) { return false; }
}

/** The switch, waited for (tests and the learner): the hub's batched read. */
async function flag() {
  try { return (await Flags.flags()).hops === true; } catch (_) { return false; }
}

module.exports = { on, flag, KEY, FIELD, _reset: () => Flags._resetCache() };
