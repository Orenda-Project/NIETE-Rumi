'use strict';
/**
 * v37 G1 Maths Q5 / Q6 (bd-5jmnfj.4.58, round 6): the stories stated facts and asked nothing ("Ali has 6 marbles.
 * He finds 7 more marbles."). A story with no "?" gets its question: Q5 " How many now?", Q6 " How many are left?".
 * Wired through fde-early-key-fixes (fixWordProblem). Pure: askStoryQuestion(q, notes) returns q or a changed copy.
 */

const ASK = { 'g1.maths.B.Q5': ' How many now?', 'g1.maths.B.Q6': ' How many are left?' };

function askStoryQuestion(q, notes) {
  const ask = q && ASK[q.slot];
  const text = q && typeof q.question === 'string' ? q.question.trim() : '';
  if (!ask || !text || text.includes('?')) return q;
  if (Array.isArray(notes)) notes.push(`${q.slot}: «${text}» had no question; it now ends "${ask.trim()}"`);
  return { ...q, question: `${text}${ask}` };
}

module.exports = { askStoryQuestion };
