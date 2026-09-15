'use strict';
/**
 * One owner for "this observation is over."
 *
 * A cancelled observation was revived by any button that had already been sent
 * before the cancel: the photo gate's No / Done, the lesson-plan Yes / No, the
 * LP list, Continue, the retry tap, the debrief entry — and by the analysis job
 * and two sweeps. Each of those paths resolves its own session from the id
 * inside the button and wrote without ever reading `status`, so a coach who
 * cancelled an observation and then tapped a message from ten seconds earlier
 * was asked for a lesson plan for a session that no longer existed to her.
 *
 * The statuses themselves were already correct in three places and duplicated
 * in each (the Flow endpoint, the draft write, the cancel ack). They live here
 * now, with the PostgREST filter spelled once so a write predicate and an
 * in-process check can never drift apart.
 */

/** Statuses past which an observation must not be advanced or re-entered. */
const TERMINAL_STATUSES = ['cancelled', 'abandoned'];

/** The same set as a PostgREST `.not('status', 'in', …)` argument. */
const TERMINAL_IN_FILTER = `(${TERMINAL_STATUSES.join(',')})`;

/**
 * @param {string|null|undefined} status a coaching_sessions.status
 * @returns {boolean} true when the session is over and nothing may advance it
 */
function isTerminalStatus(status) {
  return TERMINAL_STATUSES.includes(String(status || ''));
}

module.exports = { TERMINAL_STATUSES, TERMINAL_IN_FILTER, isTerminalStatus };
