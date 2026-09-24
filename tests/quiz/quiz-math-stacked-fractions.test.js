'use strict';
/**
 * A fraction the author wrote flat — `$2/3$` — is still drawn STACKED on the
 * child's card and the teacher's PDF, the way a textbook prints it.
 *
 * The contract asks for `$\frac{2}{3}$`, and on a live grade 4 lesson the model
 * wrote `$2/3$`, `$2/3 > 3/5$` and `$4/18$` throughout: KaTeX typesets a slash
 * as a slash, so every fraction on the card was flat. A simple numeric fraction
 * inside a maths span is rewritten to `\frac{a}{b}` in code, for the PICTURE
 * only; every WhatsApp text keeps reading "2/3".
 *
 * Root suite: KaTeX is stubbed, so this proves what reaches the typesetter.
 * The real glyphs are bot/tests/quiz/quiz-stacked-fractions-katex.test.js.
 */

jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const QM = require('../../bot/shared/services/quiz/quiz-math');

describe('stackFractions — a flat numeric fraction inside a maths span becomes \\frac', () => {
  test.each([
    ['$2/3$', '$\\frac{2}{3}$'],
    ['$2/3 > 3/5$', '$\\frac{2}{3} > \\frac{3}{5}$'],
    ['$4/18$, $3/18$ and $12/18$', '$\\frac{4}{18}$, $\\frac{3}{18}$ and $\\frac{12}{18}$'],
    ['$1 / 2 + 1/4 = 3/4$', '$\\frac{1}{2} + \\frac{1}{4} = \\frac{3}{4}$'],
    ['Hira has $2/3$ of a bottle', 'Hira has $\\frac{2}{3}$ of a bottle'],
  ])('%s', (input, out) => {
    expect(QM.stackFractions(input)).toBe(out);
  });

  test.each([
    ['2/3 outside the dollars stays prose', '2/3 outside the dollars stays prose'],
    ['$\\frac{2}{3}$ is already stacked', '$\\frac{2}{3}$ is already stacked'],
    ['$0.5/2$ is a decimal, left alone', '$0.5/2$ is a decimal, left alone'],
    ['$x/y$ is not a numeric fraction', '$x/y$ is not a numeric fraction'],
    ['$\\begin{array}{rr} & 452 \\\\ - & 137 \\\\ \\hline & \\end{array}$', '$\\begin{array}{rr} & 452 \\\\ - & 137 \\\\ \\hline & \\end{array}$'],
  ])('%s', (input, out) => {
    expect(QM.stackFractions(input)).toBe(out);
  });
});

describe('the picture typesets it stacked; every text keeps "2/3"', () => {
  test('mathHtml hands the typesetter \\frac, not a slash', () => {
    // the root KaTeX stub echoes the flattened source, so a \frac shows up as its two arguments
    const html = QM.mathHtml('Which is larger, $2/3$ or $3/5$?', { display: true });
    expect(html).not.toMatch(/2\/3/);
    expect(html).toMatch(/class="qm"/);
  });

  test('WhatsApp text reads "2/3" whether the author wrote $2/3$ or $\\frac{2}{3}$', () => {
    expect(QM.mathForChat('Which is larger, $2/3$ or $3/5$?')).toBe('Which is larger, 2/3 or 3/5?');
    expect(QM.mathForChat('Which is larger, $\\frac{2}{3}$ or $\\frac{3}{5}$?')).toBe('Which is larger, 2/3 or 3/5?');
  });
});
