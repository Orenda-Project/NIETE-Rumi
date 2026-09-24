'use strict';
/**
 * Can a lesson-plan quiz that failed `source_missing` be made again NOW?
 *
 * The generate step fails an lp_v8 / lp612 quiz `source_missing` when the
 * lesson it is written from cannot be read — the K-5 slide script for that exact
 * version (lp-asset-source.store) or the 6-12 lesson document for that exact
 * render (lp612-quiz-source). Either can appear later (a backfill, a store that
 * caught up), and then the quiz can be made. So the two surfaces that act on a
 * failed quiz — the /quiz Flow's lesson screen and a tap on its row in the list
 * message — read the source again before offering "Make it again", instead of
 * assuming it is still missing (a dead end) or back (a remake that fails the same
 * way). The reads are the generate step's own (transcript-quiz-generate
 * resolveLessonSource), with the same keys.
 *
 * Fails CLOSED: any error reads as "not there" — no remake is offered on a guess.
 * One read per failed `source_missing` quiz a teacher opens or taps; nothing on
 * any list render.
 */

const { logToFile } = require('../../utils/logger');
const { LP612, isPlanQuiz, failureReasonOf } = require('./quiz-sources');

/**
 * @param {object} quiz a `quizzes` row (quiz_source, status, meta)
 * @returns {Promise<boolean>} true only when the lesson it is written from can be read now
 */
async function lpSourceAvailable(quiz) {
  if (!quiz || !isPlanQuiz(quiz.quiz_source) || quiz.status !== 'failed') return false;
  if (failureReasonOf(quiz.meta) !== 'source_missing') return false;
  const lesson = ((quiz.meta && quiz.meta.lessons) || [])[0];
  if (!lesson) return false;
  try {
    if (quiz.quiz_source === LP612) {
      if (!lesson.segment_id) return false;
      const Lp612Source = require('./lp612-quiz-source');
      return Boolean(await Lp612Source.resolveLessonDoc(lesson));
    }
    if (!lesson.lesson_id) return false;
    const Store = require('./lp-asset-source.store');
    const hit = await Store.resolveSlideScript({
      lessonId: lesson.lesson_id, versionStamp: lesson.version_stamp, contentHash: lesson.content_hash,
    });
    return Boolean(hit && hit.slideScript);
  } catch (err) {
    // A read that failed is not a source that is missing: logged loud, and no
    // remake is offered on it (the teacher sees the failure as it stands).
    logToFile('❌ lp quiz: source re-check failed — no remake offered', { quizId: quiz.id, error: err.message }, 'error');
    return false;
  }
}

/**
 * Stamp `_sourceBack` on a loaded row (never stored) for quiz-sources
 * lpRemakeableQuiz to read. Only a failed `source_missing` plan quiz is read.
 * @returns {Promise<object>} the same row
 */
async function withSourceCheck(quiz) {
  if (quiz && isPlanQuiz(quiz.quiz_source) && quiz.status === 'failed' && failureReasonOf(quiz.meta) === 'source_missing') {
    // eslint-disable-next-line no-param-reassign
    quiz._sourceBack = await lpSourceAvailable(quiz);
  }
  return quiz;
}

module.exports = { withSourceCheck };
