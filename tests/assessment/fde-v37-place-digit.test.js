/**
 * v37 G5 Maths Q2 i: rounding 2,306,745 to the nearest thousand, the key paid "Looks at the
 * hundreds digit (6)" and accepted "because the hundreds digit is 6". The hundreds digit is 7.
 * The digit a key names is the digit the stem's number holds in that place.
 */

const { mendPlaceDigits, digitAt } = require('../../bot/shared/services/assessment/fde-place-digit');

const item = (question, points, accept) => ({
  slot: 'maths.B.Q2', question, answer: '2,307,000', marks: 5,
  scheme: { points: points.map((text) => ({ text, marks: 1, kind: 'A' })), accept },
});
const exam = (q) => ({ seen: {}, unseen: { subjective: { 'Long Questions': [q] } } });
const out = (r) => r.examJson.unseen.subjective['Long Questions'][0];

describe('digitAt', () => {
  test('reads a place from a comma number', () => {
    expect(digitAt('2,306,745', 'hundreds')).toBe(7);
    expect(digitAt('2,306,745', 'thousands')).toBe(6);
    expect(digitAt('2,306,745', 'ten thousands')).toBe(0);
    expect(digitAt('2,306,745', 'hundred thousands')).toBe(3);
    expect(digitAt('45', 'hundreds')).toBe(null);
  });
});

describe('mendPlaceDigits', () => {
  const STEM = 'The population of a town is 2,306,745. (b) Round the number to the nearest thousand.';

  test('rewrites a wrongly named digit on the same side of 5 in points and accept', () => {
    const q = item(STEM, ['Looks at the hundreds digit (6) to decide how to round'],
      ['2,307,000 by rounding up because the hundreds digit is 6']);
    const r = mendPlaceDigits(exam(q));
    expect(out(r).scheme.points[0].text).toBe('Looks at the hundreds digit (7) to decide how to round');
    expect(out(r).scheme.accept[0]).toBe('2,307,000 by rounding up because the hundreds digit is 7');
    expect(r.notes).toHaveLength(2); // the point and the accept line
    expect(q.scheme.points[0].text).toContain('(6)'); // input not mutated
  });

  test('a digit that matches a number in the answer is left alone (433,834 total, hundreds 8)', () => {
    const q = { ...item('Add Rs. 215,460 and Rs. 218,374, then round the total to the nearest thousand.',
      ['Uses the hundreds digit (8) to decide that the thousand rounds up'], []), answer: 'Rs. 433,834; 434,000' };
    const r = mendPlaceDigits(exam(q));
    expect(out(r).scheme.points[0].text).toContain('(8)');
    expect(r.notes).toEqual([]);
  });

  test('a wrong digit on the other side of 5 is not rewritten, it is reported', () => {
    const q = item(STEM, ['Looks at the hundreds digit (2) to decide how to round'], []);
    const r = mendPlaceDigits(exam(q));
    expect(out(r).scheme.points[0].text).toContain('(2)');
    expect(r.wrong).toHaveLength(1);
  });

  test('never throws on junk', () => {
    expect(() => mendPlaceDigits(null)).not.toThrow();
    expect(mendPlaceDigits({ unseen: { subjective: { x: [null, 3] } } }).notes).toEqual([]);
  });
});
