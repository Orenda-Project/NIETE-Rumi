/**
 * bd-5jmnfj.4.55 — fde-scheme-figures: accept sums and slip figures in a board-pattern maths scheme.
 * Pure module; mathsCheck's parseForm is passed in as the generator passes it.
 */

const { checkSchemeFigures, statesRightFigures, noRegroup } = require('../../bot/shared/services/assessment/fde-scheme-figures');
const { parseForm } = require('../../bot/shared/services/assessment/maths-check');

const run = (q) => ({ q, out: checkSchemeFigures(q, { parseForm }) });

describe('statesRightFigures', () => {
  test.each([
    ['12,408 × 6 = 74,448', true],
    ['12,408 × 6 = 74,449', false],
    ['900,000 - 358,742 = 541,258', true],
    ['756 ÷ 18 = 42', true],
    ['756 ÷ 18 = 43', false],
    ['Subtracting 358,743 from 899,999 to get 541,256', true],
    ['Subtracting 358,743 from 899,999 to get 541,258', false],
    ['Repeated addition', true],
  ])('%s -> %s', (entry, want) => {
    expect(statesRightFigures(entry)).toBe(want);
  });

  test('a step of a longer sum is not read as the whole sum', () => {
    expect(statesRightFigures('24,685 x 47 = 987,400 + 172,795')).toBe(true);
    expect(statesRightFigures('3 + 4 × 2 = 11')).toBe(true);
  });

  test('a division with a remainder or a decimal is left alone', () => {
    expect(statesRightFigures('100 ÷ 7 = 14 r 2')).toBe(true);
    expect(statesRightFigures('7.5 × 2 = 15')).toBe(true);
  });
});

describe('noRegroup', () => {
  test('subtracts the smaller digit from the larger in every column', () => {
    expect(noRegroup(900000n, 358742n)).toBe(658742n);
    expect(noRegroup(52n, 7n)).toBe(55n);
  });
});

describe('checkSchemeFigures', () => {
  test('drops a wrong accept sum and reports it', () => {
    const { q, out } = run({ question: 'Multiply 12,408 by 6.', answer: '74,448', scheme: { accept: ['Repeated addition', '12,408 × 6 = 74,449'] } });
    expect(q.scheme.accept).toEqual(['Repeated addition']);
    expect(out.dropped).toEqual(['12,408 × 6 = 74,449']);
  });

  test('rewrites a no-regrouping slip figure in the line\'s comma style', () => {
    const { q, out } = run({
      question: 'Subtract 358,742 from 900,000.', answer: '541,258',
      scheme: { common_error: 'Subtracts without regrouping, giving 659,358.' },
    });
    expect(q.scheme.common_error).toBe('Subtracts without regrouping, giving 658,742.');
    expect(out.rewritten).toEqual({ from: '659,358', to: '658,742' });
  });

  test('rewrites a forgot-the-zero slip figure from the key\'s product', () => {
    const { q } = run({
      question: 'A shop earns Rs. 24,685 a day. How much in 47 days?', answer: '24,685 x 47 = Rs. 1,160,195',
      scheme: { common_error: 'Forgets to place the zero when multiplying by 40, giving 296,220.' },
    });
    expect(q.scheme.common_error).toBe('Forgets to place the zero when multiplying by 40, giving 98,740.');
  });

  test('a right slip figure, an uncovered slip, and a 1-digit multiplier are left as written', () => {
    const right = run({ question: 'Subtract 358,742 from 900,000.', scheme: { common_error: 'Without regrouping, giving 658,742.' } });
    expect(right.q.scheme.common_error).toBe('Without regrouping, giving 658,742.');
    expect(right.out.rewritten).toBeNull();
    const uncovered = run({ question: 'Divide 75.6 by 1.8.', scheme: { common_error: 'Moves the point in one number, giving 4.2 or 420.' } });
    expect(uncovered.q.scheme.common_error).toBe('Moves the point in one number, giving 4.2 or 420.');
    const oneDigit = run({ question: 'Multiply.', answer: '24 × 4 = 96', scheme: { common_error: 'Forgets the zero, giving 9.' } });
    expect(oneDigit.q.scheme.common_error).toBe('Forgets the zero, giving 9.');
  });

  test('never throws on odd shapes', () => {
    expect(checkSchemeFigures(null)).toEqual({ dropped: [], rewritten: null });
    expect(checkSchemeFigures({ scheme: 'x' })).toEqual({ dropped: [], rewritten: null });
    expect(checkSchemeFigures({ scheme: { accept: [3, null], common_error: 'giving 5' } }).rewritten).toBeNull();
  });
});
