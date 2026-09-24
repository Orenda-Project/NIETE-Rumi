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
 * A quiz written from a Grades 6-12 lesson plan the teacher was served — the
 * exact document that made the PDF, read from R2 by its render's version
 * triple (lp612-quiz-source.js). Downstream it is a lesson-PLAN quiz exactly
 * like lp_v8: no recording, "What you planned", the lesson-plan failure copy,
 * "Make it again".
 */
const LP612 = 'lp612';

/**
 * Frozen: every consumer reads it, several hand it straight to PostgREST's
 * `.in()`, and one `.sort()` in a caller would reorder it for everyone in the
 * same process.
 */
const LESSON_SOURCES = Object.freeze([TRANSCRIPT, LP_V8, LP612]);

/**
 * The lesson quizzes written from a lesson PLAN rather than a recording. The
 * question every surface that used to ask "is this lp_v8?" is really asking:
 * nobody heard this lesson, so nothing may say it was taught, and the quiz is
 * made from a written source that can be read again.
 */
const PLAN_SOURCES = Object.freeze([LP_V8, LP612]);

/** @param {string|null|undefined} source `quizzes.quiz_source` */
function isPlanQuiz(source) {
  return PLAN_SOURCES.includes(source);
}

/**
 * THE KILL SWITCH for quizzes from Grades 6-12 lesson plans: QUIZ_LP612_SOURCE, read at call
 * time. `on` (or `true`) = the /quiz menu lists 6-12 lessons and the generate step writes their
 * quizzes. Anything else — unset, `off` — = no 6-12 lesson is listed and no lp612 quiz is
 * written; a quiz already MADE keeps going (its hand-off, children, report and /quiz actions are
 * not gated), so switching it off never strands a class mid-quiz.
 */
function lp612SourceOn() {
  const v = String(process.env.QUIZ_LP612_SOURCE || '').trim().toLowerCase();
  return v === 'on' || v === 'true';
}

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
  // The slide script was found and carries no lesson to write from.
  source_unusable: 'tqFailedLpSourceUnusable',
  // The model gave nothing usable — empty, cut off or unparseable after its
  // retry, or the provider refused the call. Ours, not the lesson plan's.
  model_failed: 'tqFailedLpModel',
  validator_failed: 'tqFailedLpAuthor',
  // The key check found answers the lesson contradicts and could neither fix
  // nor drop enough of them: the questions were clear, their KEYS were wrong.
  key_conflict: 'tqFailedLpKeyConflict',
  // The blind solve disagreed with too many keys (a wrong answer, or two right
  // ones) to fix or drop and still send a quiz.
  key_disagreement: 'tqFailedLpKeyDisagreement',
  // The generate job could not be queued: the quiz was never written. What the
  // teacher was told at the time, repeated — not "the questions did not come out".
  queue_failed: 'lpQuizCouldNotStart',
  // QUIZ_LP612_SOURCE was switched off between the tap and the author: the quiz
  // was never written, and "couldn't start it just now" is the honest sentence.
  source_off: 'lpQuizCouldNotStart',
};
/**
 * The transcript counterpart. `tqCouldNotMake` blames the recording ("the
 * transcript didn't carry enough"), so it is sent ONLY where that is the state:
 * a transcript too short to carry a quiz (source_unusable), checked in code
 * before any model call. Every other reason is ours and says so — the MODEL
 * gave nothing usable (model_failed); the questions we wrote never passed our
 * checks (validator_failed), or their keys contradicted the lesson
 * (key_conflict — lp_v8 only today); the blind solve held the quiz back
 * (key_disagreement). A session that is gone says so (session_missing). A
 * reason nobody has written copy for is no evidence about the recording
 * either, so it falls back to the general "on my side" sentence.
 */
const TRANSCRIPT_FAILURE_COPY = {
  source_unusable: 'tqCouldNotMake',
  model_failed: 'tqCouldNotMakeModel',
  validator_failed: 'tqCouldNotMakeAuthor',
  key_conflict: 'tqCouldNotMakeAuthor',
  key_disagreement: 'tqFailedKeyDisagreement',
  // the coaching session it was to be written from is gone
  session_missing: 'tqCouldNotMakeSessionGone',
};
function failureCopyKey(reason, quizSource) {
  if (!isPlanQuiz(quizSource)) return TRANSCRIPT_FAILURE_COPY[reason] || 'tqCouldNotMakeModel';
  // An LP quiz never falls back to the transcript copy: a reason nobody has
  // written copy for is still an LP failure, and "the questions did not come
  // out" is the honest general case of one.
  return LP_FAILURE_COPY[reason] || 'tqFailedLpAuthor';
}

/**
 * The `err.code` the LP digest throws with when the slide script it was handed
 * carries no lesson (lp-quiz-digest.service `isUsable`). It is the ONE digest
 * failure that is the lesson plan's; every other throw out of that step is the
 * model's or the provider's.
 */
const SOURCE_UNUSABLE_CODE = 'SOURCE_UNUSABLE';

/**
 * WHY the digest step stopped, from what it threw.
 *
 * Before this, every throw was `digest_failed` and the teacher heard that the
 * lesson plan could not be read — true only when the plan was empty. An empty,
 * cut-off or unparseable reply (after completeJson's one retry) or a refused
 * call is ours, and says so (root CLAUDE.md rule 24d).
 *
 * @param {Error} err what the digest threw
 * @returns {'source_unusable'|'model_failed'}
 */
function digestFailureReason(err) {
  return err && err.code === SOURCE_UNUSABLE_CODE ? 'source_unusable' : 'model_failed';
}

/**
 * The failure reason a failed quiz row carries, for a surface that repeats the
 * failure later (/quiz). `meta.error` is the reason itself; a row written
 * before the split carries `digest: <message>` and is read by that message —
 * the unusable-plan throw has one fixed text, anything else was the model.
 * A failed row with no marker failed validation (the one path that stored none).
 *
 * @param {object} meta `quizzes.meta`
 * @returns {string} a reason `failureCopyKey` understands
 */
function failureReasonOf(meta) {
  const error = String((meta && meta.error) || '');
  if (!error) return 'validator_failed';
  if (error.startsWith('digest')) {
    return /carries no lesson to digest/.test(error) ? 'source_unusable' : 'model_failed';
  }
  return error;
}

/**
 * Can a failed lp_v8 quiz be made again from /quiz?
 *
 * Only when trying again can come out differently. The model-side failures
 * can: authoring is not deterministic, and a provider fault is usually gone on
 * the next call. A plan that was missing or carried no lesson cannot — a remake
 * would fail the same way and tell the teacher the same thing a second time.
 * The row must still carry the lessons it is written from (a quiz whose queue
 * write failed lost them), and remakes are capped so a quiz that keeps failing
 * cannot be retried without end.
 *
 * @param {object} meta `quizzes.meta` of a failed lp_v8 row
 * @returns {boolean}
 */
// queue_failed: the job never reached the queue — a transient refusal, and the
// row now keeps its lessons (queueLpQuiz merges), so a remake can succeed.
const LP_REMAKE_REASONS = new Set(['model_failed', 'validator_failed', 'key_conflict', 'key_disagreement', 'queue_failed']);
const MAX_LP_REMAKES = 2;
function lpRemakeable(meta) {
  const m = meta || {};
  if (!LP_REMAKE_REASONS.has(failureReasonOf(m))) return false;
  if (!Array.isArray(m.lessons) || !m.lessons.length) return false;
  return (Number(m.remakes) || 0) < MAX_LP_REMAKES;
}

/**
 * WHICH caption rides the teacher's PDF.
 *
 * `tqHandoffIntro` says "what you taught" / «آپ نے کیا پڑھایا» — true of a quiz
 * written from a recording of the class. A quiz written from the lesson PLAN a
 * teacher was served knows only that a PDF was delivered, so its caption says
 * what was planned, matching the sheet's own "What you planned" heading.
 *
 * @param {string} quizSource `quizzes.quiz_source`
 * @returns {string} a ux-strings key
 */
function handoffIntroKey(quizSource) {
  return isPlanQuiz(quizSource) ? 'tqHandoffIntroLp' : 'tqHandoffIntro';
}

module.exports = {
  TRANSCRIPT, LP_V8, LP612, LESSON_SOURCES, PLAN_SOURCES, isLessonQuiz, isPlanQuiz, lp612SourceOn, lessonSessionFor, failureCopyKey, handoffIntroKey,
  SOURCE_UNUSABLE_CODE, digestFailureReason, failureReasonOf, lpRemakeable,
};
