/**
 * A FIGURE THAT MISSES THE LEGIBILITY FLOOR IS WIDENED, NOT REPORTED — bd-oak77.14.
 *
 * THE PRODUCTION INCIDENT this test is made of. 2026-09-06, the FIRST Urdu tap on prod:
 * `grade_12_chemistry.c14.p227-230`, row `c41e8fd2-f401-42bc-a177-0897f36a1678`. Five minutes of
 * authoring, a finished 12-page PDF already written to disk, and the final render refused it for
 * ONE remaining defect:
 *
 *   FIGURE TOO SMALL: diagram "molecule" renders its smallest label at 13.25px in a 729px
 *   column (floor 13.5px). It needs 743px of width — give it a full-width row, or simplify it.
 *
 * The renderer's own advice had nothing left to give: the figure was ALREADY in a full-width row
 * (the doc contains no `split` at all — checked). `FULL_COL` is 729px
 * (`PAGE_INNER_W 794−21*2 = 752`, minus `FIG_CHROME 10*2+3 = 23`), and the figure wanted 743.
 * The 14px it was short is sitting inside the figure's own padding and border.
 *
 * WHY 13.25 AND NOT THE ENGLISH RUN'S 14.91 — and it is NOT a language defect. Both runs draw the
 * same viewBox (660 × 392.6). The failed run authored a LARGER molecular graph
 * (`c1ccc(cc1)C(=NNC(=O)N)c1cscn1` vs `C1=CC2=NN=C(S2)NC(=O)C1`), so OCL's fragment scale
 * (`types/molecule.js` `placeFragment`: `max(1, min(2, …))`) clamps at 1 and the 12-unit subscript
 * stays 12 instead of being scaled up to 13.5. Swapping ONLY `smiles` between the two specs moves
 * `data-min-font` 12 → 13.5 and the defect disappears — measured field by field in
 * `prod_golive_2026-09-06/09_never_fail/label_experiment.js`. The same document requested in
 * English would have died the same way.
 *
 * THE REPAIR is geometry, not authoring: a FULL-WIDTH figure reclaims its own chrome and, if that
 * is still short, up to `FIG_BLEED_MAX` px of the page's 21px side margin — then re-measures with
 * the SAME `requiredBox`. 12 × 752/660 = 13.67px, over the floor. Bounded, symmetric, and the
 * document is never touched.
 *
 * WHY THE SVG BYTES ARE A FIXTURE. `openchemlib` is STUBBED in the root jest suite
 * (`tests/jest.config.js` moduleNameMapper) and throws on use, so a molecule cannot be re-rendered
 * here. The fixture carries the REAL bytes the real engine produced for the two prod specs;
 * regenerate with `09_never_fail/measure_molecule.js` after a `bot/ npm ci`.
 *
 * Red-first on the base branch: every assertion below fails there, with the verbatim prod string.
 */

const path = require('path');

const SPECS = require('./__fixtures__/prod_2026-09-06_halicin_molecule.json');

// The diagram engine, replaced by the RECORDED bytes for these two specs. Anything else falls
// through to a small deterministic SVG so the other fixture blocks still build.
jest.mock('../../bot/vendor/lp-v9/diagrams', () => {
  const F = require('./__fixtures__/prod_2026-09-06_halicin_molecule.json');
  return {
    IS_STUB: false,
    renderDiagram: (spec) => {
      if (spec && spec.__svg) return spec.__svg;
      if (spec && spec.smiles === F.failed_ur.smiles) return F.failed_ur_svg;
      if (spec && spec.smiles === F.delivered_en.smiles) return F.delivered_en_svg;
      throw new Error(`no recorded SVG for ${spec && spec.type}`);
    },
  };
});

const { buildHtml, PAGE, FULL_COL, FIG_GROW_MAX, DIAGRAM_MIN_PX, DIAGRAM_MIN_PX_A4 }
  = require('../../bot/vendor/lp-v9/lib/template.js');
const { requiredBox } = require('../../bot/vendor/lp-v9/diagrams/lib/svg.js');

const BASE = require('./__fixtures__/v9_gate_base.lp.json');

// The A4 numbers the 2026-09-06 PROD INCIDENT happened on. They are frozen on purpose: the first
// describe below re-plays that incident from the engine's recorded bytes, and an incident does not
// change because the page later did. Everything that goes through TODAY's engine reads the
// engine's own constants instead — v9.3 lays out on a 520px page, so FULL_COL is 455, not 729, and
// a test carrying the old literal would assert the geometry of a page nobody is served (bd-oak77.16).
const FULL_COL_A4 = 729;   // PAGE_INNER_W (794 − 21*2) − FIG_CHROME (10*2 + 3), at v9.2
const PAGE_SIDE_PAD = PAGE.padX;  // the page's own left/right padding — the ceiling on any bleed

function build(spec, lang = 'en') {
  const d = JSON.parse(JSON.stringify(BASE));
  d.sections[0].blocks.push({ type: 'diagram', spec });
  return buildHtml(d, { lang, docDir: path.join(__dirname, '__fixtures__') });
}

/** An SVG with an arbitrary geometry, so a case can be built without a chemistry engine. */
const svgOf = (vbW, vbH, minFont) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${vbW} ${vbH}" width="100%" `
  + `preserveAspectRatio="xMidYMid meet" role="img" data-min-font="${minFont}" `
  + `aria-label="synthetic"><text font-size="${minFont}">x</text></svg>`;

describe('the prod incident, reproduced from the real engine\'s own bytes', () => {
  test('the failed run\'s molecule renders its smallest label at 13.25px in a 729px column', () => {
    const box = requiredBox(SPECS.failed_ur_svg, { minPx: DIAGRAM_MIN_PX_A4, colPx: FULL_COL_A4 });
    expect(box.minFont).toBe(12);
    expect(box.renderedPx).toBe(13.25);   // the number in the prod log line, to the digit
    expect(box.minWidthPx).toBe(743);     // and the width it asked for
  });

  test('the ENGLISH run of the SAME segment clears the floor — this was never a language defect', () => {
    const box = requiredBox(SPECS.delivered_en_svg, { minPx: DIAGRAM_MIN_PX_A4, colPx: FULL_COL_A4 });
    expect(box.minFont).toBe(13.5);
    expect(box.renderedPx).toBeGreaterThanOrEqual(DIAGRAM_MIN_PX_A4);
    // Identical viewBox in both — so the difference is the molecular graph, not the labels.
    expect(SPECS.delivered_en_svg).toContain('viewBox="0 0 660 392.6"');
    expect(SPECS.failed_ur_svg).toContain('viewBox="0 0 660 392.6"');
  });
});

describe('a full-width figure reclaims its own chrome instead of failing the lesson', () => {
  test('the 2026-09-06 molecule no longer produces FIGURE TOO SMALL', () => {
    expect(build(SPECS.failed_ur).figureProblems).toEqual([]);
  });

  test('the widening is RECORDED — a silent repair is a regression mask (rule 24(b))', () => {
    const out = build(SPECS.failed_ur);
    expect(out.figureRepairs).toEqual([
      expect.objectContaining({
        code: 'FIGURE_WIDENED',
        specType: 'molecule',
        colPx: FULL_COL,
        floorPx: DIAGRAM_MIN_PX,
      }),
    ]);
    const r = out.figureRepairs[0];
    // it was short, it asked for more width than the column has, and afterwards it clears —
    // stated as the RELATIONS that make the repair a repair, not as this page's three numbers
    expect(r.renderedPxBefore).toBeLessThan(DIAGRAM_MIN_PX);
    expect(r.neededPx).toBeGreaterThan(FULL_COL);
    expect(r.renderedPxAfter).toBeGreaterThanOrEqual(DIAGRAM_MIN_PX);
  });

  test('the widened figure is emitted with a bounded, symmetric growth', () => {
    const out = build(SPECS.failed_ur);
    // The INLINE style on the figure — the stylesheet mentions the property on every render.
    // The INLINE style on the figure — the stylesheet mentions the property on every render, and
    // the packer rewrites the tag (`<figure data-atom class="dg sp-3" style=…>`), so match the
    // attribute rather than a literal tag.
    const m = out.html.match(/<figure[^>]*style="[^"]*--fig-wide:\s*(\d+(?:\.\d+)?)px/);
    expect(m).toBeTruthy();
    const grow = Number(m[1]);
    expect(grow).toBeGreaterThan(0);
    // Never past the page's own side padding: a figure that bleeds off the paper is a worse
    // defect than the one being fixed.
    expect(grow).toBeLessThanOrEqual(PAGE_SIDE_PAD);
    // and it is the SMALLEST growth that clears the floor, not the maximum available
    expect(12 * ((FULL_COL + 2 * grow) / 660)).toBeGreaterThanOrEqual(DIAGRAM_MIN_PX);
    if (grow < FIG_GROW_MAX) {
      // only meaningful below the ceiling: at the ceiling the growth is capped, not chosen
      expect(12 * ((FULL_COL + 2 * (grow - 1)) / 660)).toBeLessThan(DIAGRAM_MIN_PX);
    }
  });

  test('a figure that already clears the floor is left completely alone', () => {
    const out = build(SPECS.delivered_en);
    expect(out.figureProblems).toEqual([]);
    expect(out.figureRepairs).toEqual([]);
    expect(out.html).not.toMatch(/<figure[^>]*style="[^"]*--fig-wide/);
  });

  test('a figure the widening CANNOT save still reports FIGURE TOO SMALL', () => {
    // The escape hatch stays shut. A drawing far too wide for the page is a real defect and the
    // ladder is entitled to see it — the never-fail policy handles it downstream by DELIVERING
    // and flagging, which is a different decision made in a different place.
    const out = build({ type: 'flow', __svg: svgOf(2000, 900, 12) });
    expect(out.figureProblems.length).toBe(1);
    expect(out.figureProblems[0]).toMatch(/^FIGURE TOO SMALL:/);
    // and the message says what was ALREADY TRIED — accurately. It must not claim a widening that
    // did not happen; the model reads this string as a revision instruction, and "we widened it and
    // it still failed" would send it looking for a layout answer that has already been exhausted.
    expect(out.figureProblems[0])
      .toMatch(new RegExp(`the most the page can give it is \\+${FIG_GROW_MAX}px a side`));
    expect(out.figureProblems[0]).toMatch(/split it into two smaller figures/);
    expect(out.figureProblems[0]).not.toMatch(/already widened/i);
  });

  test('a split-column figure is HOISTED to a full-width row FIRST, then widened if it is still short', () => {
    // The renderer's advice — "give it a full-width row" — is already ENFORCED, not merely
    // suggested: `R.split`'s `keep()` measures every diagram against its half-column and hoists
    // an illegible one out of the split into a full-width row underneath it (that code predates
    // this bead). So the escalation a teacher's document actually goes through is:
    //     half column  ->  hoisted to full width  ->  widened by up to FIG_GROW_MAX a side
    //                  ->  and only then a defect, which the never-fail policy delivers flagged.
    // This test pins the two repairs COMPOSING. Without the hoist the widening would be asked to
    // rescue a ~360px column, which it cannot and must not (the space beside it belongs to the
    // other column).
    const d = JSON.parse(JSON.stringify(BASE));
    d.sections[0].blocks.push({
      type: 'split',
      ratio: 0.5,
      left: [{ type: 'paragraph', text: 'the words that sit beside the figure' }],
      right: [{ type: 'diagram', spec: { type: 'flow', __svg: svgOf(660, 392.6, 12) } }],
    });
    const out = buildHtml(d, { lang: 'en', docDir: path.join(__dirname, '__fixtures__') });

    // hoisted: it is measured at FULL_COL, not at its half of the split
    expect(out.figureRepairs).toEqual([
      expect.objectContaining({ code: 'FIGURE_WIDENED', colPx: FULL_COL }),
    ]);
    // the hoist is the point: it is measured at the FULL column, not at its half of the split
    expect(out.figureRepairs[0].growPx).toBeGreaterThan(0);
    expect(out.figureRepairs[0].growPx).toBeLessThanOrEqual(FIG_GROW_MAX);
    // and the composed result is a legible figure, not a defect
    expect(out.figureProblems).toEqual([]);
  });
});
