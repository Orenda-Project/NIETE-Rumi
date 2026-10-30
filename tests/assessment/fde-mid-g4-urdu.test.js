/**
 * Grade 4 urdu mid-term (end-of-chapter) pattern (bd-5jmnfj.33.1): DECISIONS.md section 4.
 */

const S = require('../../bot/shared/services/assessment/patterns/mid/g4-urdu');
const { checkCap, wordProblemLoad } = require('../../bot/shared/services/assessment/patterns/mid/word-problems');

const slots = S.sections.flatMap((x) => x.slots);
const DESIGN = [["A",10,[["mcq",10,10,1]]],["B",25,[["short",7,5,2],["meanings",5,5,1],["grammar",5,5,2]]],["C",15,[["sentences",5,5,1],["letter",2,1,5],["essay",2,1,5]]]];

test('key, medium, total and tos', () => {
  expect(S.key).toBe('urdu');
  expect(S.medium).toBe('ur');
  expect(S.grade).toBe(4);
  expect(S.total_marks).toBe(50);
  expect(S.tos).toEqual({"Remember":27,"Understand":30,"Apply":43});
  expect(S.g5_rules).toBe(false);
});

test('sections, slots, generate, attempt and marks are as designed', () => {
  expect(S.sections.map((x) => [x.id, x.marks])).toEqual(DESIGN.map((d) => [d[0], d[1]]));
  DESIGN.forEach(([id, marks, list]) => {
    const sec = S.sections.find((x) => x.id === id);
    expect(sec.slots.map((x) => [x.slot, x.generate, x.attempt, x.marks_each])).toEqual(
      list.map(([n, g, a, m]) => ['g4.urdu.' + id + '.' + n, g, a, m]));
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

test('slot ids are unique, start g4.urdu., end in a name, labels run Q1..', () => {
  const ids = slots.map((x) => x.slot);
  expect(new Set(ids).size).toBe(ids.length);
  ids.forEach((id) => {
    expect(id.startsWith('g4.urdu.')).toBe(true);
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

test('Urdu medium, Urdu instructions, and the rules forbid religious text', () => {
  expect(S.medium).toBe('ur');
  slots.forEach((x) => expect(x.instruction_ur).toMatch(/[\u0600-\u06FF]/));
  slots.forEach((x) => expect(x.prompt_rule).toMatch(/[Nn]o religious text/));
});

// v40 round-6 (bd-5jmnfj.33.7.1): Q6 and Q7 paid opening, closing, points, order, language and spelling that the printed instructions never asked for.
test('Q6 and Q7 instructions ask in words for what their schemes pay', () => {
  const by = Object.fromEntries(slots.map((s) => [s.slot.split('.').pop(), s]));
  expect(by.letter.instruction_ur).toBe('کوئی سا ایک خط یا درخواست لکھیں۔ آغاز اور اختتام درست طریقے سے لکھیں اور زبان و املا کا خیال رکھیں۔');
  expect(by.essay.instruction_ur).toBe('کوئی سا ایک مضمون لکھیں۔ کم از کم تین باتیں ترتیب سے لکھیں اور زبان و املا کا خیال رکھیں۔');
  expect(by.essay.prompt_rule).toContain('Scheme (5): three different points about the topic 3 (1 each), order of ideas 1, language and spelling 1.');
});
