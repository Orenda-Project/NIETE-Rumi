/** Grade 3 General Knowledge (Urdu medium), FDE end-of-chapter paper (bd-5jmnfj.33.1): DECISIONS section 4, Class 3. */
const { checkSubject } = require('./fde-mid-g3-spec');
const S = require('../../bot/shared/services/assessment/patterns/mid/g3-general-knowledge');

checkSubject(S, {
  key: 'general_knowledge', medium: 'ur', tos: { Remember: 41, Understand: 41, Apply: 18 }, gen: 30,
  sections: [
    { id: 'A', marks: 25, slots: [['mcq', 5, 5, 2], ['match', 5, 5, 1], ['fill', 10, 10, 1]] },
    { id: 'B', marks: 25, slots: [['short', 7, 5, 3], ['long', 3, 2, 5]] },
  ],
});

const by = Object.fromEntries(S.sections.flatMap((s) => s.slots).map((s) => [s.slot.split('.').pop(), s]));

test('GK shapes: mcq, match, fill in the blanks are objective; short and long are not', () => {
  expect(by.mcq.shape).toBe('mcq');
  expect(by.match.shape).toBe('match');
  expect(by.fill.type).toBe('Fill in the Blanks');
  ['mcq', 'match', 'fill'].forEach((k) => expect(by[k].category).toBe('objective'));
  ['short', 'long'].forEach((k) => expect(by[k].category).toBe('subjective'));
});

test('every GK prompt rule forbids religious content and says Islamiat is a separate subject', () => {
  Object.values(by).forEach((s) => expect(s.prompt_rule).toMatch(/no religious/i));
  expect(by.long.prompt_rule).toMatch(/Islamiat/);
});

test('GK choice instructions are Urdu: any 5 of 7, any 2 of 3', () => {
  expect(by.short.instruction_ur).toContain('کوئی سے پانچ');
  expect(by.long.instruction_ur).toContain('کوئی سے دو');
});

test('GK written items never have their key printed by an objective item, and Q5 never repeats Q4', () => {
  ['short', 'long'].forEach((k) => expect(by[k].prompt_rule).toMatch(/No key point is printed on the paper as an MCQ key or option, a match pair, or a blank sentence or box word/));
  expect(by.long.prompt_rule).toMatch(/never asks for the facts or examples a short question asks/);
});
