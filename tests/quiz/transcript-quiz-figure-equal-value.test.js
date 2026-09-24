'use strict';
/**
 * A picture of 2 shaded parts in 8 is 2/8 AND 1/4: offered both, a child who
 * reads the bar either way is right.
 *
 * Live (grade 3 Urdu, equivalent fractions): the author wrote "what fraction
 * of the bar is shaded?" over a bar of 8 parts with 2 shaded, options 2/8, 1/4
 * and 1/2, key 2/8. The blind solver passed it. A child who tapped 1/4 would
 * have been told they were wrong — on a lesson about equivalent fractions.
 *
 * A fraction_bar or grid question must be able to PRODUCE its key literally
 * (FIGURE_MISMATCH: 2/8, not 1/4), so a second option of the same VALUE is
 * always a second right reading of the same picture. It is refused as a
 * duplicate option, which the targeted rewrite already knows how to repair.
 * Without a picture the same options are a fair question ("which is in lowest
 * terms?") and are left alone.
 */

jest.mock('../../bot/shared/utils/html-to-pdf', () => ({ htmlToImage: jest.fn() }));
jest.mock('../../bot/shared/storage/r2', () => ({ uploadBuffer: jest.fn() }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const { validate } = require('../../bot/shared/services/quiz/transcript-quiz-validator');

const F = (a, b) => `$\\frac{${a}}{${b}}$`;
const DIGEST = { subject: 'maths', grade_band: '3', slos: [{ id: 'S1', statement: 'equivalent fractions', taught_level: 'understand' }] };
const ctx = { language: 'en', subject: 'maths', digest: DIGEST, nExpected: 1 };
function q(over) {
  return {
    slo_id: 'S1', level: 'understand', question: 'What fraction of the bar is shaded?',
    options: [F(2, 8), F(1, 4), F(1, 2)], correct_index: 0,
    explanation: 'Two of the eight equal parts are shaded.', selected_because: 'the bars in the lesson',
    distractor_misconceptions: { 1: 'simplifies', 2: 'guesses half' },
    option_feedback: { correct: 'Yes.', wrong: { 1: 'Look again.', 2: 'Count the parts.' } },
    figure: { type: 'fraction_bar', bars: [{ parts: 8, shaded: 2 }] }, figure_role: 'read_off',
    ...over,
  };
}
const dup = (v) => v.errors.filter((e) => /^q0: duplicate options/.test(e));

test('a bar of 2 in 8 offered as 2/8 and 1/4 is refused: both read the picture right', () => {
  const e = dup(validate([q()], ctx));
  expect(e).toHaveLength(1);
  expect(e[0]).toMatch(/2\/8.*1\/4.*same amount/);
});

test('a grid of 3 in 12 offered as 3/12 and 1/4 is refused too', () => {
  const v = validate([q({ question: 'What fraction of the squares are shaded?', options: [F(3, 12), F(1, 4), F(1, 3)], figure: { type: 'grid', rows: 3, cols: 4, shaded: 3 } })], ctx);
  expect(dup(v)).toHaveLength(1);
});

test('three different amounts pass', () => {
  expect(dup(validate([q({ options: [F(2, 8), F(3, 8), F(1, 2)] })], ctx))).toEqual([]);
});

test('without a picture the same options are a fair question and pass', () => {
  const v = validate([q({ question: 'Which of these is in lowest terms?', options: [F(1, 4), F(2, 8), F(4, 16)], figure: null, figure_role: null })], ctx);
  expect(dup(v)).toEqual([]);
});

describe('the same holds when the options name the bars', () => {
  // Live (grade 3 Urdu, third replay): "which bar shows 3/6?" over bars of 1/2 (A),
  // 3/6 (B) and 2/4 (C), key B. On a lesson about equivalent fractions all three
  // bars show that amount.
  const bars = (list) => ({ type: 'fraction_bar', bars: list.map(([p, sh], k) => ({ parts: p, shaded: sh, label: 'ABC'[k] })) });
  const which = (over) => q({ question: `Which bar shows ${F(3, 6)}?`, options: ['bar A', 'bar B', 'bar C'], correct_index: 1, distractor_misconceptions: { 0: 'x', 2: 'y' }, option_feedback: { correct: 'Yes.', wrong: { 0: 'No.', 2: 'No.' } }, ...over });

  test('two option bars of the same amount are refused', () => {
    const e = dup(validate([which({ figure: bars([[2, 1], [6, 3], [4, 2]]) })], ctx));
    expect(e).toHaveLength(1);
    // the parts are renamed P, Q, R before any check reads them (relabelLetterParts)
    expect(e[0]).toMatch(/bar Q.*bar P.*same amount/);
  });

  test('Urdu bar names and bare letters are read the same way', () => {
    const ur = which({ options: ['پٹی A', 'پٹی B', 'پٹی C'], figure: bars([[2, 1], [6, 3], [5, 2]]) });
    expect(dup(validate([ur], ctx))).toHaveLength(1);
    const bare = which({ options: ['A', 'B', 'C'], figure: bars([[5, 2], [6, 3], [4, 2]]) });
    expect(dup(validate([bare], ctx))).toHaveLength(1);
  });

  test('three different amounts pass', () => {
    expect(dup(validate([which({ figure: bars([[3, 1], [6, 3], [4, 1]]) })], ctx))).toEqual([]);
  });
});
