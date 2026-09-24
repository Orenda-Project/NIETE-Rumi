'use strict';
/**
 * A fraction bar is labelled ONCE, in the digits the stem uses.
 *
 * Staging (a remade grade 4 Urdu quiz, comparing and ordering unlike
 * fractions): every bar showed its value twice — "۲/۹" in Urdu digits in the
 * value gutter and "2/9" in Latin digits as the bar's name, because the author
 * named each bar with its own fraction and turned the values on. The stem
 * prints "2/9" (the contract keeps numerals 0-9 in every language), so:
 *   - a quiz figure's bar values are drawn in Latin digits, whatever the
 *     quiz language (the engine's Urdu-page default is for the lesson plan);
 *   - a bar name that only repeats the value drawn beside it is dropped.
 * Both hold on every surface, because the card, the WhatsApp image and the
 * teacher PDF all draw through renderFigureSvg.
 */

jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const { renderFigureSvg } = require('../../bot/shared/services/quiz/transcript-quiz-figure');

const count = (svg, s) => svg.split(s).length - 1;
const URDU_DIGIT = /[۰-۹٠-٩]/;
const SPEC = {
  type: 'fraction_bar', showLabels: true,
  bars: [{ parts: 9, shaded: 2, label: '2/9' }, { parts: 6, shaded: 1, label: '۱/۶' }, { parts: 3, shaded: 2, label: '2/3' }],
};

test('an Urdu figure draws each value once, in Latin digits', () => {
  const svg = renderFigureSvg(SPEC, 'ur');
  expect(svg).not.toMatch(URDU_DIGIT);
  expect(count(svg, '2/9')).toBe(1);
  expect(count(svg, '1/6')).toBe(1);
  expect(count(svg, '2/3')).toBe(1);
});

test('an English figure draws each value once too', () => {
  const svg = renderFigureSvg(SPEC, 'en');
  expect(count(svg, '2/9')).toBe(1);
  expect(count(svg, '2/3')).toBe(1);
});

test('a name that is not the value is kept, and its bar value still drawn in Latin digits', () => {
  const svg = renderFigureSvg({ ...SPEC, bars: [{ parts: 9, shaded: 2, label: 'A' }, { parts: 3, shaded: 2, label: 'B' }] }, 'ur');
  expect(svg).toMatch(/>A</);
  expect(svg).toMatch(/>B</);
  expect(count(svg, '2/9')).toBe(1);
  expect(svg).not.toMatch(URDU_DIGIT);
});

test('with the values off (the quiz default) a bar keeps its name, whatever it says', () => {
  const { showLabels, ...valuesOff } = SPEC; // eslint-disable-line no-unused-vars
  const svg = renderFigureSvg(valuesOff, 'en');
  expect(count(svg, '2/9')).toBe(1);
});
