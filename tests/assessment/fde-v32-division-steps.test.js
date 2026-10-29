/**
 * bd-5jmnfj.33.3 — a division point or common error names the digits the method really uses.
 * v31 G4 Maths Q3 iv "Divide 6,375 by 15": the M point said "using the first three digits to start"
 * and the error "instead of using the first three digits 637", but 15 goes into 63, the first two.
 * Q5 iii "Divide 9,576 by 18": the error listed "9 or 95" as wrong starts, and 95 is the right one.
 */

const { divisionSteps, firstDigits, divisionOf } = require('../../bot/shared/services/assessment/fde-division-steps');

describe('firstDigits', () => {
  test('6,375 ÷ 15 starts on 63; 9,576 ÷ 18 on 95; 5,376 ÷ 8 on 53; 2,318 ÷ 2 on 2', () => {
    expect(firstDigits('6,375', '15')).toEqual({ count: 2, digits: '63' });
    expect(firstDigits('9,576', '18')).toEqual({ count: 2, digits: '95' });
    expect(firstDigits('5,376', '8')).toEqual({ count: 2, digits: '53' });
    expect(firstDigits('2318', '2')).toEqual({ count: 1, digits: '2' });
  });
  test('a divisor bigger than the dividend has no start', () => {
    expect(firstDigits('7', '15')).toBeNull();
  });
});

describe('divisionOf', () => {
  test('reads "Divide a by b", "a ÷ b", "a / b" and "a divided by b" from the stem, then the answer', () => {
    expect(divisionOf({ question: 'Divide 6,375 by 15 and check your answer.' })).toEqual({ a: '6,375', b: '15' });
    expect(divisionOf({ question: 'Find 9,576 ÷ 18.' })).toEqual({ a: '9,576', b: '18' });
    expect(divisionOf({ question: 'Work out 5376 / 8' })).toEqual({ a: '5376', b: '8' });
    expect(divisionOf({ question: 'What is 2,318 divided by 2?' })).toEqual({ a: '2,318', b: '2' });
    expect(divisionOf({ question: 'Share the books equally.', answer: '3,768 ÷ 12 = 314' })).toEqual({ a: '3,768', b: '12' });
    expect(divisionOf({ question: 'Multiply: 92 x 4', answer: '368' })).toBeNull();
  });
});

describe('divisionSteps', () => {
  const item = (question, text, common_error) => ({
    slot: 'g4.maths.B.short', marks: 5, question, answer: 'working',
    scheme: { points: [{ text, marks: 3, kind: 'M' }], accept: [], common_error, checked: null },
  });

  test('G4 Maths Q3 iv: "first three digits" becomes "first two digits" and "637" becomes "63"', () => {
    const { q, notes } = divisionSteps(item('Divide 6,375 by 15 and check your answer.',
      'a correct method of long division by a 2-digit divisor, using the first three digits to start',
      'Trying to divide 15 into 6 and writing a wrong first digit, instead of using the first three digits 637'));
    expect(q.scheme.points[0].text).toBe('a correct method of long division by a 2-digit divisor, using the first two digits to start');
    expect(q.scheme.common_error).toBe('Trying to divide 15 into 6 and writing a wrong first digit, instead of using the first two digits 63');
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ slot: 'g4.maths.B.short', reason: 'division_steps' });
  });

  test('G4 Maths Q5 iii: the right start 95 leaves the list of wrong starts', () => {
    const { q } = divisionSteps(item('Divide 9,576 by 18. Find the quotient and the remainder. Then show that your answer is correct.',
      'a correct method for long division by a 2-digit number, using the first three digits where needed',
      'Trying to divide 18 into 9 or 95 only, and placing the quotient digits in the wrong places.'));
    expect(q.scheme.points[0].text).toBe('a correct method for long division by a 2-digit number, using the first two digits where needed');
    expect(q.scheme.common_error).toBe('Trying to divide 18 into 9 only, and placing the quotient digits in the wrong places.');
  });

  test('an error whose only "wrong" start is the right one is blanked', () => {
    const { q } = divisionSteps(item('Divide 6,375 by 15.', 'a correct method', 'Trying to divide 15 into 63 and writing a wrong first digit.'));
    expect(q.scheme.common_error).toBe('');
  });

  test('a point already naming the right digits, or an item with no division, is unchanged', () => {
    const right = item('Divide 6,375 by 15.', 'using the first two digits 63 to start', 'Forgetting the remainder.');
    expect(divisionSteps(right)).toEqual({ q: right, notes: [] });
    const mul = item('Multiply: 92 x 4', 'using the first three digits', 'Forgetting to carry');
    expect(divisionSteps(mul)).toEqual({ q: mul, notes: [] });
  });
});
