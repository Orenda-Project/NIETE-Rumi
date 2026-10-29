/** Grade 3 Urdu, FDE end-of-chapter paper (bd-5jmnfj.33.1): DECISIONS section 4, Class 3. */
const { checkSubject } = require('./fde-mid-g3-spec');
const S = require('../../bot/shared/services/assessment/patterns/mid/g3-urdu');

checkSubject(S, {
  key: 'urdu', medium: 'ur', tos: { Remember: 40, Understand: 30, Apply: 30 }, gen: 36,
  sections: [
    { id: 'A', marks: 10, slots: [['mcq', 10, 10, 1]] },
    { id: 'B', marks: 25, slots: [['short', 7, 5, 2], ['meanings', 5, 5, 1], ['grammar', 5, 5, 2]] },
    { id: 'C', marks: 15, slots: [['sentences', 5, 5, 1], ['letter', 2, 1, 5], ['essay', 2, 1, 5]] },
  ],
});

const slots = S.sections.flatMap((s) => s.slots);

test('Urdu is the medium and every prompt rule forbids religious text', () => {
  expect(S.medium).toBe('ur');
  slots.forEach((s) => expect(s.prompt_rule).toMatch(/no religious/i));
});

test('Urdu instructions are Urdu script, MCQ options are Urdu-labelled, choice says کوئی سے ایک', () => {
  slots.forEach((s) => expect(s.instruction_ur).toMatch(/[؀-ۿ]/));
  expect(slots[0].option_labels).toBe('ur');
  const by = Object.fromEntries(slots.map((s) => [s.slot.split('.').pop(), s]));
  expect(by.short.instruction_ur).toContain('کوئی سے پانچ');
  expect(by.letter.instruction_ur).toContain('کوئی سے ایک');
  expect(by.essay.instruction_ur).toContain('کوئی سے ایک');
});

test('letter and essay ask secular everyday topics', () => {
  const by = Object.fromEntries(slots.map((s) => [s.slot.split('.').pop(), s]));
  expect(by.letter.prompt_rule).toMatch(/everyday/i);
  expect(by.essay.prompt_rule).toMatch(/everyday/i);
});
