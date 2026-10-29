/** Grade 3 English, FDE end-of-chapter paper (bd-5jmnfj.33.1): DECISIONS section 4, Class 3. */
const { checkSubject } = require('./fde-mid-g3-spec');
const S = require('../../bot/shared/services/assessment/patterns/mid/g3-english');

checkSubject(S, {
  key: 'english', medium: 'en', tos: { Remember: 30, Understand: 30, Apply: 40 }, gen: 34,
  sections: [
    { id: 'A', marks: 20, slots: [['mcq', 10, 10, 1], ['grammar', 5, 5, 2]] },
    { id: 'B', marks: 15, slots: [['short', 5, 5, 2], ['sentences', 5, 5, 1]] },
    { id: 'C', marks: 15, slots: [['paragraph', 2, 1, 5], ['invitation', 2, 1, 5], ['present_continuous', 5, 5, 1]] },
  ],
});

test('English shapes: MCQ is mcq, the rest subjective, the choice slots are any 1 of 2', () => {
  const by = Object.fromEntries(S.sections.flatMap((s) => s.slots).map((s) => [s.slot.split('.').pop(), s]));
  expect(by.mcq.shape).toBe('mcq');
  expect(by.grammar.category).toBe('subjective');
  expect(by.paragraph.instruction_en).toMatch(/any one/i);
  expect(by.invitation.instruction_en).toMatch(/any one/i);
  expect(by.grammar.prompt_rule).toMatch(/do as directed|as directed/i);
  expect(by.present_continuous.prompt_rule).toMatch(/present continuous/i);
});
