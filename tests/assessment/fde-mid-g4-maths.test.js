/**
 * Grade 4 maths mid-term (end-of-chapter) pattern (bd-5jmnfj.33.1): DECISIONS.md section 4.
 */

const S = require('../../bot/shared/services/assessment/patterns/mid/g4-maths');
const { checkCap, wordProblemLoad } = require('../../bot/shared/services/assessment/patterns/mid/word-problems');

const slots = S.sections.flatMap((x) => x.slots);
const DESIGN = [["A",20,[["mcq",10,10,1],["directed",5,5,2]]],["B",20,[["short",4,3,5],["word_problem",2,1,5]]],["C",10,[["extended",3,2,5]]]];

test('key, medium, total and tos', () => {
  expect(S.key).toBe('maths');
  expect(S.medium).toBe('en');
  expect(S.grade).toBe(4);
  expect(S.total_marks).toBe(50);
  expect(S.tos).toEqual({"Remember":17,"Understand":39,"Apply":44});
  expect(S.g5_rules).toBe(false);
});

test('sections, slots, generate, attempt and marks are as designed', () => {
  expect(S.sections.map((x) => [x.id, x.marks])).toEqual(DESIGN.map((d) => [d[0], d[1]]));
  DESIGN.forEach(([id, marks, list]) => {
    const sec = S.sections.find((x) => x.id === id);
    expect(sec.slots.map((x) => [x.slot, x.generate, x.attempt, x.marks_each])).toEqual(
      list.map(([n, g, a, m]) => ['g4.maths.' + id + '.' + n, g, a, m]));
  });
  expect(slots.reduce((n, x) => n + x.generate, 0)).toBe(24);
});

test('levels sum to each section and sit within 5 marks of the tos', () => {
  S.sections.forEach((x) => expect(Object.values(x.levels).reduce((a, b) => a + b, 0)).toBe(x.marks));
  ['Remember', 'Understand', 'Apply'].forEach((b) => {
    const got = S.sections.reduce((n, x) => n + x.levels[b], 0);
    expect(Math.abs(got - S.tos[b] / 2)).toBeLessThanOrEqual(5);
  });
});

test('slot ids are unique, start g4.maths., end in a name, labels run Q1..', () => {
  const ids = slots.map((x) => x.slot);
  expect(new Set(ids).size).toBe(ids.length);
  ids.forEach((id) => {
    expect(id.startsWith('g4.maths.')).toBe(true);
    expect(id.split('.').pop()).not.toMatch(/^Q\d/);
  });
  expect(slots.map((x) => x.label_en)).toEqual(slots.map((_, i) => 'Q' + (i + 1) + '.'));
});

test('choice slots say so, every slot has a precise prompt_rule, no pictures', () => {
  slots.forEach((x) => {
    expect(x.prompt_rule.length).toBeGreaterThan(60);
    if (x.attempt < x.generate) expect(x.instruction_en || x.instruction_ur).toBeTruthy();
    ['picture', 'picture_only', 'frame'].forEach((k) => expect(x[k] || null).toBeNull());
  });
  expect(S.oral).toBeNull();
  expect(JSON.stringify(S)).not.toMatch(/\u2192|->/);
});

test('word-problem cap holds: 2 items, 5 marks, 10%', () => {
  expect(checkCap(S)).toEqual([]);
  expect(wordProblemLoad(S)).toEqual({ items: 2, marks: 5, share: 10 });
  expect(S.word_problem_cap).toEqual({ items: 2, marks: 5 });
  const wp = slots.find((x) => x.slot === 'g4.maths.B.word_problem');
  expect(wp.word_problems).toBe(wp.generate);
});

test('every non-word-problem slot forbids a story and Section C slots carry no kinds', () => {
  slots.filter((x) => !x.slot.endsWith('.word_problem')).forEach((x) => {
    expect(x.prompt_rule).toMatch(/No story or word problem: bare numbers and figures-free wording only\.$/);
    expect(x.word_problems).toBe(0);
  });
  S.sections.find((x) => x.id === 'C').slots.forEach((x) => expect(x.kinds).toBeNull());
  slots.filter((x) => x.marks_each === 5).forEach((x) => expect(x.prompt_rule).toMatch(/M 1|Scheme/));
});
