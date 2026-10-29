/** bd-5jmnfj.4.58.2: the L.C.M. ladder in a key. */
const { fixLcmLadder, remaining } = require('../../bot/shared/services/assessment/fde-lcm-ladder');

describe('fixLcmLadder', () => {
  test('1 and 3 becomes 2 and 3 for 24, 36 by 2, 2, 3', () => {
    expect(fixLcmLadder('Divide 24 and 36 by 2, 2, 3 to reach 1 and 3: L.C.M. = 72.')).toBe('Divide 24 and 36 by 2, 2, 3 to reach 2 and 3: L.C.M. = 72.');
  });
  test('a right ladder, a divisor that divides neither, and non-text are unchanged', () => {
    const ok = 'Divide 24 and 36 by 2, 2, 3 to reach 2 and 3';
    expect(fixLcmLadder(ok)).toBe(ok);
    const bad = 'Divide 24 and 36 by 5 to reach 1 and 3';
    expect(fixLcmLadder(bad)).toBe(bad);
    expect(fixLcmLadder(undefined)).toBeUndefined();
  });
  test('remaining carries a number down when it does not divide', () => {
    expect(remaining(24, 36, [2, 2, 3])).toEqual([2, 3]);
    expect(remaining(24, 36, [2, 2, 2, 3, 3])).toEqual([1, 1]);
    expect(remaining(24, 36, [7])).toBeNull();
  });
});
