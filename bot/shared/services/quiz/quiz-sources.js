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

module.exports = { TRANSCRIPT, LP_V8, LESSON_SOURCES, isLessonQuiz };
