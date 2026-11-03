'use strict';
/**
 * An item whose answers sit on its parts (bd-5jmnfj.4.50.2): G2 English Q1 is one passage
 * with ten { question, answer, marks, scheme } parts and no answer of its own, so the key
 * printed only its marks. Returns those parts, or null when the item answers itself or no
 * part carries an answer (a story to order lists its sentences as plain strings).
 */

const filled = (v) => v !== undefined && v !== null && String(v).trim() !== '';

function answeredParts(q) {
  if (!q || filled(q.answer) || !Array.isArray(q.questions)) return null;
  return q.questions.some((s) => s && typeof s === 'object' && filled(s.answer)) ? q.questions : null;
}

// v37 G2 English Q1: a passage item whose every part carries its own answer has none of its
// own. A model-written parent answer ("See the answer to each question.") became a 20-mark key
// row that hid the ten part answers. Returns true when it removed one.
function dropPassageAnswer(q) {
  if (!q || !filled(q.passage) || !Array.isArray(q.questions) || !q.questions.length) return false;
  if (!q.questions.every((s) => s && typeof s === 'object' && filled(s.answer))) return false;
  if (!filled(q.answer) && !('scheme' in q)) return false;
  delete q.answer;
  delete q.scheme;
  return true;
}

module.exports = { answeredParts, dropPassageAnswer };
