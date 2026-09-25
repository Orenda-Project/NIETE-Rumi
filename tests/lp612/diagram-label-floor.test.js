/**
 * THE DIAGRAM LABEL FLOOR IS ONE CONSTANT, 14px AT THE A4 MEASURE — bd-oak77.15.
 *
 * The diagram engine's floor was 13.5px at the A4 measure, written down twice: once as
 * requiredBox()'s default in diagrams/lib/svg.js, and once as DIAGRAM_MIN_PX_A4 in
 * lib/template.js. The template scales it by the figure column (455/729) onto the v9.3 phone page,
 * and the figure sizer (figureSlot) and lint rule 10d both judge a diagram against the result.
 *
 * Operator decision (option C, matching upstream): the floor is raised to 14px at the A4 measure,
 * which is 14 × 455/729 = 8.74px on the phone page.
 *   1. One constant, MIN_LABEL_PX = 14 in diagrams/lib/svg.js, is requiredBox()'s default and
 *      the template's A4 floor. DIAGRAM_MIN_PX is that value scaled by the column.
 *   2. Every fixture in the engine's example sweep renders its smallest label at or above
 *      DIAGRAM_MIN_PX in the full-width column that lint judges against.
 *   3. Raising the floor adds no label overlaps anywhere in the sweep.
 *   4. The rest of the phone page is unchanged: same page geometry, same body and chip floors.
 * Raising the floor to the phone chip floor (16.33px) is a redesign, filed as bd-oak77.41.
 *
 * Red-first: on this branch's base the floor is 13.5 (8.43 phone px), svg.js exports no
 * MIN_LABEL_PX, and ten sweep fixtures render their smallest label below 8.74px.
 */
const path = require('path');

const V = path.join(__dirname, '..', '..', 'bot', 'vendor', 'lp-v9');
const { BODY_FLOOR_PX, CHIP_FLOOR_PX } = require(path.join(V, 'render_lp.js'));
const T = require(path.join(V, 'lib', 'template.js'));
const { renderDiagram, allExamples, checkOverlaps } = require(path.join(V, 'diagrams'));
const svgLib = require(path.join(V, 'diagrams', 'lib', 'svg'));
const { requiredBox } = svgLib;

const FLOOR_A4 = 14;
const FULL_COL_A4 = 729; // the A4 drawing box: 794 - 21*2 - (10*2 + 3)
const FLOOR_PHONE = +(FLOOR_A4 * (455 / FULL_COL_A4)).toFixed(2); // 8.74

/** Every example the engine ships, rendered once. A spec that needs the real openchemlib
 *  (stubbed in the root suite) is skipped, never counted as legible. */
const SWEEP = allExamples()
  .map((e) => {
    try {
      return { name: e.name, svg: renderDiagram(e.spec) };
    } catch (err) {
      return { name: e.name, svg: null, err: err.message };
    }
  })
  .filter((r) => r.svg);

describe('bd-oak77.15 — the diagram label floor is one constant, 14px at the A4 measure', () => {
  it('the sweep is not empty (a vacuous pass is not a pass)', () => {
    expect(SWEEP.length).toBeGreaterThan(50);
  });

  it('the engine exports the floor as one constant, MIN_LABEL_PX = 14', () => {
    expect(svgLib.MIN_LABEL_PX).toBe(FLOOR_A4);
  });

  it("requiredBox's default floor is that constant", () => {
    const svg = SWEEP[0].svg;
    expect(requiredBox(svg).minWidthPx).toBe(requiredBox(svg, { minPx: svgLib.MIN_LABEL_PX }).minWidthPx);
  });

  it('the figure sizer and lint floor is that constant, scaled by the column (8.74px)', () => {
    expect(T.DIAGRAM_MIN_PX_A4).toBe(FLOOR_A4);
    expect(T.DIAGRAM_MIN_PX).toBe(FLOOR_PHONE);
  });

  it('every sweep fixture renders its smallest label at or above the floor at full width', () => {
    const below = SWEEP.map((r) => ({
      name: r.name,
      px: requiredBox(r.svg, { minPx: T.DIAGRAM_MIN_PX, colPx: T.FULL_COL }).renderedPx,
    }))
      .filter((r) => r.px != null && r.px < FLOOR_PHONE)
      .map((r) => `${r.name} ${r.px}px`);
    expect(below).toEqual([]);
  });

  it('no sweep fixture has a colliding label pair', () => {
    const colliding = SWEEP.map((r) => ({ name: r.name, n: checkOverlaps(r.svg).length }))
      .filter((r) => r.n > 0)
      .map((r) => `${r.name}: ${r.n}`);
    expect(colliding).toEqual([]);
  });

  it('the rest of the phone page is unchanged', () => {
    expect(T.PAGE.w).toBe(520);
    expect(T.FULL_COL).toBe(455);
    expect(BODY_FLOOR_PX).toBe(21);
    expect(CHIP_FLOOR_PX).toBe(16.33);
  });
});
