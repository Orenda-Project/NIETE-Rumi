'use strict';
/**
 * The lessons /quiz can make a quiz FROM — one provider per source.
 *
 * /quiz is one list (PLAN_R8 D11): the teacher's lessons, newest first, each
 * labelled with where it came from, whichever way its quiz is (or will be)
 * born. A PROVIDER supplies the lessons of one source that have NO quiz yet and
 * makes the quiz when the teacher taps one; the quizzes that already exist are
 * listed by the list service itself (transcript-quiz-list.service).
 *
 * Contract — every entry of PROVIDERS:
 *   source    `quizzes.quiz_source` its quizzes are written with
 *   labelKey  ux-strings key of the row label ("From lesson plan" …), ≤ 20 code points
 *   list(teacherId, {since, limit}) → Promise<[{source, lessonRef, date, grade, subject, topic, …}]>
 *             the teacher's lessons of this source with NO quiz yet, newest first.
 *             `date` is an ISO instant (sorted on, printed as the lesson's day);
 *             `lessonRef` is the provider's own id for the lesson, [A-Za-z0-9-] only
 *             (it rides in a WhatsApp row id and a Flow payload). Never throws:
 *             a lesson that cannot be made is never listed.
 *   start(teacher, lessonRef, {phone, quizLanguage?, via}) → Promise<{outcome, quizId?, existing?}>
 *             the tap: claim the lesson and make its quiz, once. `outcome: 'already'`
 *             (+ `existing`, the quiz that covers it) is answered by the CALLER
 *             (list service answerTakenLesson); every other outcome answered itself.
 *   get(teacherId, lessonRef) → Promise<item|null>   (optional; the Flow's lesson screen)
 *   existingQuiz(teacherId, item) → Promise<quiz|null> (optional; a quiz made for the lesson
 *             since the list was drawn — the Flow's lesson screen then shows that quiz)
 *
 * Adding a source = a provider in its own file and one line below. The list
 * message and the Flow read this registry and nothing else about sources.
 */

const { logToFile } = require('../../utils/logger');
const { TRANSCRIPT } = require('./quiz-sources');
const QuizMenuFlags = require('./quiz-menu-flags');
// A provider module never requires the list service (it requires this
// registry): the circular-deps guard counts every require, lazy ones too.
const { TranscriptProvider } = require('./transcript-lesson-provider');
const LpV8Provider = require('./lp-v8-lesson-provider');

const PROVIDERS = Object.freeze([
  TranscriptProvider,
  LpV8Provider,
]);

/** The key a lesson-without-a-quiz travels under: `lsn_<source>_<lessonRef>`. */
const LESSON_KEY_PREFIX = 'lsn_';

function providerFor(source) {
  return PROVIDERS.find((p) => p.source === source) || null;
}

/** Providers whose lessons are listed as rows of their own (every source but the recording). */
function planProviders() {
  return PROVIDERS.filter((p) => p.source !== TRANSCRIPT);
}

function lessonKey(item) {
  return `${LESSON_KEY_PREFIX}${item.source}_${item.lessonRef}`;
}

/**
 * `lsn_lp_v8_<ref>` → { provider, lessonRef }. Sources may contain an
 * underscore, so the longest registered source that matches wins.
 * @returns {{provider: object, lessonRef: string}|null}
 */
function parseLessonKey(key) {
  const k = String(key || '');
  if (!k.startsWith(LESSON_KEY_PREFIX)) return null;
  const rest = k.slice(LESSON_KEY_PREFIX.length);
  const provider = [...PROVIDERS]
    .sort((a, b) => b.source.length - a.source.length)
    .find((p) => rest.startsWith(`${p.source}_`));
  if (!provider) return null;
  const lessonRef = rest.slice(provider.source.length + 1);
  return lessonRef ? { provider, lessonRef } : null;
}

/** The label key for a quiz row or a lesson row of `source`. */
function labelKeyFor(source) {
  const p = providerFor(source);
  return p ? p.labelKey : 'tqRowFromLessonPlan';
}

/**
 * Every plan provider's lessons with no quiz yet, one list, newest first.
 * A provider that throws costs its own rows, never the menu.
 */
async function listPlanLessons(teacherId, { since = null, limit = 20 } = {}) {
  // QUIZ_MENU_LESSON_ROWS off: /quiz lists recordings and existing quizzes only, as before.
  if (!QuizMenuFlags.lessonRows()) return [];
  const lists = await Promise.all(planProviders().map(async (p) => {
    try {
      return await p.list(teacherId, { since, limit });
    } catch (err) {
      logToFile('❌ quiz menu: a lesson provider failed — its lessons are left out', { source: p.source, error: err.message }, 'error');
      return [];
    }
  }));
  return lists.flat().sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, Math.max(0, limit));
}

module.exports = {
  PROVIDERS,
  LESSON_KEY_PREFIX,
  providerFor,
  lessonKey,
  parseLessonKey,
  labelKeyFor,
  listPlanLessons,
};
