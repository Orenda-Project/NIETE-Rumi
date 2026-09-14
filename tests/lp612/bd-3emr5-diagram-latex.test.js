/**
 * A DIAGRAM MUST NOT SHIP RAW TeX INTO THE PDF — bd-3emr5.
 *
 * `one_screen` was fixed for the WhatsApp body (bd-lafr9). The same authored TeX also reaches the
 * page, through `diagram.spec`: `panels.js` draws each panel's `lines` with the generic
 * `wrap()` + `Svg.text()` pair, and `esc()` escapes only `& < > " '` — a `$` and a backslash pass
 * through verbatim into the emitted SVG. Confirmed on
 * PK_G10_MATH_CH3_DETERMINANT_AND_INVERSE.json's "Error (p.69)" panel, where
 * `adj = $\begin{bmatrix}…\end{bmatrix}$` rendered as literal LaTeX split over two lines.
 *
 * The split is why the conversion cannot live in `Svg.text()`: `wrap()` measures and breaks the
 * string first, so a `$…$` span can already be in two pieces by the time anything draws it. The
 * only place that sees a whole span is the spec, before `mod.render(spec)` — so that is where
 * `renderDiagram` converts, and every diagram type inherits it.
 *
 * Red-first: verified failing against this branch's own base — the emitted SVG contained
 * `$\begin{bmatrix}5 &amp; -4...` verbatim.
 */
const path = require('path');
const fs = require('fs');

const DIAGRAMS = path.join(__dirname, '..', '..', 'bot', 'vendor', 'lp-v9', 'diagrams');
const { renderDiagram } = require(DIAGRAMS);

/** The Grade 10 determinant lesson's own panel, verbatim from the stored document. */
const DETERMINANT_PANELS = {
  type: 'panels',
  lang: 'en',
  columns: 2,
  title: 'Error (p.69)',
  caption: 'The adjugate swaps $a$ and $d$ and negates $b$ and $c$.',
  panels: [
    {
      title: 'WRONG',
      lines: [
        'adj = $\\begin{bmatrix}5 & -4\\\\ -2 & 6\\end{bmatrix}$',
        'det = $ad - bc$',
      ],
    },
    {
      title: 'CORRECT',
      lines: [
        '$A^{-1} = \\frac{1}{22}\\begin{bmatrix}6 & 4\\\\ 2 & 5\\end{bmatrix}$',
        'Check: $A \\times A^{-1} = I$',
      ],
    },
  ],
};

describe('bd-3emr5 — diagram text carries no raw TeX', () => {
  test('a panels board renders its maths as Unicode, not as source', () => {
    const svg = renderDiagram(DETERMINANT_PANELS);

    expect(svg).toMatch(/^<svg/);
    expect(svg).not.toContain('$');
    expect(svg).not.toContain('\\');
    expect(svg).not.toContain('begin{');
    expect(svg).not.toContain('frac');
  });

  test('the panel body keeps the maths readable', () => {
    const svg = renderDiagram(DETERMINANT_PANELS);

    expect(svg).toContain('A⁻¹ = 1/22[6, 4; 2, 5]');
    expect(svg).toContain('adj = [5, -4; -2, 6]');
    expect(svg).toContain('A × A⁻¹ = I');
  });

  test('the title/caption strips convert too — they draw through the same egress', () => {
    const svg = renderDiagram(DETERMINANT_PANELS);
    expect(svg).toContain('The adjugate swaps a and d and negates b and c.');
  });

  test('a sibling type inherits the fix from the spec boundary, not from its own code', () => {
    const svg = renderDiagram({
      type: 'flow',
      lang: 'en',
      steps: [
        { title: 'Find $\\det A$', lines: ['$ad - bc$'] },
        { title: 'Divide', lines: ['$\\frac{1}{\\det A}$'] },
      ],
    });
    expect(svg).not.toContain('$');
    expect(svg).not.toContain('\\');
  });

  test('prose with no maths in it is untouched', () => {
    const svg = renderDiagram({
      type: 'panels',
      lang: 'en',
      panels: [{ title: 'Read it aloud', lines: ['Say the sign rule before you write the answer.'] }],
    });
    expect(svg).toContain('Say the sign rule before you write the answer.');
  });
});

describe('bd-3emr5 — the vendored converter stays in step with the shared one', () => {
  // The diagrams engine is hermetic: nothing under bot/vendor/lp-v9/ requires bot/shared/, which is
  // what lets the whole tree be re-vendored or pushed back upstream as a unit. So the converter is
  // copied in rather than reached for, and this test is the thing that keeps the copy honest.
  const SHARED = path.join(__dirname, '..', '..', 'bot', 'shared', 'utils', 'tex-to-unicode.js');
  const VENDORED = path.join(DIAGRAMS, 'lib', 'tex.js');

  test('bot/vendor/lp-v9/diagrams/lib/tex.js is bot/shared/utils/tex-to-unicode.js plus a header', () => {
    const shared = fs.readFileSync(SHARED, 'utf8');
    const vendored = fs.readFileSync(VENDORED, 'utf8');
    expect(vendored.endsWith(shared)).toBe(true);
  });
});
