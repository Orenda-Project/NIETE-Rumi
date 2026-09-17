/**
 * How a text message is routed while a reflective debrief is open.
 *
 * This used to be decided inline in `text-message.handler`, and the decision
 * included an elapsed-time branch: if `coaching_sessions.updated_at` was more
 * than an hour old, the message was NOT her answer — it was discarded and she
 * was sent "I noticed your previous coaching session didn't complete
 * properly … Reply with 1 or 2".
 *
 * That branch was measuring the wrong thing. A BEFORE-UPDATE trigger bumps
 * `updated_at` on every write to the row, and the last write before her answer
 * is the one that ASKED her the question — so the condition read
 * "this teacher took more than an hour to reflect", which is the behaviour the
 * debrief exists to produce. It was also a dead end: it wrote no state, so the
 * next message hit it again, forever; and the "1 or 2" it offered was read by a
 * handler gated on a Redis key this branch never set, placed after this
 * branch's own `return`.
 *
 * So the routing has NO clock, deliberately, and the planner takes none. A
 * reflective answer is her answer whenever it arrives. Sessions that are
 * genuinely abandoned are owned elsewhere and always were — the 2h reminder and
 * the 12h auto-complete in `workers/stale-session.worker.js`, plus
 * `coaching-stale-recovery.js` and `photo-gate-sweep.js` for the states that
 * come before this one.
 *
 * Pure + dependency-free so it is unit-testable; the handler supplies the glue.
 */

/** The three things the handler can do with the message. */
const ACTIONS = {
  /** No open debrief — leave the message to the rest of the handler. */
  NOT_REFLECTIVE: 'not_reflective',
  /** A slash command ends the debrief, then runs normally. */
  END_SESSION_AND_FALL_THROUGH: 'end_session_and_fall_through',
  /** Her answer — hand it to the coach. */
  RECORD_ANSWER: 'record_answer',
};

/**
 * Decide what a text message means while a debrief may be open.
 *
 * Takes (session, message) and NOTHING else. The missing third argument is the
 * point: there is no clock here, so elapsed time cannot start deciding whether
 * a teacher's answer counts. The reflective-answer routing test pins the
 * arity.
 *
 * @param {{status?: string}|null} session  her latest coaching_sessions row
 * @param {string} trimmedMessage           the message body, already trimmed
 * @returns {{action: string, reason: string}}
 */
function planReflectiveTextRouting(session, trimmedMessage) {
  if (!session || session.status !== 'conducting_conversation') {
    return { action: ACTIONS.NOT_REFLECTIVE, reason: 'no_open_debrief' };
  }

  // `conducting_conversation` was the only waiting state with no way out, and
  // /menu — the escape the bot itself teaches — was being swallowed by the
  // coach. Exempting the command is not enough: the session has to END, or
  // she escapes once and the next free-text message is recaptured. Answers
  // already given live in conversation_state.questions and are written as each
  // one arrives, so ending the session discards nothing she said.
  if (String(trimmedMessage || '').startsWith('/')) {
    return { action: ACTIONS.END_SESSION_AND_FALL_THROUGH, reason: 'slash_command_escape' };
  }

  return { action: ACTIONS.RECORD_ANSWER, reason: 'reflective_answer' };
}

module.exports = { ACTIONS, planReflectiveTextRouting };
