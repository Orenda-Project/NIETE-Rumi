'use strict';
/**
 * A QUESTION ABOUT THE LESSON, NOT ITS CONTENT (quiz_author_gates_v2).
 *
 * "The lesson mentioned that lava from volcanoes is very hot. Why did this
 * help…?", "How many layers does the Earth have, according to the lesson?",
 * «سندھ کی کون سی مخصوص چیز کلاس میں بتائی گئی تھی؟» — the child is asked to
 * remember the lesson rather than the idea, and a child who missed the day
 * cannot answer a question that is otherwise fair. 13 of 348 stems authored
 * from ten real sources (5 Oct 2026 re-score, both arms) had this framing, and
 * every one read as it; on all 12,670 sandbox stems it names 117 (0.9%), the
 * moral sense of "lesson" ("the lesson of the story") excluded. The fix is to drop the framing and keep the question
 * ("A desert fox has large ears. Which type of adaptation is this?").
 *
 * A question about what the TEACHER said or did is a different fault with its
 * own rule (quiz-author-gates-v2 ABOUT_TEACHER); this one leaves it alone.
 */

// The lesson as the subject of the question. Not "the class" or "the story": "The class planted 12 trees…"
// is a word problem and "In the story, why did Ali cry?" is a reading question.
const EN = /\b(?:the|this|today'?s|our) (?:lesson|chapter)\b|\baccording to the (?:lesson|chapter)\b/i;
const UR = /سبق میں|سبق کے مطابق|آج کے سبق|اس سبق|کلاس میں (?:بتا|سکھا|پڑھا|کہا)/;
const TEACHER = /\bteacher\b|استاد|استانی|ٹیچر/i;
// The moral sense: "the lesson of the story", "the lesson Chilli learned" is the content, not the class.
const MORAL = /\blesson (?:of the|.{0,30}\blearn)/i;

/**
 * @param {object} q a question ({ question })
 * @param {number} i its index
 * @returns {string|null} `qN: META_STEM — …`, or null
 */
function metaStemError(q, i) {
  const stem = String((q && q.question) || '');
  if (!stem || TEACHER.test(stem) || MORAL.test(stem)) return null;
  const hit = (EN.exec(stem) || UR.exec(stem) || [])[0];
  if (!hit) return null;
  return `q${i}: META_STEM — the question asks what the lesson said ("${hit}") instead of about the idea itself; keep the same question and answer and drop that framing, so a child who understands the idea can answer it`;
}

module.exports = { metaStemError };
