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

// v39 round-6 panel (bd-5jmnfj.33.7.1): the essay key paid three points and their order, which the printed Q7 instruction never asked for.
test('Q7 instruction asks in words for the three points and their order that its scheme pays', () => {
  const essay = slots.find((s) => s.slot === 'g3.urdu.C.essay');
  expect(essay.instruction_ur).toBe('کوئی سے ایک موضوع پر مضمون لکھیں۔ کم از کم تین باتیں ترتیب سے لکھیں اور زبان و املا کا خیال رکھیں۔');
  expect(essay.prompt_rule).toContain('Scheme (5): three different points about the topic 3 (1 each), order of ideas 1, language and spelling 1.');
});

// v40 round-6 (bd-5jmnfj.33.7.1): Q6 paid format, closing, language and spelling that its printed instruction never asked for.
test('Q6 instruction asks in words for the opening, closing, language and spelling its scheme pays', () => {
  const letter = slots.find((s) => s.slot === 'g3.urdu.C.letter');
  expect(letter.instruction_ur).toBe('کوئی سے ایک خط یا درخواست لکھیں۔ آغاز اور اختتام درست طریقے سے لکھیں اور زبان و املا کا خیال رکھیں۔');
});
