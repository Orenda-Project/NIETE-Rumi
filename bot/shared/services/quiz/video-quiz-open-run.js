'use strict';
/**
 * bd-l9fr2 — is the run already open on this phone the one a share_link start is asking for?
 *
 * A child who re-sends the class QUIZ code (a bounced reply, a retry, a second tap after the
 * one-minute join lock) must get that run back, not a second, empty quiz_sessions row. Only the
 * exact same run counts: same quiz, same class link, same child (or the same teacher self-test),
 * still a share_link run with questions left. Anything else starts a new run, as before.
 *
 * Pure: the caller hands over the Redis state it read.
 */
function isSameOpenRun(open, { quizId, shareCodeId = null, studentId = null, userId = null } = {}) {
  if (!open || !open.sessionId || open.source !== 'share_link') return false;
  if (!Array.isArray(open.questionIds) || !(open.index < open.questionIds.length)) return false;
  return open.quizId === quizId
    && (open.shareCodeId || null) === (shareCodeId || null)
    && (open.studentId || null) === (studentId || null)
    && (open.userId || null) === (userId || null);
}

module.exports = { isSameOpenRun };
