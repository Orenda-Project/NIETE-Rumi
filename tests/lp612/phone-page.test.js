/**
 * THE PHONE-FIRST PAGE — v9.3 (2026-09-07, lane 15_phone_page, bead bd-oak77.16).
 *
 * 07_font raised the body 18px -> 21px and measured, honestly, that it lands at 67% of the
 * arm's-length reading floor: an A4 page box fit to a 390-px phone is scaled by 390/794 = 0.4912
 * before anyone reads it, and no type size A4 will carry closes that. The remaining term is the
 * PAGE, and this is the suite that guards it.
 *
 * WHAT MAKES THESE TESTS DIFFERENT FROM "a constant changed".
 *
 * Every assertion below is taken from the HTML `buildHtml` ACTUALLY EMITS for a real lesson
 * document — the stylesheet it wrote, the page box it declared, the cards it laid out. The
 * headline test parses the body size and the page width back OUT of that stylesheet and walks
 * them through the same physical chain READABILITY.md validated against the renderer's own probe
 * (Inter's sxHeight/unitsPerEm, a 390-px viewport on 64.98 mm of glass, a 40 cm reading distance)
 * and asserts the result clears 12 arcmin. If someone widens the page or shrinks the type, the
 * arithmetic — not a hard-coded number — is what fails.
 *
 * `prod_golive_2026-09-06/15_phone_page/DESIGN.md` carries the measurement, the two-corpus page
 * count and the printing trade-off this geometry was chosen against.
 *
 * Unit-only, like `type-scale.test.js`: this repo's Jest run has no browser. The pagination half
 * of the contract is measured by the corpus replay in the lane folder (62 documents x 12 arms,
 * plus all 116 lessons production has delivered) and recorded in DESIGN.md §4.
 */

const fs = require('fs');
const path = require('path');

const VENDOR = path.join(__dirname, '..', '..', 'bot', 'vendor', 'lp-v9');
const TPL = require(path.join(VENDOR, 'lib', 'template'));
const { buildHtml, PAGE, PAGE_CONTENT_H, BODY_PX } = TPL;

const FIXTURE = path.join(__dirname, '__fixtures__', 'v9_gate_base.lp.json');
const doc = () => JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));

// ── the physical chain, exactly as READABILITY.md defines it ─────────────────
// Inter's own sxHeight / unitsPerEm, read from the shipped Inter-Regular.ttf.
const XHEIGHT_PER_EM = 0.5411;
// A 390 CSS-px viewport is 64.98 mm of glass on an iPhone 14, so one CSS px is 65/390 mm.
const PHONE_CSS_PX = 390;
const MM_PER_PHONE_CSS_PX = 64.98 / PHONE_CSS_PX;
// Legge & Bigelow 2011: critical print size for fluent reading is 0.2 deg of x-height.
const FLOOR_ARCMIN = 12.0;
const READING_DIST_MM = 400;

const arcmin = (mm, dist = READING_DIST_MM) =>
  (Math.atan((mm / 2) / dist) * 2 * 180 / Math.PI) * 60;

/** The teacher's eye, from the stylesheet the renderer just wrote. */
function apparentXHeightMm(bodyPx, pageWidthPx) {
  return bodyPx * XHEIGHT_PER_EM * (PHONE_CSS_PX / pageWidthPx) * MM_PER_PHONE_CSS_PX;
}

function built(lang = 'en') {
  return buildHtml(doc(), { lang, docDir: path.dirname(FIXTURE) }).html;
}

/** the body font-size the emitted sheet actually sets on `html,body` */
function emittedBodyPx(html) {
  const m = html.match(/html,body\{[\s\S]*?font-size:\s*([\d.]+)px/);
  if (!m) throw new Error('no html,body font-size in the emitted stylesheet');
  return Number(m[1]);
}

/** the page box the emitted sheet actually declares */
function emittedPageBox(html) {
  const m = html.match(/--page-w:\s*([\d.]+)px;\s*--page-h:\s*([\d.]+)px/);
  if (!m) throw new Error('no --page-w/--page-h in the emitted stylesheet');
  return { w: Number(m[1]), h: Number(m[2]) };
}

describe('v9.3 — the page a teacher actually reads', () => {
  test('THE HEADLINE: the emitted page puts the emitted body AT OR ABOVE the arm\'s-length floor', () => {
    // Both numbers come out of the document the renderer just built. Nothing here is asserted
    // against a literal geometry: the physics is the test.
    const html = built('en');
    const bodyPx = emittedBodyPx(html);
    const page = emittedPageBox(html);

    const mm = apparentXHeightMm(bodyPx, page.w);
    const arc = arcmin(mm);

    // 1.40 mm of x-height at 40 cm. v9.1 delivered 0.797 mm (57%), v9.2 delivers 0.930 (67%).
    expect(mm).toBeGreaterThanOrEqual(1.40);
    expect(arc).toBeGreaterThanOrEqual(FLOOR_ARCMIN);
  });

  test('the Urdu build is laid out on the same page box — Urdu is never given the smaller page', () => {
    const en = emittedPageBox(built('en'));
    const ur = emittedPageBox(built('ur'));
    expect(ur).toEqual(en);
    expect(apparentXHeightMm(emittedBodyPx(built('ur')), ur.w)).toBeGreaterThanOrEqual(1.40);
  });

  test('the print page box matches the layout page box — @page cannot disagree with --page-w', () => {
    const html = built('en');
    const box = emittedPageBox(html);
    const m = html.match(/@page\s*\{\s*size:\s*([^;]+);/);
    expect(m).toBeTruthy();
    // "A4" is the v9.2 value and is exactly the disagreement this guards: a 520px --page-w with
    // an A4 @page prints the layout onto a sheet 274px wider than it was laid out for.
    expect(m[1].trim()).toBe(`${box.w}px ${box.h}px`);
  });

  test('ONE geometry object owns the page, and it is frozen', () => {
    expect(PAGE).toBeDefined();
    expect(Object.isFrozen(PAGE)).toBe(true);
    for (const k of ['w', 'h', 'padX', 'padT', 'padB']) {
      expect(typeof PAGE[k]).toBe('number');
    }
    // the exported content height is DERIVED, never a second literal
    expect(PAGE_CONTENT_H).toBe(PAGE.h - PAGE.padT - PAGE.padB);
    // and the emitted sheet agrees with it
    expect(emittedPageBox(built('en'))).toEqual({ w: PAGE.w, h: PAGE.h });
  });

  test('the type scale is NOT what changed here — the body is still v9.2\'s 21px', () => {
    // The whole point of a phone-first page is that it reaches the floor without another type
    // rise. If a later change reaches for the type instead, this says so.
    expect(BODY_PX).toBe(21);
    expect(emittedBodyPx(built('en'))).toBe(21);
  });
});

describe('v9.3 — what a narrow measure breaks, and what was done about it', () => {
  test('the footer STACKS: a two-column footer wraps to 188px on a phone page', () => {
    // Measured on cell_c06 (Urdu): 74px -> 188px per page, which is what pushed 29 of 62
    // documents into OVERFLOW with `overflowingSections` empty — the page furniture, not the
    // lesson, over the line. DESIGN.md section 5(a).
    const html = built('en');
    // anchored to the start of a line: `body.measuring .foot{ margin-top:0 }` also contains
    // ".foot{" and is not the rule this is about.
    const foot = html.match(/\n\.foot\{[^}]*\}/);
    expect(foot).toBeTruthy();
    expect(foot[0]).not.toMatch(/justify-content:\s*space-between/);
    expect(foot[0]).toMatch(/display:\s*block/);
    // and the right half may no longer refuse to wrap
    const fr = html.match(/\.foot \.fr\{[^}]*\}/);
    expect(fr).toBeTruthy();
    expect(fr[0]).not.toMatch(/white-space:\s*nowrap/);
  });

  test('multi-column card grids collapse to ONE column', () => {
    const html = built('en');
    const g2 = html.match(/\.grid2\{[^}]*\}/)[0];
    const g3 = html.match(/\.grid3\{[^}]*\}/)[0];
    // at a 478px measure a grid3 cell is 154px — about seven characters a line
    expect(g2).toMatch(/grid-template-columns:\s*1fr\s*;/);
    expect(g3).toMatch(/grid-template-columns:\s*1fr\s*;/);
    expect(html.match(/\.split\{[^}]*\}/)[0]).toMatch(/display:\s*block/);
    expect(html.match(/\.secrow\{[^}]*\}/)[0]).toMatch(/display:\s*block/);
  });

  test('EVERY side-by-side pair is collapsed — including the four found by reading the render', () => {
    // grid2/grid3/split/secrow were found by grepping the template. These four were not: they
    // were found by rendering the whole diagram-and-block sweep at 390px and LOOKING at it.
    //   .hero    the masthead — h-meta is `flex:0 1 auto`, so at a 478px measure it shrank to
    //            ~110px and printed the chapter line down five lines while stealing width from
    //            the title. The same pathology the h-meta comment records at 794px.
    //   .p2head  the support page's masthead — eight lines of wrapped meta beside the title.
    //   .se      support / extend, the same shape.
    // A grep-only list is how three of these shipped past the first pass; the assertion is
    // therefore "no rule in the emitted sheet lays two equal columns", not a list of names.
    //
    // `.nxt` was the fourth — next period / not going, two ~230px cards, worst in Urdu. It left
    // this list in bd-a8veu.20 with the section it styled: the support page no longer paints
    // Next period / Not going today, so there is no `.nxt` rule in the sheet to collapse. A name
    // that no longer exists cannot be asserted on; the rule it named is gone, not widened.
    const html = built('en');
    for (const sel of ['.hero', '.p2head', '.se']) {
      const rule = html.match(new RegExp(`\\${sel}\\{[^}]*\\}`));
      expect(rule).toBeTruthy();
      expect(rule[0]).toMatch(/display:\s*block/);
      expect(rule[0]).not.toMatch(/display:\s*flex/);
    }
    // and the meta columns are no longer capped to a fraction of a column that no longer exists
    expect(html.match(/\.hero \.h-meta\{[^}]*\}/)[0]).toMatch(/max-width:\s*100%/);
  });

  test('the Urdu sheet collapses the same pairs — Urdu wraps harder, not less', () => {
    const html = built('ur');
    for (const sel of ['.hero', '.p2head', '.se', '.split', '.secrow']) { // `.nxt` — see above
      expect(html.match(new RegExp(`\\${sel}\\{[^}]*\\}`))[0]).toMatch(/display:\s*block/);
    }
    expect(html.match(/\.grid3\{[^}]*\}/)[0]).toMatch(/grid-template-columns:\s*1fr\s*;/);
  });

  test('a grid row carries exactly ONE card, so the packer can break between them', () => {
    // The fixture has 3 `mistakes` and 5 `model_answers`. On A4 those were 1 grid3 row and 3
    // grid2 rows; a break may never fall inside a row, so each card must now be its own row.
    const d = doc();
    const html = buildHtml(d, { lang: 'en', docDir: path.dirname(FIXTURE) }).html;
    // count the class in the class LIST — decorate() appends the spacing rung, so what is
    // emitted is `<div data-atom class="grid3 sp-2">`.
    const body = html.slice(html.indexOf('</style>'));
    const rows = (cls) => (body.match(new RegExp(`class="${cls}[\\s"]`, 'g')) || []).length;
    expect(rows('grid2')).toBe(d.page2.model_answers.length + d.page2.homework_key.length);
    // Differentiation used to be the ONE exception: a hand-written `<div class="grid3">` holding
    // all three fixed cards in a single unbreakable atom. bd-a8veu.10 moved it into the flow and
    // split it the same way as everything else — one card, one row, one atom — so the exception
    // is gone and the rule in this test's own title now holds without a footnote.
    const DIFF_CARDS = 3; // stuck / barrier / early
    expect(rows('grid3')).toBe(d.page2.mistakes.length + DIFF_CARDS);
  });

  test('two consecutive half sections are NOT paired into a side-by-side band', () => {
    // A `secrow` gives each half section a 210px column at a phone measure, and its figures with
    // it. The band is one atom, so it also cannot be broken across a page.
    const d = doc();
    d.sections[1].layout = 'half';
    d.sections[2].layout = 'half';
    const html = buildHtml(d, { lang: 'en', docDir: path.dirname(FIXTURE) }).html;
    // NB: match the class INSIDE the class list, not `<div class="secrow">` — decorate() adds a
    // `data-atom` attribute and appends the spacing rung, so what is emitted is
    // `<div data-atom class="secrow sp-4">`. Two earlier spellings of this assertion passed
    // against the OLD code, which is exactly the shape of test that proves nothing.
    const body = html.slice(html.indexOf('</style>'));
    expect(body).not.toMatch(/class="secrow[\s"]/);
  });

  test('the diagram label floor scales BY THE COLUMN — not by the page, and not at all', () => {
    // requiredBox() sizes a figure so its smallest label clears this floor IN THE FIGURE'S OWN
    // COLUMN, and `FIGURE` is not on lint's ADVISORY_CODES — so this floor decides whether the
    // authoring ladder spends a revision round, and whether a lesson can be lost. Measured over
    // the 116 lessons production has delivered (DESIGN.md section 5(c)):
    //   13.5 in a 455px column  ->  159 blocking failures across 101 of 116   (unusable)
    //   8.84 (scaled by PAGE.w) ->   26 across  25   — still 3x today, because padX and
    //                                                  FIG_CHROME did not shrink with the page
    //   8.43 (scaled by FULL_COL) -> 8 across   8    — today's set, exactly
    const { DIAGRAM_MIN_PX, DIAGRAM_MIN_PX_A4, FULL_COL, FULL_COL_A4, pageScaled } = TPL;
    expect(DIAGRAM_MIN_PX_A4).toBe(13.5);
    // derived, never a second literal — 2dp for the same reason `scaledPx` is 2dp
    expect(DIAGRAM_MIN_PX).toBeCloseTo(DIAGRAM_MIN_PX_A4 * (FULL_COL / FULL_COL_A4), 2);
    // and NOT the page ratio, which is the mistake this test exists to pin
    expect(DIAGRAM_MIN_PX).not.toBe(pageScaled(DIAGRAM_MIN_PX_A4));
    // ACCEPTANCE-neutral: a figure that exactly cleared the floor on A4 exactly clears it here
    expect(DIAGRAM_MIN_PX_A4 * (FULL_COL / FULL_COL_A4)).toBeCloseTo(DIAGRAM_MIN_PX, 2);
    // and the honest cost, stated rather than hidden: ~5% smaller on the phone than today
    const now = apparentXHeightMm(DIAGRAM_MIN_PX, PAGE.w);
    const before = apparentXHeightMm(DIAGRAM_MIN_PX_A4, TPL.PAGE_A4.w);
    expect(now / before).toBeGreaterThan(0.94);
    expect(now / before).toBeLessThan(1.0);
  });

  test('lint reads BOTH the column and the floor from the renderer, never a literal', () => {
    // lint_lp.js's 10d gate runs during AUTHORING. On `main` it already imported FULL_COL while
    // hardcoding 13.5; with a 455px column that combination is 159 blocking failures across 101
    // of 116 real lessons — strictly worse than hardcoding both. One definition, imported.
    const src = fs.readFileSync(path.join(VENDOR, 'lint_lp.js'), 'utf8');
    expect(src).toMatch(/const \{ FULL_COL, DIAGRAM_MIN_PX \} = require\("\.\/lib\/template\.js"\)/);
    expect(src).toMatch(/requiredBox\(svg, \{ minPx: DIAGRAM_MIN_PX, colPx: FULL_COL \}\)/);
    expect(src).not.toMatch(/minPx:\s*13\.5/);
    expect(src).not.toMatch(/renderedPx < 13\.5/);
  });
});

describe('v9.3 — the renderer prints what it laid out', () => {
  test('render_lp.js prints at the template\'s page box, not at its own copy of it', () => {
    // v9.2 carried `const A4 = { w: 794, h: 1123 }` in render_lp.js AND `--page-w:794px` in the
    // template. Two homes for one number is how a page gets laid out at one size and printed at
    // another. There is now one, and this asserts the renderer reads it.
    const R = require(path.join(VENDOR, 'render_lp'));
    expect(R.PAGE).toBe(PAGE);
    const src = fs.readFileSync(path.join(VENDOR, 'render_lp.js'), 'utf8');
    expect(src).not.toMatch(/const A4 = \{ w: \d+, h: \d+ \};/);
  });

  test('the page caps are the ones the operator asked for', () => {
    // This guard was written for the phone-page lane, where the point was that a page-FORMAT
    // change had not also moved the caps — otherwise nobody could say which did what. That lane
    // is long shipped, and the caps have since moved deliberately: the operator's v9.3 PDF review
    // opened on *"its 10 pages long"* (bd-a8veu.1), and 7/6 was the ceiling that let it be.
    //
    // So the assertion keeps its job — the caps are a decision, not a drift, and a change to them
    // reddens this — but it now pins the DECIDED values instead of the superseded ones.
    const { MAX_PAGES, MAX_PAGES_UR } = require(path.join(VENDOR, 'render_lp'));
    expect(MAX_PAGES).toEqual({ teach: 4, support: 3 });
    expect(MAX_PAGES_UR).toEqual({ teach: 5, support: 4 });
  });
});

describe('a cached lesson re-renders, it does not re-author', () => {
  // Was pinned to v9.3 as the head. The head moved to v9.4 on 2026-09-12 (bd-m1k16), and this
  // guard's job is the SHAPE — the current version leads, every older one the renderer still
  // accepts stays behind it — not one particular literal at the front. v9.3 keeps its own
  // assertion because it is the version whose stored documents the corpus is actually made of.
  test('the current version leads the lineage and v9.3 re-renders behind it', () => {
    const flags = require('../../bot/shared/config/lp612-flags');
    expect(flags.DEFAULT_TEMPLATE_VERSION).toBe('v9.4');
    expect(flags.TEMPLATE_VERSION_LINEAGE).toEqual(['v9.4', 'v9.3', 'v9.2', 'v9.1']);
    // every v9.3, v9.2 and v9.1 PDF in the cache has its `.lp.json` beside it, so the bump costs
    // 0 model calls — 07_font proved the path live on staging (PROOF.md there).
    expect(flags.previousTemplateVersions('v9.4')).toEqual(['v9.3', 'v9.2', 'v9.1']);
    expect(flags.previousTemplateVersions('v9.3')).toEqual(['v9.2', 'v9.1']);
  });
});
