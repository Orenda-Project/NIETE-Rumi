/**
 * A BOOK CROP IS NOT CLAMPED SMALLER THAN THE DIAGRAMS BESIDE IT — bd-8lifl.
 *
 * `template.js` gives every SVG a max-height COMPUTED per figure by `figureSlot()` — the slot in
 * which its smallest label still clears the 13.5 px legibility floor. The comment above it records
 * why: a blanket clamp "is what put mindmap, punnett and grid labels at ~3px on a phone".
 *
 * A raster book crop was left on a hard-coded 200 px, with this reasoning:
 *
 *     /* … A raster book crop has no vector type to crush, so it keeps a clamp. *\/
 *     figure.dg img{ … max-height:200px; object-fit:contain; … }
 *
 * That reasoning is the defect. A crop's labels are baked pixels; downscaling crushes them exactly
 * as it crushed the vector labels, and `object-fit: contain` then letterboxes what is left.
 *
 * Measured on the 2026-09-05 representative batch: `TOO_SMALL` on 6 diagrams across 5 lessons,
 * every one of them a `textbook_figure`. The clearest is d07 page 4 — the Grade 6 Geography world
 * map, printed at under half the text-column width, its own printed labels ("CONTINENTAL AREA",
 * "Tropic of Cancer", "Equator") at roughly 2.5 pt and unreadable. The reviewer scored it
 * legibility 0; the crop itself is correct and matches page-truth exactly.
 *
 * The trade-off is real and is stated in FIXES.md: a taller figure costs page space, and 12 of 17
 * lessons in that batch were already over cap. The over-cap policy (bd-vjk68) delivers anyway, so
 * the cost is paper, not lost lessons, and the re-run measures it.
 *
 * Red-first: fails on this branch's base, where the constant is 200.
 */

const fs = require('fs');
const path = require('path');

const TEMPLATE = path.join(__dirname, '..', '..', 'bot', 'vendor', 'lp-v9', 'lib', 'template.js');
const src = fs.readFileSync(TEMPLATE, 'utf8');

/**
 * The `figure.dg img{…}` rule as written in the stylesheet.
 * The declaration block now contains `${CROP_MAX_H}`, whose own closing brace ends a lazy
 * `\{[\s\S]*?\}` match early — so the rule is read to `margin:0 auto; }` explicitly.
 */
function imgRule() {
  const m = src.match(/figure\.dg img\{[\s\S]*?margin:0 auto; \}/);
  expect(m).not.toBeNull();
  return m[0];
}

describe('the raster clamp is not tighter than a diagram slot', () => {
  it('the img rule exists and still constrains height (an uncapped crop would blow the page)', () => {
    expect(imgRule()).toMatch(/max-height:/);
  });

  it('the clamp is at least 300px — 200px is the measured TOO_SMALL value', () => {
    // The literal is gone from the rule now; the value lives in the named constant.
    const m = src.match(/const\s+CROP_MAX_H\s*=\s*(\d+)/);
    expect(m).not.toBeNull();
    expect(Number(m[1])).toBeGreaterThanOrEqual(300);
  });

  it('the clamp rides a NAMED constant, so the next reader sees what it is for', () => {
    expect(src).toMatch(/CROP_MAX_H/);
    const m = src.match(/const\s+CROP_MAX_H\s*=\s*(\d+)/);
    expect(m).not.toBeNull();
    expect(Number(m[1])).toBeGreaterThanOrEqual(300);
    // and the stylesheet uses it rather than repeating the number
    expect(imgRule()).toMatch(/\$\{CROP_MAX_H\}/);
  });

  it('CROP_MAX_H is genuinely in scope when the stylesheet is built — not a TDZ ReferenceError', () => {
    // The constant is declared further down the file than the template literal that uses it.
    // That is legal at module scope, but only proof that the CSS actually BUILDS settles it:
    // a source-text assertion would pass on a guaranteed runtime crash.
    const { buildHtml } = require(path.join(__dirname, '..', '..', 'bot', 'vendor', 'lp-v9', 'lib', 'template.js'));
    const doc = JSON.parse(fs.readFileSync(
      path.join(__dirname, '__fixtures__', 'v9_gate_base.lp.json'), 'utf8'));
    const out = buildHtml(doc);
    const html = typeof out === 'string' ? out : (out && (out.html || ''));
    expect(String(html)).toContain(`max-height:${320}px`);
  });

  it('a crop still scales to the column width, and is still contained', () => {
    expect(imgRule()).toMatch(/width:\s*100%/);
    expect(imgRule()).toMatch(/object-fit:\s*contain/);
  });

  it('the comment now says the old reasoning was WRONG, not that it holds', () => {
    // The phrase itself survives, quoted, because the note explains what changed and why —
    // deleting the history would leave the next reader to rediscover it. What must not survive
    // is the phrase standing as the live justification.
    expect(src).toMatch(/no vector type to crush["']?,?\s*and that reasoning was wrong/i);
    expect(src).toMatch(/baked pixels/);
  });
});
