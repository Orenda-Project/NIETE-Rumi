/**
 * G1 English Q9 (bd-5jmnfj.4.38). v17 printed "Pinky likes to ___ in the park" keyed
 * "paint": play and run fit just as well. Each sentence must leave only one word.
 */

const Patterns = require('../../bot/shared/services/assessment/patterns');

const q9 = Patterns.get('fde_g1_2026').subjects.english.sections.flatMap((s) => s.slots).find((s) => s.slot === 'g1.english.B.Q9');

test('the rule says only one word from the box fits each blank', () => {
  expect(q9.prompt_rule).toMatch(/only one word from the box fits/i);
  expect(q9.prompt_rule).toMatch(/rules out every other word/i);
});
