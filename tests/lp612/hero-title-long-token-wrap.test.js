/**
 * THE LESSON TITLE THAT RAN OFF THE PAGE — bd-rvyfd.
 *
 * bd-9la73 made `clipped_x` FAIL a render for the first time. Sweeping all 335 built documents
 * of the ch9-10 rebuild, 238 of them (71%) produce at least one `CLIPPED HORIZONTALLY`. 1,653
 * of the 1,674 element instances are `.contstrip .ct`, `.foot .fl` and `.vres a` — three runs
 * that carry a DELIBERATE one-line clamp (`white-space:nowrap; overflow:hidden;
 * text-overflow:ellipsis`) and render a visible ellipsis inside their own box. Those are not
 * defects, and they are not this suite's business (see the guard at the bottom, which exists so
 * a fix for the real bug cannot quietly unclamp them).
 *
 * The other 21 instances, across 6 Grade-1 documents and always on page t1, ARE a defect, and a
 * raster of `g1_ch10/Maths_seg8` page 1 shows it plainly: the title
 *
 *     Position: Skill Sharpener (above/near/far/inside/straight/right)
 *
 * is sliced dead at the page's right edge with NO ellipsis — in the navy hero AND again in the
 * green TODAY card — and the sliced characters are genuinely absent from the PDF.
 *
 * WHY. `(above/near/far/inside/straight/right)` contains no space, and a solidus is not a
 * soft wrap opportunity, so the whole parenthetical is ONE word, wider than the column. Both
 * boxes are already correctly constrained — `.hero .h-col` and `.band > div` each declare
 * `min-width:0` — so the box does not grow; the word simply paints past it. Neither run
 * declares `overflow-wrap`, so there is no break opportunity to fall back on and the glyphs go
 * over the edge. `.pad`, `.hero`, `.h-col`, `.band` and `.today`/`.jrn`/`.up` all report the
 * same overflow underneath: one cause, one cascade.
 *
 * THE FIX IS THE ONE THIS FILE ALREADY USES ELSEWHERE. `.hero .tchip` has carried
 * `overflow-wrap` since the board badge hung 119px off the hero, for exactly this reason:
 * *"overflow-wrap covers the pathological single long token that would otherwise still push
 * out"*. The title runs never got it. `break-word` rather than `anywhere` is deliberate: it
 * fires ONLY when a word cannot fit on a line of its own, so no title that already lays out
 * correctly changes a single line break, and no page can gain a line from it.
 *
 * NOT A FIX, AND WHY NOT — both are asserted below, because both are the tempting shortcut:
 *   - shrinking the title (the renderer enforces BODY_FLOOR_PX / CHIP_FLOOR_PX, and the
 *     operator's standing complaint is that these pages are hard to read);
 *   - truncating the string (*"dont cut anything"* — the renderer never removes a word).
 *
 * FIXTURE. `primary_g1_english.lp.json` is a real Grade-1 primary document (`isPrimary` true),
 * not the Grade-9 STEM `v9_gate_base.lp.json` — which misses the primary code paths entirely
 * and has let a whole suite pass green over broken code. The pathological topic is the exact
 * string from `renders/g1_ch10/docs/Maths_seg8.lp.json`, copied off the corpus, not invented.
 *
 * Red-first: before the two declarations land, `overflowWrapOf` returns null for both runs and
 * the first two tests fail.
 */

const fs = require('fs');
const path = require('path');

const { buildHtml, isPrimary } = require('../../bot/vendor/lp-v9/lib/template');
const { rule } = require('./__helpers__/colour');

const FIXTURE = path.join(__dirname, '__fixtures__', 'primary_g1_english.lp.json');

/** The real, unbreakable title out of `renders/g1_ch10/docs/Maths_seg8.lp.json`. */
const PATHOLOGICAL = 'Position: Skill Sharpener (above/near/far/inside/straight/right)';

/** The fixture, with the corpus's own longest unbreakable topic on it. */
function doc(topic = PATHOLOGICAL) {
  const d = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  d.provenance = { ...d.provenance, topic };
  return d;
}

const build = (d = doc()) => buildHtml(d, { docDir: path.dirname(FIXTURE) }).html;

/** The emitted sheet, comments stripped so a rationale cannot satisfy an assertion. */
function sheet(html) {
  const open = html.indexOf('<style>');
  return html
    .slice(open + 7, html.lastIndexOf('</style>'))
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/url\(data:[^)]*\)/g, 'url(data:)');
}

/** The `overflow-wrap` (or legacy `word-wrap`) a rule declares, or null when it declares none. */
function overflowWrapOf(css, selector) {
  const decl = rule(css, selector);
  if (decl == null) return null;
  const m = /(?:^|;)\s*(?:overflow-wrap|word-wrap)\s*:\s*([a-z-]+)/.exec(decl);
  return m ? m[1] : null;
}

/** Everything inside `<body>` — so no assertion can be satisfied by the stylesheet. */
function body(html) {
  const i = html.indexOf('<body');
  return html.slice(html.indexOf('>', i) + 1, html.lastIndexOf('</body>'));
}

describe('the fixture is a real primary document', () => {
  // Guard against the trap that cost a sibling suite a 16-test vacuous green: a Grade-9 STEM
  // fixture never enters the primary hero or the journey band at all.
  test('isPrimary, so the hero and the journey band are actually emitted', () => {
    expect(isPrimary(doc())).toBe(true);
    const html = build();
    expect(body(html)).toContain('class="h-title"');
    expect(body(html)).toContain('class="band');
  });
});

describe('a title with no break opportunity stays inside its box', () => {
  test('the hero title can break a word that is wider than its column', () => {
    // `.hero .h-col` already declares min-width:0, so the column does not grow to fit the
    // word — without a break opportunity the glyphs paint past the page edge instead.
    expect(overflowWrapOf(sheet(build()), '.hero .h-title')).toMatch(/^(break-word|anywhere)$/);
  });

  test('the journey/today/coming-up band can break one too', () => {
    // The same topic is printed a second time in the green TODAY card, and overflowed there by
    // 31px on g1_ch10/Maths_seg8 while the hero overflowed by 151px — two boxes, one cause.
    expect(overflowWrapOf(sheet(build()), '.band > div .t')).toMatch(/^(break-word|anywhere)$/);
  });

  test('the column is still constrained — the break rule is a fallback, not the constraint', () => {
    // If min-width:0 ever came off, the flex/grid item would take its min-content width back
    // and the overflow would return with overflow-wrap declared and doing nothing.
    expect(rule(sheet(build()), '.hero .h-col')).toMatch(/min-width:\s*0/);
    expect(rule(sheet(build()), '.band > div')).toMatch(/min-width:\s*0/);
  });
});

describe('the words themselves are untouched', () => {
  test('the hero prints the whole title — no word is cut to make it fit', () => {
    // The standing operator ruling is "dont cut anything": the renderer never removes a word.
    const hero = body(build());
    const m = /<div class="h-title">([\s\S]*?)<\/div>/.exec(hero);
    expect(m).not.toBeNull();
    expect(m[1].replace(/<[^>]*>/g, '')).toBe(PATHOLOGICAL);
  });

  test('a title that already fits is emitted unchanged as well', () => {
    const short = 'Counting to Twenty';
    const m = /<div class="h-title">([\s\S]*?)<\/div>/.exec(body(build(doc(short))));
    expect(m[1].replace(/<[^>]*>/g, '')).toBe(short);
  });

  test('no ellipsis is introduced on the title — it wraps, it does not clip', () => {
    // An ellipsised title would read as a fix and still hide authored words; and, because
    // scrollWidth stays wider than clientWidth on an ellipsised run, it would not even clear
    // the gate that opened this bead.
    const css = sheet(build());
    expect(rule(css, '.hero .h-title')).not.toMatch(/text-overflow/);
    expect(rule(css, '.band > div .t')).not.toMatch(/text-overflow/);
  });
});

describe('the fix does not win by making the page harder to read', () => {
  test('the hero title keeps its size', () => {
    // 33.25px is 28.5px through primary's 1.1667 type scale (scaleTypeCss) -- the literal the
    // primary sheet actually emits. Shrinking type is the one move this bead is explicitly
    // barred from: the operator's complaint about these pages is that they are hard to read.
    expect(rule(sheet(build()), '.hero .h-title')).toMatch(/font-size:\s*33\.25px/);
  });

  test('the TODAY card keeps its size', () => {
    // 26.83px is 23px through the same scale.
    expect(rule(sheet(build()), '.band > .today .t')).toMatch(/font-size:\s*26\.83px/);
  });
});

describe('the deliberate one-line clamps are left alone', () => {
  // 1,653 of the 1,674 clipped_x instances in the corpus are these three runs, and every one of
  // them renders a visible ellipsis INSIDE its box — verified on a 150dpi raster of
  // g5_ch10/Maths_seg4 p1 and g3_ch9/English_seg1 p2. Unclamping them to satisfy the gate would
  // cost the footer its two-line guarantee, the continuation strip a line on every continuation
  // page, and the video row three lines of furniture on a page already at its cap.
  test.each([
    ['.foot .fl'],
    ['.foot .fr'],
    ['.contstrip .ct'],
    ['.vres a'],
  ])('%s still clamps to one line and ellipsises', (selector) => {
    const decl = rule(sheet(build()), selector);
    expect(decl).toMatch(/white-space:\s*nowrap/);
    expect(decl).toMatch(/overflow:\s*hidden/);
    expect(decl).toMatch(/text-overflow:\s*ellipsis/);
  });

  test('none of them gained an overflow-wrap either — that would defeat the clamp', () => {
    const css = sheet(build());
    for (const sel of ['.foot .fl', '.contstrip .ct', '.vres a']) {
      expect(overflowWrapOf(css, sel)).toBeNull();
    }
  });
});
