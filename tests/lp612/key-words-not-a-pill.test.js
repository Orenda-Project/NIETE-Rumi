/**
 * bd-3wjme — A KEY WORD IS NOT A PILL, BECAUSE ITS MEANING IS A SENTENCE.
 *
 * Operator, on `grade_8_history_c04_p54_en.pdf` (generated 2026-09-13 01:16, so it carries
 * 3492ff5d): *"the grade 8 history is 7 pages with vocab boxes not fitting properly"*.
 *
 * WHAT THE PAGE ACTUALLY SHOWS. Page 1's KEY WORDS card holds two entries:
 *
 *     separate electorate — a system where Muslim voters choose Muslim representatives in a
 *                           vote held only among Muslims
 *     dyarchy            — a system of two-part rule where power is divided between British
 *                           officials and elected Indian ministers
 *
 * Each is rendered by `.kw`, which was written as a CHIP: `border-radius: var(--r-pill)` — 999px —
 * with one line's worth of vertical padding. A pill radius is correct at exactly one line height.
 * At four lines it clamps to half the box height, so each end becomes a full semicircle that curves
 * away from the text it is meant to enclose, and the first and last lines run out past the border.
 * That is the "not fitting properly".
 *
 * `.kw` is the only `--r-pill` rule in the sheet whose content can wrap. Every other one is a
 * genuine one-liner: the section tag, the `[SLO, K/U/A]` code (`white-space:nowrap`), the uppercase
 * micro-labels. The bug is not the pill; it is a pill around a paragraph.
 *
 * THE FIX IS A LOOK FIX AND NOTHING ELSE — it takes the row radius (`--r-1`) and stops there.
 * Measured at the card's real 424px inner column on the two entries above: 250.8px before, 250.8px
 * after. `border-radius` does not touch line boxes, so the curve never narrowed the text column and
 * there was no height to win. A `flex: 1 1 auto` grow was tried and measured away: a long meaning
 * already fills its own line, and the grow forces four two-word meanings to one per line instead of
 * packing them. This suite pins the removal so it is not re-added on the same wrong reasoning.
 *
 * Assertions are on the EMITTED sheet, following `surface-ladder.test.js`: what is being changed
 * IS the stylesheet, and `buildHtml` is what executes it.
 */

const fs = require('fs');
const path = require('path');

const { buildHtml } = require('../../bot/vendor/lp-v9/lib/template');

const FIXTURE = path.join(__dirname, '__fixtures__', 'v9_gate_base.lp.json');
const doc = () => JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));

/** The emitted sheet with comments and font payloads stripped — what a CSS parser sees. */
function sheet(d = doc()) {
  const out = buildHtml(d, { docDir: path.dirname(FIXTURE) }).html;
  const open = out.indexOf('<style>');
  const close = out.lastIndexOf('</style>');
  expect(open).toBeGreaterThan(-1);
  return out
    .slice(open + 7, close)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/url\(data:[^)]*\)/g, 'url(data:)');
}

/** One rule's declaration body, by exact selector. */
function rule(css, selector) {
  const m = css.match(new RegExp(`(^|\\})\\s*${selector.replace('.', '\\.')}\\s*\\{([^}]*)\\}`));
  expect(m).not.toBeNull();
  return m[2];
}

describe('the key-word entry', () => {
  test('is not a pill — a pill radius is only correct at one line', () => {
    expect(rule(sheet(), '.kw')).not.toMatch(/--r-pill/);
  });

  test('takes the row radius, the token meant for rows and chips', () => {
    expect(rule(sheet(), '.kw')).toMatch(/border-radius:\s*var\(--r-1\)/);
  });

  test('does not grow — a grow costs the packing and buys no height', () => {
    // Measured: a long meaning already fills its own line without it, and with it four two-word
    // meanings go one-per-line instead of packing. It looked like a page lever and was not one.
    expect(rule(sheet(), '.kw')).not.toMatch(/flex\s*:/);
  });

  test('the row it sits in still wraps, so short meanings still pack two to a line', () => {
    const r = rule(sheet(), '.kwrow');
    expect(r).toMatch(/flex-wrap:\s*wrap/);
    expect(r).toMatch(/display:\s*flex/);
  });
});

describe('the rest of the pills are untouched', () => {
  // The guard is "no pill around a paragraph", not "no pills". These three cannot wrap: two are
  // short uppercase labels and one is explicitly nowrap.
  test.each(['.hw .tag', '.kwrow'])('%s keeps its own shape', (sel) => {
    expect(() => rule(sheet(), sel)).not.toThrow();
  });

  test('the nowrap tag is still a pill', () => {
    const r = rule(sheet(), '.hw .tag');
    expect(r).toMatch(/--r-pill/);
    expect(r).toMatch(/white-space:\s*nowrap/);
  });
});
