/**
 * THE TYPE SCALE — v9.2 (2026-09-06, lane 07_font, bead bd-oak77.12).
 *
 * Operator, verbatim: *"could we please increase the font on the lesson plan even further to
 * ensure its readability? Currently, it's very small, and it's very hard to read. Please increase
 * the size by 1 or 2 pt, or figure out what makes it readable if one is holding a phone at an
 * arm's length distance."*
 *
 * The body went 18px -> 21px and every other size by the same factor. The measurement behind that
 * number, including the honest statement that it reaches 67% and not 100% of the arm's-length
 * floor, is in `prod_golive_2026-09-06/07_font/READABILITY.md`.
 *
 * WHY THIS SUITE EXISTS HERE, when the canon has its own (`lp_html/test/type_scale.js`):
 * upstream's suites are NOT vendored and do not run in this repo (SYNC.md §5). The renderer that
 * serves a Pakistani teacher is the copy in `bot/vendor/lp-v9`, and until now nothing in this repo
 * asserted a single thing about the size of the type it paints. Three properties are checked here
 * that only this repo CAN check:
 *
 *   1. the vendored engine's body size EQUALS the shared token in
 *      `bot/shared/templates/niete-brand.js` — the join between two teacher-facing PDF stacks that
 *      must not disagree about what "readable" means, and which no upstream test can see;
 *   2. the floors in the vendored `render_lp.js` are DERIVED from the scale, never literals;
 *   3. the page caps moved with the type and Urdu is never tighter than English.
 *
 * It is unit-only on purpose: this repo's Jest run has no browser (`tests/__mocks__`), so the
 * pagination half of the contract lives upstream, where a browser exists, and is pinned there on
 * three real corpus documents.
 */

const path = require('path');

const VENDOR = path.join(__dirname, '..', '..', 'bot', 'vendor', 'lp-v9');
const { TYPE_SCALE, BODY_PX, BODY_PX_V91, scaledPx, scaleTypeCss } = require(path.join(VENDOR, 'lib', 'template'));
const { BODY_FLOOR_PX, CHIP_FLOOR_PX, pageCapsFor, MAX_PAGES, MAX_PAGES_UR } = require(path.join(VENDOR, 'render_lp'));

describe('the v9.2 type scale', () => {
  test('the body is 21px and the v9.1 reference is kept at 18', () => {
    expect(BODY_PX_V91).toBe(18);
    expect(BODY_PX).toBe(21);
    expect(TYPE_SCALE).toBeCloseTo(21 / 18, 12);
  });

  test('it agrees with the shared teacher-artefact type token', () => {
    // `niete-brand.js` declares TYPE_FLOOR.body for every teacher-facing rendered artefact and
    // the quiz PDFs are built on it. The vendored engine may not `require` it — reaching into the
    // host app is a divergence SYNC.md would never let upstream carry — so THIS ASSERTION IS THE
    // JOIN. If the token moves and this constant does not, a teacher gets two PDFs from the same
    // bot, on the same day, that disagree about how big readable is.
    //
    // Skipped rather than failed where the brand module is absent: the lp612 lane ships to `main`
    // ahead of the quiz lane, so the token legitimately does not exist on every base this file
    // is merged onto. A skip says so out loud; a silent pass would not.
    let TYPE_FLOOR;
    try {
      ({ TYPE_FLOOR } = require('../../bot/shared/templates/niete-brand'));
    } catch (_) {
      console.warn('SKIPPED: bot/shared/templates/niete-brand.js is not on this branch, so the '
        + 'shared-token join is UNVERIFIED here. It is asserted wherever both exist.');
      return;
    }
    expect(TYPE_FLOOR.body).toBe(BODY_PX);
  });

  test('scaledPx rounds to 2 dp, because that is what the browser serialises', () => {
    // Measured, not reasoned: the first +1pt corpus render died with
    // "TYPE FLOOR: smallest body text is 19.33px (<19.333px)" — a stylesheet written at 3 dp,
    // read back at 2, and a floor check failing on nothing but the rounding.
    expect(scaledPx(18)).toBe(21);
    expect(scaledPx(14)).toBe(16.33);
    for (const px of [13.5, 15.5, 16.5, 18.5, 28.5]) {
      expect(String(scaledPx(px)).split('.')[1] || '').toHaveLength(
        String(scaledPx(px)).includes('.') ? String(scaledPx(px)).split('.')[1].length : 0,
      );
      expect(scaledPx(px)).toBe(Number((px * TYPE_SCALE).toFixed(2)));
    }
  });

  test('scaleTypeCss touches font-size and nothing else', () => {
    expect(scaleTypeCss('a{font-size:18px;padding:18px;border:18px;border-radius:18px}', 2))
      .toBe('a{font-size:36px;padding:18px;border:18px;border-radius:18px}');
    // em/unitless values scale with their parent for free and must be left alone
    expect(scaleTypeCss('a{font-size:1.24em}', 2)).toBe('a{font-size:1.24em}');
    // a scale of 1 is a no-op, so a future revert is a one-constant change
    expect(scaleTypeCss('a{font-size:18px}', 1)).toBe('a{font-size:18px}');
  });
});

describe('the render floors follow the scale rather than restating it', () => {
  test('BODY_FLOOR_PX and CHIP_FLOOR_PX are derived', () => {
    // A floor written as a literal passes trivially the moment the scale moves, and stops
    // catching the regression it exists for. It must be computed, and computed with the SAME
    // rounding the stylesheet uses.
    expect(BODY_FLOOR_PX).toBe(scaledPx(18));
    expect(CHIP_FLOOR_PX).toBe(scaledPx(14));
    expect(BODY_FLOOR_PX).toBe(21);
    expect(CHIP_FLOOR_PX).toBe(16.33);
  });

  test('the body floor is never below the chip floor', () => {
    expect(BODY_FLOOR_PX).toBeGreaterThan(CHIP_FLOOR_PX);
  });
});

describe('the page caps moved with the type', () => {
  // Lowered again 2026-09-11 (bd-g6sww): the operator's "no LP ships at 11-16 pages" ceiling
  // (bd-q29w9) sits below what the v9.2 type-scale caps (7/6 EN, 9/7 UR) allowed on their own.
  test('English is teach 4 / support 3', () => {
    expect(pageCapsFor('en').max).toEqual({ teach: 4, support: 3 });
    expect(pageCapsFor('en').warn).toEqual({ teach: 3, support: 2 });
  });

  test('Urdu is teach 5 / support 4', () => {
    expect(pageCapsFor('ur').max).toEqual({ teach: 5, support: 4 });
    expect(pageCapsFor('ur').warn).toEqual({ teach: 4, support: 3 });
  });

  test('Urdu is never tighter than English on any part', () => {
    // The property that outlives any particular pair of numbers: the same words measure ~+33%
    // more paper under Nastaliq's leading, so an Urdu cap below the English one would fail every
    // Urdu render of a document English delivers.
    for (const part of ['teach', 'support']) {
      expect(MAX_PAGES_UR[part]).toBeGreaterThanOrEqual(MAX_PAGES[part]);
    }
  });
});
