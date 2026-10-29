'use strict';
/**
 * The word-problem load of a Grade 3–4 subject and its cap check (bd-5jmnfj.33.1).
 * A word problem is a situation in words the child turns into a calculation.
 *
 * Pure: no I/O.
 */

const slotsOf = (subject) => subject.sections.flatMap((sec) => sec.slots);

/** items: word problems generated; marks: the most a child can be made to answer; share: % of the paper. */
function wordProblemLoad(subject) {
  const slots = slotsOf(subject);
  const items = slots.reduce((n, s) => n + (s.word_problems || 0), 0);
  const marks = slots.reduce((n, s) => n + Math.min(s.word_problems || 0, s.attempt) * s.marks_each, 0);
  const share = subject.total_marks ? Math.round((marks / subject.total_marks) * 1000) / 10 : 0;
  return { items, marks, share };
}

/** [] when the subject has no cap or is within it; else one problem per breached limit. */
function checkCap(subject) {
  const cap = subject.word_problem_cap;
  if (!cap) return [];
  const have = wordProblemLoad(subject);
  const out = [];
  if (have.items > cap.items) out.push({ code: 'WORD_PROBLEM_ITEMS', have: have.items, cap: cap.items });
  if (have.marks > cap.marks) out.push({ code: 'WORD_PROBLEM_MARKS', have: have.marks, cap: cap.marks });
  return out;
}

module.exports = { wordProblemLoad, checkCap };
