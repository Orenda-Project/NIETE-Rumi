/**
 * THE OPERATOR'S PDF DESIGN REVIEW — `grade_6_geography_c04_p63_en.pdf`, 2026-09-12.
 *
 * Eleven items, filed as bd-a8veu.1 through .11. This suite carries the ones that are a
 * property of the document the renderer BUILDS, and pins each to the emitted artefact rather
 * than to the source that emitted it.
 *
 * WHY THE ASSERTIONS LOOK LIKE THIS. This repo's Jest run has no browser (`tests/__mocks__`),
 * so a rendered box cannot be measured here — but `buildHtml()` is not a pure helper either:
 * it EVALUATES the stylesheet, including the `${start}`/`${end}` interpolation that decides
 * whether the Urdu overlay mirrors. Every test below drives the real `buildHtml` and reads the
 * sheet it just wrote, exactly as `phone-page.test.js` does. The measurement half — the actual
 * pixels — is recorded on each bead, taken off a real render at 520x2000 with Chrome.
 *
 * ── item 5 · "Introduction boxes have left too much blank space on the right,
 *              the formatting is not sitting in the whole box itself" ──────────────
 *
 * The operator read this as a box problem. It is not: every block measures the full 478px
 * content column. It is a ROW problem, and it is one mechanism wearing three class names.
 *
 * Every question row — warm-up (`.wu .it`), practice (`.pr .it`), homework (`.hw .it`) — was
 * a flex line holding three children: the number `.n` (`flex:0 0 auto`), the question `.q`
 * (`flex:0 1 auto`, so grow 0), and a chip: `.kind`, `.tier` or `.tag`, all `flex:0 0 auto`.
 * A chip that cannot shrink reserves its full max-content width as a hard column for the
 * whole height of the row; the question gets whatever is left and wraps into a narrow ribbon,
 * and the space UNDER the chip stays blank. Measured on the fixture at 520px:
 *
 *   warm-up 3   chip "SPACED REVIEW · P.22, ADDING MATRICES"  372.8px of a 478px row (78%)
 *               -> `.q` squeezed to 70.1px -> the row is 261.4px tall
 *   homework    chip `[SLO, K/U/A]` 173.4px -> rows fill 55-59% of their own width
 *
 * and `.q`'s max-content is 725-1685px in every one of them: the text is not short, it is
 * boxed in. There is no free space for `flex-grow` to distribute (14.3 + 248.3 + 173.4 + two
 * 9px gaps = 454 = the 476px client width less its padding), which is why giving `.q` a grow
 * factor does nothing.
 *
 * The fix is to stop laying the row as a line. `.it` becomes `display:flow-root` and the chip
 * floats to the END edge, so the question flows the full measure and reclaims the column under
 * the chip. Measured over all 11 rows of the fixture: 1865.6px -> 1326.5px, a saving of
 * 539.1px — 28.9% of the vertical space these rows occupy, and over a quarter of a 1917px
 * content box. So this is also a page-count lever (bd-a8veu.1). Two other candidates were
 * measured and lost: flex-wrap + `flex:1 1 60%` saved 337.9px and made `.exit` rows worse;
 * hoisting the chip to the front of the row first saved 546.3px — 7px better across 11 rows,
 * which does not pay for changing three emitters.
 */

const fs = require('fs');
const path = require('path');

const VENDOR = path.join(__dirname, '..', '..', 'bot', 'vendor', 'lp-v9');
const { buildHtml } = require(path.join(VENDOR, 'lib', 'template'));

const FIXTURE = path.join(__dirname, '__fixtures__', 'v9_gate_base.lp.json');
const doc = () => JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));

const built = (lang = 'en') => buildHtml(doc(), { lang, docDir: path.dirname(FIXTURE) }).html;

/** the one rule the emitted sheet declares for `sel`, as it was written */
function rule(html, sel) {
  const m = html.match(new RegExp(`\\n${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\{[^}]*\\}`));
  if (!m) throw new Error(`the emitted stylesheet has no rule for \`${sel}\``);
  return m[0];
}

/** the three question rows, and the chip each one carries */
const ROWS = [
  { row: '.wu .it', num: '.wu .n', chip: '.wu .kind' },
  { row: '.pr .it', num: '.pr .n', chip: '.pr .tier' },
  { row: '.hw .it', num: '.hw .n', chip: '.hw .tag' },
];

describe('bd-a8veu.5 — a question row gives its question the whole measure', () => {
  test('no question row is laid out as a flex LINE', () => {
    // A flex line is what makes the chip a column. Whatever replaces it must contain the
    // float, so the row also has to establish a block formatting context.
    const html = built('en');
    for (const { row } of ROWS) {
      const r = rule(html, row);
      expect(r).not.toMatch(/display:\s*flex/);
      expect(r).toMatch(/display:\s*flow-root/);
    }
  });

  test('no chip is an unshrinkable flex item beside the question', () => {
    const html = built('en');
    for (const { chip } of ROWS) {
      const r = rule(html, chip);
      // `flex:0 0 auto` is the defect in one declaration: grow 0, SHRINK 0, basis max-content.
      expect(r).not.toMatch(/flex:\s*0\s+0\s+auto/);
      // and `margin-left:auto` only pushes a flex item; outside a flex line it does nothing,
      // so a fix that leaves it behind has left the row half-converted.
      expect(r).not.toMatch(/margin-\w+:\s*auto/);
    }
  });

  test('the chip floats to the END edge, so the question wraps back under it', () => {
    const html = built('en');
    for (const { chip } of ROWS) {
      expect(rule(html, chip)).toMatch(/float:\s*right/);
    }
  });

  test('the Urdu build mirrors the float — the chip is never stranded on the wrong edge', () => {
    // This is the half a source-text assertion cannot reach: `float:${end}` and a literal
    // `float:right` are the same characters in the EN sheet and different documents in Urdu.
    const ur = built('ur');
    for (const { chip } of ROWS) {
      const r = rule(ur, chip);
      expect(r).toMatch(/float:\s*left/);
      expect(r).not.toMatch(/float:\s*right/);
    }
    // the number mirrors with it, or it lands on top of the chip
    for (const { num } of ROWS) {
      expect(rule(ur, num)).toMatch(/float:\s*right/);
    }
  });

  test('the number still leads the row, and keeps the gap the flex line used to draw', () => {
    const html = built('en');
    for (const { num } of ROWS) {
      const r = rule(html, num);
      expect(r).toMatch(/float:\s*left/);
      // `gap` dies with the flex line; without a replacement the number touches the question.
      expect(r).toMatch(/margin-right:\s*[\d.]+px/);
    }
  });
});
