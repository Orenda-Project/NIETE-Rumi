'use strict';
/**
 * An equation written OUTSIDE the maths dollars is read as one expression, in
 * the order it was written, on every surface.
 *
 * Replay (grade 3 Urdu, multiplying by 6-9): the stem «تصویر میں 7 x 4 = 28 کی
 * نمائندگی…» was laid out "x 4 = 28 7" on the card. A Latin "x" as the times
 * sign makes "7" (a number after Urdu) and "x 4 = 28" (a Latin run) two
 * separate bidi runs, and the right-to-left paragraph puts the second before
 * the first. The same happens in the WhatsApp text and the PDF, and with "*",
 * "÷" or "=" between bare numbers. So an equation run in prose — numbers joined
 * by x, ×, *, ÷, +, −, = — becomes ONE `$…$` expression with \times (the way a
 * flat `$2/3$` became \frac): the picture typesets it in a left-to-right
 * isolate, and the WhatsApp text reads "7 × 4 = 28" inside one.
 *
 * Root suite: KaTeX is stubbed, so this proves the rewrite and the text path.
 * The typeset card and PDF are bot/tests/quiz/quiz-equation-runs-katex.test.js.
 */

jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const QM = require('../../bot/shared/services/quiz/quiz-math');

const { LRI, PDI } = QM;

describe('spanEquations — an equation run in prose becomes one maths expression', () => {
  test.each([
    ['تصویر میں 7 x 4 = 28 کی نمائندگی', 'تصویر میں $7 \\times 4 = 28$ کی نمائندگی'],
    ['6 x 3 کا product کیا ہے؟', '$6 \\times 3$ کا product کیا ہے؟'],
    ['What is 6 * 3?', 'What is $6 \\times 3$?'],
    ['7×4=28', '$7 \\times 4 = 28$'],
    ['12 ÷ 3 = 4', '$12 \\div 3 = 4$'],
    ['3 + 4 = 7', '$3 + 4 = 7$'],
    ['9 − 4 = 5 and 9 - 4', '$9 - 4 = 5$ and $9 - 4$'],
    ['7 x 4 = ?', '$7 \\times 4 = ?$'],
    ['7 x 4 = ؟', '$7 \\times 4 = ?$'],
    ['2/3 + 1/3 = 1', '$2/3 + 1/3 = 1$'],
  ])('%s', (input, out) => {
    expect(QM.spanEquations(input)).toBe(out);
  });

  test.each([
    ['already maths: $7 \\times 4 = 28$'],
    ['algebra stays as written: 2x + 3 = 7'],
    ['a range is not a sum: 5-10 سال'],
    ['a count is not a sum: 28 counters in 7 rows'],
    ['a lone fraction stays prose: 2/3'],
    ['a letter is not a number: x = 4'],
    ['a percentage is left to the prose: 8/10 = 80%'],
  ])('%s', (input) => {
    expect(QM.spanEquations(input)).toBe(input);
  });
});

describe('the WhatsApp text reads the equation in one piece', () => {
  test('in Urdu, one left-to-right isolate around "7 × 4 = 28"', () => {
    const out = QM.mathForChat('تصویر میں 7 x 4 = 28 کی نمائندگی کے لیے counters کا استعمال کیا گیا ہے۔');
    expect(out).toContain(`${LRI}7 × 4 = 28${PDI}`);
    expect(out).not.toMatch(/\d\s*x\s*\d/);
  });

  test('in English, the times sign and no isolate', () => {
    expect(QM.mathForChat('What is 6 * 3?')).toBe('What is 6 × 3?');
  });

  test('the check view reads the times sign too', () => {
    expect(QM.mathToText('7 x 4 = 28')).toBe('7 × 4 = 28');
  });
});

describe('the author is told to write a product as TeX', () => {
  test('the maths notation rule names the Latin x and the star, and says why', () => {
    const { MATH_NOTATION_RULE } = require('../../bot/shared/services/quiz/transcript-quiz-contract');
    expect(MATH_NOTATION_RULE).toMatch(/never 7 x 4 or 7 \* 4/);
    expect(MATH_NOTATION_RULE).toMatch(/backwards/);
  });
});
