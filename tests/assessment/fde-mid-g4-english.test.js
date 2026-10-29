/**
 * Grade 4 english mid-term (end-of-chapter) pattern (bd-5jmnfj.33.1): DECISIONS.md section 4.
 */

const S = require('../../bot/shared/services/assessment/patterns/mid/g4-english');
const { checkCap, wordProblemLoad } = require('../../bot/shared/services/assessment/patterns/mid/word-problems');

const slots = S.sections.flatMap((x) => x.slots);
const DESIGN = [["A",20,[["mcq",10,10,1],["grammar",5,5,2]]],["B",15,[["short",6,5,2],["sentences",6,5,1]]],["C",15,[["letter",2,1,5],["paragraph",2,1,5],["syllables",5,5,1]]]];

test('key, medium, total and tos', () => {
  expect(S.key).toBe('english');
  expect(S.medium).toBe('en');
  expect(S.grade).toBe(4);
  expect(S.total_marks).toBe(50);
  expect(S.tos).toEqual({"Remember":30,"Understand":30,"Apply":40});
  expect(S.g5_rules).toBe(false);
});

test('sections, slots, generate, attempt and marks are as designed', () => {
  expect(S.sections.map((x) => [x.id, x.marks])).toEqual(DESIGN.map((d) => [d[0], d[1]]));
  DESIGN.forEach(([id, marks, list]) => {
    const sec = S.sections.find((x) => x.id === id);
    expect(sec.slots.map((x) => [x.slot, x.generate, x.attempt, x.marks_each])).toEqual(
      list.map(([n, g, a, m]) => ['g4.english.' + id + '.' + n, g, a, m]));
  });
  expect(slots.reduce((n, x) => n + x.generate, 0)).toBe(36);
});

test('levels sum to each section and sit within 5 marks of the tos', () => {
  S.sections.forEach((x) => expect(Object.values(x.levels).reduce((a, b) => a + b, 0)).toBe(x.marks));
  ['Remember', 'Understand', 'Apply'].forEach((b) => {
    const got = S.sections.reduce((n, x) => n + x.levels[b], 0);
    expect(Math.abs(got - S.tos[b] / 2)).toBeLessThanOrEqual(5);
  });
});

test('slot ids are unique, start g4.english., end in a name, labels run Q1..', () => {
  const ids = slots.map((x) => x.slot);
  expect(new Set(ids).size).toBe(ids.length);
  ids.forEach((id) => {
    expect(id.startsWith('g4.english.')).toBe(true);
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
