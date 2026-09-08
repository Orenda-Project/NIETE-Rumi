'use strict';
/**
 * Transcript quiz figures — phone font scale (bd-mg9c7.52, PLAN_R4 D7 follow-up).
 *
 * Every figure clears the 13.5px label floor on the 1080x565 quiz canvas, but
 * that canvas renders at ~360 CSS px on a mid-range Android — a third of its
 * size — so the child reads labels at 5-12dp. `withFontScale` scales every
 * `SIZE.*` token around a render; `PHONE_FONT_SCALE` is the per-type k the
 * sweep in renders/round4/figures/phone_scale/RESULTS.md found safe (zero
 * label collisions, zero degenerate shapes) on the quiz canvas.
 */

jest.mock('../../bot/shared/utils/html-to-pdf', () => ({ htmlToImage: jest.fn() }));
jest.mock('../../bot/shared/storage/r2', () => ({ uploadBuffer: jest.fn() }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const { renderDiagram } = require('../../bot/vendor/lp-v9/diagrams');
const { requiredBox, SIZE } = require('../../bot/vendor/lp-v9/diagrams/lib/svg');
const Figure = require('../../bot/shared/services/quiz/transcript-quiz-figure');
const Gates = require('../../bot/shared/services/quiz/transcript-quiz-figure-gates');

const { renderFigureSvg, withFontScale, PHONE_FONT_SCALE } = Figure;

/** Canvas renderedPx for the smallest label in `svg` — same box gates.js uses. */
function canvasMinPx(svg) {
  const { vbW, vbH, minFont } = requiredBox(svg);
  const scale = Math.min(Gates.BOX_W / vbW, Gates.BOX_H / vbH);
  return minFont * scale;
}

describe('withFontScale', () => {
  test('scales every SIZE entry by k around a synchronous call', () => {
    const before = { ...SIZE };
    let seen;
    withFontScale(2, () => { seen = { ...SIZE }; });
    Object.keys(before).forEach((key) => {
      expect(seen[key]).toBeCloseTo(before[key] * 2, 6);
    });
    // and restored exactly on the happy path too
    expect(SIZE).toEqual(before);
  });

  test('restores SIZE exactly even when the render throws', () => {
    const before = { ...SIZE };
    expect(() => withFontScale(2.4, () => { throw new Error('boom'); })).toThrow('boom');
    expect(SIZE).toEqual(before);
  });

  test('restores SIZE exactly on a nested throw from a real renderDiagram call', () => {
    const before = { ...SIZE };
    // Asserts on renderDiagram's OWN error message, not just "something threw" —
    // withFontScale being undefined would also make this line throw, for the
    // wrong reason.
    expect(() => withFontScale(1.6, () => renderDiagram({ type: 'not_a_real_type' })))
      .toThrow(/unknown diagram type/);
    expect(SIZE).toEqual(before);
  });
});

describe('PHONE_FONT_SCALE applied by renderFigureSvg', () => {
  test('an atom rendered by the quiz lane has its smallest label rendered at least PHONE_FONT_SCALE.atom * 13 canvas px', () => {
    const svg = renderFigureSvg({ type: 'atom', element: 'Na' }, 'en');
    expect(canvasMinPx(svg)).toBeGreaterThanOrEqual(PHONE_FONT_SCALE.atom * 13);
  });

  test('a type the sweep improved (molecule, k=2.4) renders visibly larger than at k=1', () => {
    const spec = { type: 'molecule', formula: 'H2O', smiles: 'O', name: 'water' };
    // A bigger viewBox from bigger fonts nudges the box-fit scale too, so the
    // growth is not perfectly linear in k — check direction and a wide margin,
    // not an exact multiple.
    const shipped = canvasMinPx(renderFigureSvg(spec, 'en'));
    const unscaled = canvasMinPx(renderDiagram({ ...spec, type: 'molecule', lang: 'en' }));
    expect(PHONE_FONT_SCALE.molecule).toBeGreaterThan(1);
    expect(shipped).toBeGreaterThan(unscaled * (PHONE_FONT_SCALE.molecule * 0.7));
    expect(shipped).toBeGreaterThan(unscaled);
  });

  test('a type the sweep left unscaled (atom, k=1) renders identically to the raw engine', () => {
    const spec = { type: 'atom', element: 'Na', lang: 'en' };
    expect(PHONE_FONT_SCALE.atom).toBe(1);
    expect(renderFigureSvg({ type: 'atom', element: 'Na' }, 'en')).toBe(renderDiagram(spec));
  });
});

describe('the LP path is untouched', () => {
  test('renderDiagram called directly renders byte-identically before and after a withFontScale window mutates and restores SIZE around it', () => {
    const atomSpec = { type: 'atom', element: 'Na', lang: 'en' };
    const before = renderDiagram(atomSpec);
    const during = withFontScale(2.4, () => renderDiagram({ ...atomSpec }));
    const after = renderDiagram(atomSpec);
    expect(during).not.toBe(before); // the window really did reach atom
    expect(after).toBe(before); // and it is gone again once the window closes
  });

  // `cell` (bio_schematic.js) is the one type this round touched under
  // bot/vendor/ — it used to snapshot SIZE.small into a module-load constant,
  // which no runtime mutation of SIZE could ever reach. This round replaced
  // that with a live read. Proves the fix actually works (the window now
  // reaches cell too) AND that the LP path still renders identically by
  // default once the window closes.
  test('the cell type (the one vendor file this round edited) is reached during the window and byte-identical after it', () => {
    const cellSpec = { type: 'cell', kind: 'plant', lang: 'en' };
    const before = renderDiagram(cellSpec);
    const during = withFontScale(2.4, () => renderDiagram({ ...cellSpec }));
    const after = renderDiagram(cellSpec);
    expect(during).not.toBe(before);
    expect(after).toBe(before);
  });
});

describe('the gates still run on the scaled SVG', () => {
  test('an aggressive scale that genuinely collides still gets caught', () => {
    // atom fails checkOverlaps at k=1.6 in the sweep (RESULTS.md) — confirm the
    // gate sees the SCALED svg, not the SIZE object's since-restored defaults.
    const svg = withFontScale(2.4, () => renderDiagram({ type: 'atom', element: 'Na', lang: 'en' }));
    const defect = Gates.overlapDefect(svg, 'atom');
    expect(defect).not.toBeNull();
    expect(defect.pairs.length).toBeGreaterThan(0);
  });

  test('the shipped scale for an improved type is visibly bigger AND still passes every gate cleanly', () => {
    const spec = { type: 'molecule', formula: 'H2O', smiles: 'O', name: 'water' };
    const shipped = renderFigureSvg(spec, 'en');
    const unscaled = renderDiagram({ ...spec, type: 'molecule', lang: 'en' });
    expect(canvasMinPx(shipped)).toBeGreaterThan(canvasMinPx(unscaled));
    expect(Gates.figureGateDefects(shipped, 'molecule')).toEqual([]);
  });
});
