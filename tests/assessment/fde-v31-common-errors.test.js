/**
 * bd-5jmnfj.33.2 — a multiplication common-error figure is the slip it names.
 * v30 G3 Maths: "58 x 7 … Forgetting to add the carried 5 tens, giving 351" (the slip gives 356);
 * "435 x 6 … Not carrying from the tens to the hundreds, giving 11" (2480); "58 x 4 … Not carrying
 * the 3 tens, giving 212" (202); "346 x 3 … writing 918 or 1028" (928). v30 G4 Maths: "2,596 x 73 …
 * Not placing a zero when multiplying by tens, giving 10,364" (the unshifted slip gives 25,960);
 * "4,275 x 8 … Forgetting to add the carried digit, giving 33,600" is a real slip and stays.
 * Run through mathsCheck as the writer runs it on a board-pattern paper.
 */

const { mathsCheck } = require('../../bot/shared/services/assessment/maths-check');
const { mulCarrySlips } = require('../../bot/shared/services/assessment/fde-common-error-check');

const paper = (q) => ({ _layout: { subject: 'Maths', sections: [] }, unseen: { subjective: { 'Short Response': [q] } } });
const errorOf = (question, answer, common_error) => mathsCheck(paper({
  slot: 'g3.maths.B.short', marks: 5, question, answer,
  scheme: { accept: [answer], points: [], checked: null, common_error },
})).examJson.unseen.subjective['Short Response'][0].scheme.common_error;

describe('mulCarrySlips', () => {
  test('58 x 7: the carried 5 tens dropped gives 356; all carries dropped gives 356', () => {
    const s = mulCarrySlips('58', '7');
    expect([...s.slips]).toEqual(expect.arrayContaining([356]));
    expect(s.all).toBe(356);
  });
  test('435 x 6: tens→hundreds carry dropped gives 2480; every carry dropped also gives 2480 (30→0 c3, 18→8 c1, 24)', () => {
    const s = mulCarrySlips('435', '6');
    expect(s.slips.has(2480)).toBe(true);
    expect(s.all).toBe(2480);
  });
  test('a product with no carry has no slips', () => {
    expect(mulCarrySlips('12', '3').carrying).toEqual([]);
  });
});

describe('single-digit multiplication, carry forgotten', () => {
  test('v30 G3: forgetting to add the carried 5 tens in 58 x 7 gives 356, not 351', () => {
    expect(errorOf('Multiply 58 x 7', '58 x 7 = 406', 'Forgetting to add the carried 5 tens, giving 351.'))
      .toBe('Forgetting to add the carried 5 tens, giving 356.');
  });
  test('v30 G3: not carrying from the tens to the hundreds in 435 x 6 gives 2480, not 11', () => {
    expect(errorOf('Multiply 435 x 6', '435 x 6 = 2610', 'Not carrying from the tens to the hundreds, giving 11.'))
      .toBe('Not carrying from the tens to the hundreds, giving 2480.');
  });
  test('v30 G3: not carrying the 3 tens in 58 x 4 gives 202, not 212', () => {
    expect(errorOf('58 x 4 = ___', '232', 'Not carrying the 3 tens, giving 212.')).toBe('Not carrying the 3 tens, giving 202.');
  });
  test('v30 G3: 346 x 3 without carrying gives 928, not 918 or 1028', () => {
    expect(errorOf('346 x 3 = ___', '1038', 'Not carrying, writing 918 or 1028.')).toBe('Not carrying, writing 928.');
  });
  test('a figure the slip gives is left as written (v30 G4 4,275 x 8 → 33,600 drops the tens carry)', () => {
    expect(errorOf('Multiply 4,275 x 8', '34,200', 'Forgetting to add the carried digit, giving 33,600.'))
      .toBe('Forgetting to add the carried digit, giving 33,600.');
  });
  test('v30 G3 Q5: 46 x 6 giving 246 and 213 x 4 giving 842 are real slips and stay', () => {
    expect(errorOf('46 x 6', '276', 'Not carrying the 3 tens, giving 246 instead of 276.')).toBe('Not carrying the 3 tens, giving 246 instead of 276.');
    expect(errorOf('213 x 4', '852', 'Not carrying 1 ten from 12 ones, giving 842.')).toBe('Not carrying 1 ten from 12 ones, giving 842.');
  });
});

describe('two-digit multiplier, the zero for the tens not placed', () => {
  test('v30 G4: 2,596 x 73 without the shifted zero gives 25,960, not 10,364', () => {
    expect(errorOf('Multiply 2,596 x 73', '189,508', 'Not placing a zero when multiplying by tens, giving 10,364.'))
      .toBe('Not placing a zero when multiplying by tens, giving 25,960.');
  });
  test('a figure the slip gives, and a figure followed by an operator, are left as written', () => {
    expect(errorOf('Multiply 2,596 x 73', '189,508', 'Not placing a zero for the tens, giving 25,960.')).toBe('Not placing a zero for the tens, giving 25,960.');
    expect(errorOf('2,718 by 46', '125,028', 'Adding the partial products wrongly, giving 16,308 + 10,872 = 27,180.'))
      .toBe('Adding the partial products wrongly, giving 16,308 + 10,872 = 27,180.');
  });
});

describe('addition carry still works as before', () => {
  test('324 + 258 not carrying gives 572', () => {
    expect(errorOf('324 + 258 = ___', '582', 'Not carrying in the ones, giving 472.')).toBe('Not carrying in the ones, giving 572.');
  });
});
