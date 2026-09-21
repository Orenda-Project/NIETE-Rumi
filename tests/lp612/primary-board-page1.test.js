/**
 * bd-6s5u7 -- WRITE ON THE BOARD CLOSES PAGE 1 ON A PRIMARY PLAN.
 *
 * OPERATOR: *"go ahead with the shim, and move the board to page 1"*, and, in the page map she
 * wrote for the primary profile: *"kie.ai has a to Prepare list, it should be in one table the
 * video resources in the other table and then the third shold carry the actual key words of the
 * day - this should all be on page 1 finally there should be a write on the board section here
 * with all the relevant things that will go on the board"*.
 *
 * It was measured on printed page TWO. The board is the sheet a primary teacher sets up from
 * BEFORE the lesson starts -- it belongs with the other three set-up tables, not four atoms
 * downstream behind the hook and the warm-up, on a page she has to turn to while holding chalk.
 *
 * THIS IS A HOIST, NOT AN EDIT. The precedent is stated in `template.js` itself: *"the key words
 * stayed in `introduction.blocks` when they were hoisted into the resources card for bd-a8veu.6"*.
 * The DOCUMENT is untouched -- `d0_primary._intro` still appends the board block last, the schema,
 * lint and every `ur_overlay` pointer still address it where it lives -- and only the RENDERER
 * emits it as page-1 furniture. So the four groups below are:
 *
 *   1. G6-12 IS UNTOUCHED BY CONSTRUCTION. The fixture is a GRADE 9 document and it is the
 *      control: its board must still print inside the Introduction's own flow, below the bar.
 *   2. PRIMARY MOVES IT, and moves BOTH halves -- the panels to write and the picture of the
 *      finished board. Half a board on each of two pages is worse than the defect.
 *   3. IT PRINTS ONCE. A hoist that copies is the duplication the whole primary profile exists
 *      to remove (ONE HOME PER SOURCE FIELD, on the printed page).
 *   4. IT LANDS ON PRINTED PAGE 1, on both surfaces -- which is the actual ask, and is a fact
 *      about the PACKER, not about source order. `<div class="page" id="t1">` is the printed
 *      page; slicing to it is the only assertion that cannot pass by accident.
 */

const fs = require('fs');
const path = require('path');

const VENDOR = path.join(__dirname, '..', '..', 'bot', 'vendor', 'lp-v9');
const { buildHtml } = require(path.join(VENDOR, 'lib', 'template'));
const { LABELS } = require(path.join(VENDOR, 'lib', 'overlay'));

const FIXTURE = path.join(__dirname, '__fixtures__', 'v9_gate_base.lp.json');
const baseDoc = () => JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));

/** A grade-4 document: the same fixture, re-provenanced. `isPrimary` reads `provenance.grade`
 *  and nothing else, so this is the whole difference between the two halves of every test here. */
function primaryDoc() {
  const d = baseDoc();
  d.provenance = { ...d.provenance, grade: 4, subject: 'English' };
  d.materials = ['Chalk', 'Board', 'Textbook p.102'];
  return d;
}

const build = (doc, opts = {}) =>
  buildHtml(doc, { docDir: path.dirname(FIXTURE), lang: 'en', ...opts }).html;

const L = LABELS.en;
const BOARD = L.board;                 // "Write on the board" -- the block's own label
const FINAL = L.p2Board;               // "The board at the end of the lesson" -- the figure's

/** Everything after the stylesheet, so a CSS comment or a selector name cannot answer a
 *  content question. Every index below is taken against this string. */
const body = (html) => html.split('</style>').pop();

/** The printed page, as the packer decided it -- `pageHtml` emits one `<div class="page" id="tN">`
 *  per group of atoms it chose to keep together. Source order is not page order, and this is the
 *  difference between the two. */
const printedPage = (html, n) => {
  const b = body(html);
  const start = b.indexOf(`id="t${n}"`);
  if (start < 0) return '';
  const next = b.indexOf(`id="t${n + 1}"`, start);
  return b.slice(start, next < 0 ? b.length : next);
};

/** Where the LAST resources card ends, and where the FIRST section bar begins: the gap her page
 *  map points at. `.rescard` is the three set-up tables; `.bar` opens a lettered section. */
const afterLastRescard = (b) => {
  const i = b.lastIndexOf('class="rescard');
  return i < 0 ? -1 : i;
};
const firstSectionBar = (b) => {
  // NOT `<div class="bar` -- `decorate` emits `data-atom` BEFORE `class` and appends its own
  // `sp-N`, so an atom root's class attribute neither starts where the tag does nor ends where
  // the name does. A regex that assumed otherwise returned -1 here and made every ordering
  // assertion below pass against nothing.
  const m = b.match(/class="(?:[^"]*\s)?bar(?:\s[^"]*)?"/);
  return m ? m.index : -1;
};

const count = (s, needle) => s.split(needle).length - 1;

// ── 1. the control: a GRADE 9 plan prints its board exactly where it always did ──
describe('G6-12 is untouched by construction', () => {
  test('the board block stays inside the Introduction, below its bar', () => {
    const b = body(build(baseDoc()));
    expect(b.indexOf(BOARD)).toBeGreaterThan(firstSectionBar(b));
  });

  test('so does the picture of the finished board', () => {
    const b = body(build(baseDoc()));
    expect(b.indexOf(FINAL)).toBeGreaterThan(firstSectionBar(b));
  });

  test('and where the fixture is short enough to print it on page 1 anyway, it is still '
     + 'below the bar, not above it', () => {
    // The gate fixture is a SHORT document: every one of its Introduction atoms fits on printed
    // page 1 on both surfaces, so "is the board on page 1" cannot tell the two profiles apart
    // here and asserting it would be a green that means nothing. What separates them is the
    // ORDER on that page -- G6-12's board is body copy under its section bar, primary's is
    // furniture above it. On a real 30-minute lesson the same hoist also changes the page
    // number; that is measured on the render, not claimed here.
    const p1 = printedPage(build(baseDoc()), 1);
    expect(p1).toContain(BOARD);
    expect(p1.indexOf(BOARD)).toBeGreaterThan(firstSectionBar(p1));
  });
});

// ── 2. primary hoists BOTH halves of the board into the set-up furniture ──
describe('a primary plan closes its set-up furniture with the board', () => {
  test('the board block sits after the last resources card', () => {
    const b = body(build(primaryDoc()));
    expect(b.indexOf(BOARD)).toBeGreaterThan(afterLastRescard(b));
  });

  test('and before the first section bar, so it is furniture and not a body block', () => {
    const b = body(build(primaryDoc()));
    expect(b.indexOf(BOARD)).toBeLessThan(firstSectionBar(b));
  });

  test('the picture of the finished board travels with it, in that order', () => {
    const b = body(build(primaryDoc()));
    expect(b.indexOf(FINAL)).toBeGreaterThan(b.indexOf(BOARD));
    expect(b.indexOf(FINAL)).toBeLessThan(firstSectionBar(b));
  });
});

// ── 3. a hoist that copies is not a hoist ──
describe('one home per source field, on the printed page', () => {
  test('WRITE ON THE BOARD prints once on a primary plan, as it does on a G9 one', () => {
    // The fixture also carries a board in the CONCLUSION -- a different board, left alone. The
    // count is therefore the same on both sides, and it is the SAMENESS that proves nothing
    // was duplicated on the way up the page.
    expect(count(body(build(primaryDoc())), BOARD))
      .toBe(count(body(build(baseDoc())), BOARD));
  });

  test('and the finished-board figure prints once', () => {
    expect(count(body(build(primaryDoc())), FINAL)).toBe(1);
  });

  test('the DOCUMENT is not edited -- the board is still the last block of the introduction', () => {
    const d = primaryDoc();
    build(d);
    const intro = d.sections.find((s) => s.id === 'introduction');
    expect(intro.blocks[intro.blocks.length - 1].type).toBe('board');
  });
});

// ── 4. the ask itself: printed page 1, on both surfaces ──
describe('the board lands on printed page 1', () => {
  const bothHalvesAboveTheFirstBar = (html) => {
    const p1 = printedPage(html, 1);
    expect(p1).toContain(BOARD);
    expect(p1).toContain(FINAL);
    // Above the first bar, on the page the packer actually cut -- not merely present on it. The
    // G6-12 control is present on page 1 too, and is wrong.
    expect(p1.indexOf(BOARD)).toBeLessThan(firstSectionBar(p1));
    expect(p1.indexOf(FINAL)).toBeLessThan(firstSectionBar(p1));
  };

  test('on the phone', () => bothHalvesAboveTheFirstBar(build(primaryDoc())));

  test('and on A4', () => bothHalvesAboveTheFirstBar(build(primaryDoc(), { format: 'a4' })));
});
