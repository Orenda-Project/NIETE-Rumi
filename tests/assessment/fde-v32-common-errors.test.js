/**
 * bd-5jmnfj.33.3 — two multiplication common errors the v31 check left as written.
 *  G3 Maths Q5 i "Use the multiplication 27 x 4 … giving 44 as the product": the slip that drops the
 *  carry gives 88. The check read the answer's own working step "2 x 4 = 8" as the multiplication
 *  (fde-common-error-check.js mulAt took the answer before the stem), so it saw no carry and left 44.
 *  G3 Maths Q2 iv "Multiply: 92 x 4 … Forgetting to carry, giving 3608": 92 x 4 has no carry, so
 *  there is no such slip and the error is blanked (the renderer prints nothing for an empty one).
 * Run through mathsCheck as the writer runs it on a board-pattern paper.
 */

const { mathsCheck } = require('../../bot/shared/services/assessment/maths-check');

const paper = (q) => ({ _layout: { subject: 'Maths', sections: [] }, unseen: { subjective: { 'Short Response': [q] } } });
const run = (q) => mathsCheck(paper(q)).examJson.unseen.subjective['Short Response'][0].scheme.common_error;
const errorOf = (question, answer, common_error) => run({
  slot: 'g3.maths.B.short', marks: 5, question, answer,
  scheme: { accept: [answer], points: [], checked: null, common_error },
});

test('G3 Maths Q5 i: the stem\'s 27 x 4 is the multiplication, not the answer\'s step 2 x 4, so 44 becomes 88', () => {
  const q = {
    slot: 'g3.maths.C.extended', marks: 5,
    main_question: 'Answer any 2 of the 3 questions. Each question has parts (a), (b) and (c).',
    question: 'Use the multiplication 27 x 4.\n(a) Write 27 x 4 as an addition sentence.\n(b) Find the product of 27 x 4.\n(c) Write the multiplication sentence with the numbers in the other order and give its product.',
    answer: '(a) 27 + 27 + 27 + 27 = 108. (b) 7 ones x 4 = 28 ones, write 8 and carry 2; 2 x 4 = 8, plus 2 = 10 so the product is 108. (c) 4 x 27 = 108, so the product stays the same.',
    questions: null,
    scheme: {
      points: [{ text: 'A correct method for writing repeated addition and for multiplying', marks: 2, kind: 'M' }],
      accept: ['27 x 4 worked as 20 x 4 + 7 x 4 = 80 + 28 = 108'], checked: null,
      common_error: 'Forgetting to add the carried amount, giving 44 as the product, or writing 4 + 27 for the addition sentence.',
    },
  };
  expect(run(q)).toBe('Forgetting to add the carried amount, giving 88 as the product, or writing 4 + 27 for the addition sentence.');
});

test('G3 Maths Q2 iv: 92 x 4 carries nothing, so "Forgetting to carry, giving 3608" is blanked', () => {
  expect(errorOf('Multiply: 92 x 4', '368', 'Forgetting to carry, giving 3608')).toBe('');
});

test('a real carry slip is still rewritten to the figure the slip gives (v31 cases hold)', () => {
  expect(errorOf('Multiply: 58 x 7', '406', 'Forgetting to add the carried 5 tens, giving 351')).toBe('Forgetting to add the carried 5 tens, giving 356');
  expect(errorOf('Multiply: 4,275 x 8', '34,200', 'Forgetting to add the carried digit, giving 33,600')).toBe('Forgetting to add the carried digit, giving 33,600');
});

test('an error on a stem with no multiplication is left alone', () => {
  expect(errorOf('Add: 92 + 4', '96', 'Forgetting to carry, giving 86')).toBe('Forgetting to carry, giving 86');
});
