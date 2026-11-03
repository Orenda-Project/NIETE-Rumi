/**
 * The near-repeat detector reads shared content words between two items as one giving the other away. Two
 * Grade 5 maths items that share only their instruction ("Find the value ... write the answer in its simplest
 * form") are not a give-away, and each false pair costs a re-ask round (bd-5jmnfj.4.58.3). The stop list grows
 * by the instruction words of a maths paper; a real repeat is still caught.
 */

const { nearRepeats } = require('../../bot/shared/services/assessment/fde-near-repeats');

const paper = (byType, slots) => ({
  unseen: { subjective: byType },
  _layout: { sections: [{ id: 'B', slots: slots.map(([slot, type]) => ({ slot, type })) }] },
});

test('two maths items sharing only instruction words are not a give-away', () => {
  const p = paper({
    'Word Problems': [
      { slot: 'maths.B.Q2', question: 'Find the value of the following and write the answer in its simplest form: 3/4 + 1/8.', answer: '7/8' },
      { slot: 'maths.B.Q2', question: 'Solve the following and show your working. Write the number 4,560,218 in words.', answer: 'Four million, five hundred sixty thousand, two hundred eighteen' },
    ],
    'Short Questions': [
      { slot: 'maths.C.Q7', question: 'Find the value of the following and write the answer in its simplest form: 2/3 × 3/5.', answer: '2/5' },
      { slot: 'maths.C.Q7', question: 'Find the correct number and show your working: 25% of 480.', answer: '120' },
    ],
  }, [['maths.B.Q2', 'Word Problems'], ['maths.C.Q7', 'Short Questions']]);
  expect(nearRepeats(p)).toEqual([]);
});

test('a real repeat is still caught', () => {
  const p = paper({
    MCQs: [{ slot: 'science.A.Q1a', question: 'Which gas do green plants take in from the air to make their food?', options: ['a) Oxygen', 'b) Carbon dioxide', 'c) Nitrogen', 'd) Hydrogen'], answer: 'b) Carbon dioxide' }],
    'Short Questions': [{ slot: 'science.C.Q3a', question: 'Name the gas green plants take in from the air to make their food.', answer: 'Carbon dioxide' }],
  }, [['science.A.Q1a', 'MCQs'], ['science.C.Q3a', 'Short Questions']]);
  expect(nearRepeats(p).map((f) => f.slot)).toEqual(['science.C.Q3a']);
});
