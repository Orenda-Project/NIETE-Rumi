/**
 * The teacher's I-SAPS score sheet (bd-vej4h).
 *
 * I-SAPS: "The trainees' scores should be recorded and available at the end of
 * the training." Operator, 2026-10-01: shown to the teacher on the portal; no
 * export. Every number here is already stored — unit-quiz attempts, module-exam
 * attempts and their answer rows — so this module is only the arithmetic.
 *
 * Choices, each for a reason:
 *   - a unit shows its BEST quiz percentage: retakes are unlimited and the gate
 *     opened on the best one;
 *   - an exam shows the PASSED attempt if there is one, else the highest
 *     scoring, so the sheet matches what decided the certificate;
 *   - the exam is split into MCQ and written marks, because the pass rule is
 *     two separate bars and a single total would hide which one held her back.
 *
 * Pure: no I/O.
 */

const { MCQ_MARKS } = require('./isaps-crq-paper.rules');

const MODULE_SOURCE_BASE = 900;
const moduleNoOf = title => {
  const m = /Module (\d+)/.exec(title || '');
  return m ? parseInt(m[1], 10) : null;
};

/**
 * @param {object} input
 * @param {Array<{id:number,title:string,order_index:number}>} input.courses
 * @param {Array<{id:number,course_id:number,title:string,order_index:number}>} input.units
 * @param {Array<{id:number,source_quiz_id:number}>} input.exams  active per-module exams
 * @param {Array<object>} input.unitAttempts  {training_module_id, score, total_questions}
 * @param {Array<object>} input.examAttempts  {id, grand_quiz_id, is_passed, score, total_questions, status}
 * @param {Array<object>} input.examAnswers   {attempt_id, question_index, is_correct, answer_score}
 * @param {number} input.crqMax
 * @returns {{modules: Array<object>}}
 */
function buildIsapsScoreSheet({
  courses = [], units = [], exams = [], unitAttempts = [], examAttempts = [], examAnswers = [], crqMax = 10,
}) {
  const bestPct = new Map();
  for (const a of unitAttempts || []) {
    const total = Number(a.total_questions) || 0;
    if (total <= 0 || !Number.isFinite(Number(a.score))) continue;
    const pct = Math.round((Number(a.score) / total) * 100);
    const cur = bestPct.get(a.training_module_id);
    if (cur === undefined || pct > cur) bestPct.set(a.training_module_id, pct);
  }

  const examByModule = new Map(
    (exams || []).map(e => [Number(e.source_quiz_id) - MODULE_SOURCE_BASE, e.id]),
  );

  const answersBy = new Map();
  for (const r of examAnswers || []) {
    if (!answersBy.has(r.attempt_id)) answersBy.set(r.attempt_id, []);
    answersBy.get(r.attempt_id).push(r);
  }

  const examFor = (quizId) => {
    const graded = (examAttempts || []).filter(a => a.grand_quiz_id === quizId
      && a.status !== 'in_progress' && Number.isFinite(Number(a.score)));
    if (graded.length === 0) return null;
    graded.sort((a, b) => (Number(Boolean(b.is_passed)) - Number(Boolean(a.is_passed)))
      || (Number(b.score) - Number(a.score)));
    const best = graded[0];
    const served = Math.max(0, (Number(best.total_questions) || 0) - (crqMax > 0 ? 1 : 0));
    let mcqCorrect = 0;
    let crqEarned = null;
    for (const r of answersBy.get(best.id) || []) {
      if (Number(r.question_index) < served) {
        if (r.is_correct === true) mcqCorrect += 1;
      } else if (r.answer_score !== null && r.answer_score !== undefined && Number.isFinite(Number(r.answer_score))) {
        crqEarned = Math.max(0, Math.min(crqMax, Number(r.answer_score)));
      }
    }
    return {
      passed: Boolean(best.is_passed),
      mcq_correct: mcqCorrect,
      mcq_served: served,
      mcq_earned: mcqCorrect * MCQ_MARKS,
      mcq_possible: served * MCQ_MARKS,
      crq_earned: crqEarned,
      crq_max: crqMax,
    };
  };

  const orderedCourses = (courses || []).slice()
    .sort((a, b) => ((a.order_index || 0) - (b.order_index || 0)) || (a.id - b.id));
  return {
    modules: orderedCourses.map(c => {
      const quizId = examByModule.get(moduleNoOf(c.title));
      return {
        course_id: c.id,
        title: c.title,
        units: (units || []).filter(u => u.course_id === c.id)
          .sort((a, b) => ((a.order_index || 0) - (b.order_index || 0)) || (a.id - b.id))
          .map(u => ({ id: u.id, title: u.title, best_pct: bestPct.has(u.id) ? bestPct.get(u.id) : null })),
        exam: quizId === undefined ? null : examFor(quizId),
      };
    }),
  };
}

module.exports = { buildIsapsScoreSheet };
