'use strict';
/**
 * The web quiz's quiz_funnel.child_completed, with the quiz STREAM on it (bd-4dkwaf).
 *
 * It used to go without `source`, so the funnel watcher (streamOf(undefined) = null)
 * dropped every web finish: prod 21–23 Nov logged 971 finishes with no source and the
 * #niete-lp-quiz-alerts summary read "joined N → 0 finished". The join events already
 * carried it (web-quiz.service quizSourceOf); the finish now reads it the same way.
 *
 * Never throws and is not awaited by /finish: a missing label never slows or stops a
 * child's scorecard.
 */
const Funnel = require('./quiz-funnel');

/**
 * @param {object} s         the quiz_sessions row being completed
 * @param {number} pct       the child's score, as the page shows it
 * @param {(quizId: string) => Promise<string|null>} sourceOf  quizzes.quiz_source by id
 */
async function emitFinished(s, pct, sourceOf) {
  let source = null;
  try { source = (await sourceOf(s.quiz_id)) || null; } catch { source = null; }
  try {
    Funnel.emit('child_completed', {
      quiz_id: s.quiz_id, session_id: s.id, share_code_id: s.share_code_id, source, channel: 'web', pct,
      ...(s.user_id ? { kind: 'self_test' } : {}),
    });
  } catch { /* a log line, never the child's finish */ }
}

module.exports = { emitFinished };
