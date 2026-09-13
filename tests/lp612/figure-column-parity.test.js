/**
 * THE LINT AND THE RENDERER MUST MEASURE A FIGURE AGAINST THE SAME COLUMN — bd-oak77.14.
 *
 * `lint_lp.js` rule 10d and `lib/template.js` `figureSlot()` ask the identical question — *does this
 * diagram render its smallest label above the 13.5px floor at full width?* — and until now they
 * asked it about **two different columns**:
 *
 *     lint_lp.js:446   794 - 22*2 - (10*2 + 3)  =  727      // "per lib/template.js"
 *     template.js:572  794 - 21*2 - (10*2 + 3)  =  729      // and the comment there SAID 727
 *
 * The comment was wrong in one file and the arithmetic was wrong in the other. Production settled
 * it on 2026-09-06 — the live defect string reads *"13.25px in a **729**px column"* — and a staging
 * run on the deployed build said 729 again.
 *
 * Two pixels is small; a second copy of a shared constant is not. This is the exact shape root
 * Rule 10 and bd-vjk68 both record: a rule restated instead of imported drifts, and the drift is
 * invisible because both sides look right in isolation. Here it makes the LINT stricter than the
 * renderer, so the ladder can burn ~60s revision rounds chasing a `FIGURE` defect the renderer
 * would never have reported.
 *
 * The fix is not to correct 727 to 729 in two places — that just re-arms the trap. `render_lp.js`
 * already re-exports the renderer's own geometry; the lint reads it from there.
 */

const path = require('path');
const fs = require('fs');

const VENDOR = path.join(__dirname, '..', '..', 'bot', 'vendor', 'lp-v9');

describe('one column width, one definition', () => {
  test('the renderer exports its full-width drawing box, and the A4 measure is still 729px', () => {
    const T = require(path.join(VENDOR, 'lib', 'template.js'));
    // v9.3 moved the live page off A4 onto the phone page, so the number this guard was written
    // against moved with it — 729 is now `FULL_COL_A4`, kept because the legibility floor was
    // chosen at that measure and has to scale from it. The invariant the guard exists for is
    // unchanged: ONE definition, derived from ONE page object, and the lint imports it.
    expect(T.FULL_COL_A4).toBe(794 - 21 * 2 - (10 * 2 + 3));
    expect(T.FULL_COL_A4).toBe(729);
    // …and the live column is derived the same way from the page actually being rendered.
    expect(T.FULL_COL).toBe(T.PAGE.w - T.PAGE.padX * 2 - T.FIG_CHROME);
  });

  test('lint_lp.js does not recompute it', () => {
    // Comments stripped FIRST — a source assertion that lands on a comment is vacuous
    // (language-protocol §7.1, which cost this repo five false passes).
    const src = fs.readFileSync(path.join(VENDOR, 'lint_lp.js'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');
    expect(src).not.toMatch(/794\s*-\s*2[12]\s*\*\s*2/);
    expect(src).toMatch(/FULL_COL/);
  });

  test('no stale 727 survives in the CODE of either file', () => {
    // Comments may — and should — still say 727: they record what the number used to be and why it
    // was wrong, which is the only thing that stops someone "correcting" 729 back. What must not
    // survive is a 727 the machine reads.
    for (const f of ['lint_lp.js', path.join('lib', 'template.js')]) {
      const code = fs.readFileSync(path.join(VENDOR, f), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/[^\n]*/g, '');
      expect({ file: f, has727: /\b727\b/.test(code) }).toEqual({ file: f, has727: false });
    }
  });

  test('the two gates agree on a figure sitting between the two numbers', () => {
    // A diagram whose smallest label clears the floor at 729px but not at 727px is exactly the
    // document the drift mis-sorted: lint says FIGURE, the renderer says fine.
    const { requiredBox } = require(path.join(VENDOR, 'diagrams', 'lib', 'svg.js'));
    // minFont/vbW chosen so renderedPx crosses 13.5 between 727 and 729.
    const vbW = 660;
    const minFont = 13.5 * vbW / 728;            // legible at 729, not at 727
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${vbW} 400" `
      + `data-min-font="${minFont}" role="img"><text font-size="${minFont}">x</text></svg>`;
    expect(requiredBox(svg, { minPx: 13.5, colPx: 727 }).renderedPx).toBeLessThan(13.5);
    expect(requiredBox(svg, { minPx: 13.5, colPx: 729 }).renderedPx).toBeGreaterThanOrEqual(13.5);
    // …so which number the lint uses decides the verdict, which is why there may only be one.
  });
});
