/**
 * The one place that turns "how many reflections has she answered"
 * into the numbers and copy the teacher is shown.
 *
 * `config/coaching-debrief.config.js` says NUM_REFLECTIVE_QUESTIONS is "the
 * single source of the count — no other edit is needed to change how many are
 * asked". When the debrief was cut from 3 questions to 1 that turned out to be
 * false: the stale-session worker, the reminder-button router and the report
 * generator each kept a literal 3. So the bot told a teacher who had answered
 * the only question it would ever ask her that her report covered "1/3
 * reflective responses" and that "full insights require completing all
 * reflection questions", and the 2h reminder promised her three more questions.
 *
 * Every consumer now reads this helper, so the count cannot drift again.
 * Pure + dependency-free (beyond the config) so it is unit-testable.
 */

const { NUM_REFLECTIVE_QUESTIONS } = require('../../config/coaching-debrief.config');

/**
 * @param {number} questionsAnswered  how many reflective questions have answers
 * @returns {{answered:number, total:number, remaining:number, isPartial:boolean, label:string}}
 */
function reflectionProgress(questionsAnswered) {
  const n = Number(questionsAnswered);
  // Missing / NaN / negative all mean "she has answered nothing yet". The old
  // callers used `|| 0`, which silently turned a garbage value into zero too —
  // this keeps that tolerance but makes it deliberate.
  const answered = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  const total = NUM_REFLECTIVE_QUESTIONS;
  // Clamp: over-answering (a resumed session that recorded an extra answer)
  // must not produce negative "remaining" or re-flag the debrief as partial.
  const remaining = Math.max(0, total - answered);

  return {
    answered,
    total,
    remaining,
    isPartial: remaining > 0,
    label: `${answered}/${total}`,
  };
}

module.exports = { reflectionProgress, NUM_REFLECTIVE_QUESTIONS };
