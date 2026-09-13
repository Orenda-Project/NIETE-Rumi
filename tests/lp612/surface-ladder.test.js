/**
 * bd-a8veu.23 — THE SURFACE LADDER AND THE LABEL LADDER.
 *
 * Operator, on the PDF design review: *"the readability of the LP should be better with colour
 * blocks and formatting of text and font to hold the eye"*.
 *
 * A census of the emitted sheet before this guard found **19 distinct pale background tints**,
 * seven more solid section fills, seventeen different border treatments and **eleven corner
 * radii** — every one of them a hex literal written at the block that needed it. Nothing there is
 * wrong on its own; the problem is the sum. A page on which `.askb` is #F5F8FC, `.say` is #F7F9FC,
 * `.seq` is #F6F8FC and `.kw` is #EEF2F8 carries four colours a reader cannot tell apart and four
 * borders that all mean "a box". The eye is given no rank to follow, so it follows none.
 *
 * Same story in type. TWENTY-EIGHT labels printed at 14px / weight 800 / uppercase / tracked: the
 * section landmark, the block label and the little "REVISION" tag floating in the corner of a
 * warm-up row were the same visual volume. Everything shouts, so nothing does.
 *
 * So this guard fixes the LADDERS, not the individual boxes:
 *
 *   SURFACES — five pale roles, declared once in `:root`, on top of the page's white and the
 *   navy that was already a token. A block picks a ROLE (teach / do / watch / note / quiet);
 *   it does not pick a colour. New hex literals in block rules are what this test refuses.
 *
 *   RADII — three: `--r-1` for rows and chips, `--r-2` for blocks and boxes, `--r-pill` for
 *   pills. A circle (`50%`) is a shape, not a radius choice, and is left alone.
 *
 *   LABELS — three levels, and they are ranked by WEIGHT, CASE and COLOUR, never by size.
 *   Size is not available: every font-size here is multiplied by TYPE_SCALE on the way out, the
 *   page renders at 99-100% of its cap, and one added pixel per label buys a page. So
 *     L1  the section band      — solid fill, its own colour, 17.5px
 *     L2  the block label       — `.lbl`, 14px/800/uppercase/tracked, the surface's own ink
 *     L3  the quiet metadata    — 14px/700, sentence case, muted: the repeating per-row tags
 *   L3 is the level that did not exist. The five selectors below are it, and they are the five
 *   that repeat several times per page, which is why they cost the most attention.
 *
 * THE ASSERTIONS ARE ON THE EMITTED SHEET, and that is deliberate for this one change: what is
 * being changed IS the stylesheet, and the invariant worth keeping is "nobody adds a twentieth
 * one-off tint". Geometry is asserted by the render suites, which must stay green — this pass
 * changes fill, line and case only, and must not move a single box.
 */

const fs = require('fs');
const path = require('path');

const { buildHtml } = require('../../bot/vendor/lp-v9/lib/template');

const FIXTURE = path.join(__dirname, '__fixtures__', 'v9_gate_base.lp.json');
const doc = () => JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));

/** The emitted sheet with comments and font payloads stripped — what a CSS parser sees. */
function sheet() {
  const out = buildHtml(doc(), { docDir: path.dirname(FIXTURE) }).html;
  const open = out.indexOf('<style>');
  const close = out.lastIndexOf('</style>');
  expect(open).toBeGreaterThan(-1);
  return out
    .slice(open + 7, close)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/url\(data:[^)]*\)/g, 'url(data:)');
}

/**
 * The sheet with the `:root` block removed — i.e. every rule that is NOT the palette.
 *
 * The palette is the one place a hex literal belongs. Everywhere else a colour must arrive as a
 * `var(--…)`, which is what makes the ladder a ladder instead of a naming convention.
 */
function rules() {
  const s = sheet();
  // KaTeX ships its own vendored sheet ahead of ours and is not ours to re-palette.
  const mine = s.slice(s.indexOf('@page '));
  return mine.replace(/:root\{[\s\S]*?\}/, '');
}

/**
 * The body of one rule, by exact selector prelude.
 *
 * Pass the selector RAW — `.tbl th`, not `\\.tbl th`. Escaping happens here, once; a caller that
 * pre-escapes gets a pattern demanding a literal backslash in the sheet, which matches nothing and
 * fails on the null instead of on the assertion it meant to make.
 */
function rule(sel) {
  const s = rules();
  const re = new RegExp(`(?:^|[\\n};])\\s*${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`);
  const m = s.match(re);
  expect(m).not.toBeNull();
  return m[1];
}

describe('the surface ladder', () => {
  test('no block rule paints a background with its own hex literal', () => {
    // `#fff` is the page itself and stays a literal: white is not a role.
    const offenders = [...rules().matchAll(/background(?:-color)?:\s*(#[0-9a-fA-F]{3,8})/g)]
      .map((m) => m[1])
      .filter((hex) => hex.toLowerCase() !== '#fff' && hex.toLowerCase() !== '#ffffff');
    expect(offenders).toEqual([]);
  });

  test('no block rule paints a border with its own hex literal', () => {
    const offenders = [...rules().matchAll(/border[-\w]*:\s*[^;]*?(#[0-9a-fA-F]{3,8})/g)].map((m) => m[1]);
    expect(offenders).toEqual([]);
  });

  test('every corner radius is one of the three tokens, or a circle', () => {
    const offenders = [...rules().matchAll(/border-radius:\s*([^;}]+)/g)]
      .map((m) => m[1].trim())
      .filter((v) => !/^var\(--r-(1|2|pill)\)$/.test(v) && v !== '50%');
    expect(offenders).toEqual([]);
  });

  test('the five pale roles are declared once, in :root', () => {
    const root = sheet().match(/:root\{([\s\S]*?)\}/)[1];
    for (const role of ['teach', 'do', 'watch', 'note', 'quiet']) {
      expect(root).toMatch(new RegExp(`--s-${role}:`));
      expect(root).toMatch(new RegExp(`--s-${role}-line:`));
      expect(root).toMatch(new RegExp(`--s-${role}-ink:`));
    }
    expect(root).toMatch(/--r-1:/);
    expect(root).toMatch(/--r-2:/);
    expect(root).toMatch(/--r-pill:/);
  });
});

describe('the label ladder', () => {
  test('L2 — the block label keeps its caps and its weight', () => {
    const b = rule('.lbl');
    expect(b).toMatch(/text-transform:uppercase/);
    expect(b).toMatch(/font-weight:800/);
  });

  // The five tags that repeat several times per page. Each one used to print at the block
  // label's exact volume; each one is metadata a teacher reads once, not a landmark she scans for.
  const QUIET = ['.wu .kind', '.pr .tier', '.hw .tag', '.cite', '.tbl th'];
  test.each(QUIET)('L3 — %s is demoted to sentence case at weight 700', (sel) => {
    const b = rule(sel);
    expect(b).not.toMatch(/text-transform:uppercase/);
    expect(b).toMatch(/font-weight:700/);
  });

  test('the ladder is carried by weight and case, not by size — all three levels stay on 14px', () => {
    // 14px source emits at CHIP_FLOOR_PX (16.33). Growing a label is how a lesson buys a page.
    for (const sel of ['.lbl', ...QUIET]) {
      const m = rule(sel).match(/font-size:\s*([\d.]+)px/);
      if (m) expect(Number(m[1])).toBeCloseTo(16.33, 1);
    }
  });
});
