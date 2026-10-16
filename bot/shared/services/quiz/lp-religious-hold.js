'use strict';
/**
 * Which K-5 lesson plans are HELD out of machine-written quizzes: Islamiyat, and the Hamd, Naat and
 * Prophet's-life chapters that open every Urdu book, until the
 * fluent-Urdu religious review clears the subject.
 *
 * The other two quiz paths already hold it. The recorded-lesson quiz has its subject allow-list
 * (TRANSCRIPT_QUIZ_SUBJECTS, transcript-quiz-offer.subjectAllowed) and the 6-12 plans have
 * `is_religious` (providers/lp612.provider). The K-5 plans had neither, so when the Islamiyat books
 * joined the v8 catalog every door into an lp_v8 quiz offered them. A code constant, not an env
 * var: with no setting changed on any tier the hold is on, and lifting it is a reviewed change.
 *
 * One predicate, read by every door: the 15:00 offer (the cohort build and the class tap), the
 * /quiz lesson provider (list, get, start — the Flow uses the same three) and "make it again" on a
 * failed quiz (quiz-sources.lpRemakeable). A held lesson is logged with HELD_REASON — its own
 * reason, never folded into `no_lesson` or `no_quiz_source`.
 *
 * Pure apart from the catalog lookup, and that runs only for a row with no subject. Every delivery
 * row and app-open row carries the book's subject_key today; the lookup is there so a row written
 * without one is judged by its book, never waved through.
 */

const { canonicalSubject } = require('./transcript-quiz-language');
const Catalog = require('../lp-v8-catalog.service');

/** The reason a held lesson is skipped, logged and counted under. */
const HELD_REASON = 'religious_review_pending';

// Until the fluent-Urdu religious review clears it; see the transcript path's allow-list.
const HELD_SUBJECTS = Object.freeze(['islamiat']);

// Every K-5 Urdu book opens with the same three chapters: Hamd, Naat and the Prophet's ﷺ life
// (bot/data/lp_catalog.json grade_1_urdu .. grade_5_urdu). Held with the subject above, by lesson id,
// until a reviewer lists each book's religious lessons.
const HELD_LESSON_ID = /^grade_[1-5]_urdu_ch[1-3]_/;

/** The canonical subject of a lesson row: its own subject, else its catalog book's. */
function subjectOf({ subject, lesson_id: lessonId } = {}) {
  if (String(subject == null ? '' : subject).trim()) return canonicalSubject(subject);
  const hit = lessonId ? Catalog.lessonById(lessonId) : null;
  return hit ? canonicalSubject(hit.book.subject_key) : 'other';
}

/**
 * @param {{subject?: string|null, lesson_id?: string|null}} lesson a delivery row, a cohort lesson
 *   with its class's subject, or a quiz's class + first lesson
 * @returns {boolean} true when no quiz may be made from it
 */
function isHeldLesson(lesson) {
  const l = lesson || {};
  if (HELD_LESSON_ID.test(String(l.lesson_id || ''))) return true;
  return HELD_SUBJECTS.includes(subjectOf(l));
}

module.exports = { HELD_REASON, HELD_SUBJECTS, HELD_LESSON_ID, isHeldLesson };
