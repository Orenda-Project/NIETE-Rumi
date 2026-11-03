/**
 * G5 Maths: an MCQ that uses the fractions a later compare or order item uses (bd-5jmnfj.4.58.4). v28 Q1 (a) xii
 * "Which fraction is the greatest?" with 3/4, 2/3, 3/5, 5/8 (key 3/4) settled part of Q1 (b) iii "Compare 2/3 and 3/5" and
 * of Q2 vii "Arrange 2/3, 5/8 and 3/4 from the greatest to the smallest" (key 3/4 > 2/3 > 5/8).
 * Two compare, order or greatest/smallest items sharing two or more fractions: the MCQ's slot is flagged (its section is
 * the cheapest to ask again); between two written items the later one.
 */

const { fractionGiveaways } = require('../../bot/shared/services/assessment/fde-fraction-giveaway');
const { answerRepeats } = require('../../bot/shared/services/assessment/fde-answer-repeats');
const Patterns = require('../../bot/shared/services/assessment/patterns');
const maths = require('./fixtures/fde-v29-g5-maths.json');
const science = require('./fixtures/fde-v29-g5-science.json');
const english = require('./fixtures/fde-v29-g5-english.json');
const urdu = require('./fixtures/fde-v29-g5-urdu.json');

const paper = (list) => ({
  unseen: { x: { y: list } },
  _layout: { sections: [{ slots: [...new Set(list.map((q) => q.slot))].map((slot) => ({ slot, type: 'y' })) }] },
});
const q = (slot, question, extra = {}) => ({ slot, question, answer: 'a', ...extra });
const GREATEST = q('maths.A.Q1a', 'Which fraction is the greatest?', { options: ['a) 3/4', 'b) 2/3', 'c) 3/5', 'd) 5/8'], answer: 'a) 3/4' });

describe('the real v28 G5 Maths paper', () => {
  const f = fractionGiveaways(maths);

  test('Q1 (a) xii is flagged against Q1 (b) iii and Q2 vii, once', () => {
    expect(f.map((x) => x.slot)).toEqual(['maths.A.Q1a']);
    expect(f[0]).toMatchObject({ reason: 'giveaway', printed: true });
    expect(f[0].with).toEqual(expect.arrayContaining(['maths.A.Q1b', 'maths.B.Q2']));
    expect(f[0].words).toEqual(expect.arrayContaining(['3/4', '2/3', '3/5', '5/8']));
  });

  test('it reaches the re-ask path through answerRepeats', () => {
    expect(answerRepeats(maths).map((x) => x.slot)).toContain('maths.A.Q1a');
  });
});

describe('what counts', () => {
  test('an MCQ sharing one fraction with an order item is not a give-away', () => {
    const p = paper([q('maths.A.Q1a', 'Which fraction is the smallest?', { options: ['a) 1/2', 'b) 3/4', 'c) 7/8', 'd) 5/6'], answer: 'a) 1/2' }), q('maths.B.Q2', 'Arrange 3/4, 2/5 and 3/10 from the smallest to the greatest.')]);
    expect(fractionGiveaways(p)).toEqual([]);
  });

  test('two written items sharing two fractions flag the later one', () => {
    const p = paper([q('maths.A.Q1b', 'Compare 2/3 and 3/5.'), q('maths.B.Q2', 'Arrange 3/5, 2/3 and 1/2 from the greatest to the smallest.')]);
    const f = fractionGiveaways(p);
    expect(f.map((x) => x.slot)).toEqual(['maths.B.Q2']);
    expect(f[0].with).toEqual(['maths.A.Q1b']);
  });

  test('the same fractions in a sum, not a compare, are not a give-away', () => {
    const p = paper([GREATEST, q('maths.B.Q2', 'Add 3/4 and 2/3. Write the answer in simplest form.')]);
    expect(fractionGiveaways(p)).toEqual([]);
  });

  test('items of one slot are not compared with each other', () => {
    const p = paper([q('maths.B.Q2', 'Compare 2/3 and 3/5.'), q('maths.B.Q2', 'Arrange 3/5, 2/3 and 1/2 from the greatest to the smallest.')]);
    expect(fractionGiveaways(p)).toEqual([]);
  });

  test('"2 / 3" with spaces is the same fraction', () => {
    const p = paper([GREATEST, q('maths.B.Q2', 'Arrange 3 / 4, 2 / 3 and 7/9 from the greatest to the smallest.')]);
    expect(fractionGiveaways(p).map((x) => x.slot)).toEqual(['maths.A.Q1a']);
  });

  test('no paper, no flags', () => {
    expect(fractionGiveaways(null)).toEqual([]);
    expect(fractionGiveaways({})).toEqual([]);
  });
});

describe('the other Grade 5 papers are not hit', () => {
  test.each([['science', science], ['english', english], ['urdu', urdu]])('%s', (_n, p) => { expect(fractionGiveaways(p)).toEqual([]); });
});

describe('G5 Maths prompt rules', () => {
  const rule = (slot) => Patterns.subjectOf('fde_g5_2027', 'maths').sections.flatMap((s) => s.slots).find((s) => s.slot === slot).prompt_rule;
  test('Q1 (a): an MCQ never uses the numbers or fractions a later compare, order or arrange item uses', () => {
    expect(rule('maths.A.Q1a')).toMatch(/An MCQ never uses the numbers or fractions that a later compare, order or arrange item uses/);
  });
  test('Q1 (b) and Q2: compare, order and arrange items use fractions no Section A MCQ offers', () => {
    expect(rule('maths.A.Q1b')).toMatch(/fractions no Section A MCQ offers/);
    expect(rule('maths.B.Q2')).toMatch(/fractions no Section A MCQ offers/);
  });
});
