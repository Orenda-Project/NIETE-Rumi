/** The word-problem load of a Grade 3-4 subject and its cap check (bd-5jmnfj.33.1). */

const W = require('../../bot/shared/services/assessment/patterns/mid/word-problems');

const slot = (generate, attempt, marks_each, word_problems) => ({ generate, attempt, marks_each, word_problems });
const subject = (cap, slots) => ({
  total_marks: 20,
  word_problem_cap: cap,
  sections: [{ slots: slots.slice(0, 1) }, { slots: slots.slice(1) }],
});
const slots = [slot(5, 5, 1, 0), slot(4, 3, 2, 2), slot(6, 4, 3, 5)];

test('load: items are generated word problems; marks use min(word_problems, attempt) x marks_each', () => {
  // items 0+2+5; marks 0 + 2x2 + min(5,4)x3 = 16; share 16/20
  expect(W.wordProblemLoad(subject(null, slots))).toEqual({ items: 7, marks: 16, share: 80 });
});

test('load: share is rounded to one decimal', () => {
  const S = { total_marks: 30, sections: [{ slots: [slot(2, 2, 1, 1)] }] };
  expect(W.wordProblemLoad(S)).toEqual({ items: 1, marks: 1, share: 3.3 });
});

test('load: a subject with no word problems is zero', () => {
  expect(W.wordProblemLoad(subject(null, [slot(5, 5, 1, 0)]))).toEqual({ items: 0, marks: 0, share: 0 });
});

test('checkCap: no cap, or within the cap, is clean', () => {
  expect(W.checkCap(subject(null, slots))).toEqual([]);
  expect(W.checkCap(subject({ items: 7, marks: 16 }, slots))).toEqual([]);
});

test('checkCap: names each breach with what the paper has and the cap', () => {
  expect(W.checkCap(subject({ items: 6, marks: 16 }, slots))).toEqual([{ code: 'WORD_PROBLEM_ITEMS', have: 7, cap: 6 }]);
  expect(W.checkCap(subject({ items: 7, marks: 10 }, slots))).toEqual([{ code: 'WORD_PROBLEM_MARKS', have: 16, cap: 10 }]);
  expect(W.checkCap(subject({ items: 1, marks: 1 }, slots)).map((p) => p.code)).toEqual(['WORD_PROBLEM_ITEMS', 'WORD_PROBLEM_MARKS']);
});
