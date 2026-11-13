/**
 * bd-ipoxhx.8 — ICT Feedback, Assessment Generator row 27 (Rabia, point 5):
 * "Questions requiring multiple responses … should carry appropriate marks rather than having a
 * fixed one-mark allocation."
 *
 * An objective question still earns 1 mark per response, but a question that asks for several
 * responses now earns one mark for each: every correct option of an MSQ, every blank in a
 * fill-in, every item a "give two…" stem asks for.
 */

const { standardMarks } = require('../../bot/shared/services/assessment/standard-marks');

const one = (type, q, category = 'objective') => {
  const exam = { unseen: { [category]: { [type]: [q] } } };
  standardMarks(exam);
  return q.marks;
};

describe('standardMarks — one mark per required response', () => {
  test('an MSQ with two correct options is worth 2 marks', () => {
    expect(one('MSQs', { question: 'Pick the mammals.', options: ['a) Cow', 'b) Fish', 'c) Goat', 'd) Crow'], answer: 'a) Cow, c) Goat', marks: 1 })).toBe(2);
  });

  test('an MSQ whose answer is a list counts the list', () => {
    expect(one('MSQs', { question: 'Pick', options: ['a', 'b', 'c', 'd'], answer: ['a', 'b', 'd'] })).toBe(3);
  });

  test('an MSQ answered by letters only counts the letters', () => {
    expect(one('MSQs', { question: 'Pick', options: ['a) 2', 'b) 3', 'c) 4', 'd) 9'], answer: 'a, c' })).toBe(2);
  });

  test('an MSQ never earns more marks than it has options, and one answer stays 1', () => {
    expect(one('MSQs', { question: 'Pick', options: ['a) Red', 'b) Blue'], answer: 'a) Red, b) Blue, c) Pink' })).toBe(2);
    expect(one('MSQs', { question: 'Pick', options: ['a) Red', 'b) Blue', 'c) Pink'], answer: 'b) Blue' })).toBe(1);
  });

  test('a fill-in with three blanks is worth 3 marks; one blank stays 1', () => {
    expect(one('Fill in the Blanks', { question: 'Plants need ____, ____ and ______ to grow.', answer: 'water, sunlight, air', marks: 1 })).toBe(3);
    expect(one('Fill in the Blanks', { question: 'The sun rises in the ______.', answer: 'east' })).toBe(1);
  });

  test('a "give two…" objective stem earns one mark per item asked for', () => {
    expect(one('Short Answer', { question: 'Give two examples of living things.', answer: 'cat, tree' })).toBe(2);
    expect(one('One Word Answer', { question: 'Name three planets.', answer: 'Earth, Mars, Venus' })).toBe(3);
    expect(one('One Word Answer', { question: 'Write 2 uses of water.', answer: 'drinking, washing' })).toBe(2);
  });

  test('an MCQ stays 1 mark even when its stem says "two"', () => {
    expect(one('MCQs', { question: 'Which animal has two legs?', options: ['a) Hen', 'b) Cow'], answer: 'a) Hen', marks: 3 })).toBe(1);
  });

  test('no objective question goes above 5 marks', () => {
    expect(one('Fill in the Blanks', { question: '__ __ __ __ __ __ __ __', answer: 'x' })).toBe(5);
  });
});
