'use strict';
/**
 * A MIXED NUMBER keeps its whole part apart from its fraction.
 *
 * `convertMath` wrote `$2\frac{1}{3}$` as "21/3" — the whole part ran straight
 * into the numerator, and a teacher reading the lesson's `one_screen` message
 * (the WhatsApp body that precedes the PDF) read twenty-one thirds. The class
 * quiz had patched this in its own module with a local pre-pass; the rule now
 * lives in the shared converter, once.
 *
 * The joiner is a NO-BREAK SPACE, U+00A0, chosen for bidi rather than looks: it
 * is a common SEPARATOR, so "2 1/3" stays one number run inside an Urdu line,
 * where an ordinary space would let the two numbers swap sides.
 */

jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({ sendMessage: jest.fn(), sendDocument: jest.fn() }));
jest.mock('../../bot/shared/services/lp-shelf.service', () => ({ pushToShelf: jest.fn() }));
jest.mock('../../bot/shared/storage/r2', () => ({ uploadBuffer: jest.fn(), getSignedUrl: jest.fn() }));
jest.mock('../../bot/shared/services/lp612-catalog.service', () => ({}));
jest.mock('../../bot/shared/config/supabase', () => ({ from: () => ({}) }));

const { texToUnicode, convertMath } = require('../../bot/shared/utils/tex-to-unicode');
const { buildBody } = require('../../bot/shared/services/lp612-serving.service');
const { mathToText } = require('../../bot/shared/services/quiz/quiz-math');

const NBSP = '\u00A0';

describe('convertMath: a whole number written before a fraction is a mixed number', () => {
  test.each([
    ['2\\frac{1}{3}', `2${NBSP}1/3`],
    ['2 \\frac{1}{3}', `2${NBSP}1/3`],
    ['12\\dfrac{3}{4}', `12${NBSP}3/4`],
    ['5\\tfrac{1}{2}', `5${NBSP}1/2`],
  ])('%s -> "%s"', (src, want) => {
    expect(convertMath(src)).toBe(want);
  });

  test.each([
    ['\\frac{1}{3}', '1/3'],
    ['3 \\times \\frac{1}{2}', '3 × 1/2'],
    ['x = \\frac{1}{2}', 'x = 1/2'],
    ['\\frac{a+b}{2}', '(a+b)/2'],
  ])('no whole part, nothing inserted: %s -> "%s"', (src, want) => {
    expect(convertMath(src)).toBe(want);
  });
});

describe('every text path gets the same reading', () => {
  test('the lesson message a teacher receives says "2 1/3 cups", never "21/3"', () => {
    const body = buildBody({ oneScreen: 'Add $2\\frac{1}{3}$ cups of flour.', segment: {} });
    expect(body).toBe(`Add 2${NBSP}1/3 cups of flour.`);
    expect(body).not.toContain('21/3');
  });

  test('\\( … \\) spans convert the same way', () => {
    expect(texToUnicode('It is \\(3\\frac{1}{4}\\) metres.')).toBe(`It is 3${NBSP}1/4 metres.`);
  });

  test('the quiz\'s own text path agrees with the shared one', () => {
    const src = 'What is $2\\frac{1}{3}$ as an improper fraction?';
    expect(mathToText(src)).toBe(texToUnicode(src));
  });
});
