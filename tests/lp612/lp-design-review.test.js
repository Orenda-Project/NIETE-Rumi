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

const buildFrom = (d, lang = 'en') => buildHtml(d, { lang, docDir: path.dirname(FIXTURE) }).html;
const built = (lang = 'en') => buildFrom(doc(), lang);

/** the one rule the emitted sheet declares for `sel`, as it was written */
function rule(html, sel) {
  const m = html.match(new RegExp(`\\n${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\{[^}]*\\}`));
  if (!m) throw new Error(`the emitted stylesheet has no rule for \`${sel}\``);
  return m[0];
}

/** the emitted BODY — everything after the stylesheet, so a class name in a CSS
 *  selector can never be mistaken for a class name on an element */
const body = (html) => html.slice(html.indexOf('</style>'));

/** where `needle` first appears in the body, asserted to appear at all */
function at(html, needle, what) {
  const i = body(html).indexOf(needle);
  if (i < 0) throw new Error(`the emitted document has no ${what} (looked for \`${needle}\`)`);
  return i;
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

/**
 * ── item 6 · "Key words should come on the 1st page, so teachers have their materials
 *              listed, videos, and key words. So the 1st page quickly tells the teacher
 *              where they are at, what they are teacing, the SLO, the resources, videos
 *              and key words of this lesson" ────────────────────────────────────────
 *
 * Page 1 already opens with WHERE (the hero: grade, subject, chapter, pages, minutes),
 * WHAT NEXT (the sequence strip) and the SLO (the outcome box). The three things the
 * operator names as missing are the three that were scattered:
 *
 *   the video      one bordered row under the outcome box  — already on page 1
 *   the materials  14px muted ITALIC, folded into the pacing sentence at the very END
 *                  of the teach part (`.mats .cont`), four pages away
 *   the key words  a block INSIDE the Introduction section, mid-page
 *
 * All three are resources — things the teacher has to have in her hand before the bell —
 * so they become one box directly under the outcome. This is a MOVE, exactly as the video
 * itself was moved out of Development (see `resourcesLine`): each renders in exactly ONE
 * place, and a second copy of the same content is a defect that costs a page.
 *
 * The key words move in the RENDERER only. `lint_lp.js`'s VOCAB_PAGE reads the DOCUMENT —
 * it requires a `keywords` block among the introduction's blocks and a page number on it —
 * so the lp_doc shape, the author brief, and every `ur_overlay` pointer are untouched.
 *
 * `L.continues` ("Support pages follow — planning material for you, not read aloud in
 * class") stays at the end of the teach part, because that is the only place it is true.
 */
describe("bd-a8veu.6 — page 1 is the teacher's at-a-glance card", () => {
  // `atom()` rewrites the outer element's class attribute to add its spacing class, so the card
  // ships as `class="rescard sp-2"`. Match the opening of the attribute, not a closed one.
  const CARD = 'class="rescard';

  test('the resources card is on page 1, above the first section', () => {
    const html = built('en');
    const card = at(html, CARD, 'resources card');
    const intro = at(html, 'data-sec="introduction"', 'introduction bar');
    expect(card).toBeLessThan(intro);
  });

  test('the key words are in that card, not buried inside the Introduction', () => {
    const html = built('en');
    expect(at(html, 'class="kwrow"', 'key-words row'))
      .toBeLessThan(at(html, 'data-sec="introduction"', 'introduction bar'));
    // ONE copy. A hoist that leaves the block rendering in place too is not a move.
    expect(body(html).match(/class="kwrow"/g)).toHaveLength(1);
  });

  test('the materials are on page 1, not in the tail sentence four pages later', () => {
    const html = built('en');
    const intro = at(html, 'data-sec="introduction"', 'introduction bar');
    // the fixture's own materials, so this cannot pass on a label alone
    expect(at(html, 'Squared paper', 'materials list')).toBeLessThan(intro);
    // and the tail keeps the one sentence that is only true at the end
    const tail = body(html).slice(at(html, 'class="mats', 'tail sentence'));
    expect(tail).toMatch(/Support pages follow/);
    expect(tail).not.toMatch(/Squared paper/);
  });

  test('the video still renders exactly once, and inside the card', () => {
    const html = built('en');
    expect(body(html).match(/class="vres"/g)).toHaveLength(1);
    const card = at(html, CARD, 'resources card');
    expect(at(html, 'class="vres"', 'video row')).toBeGreaterThan(card);
    expect(at(html, 'class="vres"', 'video row'))
      .toBeLessThan(at(html, 'data-sec="introduction"', 'introduction bar'));
  });

  test('a lesson with no video still gets its card, with materials and key words', () => {
    // the card is not the video row wearing a new name: it must hold on its own. Most lessons
    // carry a video (the fixture does), so strip it to reach the branch that does not.
    const d = doc();
    delete d.sections.find((s) => s.id === 'development').video;
    const html = buildFrom(d);
    expect(body(html)).not.toMatch(/class="vres"/);
    const card = at(html, CARD, 'resources card');
    expect(at(html, 'class="kwrow"', 'key-words row')).toBeGreaterThan(card);
    expect(at(html, 'Squared paper', 'materials list')).toBeGreaterThan(card);
    expect(at(html, 'Squared paper', 'materials list'))
      .toBeLessThan(at(html, 'data-sec="introduction"', 'introduction bar'));
  });
});
