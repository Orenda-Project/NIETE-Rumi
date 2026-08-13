/**
 * Paper marking — the ONE place "which answer is correct" is decided.
 *
 * bd-2673.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * This rule used to live in three places: here-ish (inline in
 * quiz-delivery.service.js) and twice more in dashboard/routes/portal.routes.js
 * — once for the module quiz, once for the level exam. All three agreed, but by
 * coincidence rather than by construction, and the portal's comment claimed
 * "identical comparator to the WhatsApp writer", which is exactly the kind of
 * claim that rots. dashboard/services/training-rules.service.js documents four
 * sibling rules that drifted this way, two of them after their fix had been
 * announced as shipped.
 *
 * So: one implementation, two callers, and a test asserting the callers do not
 * fork it.
 *
 * WHAT BELONGS HERE
 * -----------------
 * Only the marking rule — given questions and submitted answers, which are
 * right, what is the raw score, and what per-question rows should be stored.
 *
 * WHAT DOES NOT BELONG HERE
 * -------------------------
 * The PASS decision. That needs the vendor's bar (training_vendors
 * .module_passing_pct / .passing_pct) and stays with decideModuleQuizPass /
 * the exam-gate services, reached over the internal API. Marking is arithmetic;
 * passing is policy, and mixing them is how the portal ended up failing Beacon
 * House teachers on work that passed on WhatsApp (bd-2483).
 *
 * PURITY IS THE POINT
 * -------------------
 * No supabase, no network, no phone number, no WhatsApp send. That is what lets
 * the dashboard reach it over HTTP without dragging the bot's queue driver into
 * a process that carries a different aws-sdk major (bd-2461).
 */

/**
 * A question is multi-answer ("msq") iff its stored key holds a comma-joined
 * set — '1,3,5', restored from the legacy `answers` array. bd-2138.
 */
function isMultiKey(correctOption) {
  return String(correctOption || '').includes(',');
}

/**
 * Canonical form of an answer key or a submitted selection: de-duplicated,
 * numerically sorted, comma-joined. Makes '3,1', '1,3', ' 1 , 3 ' and [1, 3]
 * all compare equal, which is the property multi-answer grading needs.
 *
 * Accepts an array (the legacy shape) or a string.
 */
function normalizeAnswerKey(value) {
  const parts = Array.isArray(value)
    ? value
    : String(value === null || value === undefined ? '' : value).split(',');
  const unique = [...new Set(parts.map(p => String(p).trim()).filter(Boolean))];
  return unique.map(Number).sort((a, b) => a - b).join(',');
}

/**
 * Mark a submitted paper.
 *
 * @param {object}   input
 * @param {object[]} input.questions Canonical question rows, in canonical order
 *   (i.e. already sorted by order_index). Each needs `id` and `correct_option`.
 * @param {object[]} input.answers   Submitted answers: `{ question_id, chosen_option }`.
 *   Submit order is irrelevant — the recorded question_index always follows the
 *   canonical order, because (attempt_id, question_index) is UNIQUE.
 *
 * WHY question_index IS THE POSITION AND NOT order_index
 * -----------------------------------------------------
 * The bot writes `attempt.current_question_index` — a 0-based counter it
 * increments as it walks the served paper (recordAnswer in
 * quiz-delivery.service.js, upserting on attempt_id,question_index). It is a
 * position in THIS attempt's paper, not the question's catalogue order.
 *
 * Those two coincide only when order_index happens to be 0-based and gapless.
 * Real corpora are neither: the grand-quiz corpus is 1-based, and a capped exam
 * serves a subset, so order_index would skip values the counter never does.
 * Using order_index here would write indices that collide with, or diverge
 * from, the rows WhatsApp writes for the same attempt — so position it is.
 *
 * @returns {{
 *   graded: {question_index:number, question_id:string, chosen_option:string, is_correct:boolean}[],
 *   score: number,
 *   total_questions: number,
 *   has_unknown_question: boolean,
 *   has_duplicate_answer: boolean,
 * }}
 *
 * Callers decide what to do about `has_unknown_question` /
 * `has_duplicate_answer`; both surfaces currently reject the submit with a 400.
 * Reporting rather than throwing keeps this function total — a race between a
 * question edit and a submit should not 500.
 */
function markPaper({ questions, answers } = {}) {
  const qList = Array.isArray(questions) ? questions : [];
  const aList = Array.isArray(answers) ? answers : [];

  // Position in the canonical paper — see the note above on why this is the
  // position rather than the question's order_index.
  const byId = new Map(qList.map((q, pos) => [q.id, { q, pos }]));

  let hasUnknown = false;
  const graded = [];
  const seen = new Set();
  let hasDuplicate = false;

  for (const a of aList) {
    const hit = byId.get(a && a.question_id);
    if (!hit) {
      hasUnknown = true;
      continue;
    }
    const { q, pos } = hit;
    if (seen.has(q.id)) hasDuplicate = true;
    seen.add(q.id);

    const multi = isMultiKey(q.correct_option);
    const chosen = multi
      ? normalizeAnswerKey(a.chosen_option)
      : (a.chosen_option === null || a.chosen_option === undefined ? '' : String(a.chosen_option));
    const correctKey = multi
      ? normalizeAnswerKey(q.correct_option)
      : String(q.correct_option).trim();

    // An empty selection is wrong, never accidentally equal to the key.
    const isCorrect = chosen.trim() !== '' && correctKey === chosen.trim();

    graded.push({
      question_index: pos,
      question_id: q.id,
      chosen_option: chosen,
      is_correct: isCorrect,
    });
  }

  return {
    graded,
    score: graded.filter(g => g.is_correct).length,
    total_questions: qList.length,
    has_unknown_question: hasUnknown,
    has_duplicate_answer: hasDuplicate,
  };
}

module.exports = {
  isMultiKey,
  normalizeAnswerKey,
  markPaper,
};
