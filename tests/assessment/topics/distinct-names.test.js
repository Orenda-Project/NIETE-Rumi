'use strict';
/** Task 3 fix round 1 — topics in one chapter never share a name. */
const { distinctNames } = require('../../../bot/shared/services/assessment/topics/distinct-names');

const topic = (name, statement) => ({ name, sloCodes: statement ? ['X'] : [], sloDescriptions: statement ? [statement] : [] });

describe('distinctNames', () => {
  test('names that already differ are kept', () => {
    expect(distinctNames([topic('A'), topic('B')])).toEqual(['A', 'B']);
  });

  test('colliding SLO topics are renamed from the part of their statements that differs (real G1 Maths Ch9)', () => {
    const name = "Read and write time in hours (o'clock)";
    expect(distinctNames([
      topic(name, "I can read and write time in hours (o'clock) from analogue clock."),
      topic('Other'),
      topic(name, "I can read and write time in hours (o'clock) from digital clock."),
    ])).toEqual(['Read and write: analogue clock', 'Other', 'Read and write: digital clock']);
  });

  test('three colliding statements (real G5 Maths Ch8) stay within 40 code points', () => {
    const name = 'Use unitary method to calculate the';
    const out = distinctNames([
      topic(name, 'I can use unitary method to calculate the value of many objects of the same kind when the value of one is given .'),
      topic(name, 'I can use unitary method to calculate the value of one object when value of many is given.'),
      topic(name, 'I can use unitary method to calculate the value of many objects when value of some is given (including related real-world problems).'),
    ]);
    expect(out).toEqual([
      'Use unitary method: many objects of the',
      'Use unitary method: one object when',
      'Use unitary method: many objects when',
    ]);
  });

  test('topics without a single statement get (2), (3) after the first, within 40 code points', () => {
    const long = 'A'.repeat(40);
    expect(distinctNames([topic('Same'), topic('Same'), topic('Same')])).toEqual(['Same', 'Same (2)', 'Same (3)']);
    expect(distinctNames([topic(long), topic(long)])[1]).toBe(`${'A'.repeat(36)} (2)`);
  });

  test('statements that still collide after the rename fall back to numbers', () => {
    const s = 'I can count.';
    expect(distinctNames([topic('Count', s), topic('Count', s)])).toEqual(['Count', 'Count (2)']);
  });

  test('statements that share no lead words never give a name starting with punctuation; the SLO code tells them apart', () => {
    const t = (code, statement) => ({ name: 'Add numbers', sloCodes: [code], sloDescriptions: [statement] });
    const out = distinctNames([t('M-01-NS-03', 'I can add numbers.'), t('M-01-NS-04', 'I can subtract numbers.')]);
    expect(out).toEqual(['Add numbers (NS-03)', 'Add numbers (NS-04)']);
  });

  test('no shared lead words and no SLO code -> numbered, never ":"', () => {
    const t = (statement) => ({ name: 'Plants', sloCodes: [], sloDescriptions: [statement] });
    expect(distinctNames([t('I can grow seeds.'), t('Leaves make food.')])).toEqual(['Plants', 'Plants (2)']);
  });
});
