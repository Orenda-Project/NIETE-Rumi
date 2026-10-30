/**
 * bd-5jmnfj.33.7.1 v38 BLOCKER — G3 Maths ch3 Q1 iv asked «Which multiplication sentence has the same answer as
 * 6 x 5?» and keyed the bare number «30»; Q1 v asked for an addition sentence and keyed «24». The stem asks for a
 * sentence (an operation), so a keyed option with no operation sign answers a different question.
 */

const { mcqStemShortfall, mcqStemNote } = require('../../bot/shared/services/assessment/fde-mcq-stem');

const P = { g5_rules: false };
const exam = (items) => ({ _layout: { subject: 'Maths', sections: [] }, unseen: { objective: { MCQs: items } } });
const mcq = (question, options, answer) => ({ slot: 'g3.maths.A.mcq', question, options, answer, marks: 1 });

describe('an MCQ that asks for a number sentence keys a sentence', () => {
  test('v38 Q1 iv: a multiplication sentence keyed as a bare number is flagged', () => {
    const q = mcq('Which multiplication sentence has the same answer as 6 x 5?', ['a) 30', 'b) 5 x 5', 'c) 6 x 6'], 'a) 30');
    const flags = mcqStemShortfall(exam([q]), P);
    expect(flags).toHaveLength(1);
    expect(flags[0].why).toEqual(['sentence_not_keyed']);
    expect(mcqStemNote(flags)).toMatch(/sentence/);
  });

  test('v38 Q1 v: an addition sentence keyed as a bare number is flagged', () => {
    const q = mcq('Which addition sentence is the same as 8 x 3?', ['a) 8 + 3', 'b) 24', 'c) 8 + 8 + 8 + 8'], 'b) 24');
    expect(mcqStemShortfall(exam([q]), P)[0].why).toEqual(['sentence_not_keyed']);
  });

  test('a sentence keyed as a sentence is not flagged', () => {
    const q = mcq('Which addition sentence is the same as 8 x 3?', ['a) 8 + 3', 'b) 8 + 8 + 8', 'c) 8 + 8 + 8 + 8'], 'b) 8 + 8 + 8');
    expect(mcqStemShortfall(exam([q]), P)).toEqual([]);
  });

  test('a stem that asks for a number is not flagged', () => {
    const q = mcq('What is 6 x 5?', ['a) 30', 'b) 25', 'c) 36'], 'a) 30');
    expect(mcqStemShortfall(exam([q]), P)).toEqual([]);
  });
});
