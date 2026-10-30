/** Grade 3 Maths, FDE end-of-chapter paper (bd-5jmnfj.33.1): DECISIONS section 4, Class 3 and section 3 cap. */
const { checkSubject } = require('./fde-mid-g3-spec');
const S = require('../../bot/shared/services/assessment/patterns/mid/g3-maths');
const { checkCap, wordProblemLoad } = require('../../bot/shared/services/assessment/patterns/mid/word-problems');

checkSubject(S, {
  key: 'maths', medium: 'en', tos: { Remember: 20, Understand: 50, Apply: 30 }, gen: 22,
  sections: [
    { id: 'A', marks: 20, slots: [['mcq', 10, 10, 1], ['directed', 5, 5, 2]] },
    { id: 'B', marks: 20, slots: [['short', 3, 3, 5], ['word_problem', 1, 1, 5]] },
    { id: 'C', marks: 10, slots: [['extended', 3, 2, 5]] },
  ],
});

const slots = S.sections.flatMap((s) => s.slots);
const wp = slots.find((s) => s.slot.endsWith('.word_problem'));

test('cap is 1 item / 5 marks and the paper is within it: 1 item, 5 marks, 10%', () => {
  expect(S.word_problem_cap).toEqual({ items: 1, marks: 5 });
  expect(checkCap(S)).toEqual([]);
  expect(wordProblemLoad(S)).toEqual({ items: 1, marks: 5, share: 10 });
});

test('only the word-problem slot has word_problems, equal to its generate, and it is compulsory', () => {
  slots.forEach((s) => expect(s.word_problems).toBe(s === wp ? s.generate : 0));
  expect(wp.word_problems).toBe(1);
  expect(wp.compulsory).toBe(true);
});

test('every other slot forbids a story, section C has no kinds, 5-mark items state a mark scheme', () => {
  slots.filter((s) => s !== wp).forEach((s) => {
    expect(s.prompt_rule.endsWith('No story or word problem: bare numbers and figures-free wording only.')).toBe(true);
  });
  S.sections.find((s) => s.id === 'C').slots.forEach((s) => expect(s.kinds).toBeNull());
  slots.filter((s) => s.marks_each === 5).forEach((s) => expect(s.prompt_rule).toMatch(/Scheme:/));
});

// v39 round-6 panel (bd-5jmnfj.33.7.1): the key paid a number sentence and a unit the printed Q4 instruction never asked for.
test('Q4 instruction asks in words for every part its scheme pays: number sentence, working, answer with unit', () => {
  expect(wp.instruction_en).toBe('Solve the word problem. Write the number sentence, show your working and write the answer with its unit.');
});

// v40 round-6 panel (bd-5jmnfj.33.7.1): Q3 stems said "using the vertical method" while the key paid partitioning too.
test('every 5-mark scheme forbids a stem that prescribes the method', () => {
  slots.filter((s) => s.marks_each === 5).forEach((s) => expect(s.prompt_rule).toContain('No stem prescribes the method; the key pays any correct method.'));
});
