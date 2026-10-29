'use strict';
/**
 * A one-item slot made of equal parts prints its marks as "(n×m=t)" (bd-5jmnfj.4.58.2, v26 finding 3).
 * v26: G2 English Q1 (ten sub-questions of 2 marks) printed "(20)" and G5 English Q4 (five sentences
 * of 2 marks) printed "(10)", where every slot that holds n items of m marks prints "(5×2=10)".
 * The parts are read from the item: `questions[].marks`, or, for a choose-n item (`in_item_choice`),
 * its `scheme.points`. Only n > 1, m > 1 and n×m equal to the slot total are rewritten.
 * Pure: the raw marks line (with its {t:} atom) in, the raw line out.
 */

const TOTAL = /\{t:[^}]*\}/;

// [n, m] of an item's equal parts, or null.
function partsOf(q, slot) {
  let marks = null;
  if (Array.isArray(q.questions) && q.questions.length && q.questions.every((p) => p && typeof p === 'object')) {
    marks = q.questions.map((p) => p.marks);
  } else if (slot.in_item_choice && q.scheme && Array.isArray(q.scheme.points)) {
    marks = q.scheme.points.map((p) => p && p.marks);
    if (marks.length !== slot.in_item_choice.n) return null;
  }
  if (!marks || marks.length < 2 || !marks.every((m) => typeof m === 'number' && m === marks[0])) return null;
  return marks[0] > 1 ? [marks.length, marks[0]] : null;
}

/** raw marks line → the same with "n×m=" before its total, or unchanged. */
function equalPartsLine(raw, slot, items) {
  if (typeof raw !== 'string' || !TOTAL.test(raw) || /\{n:|×/.test(raw)) return raw;
  if (!slot || slot.generate !== 1 || slot.attempt !== 1 || !Array.isArray(items) || items.length !== 1 || !items[0]) return raw;
  const parts = partsOf(items[0], slot);
  if (!parts || parts[0] * parts[1] !== slot.marks_each) return raw;
  return raw.replace(TOTAL, (atom) => `${parts[0]}×${parts[1]}=${atom}`);
}

module.exports = { equalPartsLine };
