/**
 * G5 Maths items that repeat or hand each other answers (bd-5jmnfj.4.58 round 4). v29: the mean asked in Q1 (b) ix and Q7;
 * 35% as a decimal asked in Q1 (b) viii and Q2 x with the same key 0.35; Q1 (a) iii (a right angle is 90) hands Q8 its
 * first mark and Q1 (a) ix (a straight angle is 180) hands Q4 iii its pair.
 */
const { mathsRepeats } = require('../../bot/shared/services/assessment/fde-maths-repeats');
const { paperGiveaways } = require('../../bot/shared/services/assessment/fde-g5-paper-giveaways');
const exam = require('./fixtures/fde-v34-g5-maths-v29.json');

const flags = mathsRepeats(exam);
const of = (word) => flags.filter((f) => f.words.includes(word));

describe('the real v29 G5 Maths paper', () => {
  test('the mean is asked once: the second ask is flagged', () => {
    expect(of('the mean').map((f) => f.slot)).toEqual(['maths.C.Q4-8']);
  });

  test('35% as a decimal, with the key 0.35, is asked once', () => {
    const f = of('0.35');
    expect(f.map((x) => x.slot)).toEqual(['maths.B.Q2']);
    expect(f[0].with).toEqual(['maths.A.Q1b']);
  });

  test('a right angle is 90 and a straight angle is 180 are not handed to Q8 and Q4', () => {
    const f = of('90 degrees').concat(of('180 degrees'));
    expect(f.map((x) => x.slot)).toEqual(['maths.A.Q1a', 'maths.A.Q1a']);
    expect(f.flatMap((x) => x.with).sort()).toEqual(['maths.C.Q4-8', 'maths.C.Q4-8']);
  });

  test('flags carry the shape fde-answer-repeats reads', () => {
    flags.forEach((x) => expect(x).toEqual({ slot: expect.any(String), reason: 'giveaway', words: expect.any(Array), with: expect.any(Array), text: expect.any(Array), printed: true }));
  });

  test('paperGiveaways includes them', () => {
    expect(paperGiveaways(exam).some((x) => x.words.includes('the mean'))).toBe(true);
  });
});

describe('small papers', () => {
  const paper = (list) => ({ unseen: { x: { y: list } }, _layout: { sections: [{ slots: [...new Set(list.map((q) => q.slot))].map((slot) => ({ slot, type: 'y' })) }] } });
  const w = (slot, question, answer, extra = {}) => ({ slot, question, answer, ...extra });

  test('one mean, one decimal, no angle fact: nothing to flag', () => {
    expect(mathsRepeats(paper([w('maths.A.Q1b', 'Find the mean of 4, 6 and 8.', '6'), w('maths.B.Q2', 'Write 35% as a decimal.', '0.35')]))).toEqual([]);
  });

  test('the average counts as the mean', () => {
    const f = mathsRepeats(paper([w('maths.A.Q1b', 'Find the mean of 4, 6 and 8.', '6'), w('maths.C.Q7', 'Find the average of 5, 7 and 9.', '7')]));
    expect(f.map((x) => x.slot)).toEqual(['maths.C.Q7']);
  });

  test('a decimal with one place shared by two items is fine', () => {
    expect(mathsRepeats(paper([w('maths.A.Q1b', 'Convert 4/5 to a decimal.', '0.8'), w('maths.B.Q2', 'Convert 8/10 to a decimal.', '0.8')]))).toEqual([]);
  });

  test('not maths, no paper', () => {
    expect(mathsRepeats(null)).toEqual([]);
    expect(mathsRepeats(paper([w('science.A.Q1a', 'mean mean', 'average')]))).toEqual([]);
  });
});
