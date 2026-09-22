'use strict';
/**
 * `quizzes.quiz_source` — the one place the values are named.
 *
 * The `quizzes` table is shared by four lanes: the PK video quiz (`video`), the
 * in-chat preview (`in_chat_preview`), the quiz written from a coaching
 * recording (`transcript`) and — from R8 — the quiz written from the slide
 * script of the lesson plan the teacher was served (`lp_v8`).
 *
 * The last two are THE SAME THING to a teacher: a quiz for a lesson she gave
 * today (PLAN_R8 D11 — "one list in /quiz for both kinds of quiz; the teacher
 * never cares where a quiz came from"). Everything downstream of authoring —
 * the /quiz list message, the /quiz Flow, the class report's objectives, the
 * report_sent stamp — must therefore ask "is this a LESSON quiz", not "is this
 * a transcript quiz". Before this module that question was four `'transcript'`
 * string literals in three files, and a second lesson source meant finding all
 * four by hand.
 *
 * `lp_v8`, never `'lesson_plan'` (PLAN_R8 D12): `lesson_plan` is the column's
 * historical default and rows carrying it are not R8 quizzes.
 */

/** A quiz written from a coaching recording's transcript. */
const TRANSCRIPT = 'transcript';

/** A quiz written from the slide script of the lp_v8 lesson actually served. */
const LP_V8 = 'lp_v8';

/**
 * Frozen: every consumer reads it, several hand it straight to PostgREST's
 * `.in()`, and one `.sort()` in a caller would reorder it for everyone in the
 * same process.
 */
const LESSON_SOURCES = Object.freeze([TRANSCRIPT, LP_V8]);

/**
 * Is this quiz one of a teacher's own lessons (as opposed to a video quiz or an
 * in-chat preview)?
 * @param {string|null|undefined} source `quizzes.quiz_source`
 * @returns {boolean}
 */
function isLessonQuiz(source) {
  return LESSON_SOURCES.includes(source);
}

/**
 * The only thing any consumer reads from a quiz's "session" is the lesson's
 * date. An lp_v8 quiz has no coaching session: its date is `meta.lesson_date`,
 * the PKT school day the lesson was planned for (PLAN_R8 §2.3, D2), printed
 * where a transcript quiz prints the recording's date and sorted on in /quiz.
 *
 * A bare `YYYY-MM-DD` is pinned to noon PKT, so no reading of the offset can
 * move it across midnight onto the neighbouring day. Pure, and here rather than
 * in the hand-off, because several suites mock the hand-off service wholesale.
 *
 * @returns {{created_at?: string}}
 */
function lessonSessionFor(quiz) {
  const d = quiz && quiz.meta && quiz.meta.lesson_date;
  if (!d) return {};
  return { created_at: /^\d{4}-\d{2}-\d{2}$/.test(String(d)) ? `${d}T12:00:00+05:00` : d };
}

/**
 * WHICH failure sentence the teacher gets.
 *
 * `tqCouldNotMake` names "this lesson's recording" and "the transcript" — true
 * of a quiz written from a coaching recording, and a state that never existed
 * for a quiz written from the lesson PLAN a teacher was served. One shared
 * fallback across distinct failures is also what misdirected a whole fix cycle
 * before, so the LP path names the step that stopped. Pure and here, so the
 * generate step (which sends it) and /quiz (which repeats it on a failed row)
 * read one table.
 *
 * @param {string} reason      the `transcript_quiz.failed` reason
 * @param {string} quizSource  `quizzes.quiz_source`
 * @returns {string} a ux-strings key
 */
const LP_FAILURE_COPY = {
  source_missing: 'tqFailedLpSource',
  digest_failed: 'tqFailedLpDigest',
  validator_failed: 'tqFailedLpAuthor',
};
function failureCopyKey(reason, quizSource) {
  if (quizSource !== LP_V8) return 'tqCouldNotMake';
  // An LP quiz never falls back to the transcript copy: a reason nobody has
  // written copy for is still an LP failure, and "the questions did not come
  // out" is the honest general case of one.
  return LP_FAILURE_COPY[reason] || 'tqFailedLpAuthor';
}

module.exports = {
  TRANSCRIPT, LP_V8, LESSON_SOURCES, isLessonQuiz, lessonSessionFor, failureCopyKey,
};
