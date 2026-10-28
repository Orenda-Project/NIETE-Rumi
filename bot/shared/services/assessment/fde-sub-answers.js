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

module.exports = { answeredParts };
