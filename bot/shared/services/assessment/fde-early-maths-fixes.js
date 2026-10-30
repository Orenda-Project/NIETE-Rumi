'use strict';
/**
 * Grade 2 Maths one-step word problems paid M1 + M1 + A1 (bd-5jmnfj.4.58.4, round 4: Q7, Q9, Q11). A one-step
 * problem has one method, so the two method marks become one M mark and the freed mark goes to the answer (A2).
 * Wired through fde-early-key-fixes (fixWordProblem). Pure: mergeMethodMarks(q, notes) returns q or a changed copy.
 */

const kinds = (points) => points.map((p) => p && p.kind).join('');

function mergeMethodMarks(q, notes) {
  const points = q && q.scheme && q.scheme.points;
  if (!q || !/^g2\.maths\./.test(String(q.slot || '')) || !Array.isArray(points) || kinds(points) !== 'MMA') return q;
  if (points.some((p) => typeof p.marks !== 'number')) return q;
  const [m1, m2, a] = points;
  const merged = [{ ...m1, marks: m1.marks }, { ...a, marks: a.marks + m2.marks }];
  if (Array.isArray(notes)) notes.push(`${q.slot}: «${q.question}» M${m1.marks} + M${m2.marks} + A${a.marks} become M${m1.marks} + A${a.marks + m2.marks}`);
  return { ...q, scheme: { ...q.scheme, points: merged } };
}

module.exports = { mergeMethodMarks };
