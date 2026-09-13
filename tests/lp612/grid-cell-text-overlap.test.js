/**
 * bd-dmttc — GRID CELL TEXT MAY NOT PRINT ON TOP OF ITSELF.
 *
 * Operator, on `grade_10_pak_studies_english_c04_p62_en.pdf`: *"page 2 diagram on prod is
 * overwritten"*. Page 2's "THE BOARD AT THE END OF THE LESSON" figure is a `grid` used as a
 * comparison table — two columns, five rows, and every cell holding a phrase:
 *
 *     Obeying laws                      |  Voting
 *     Paying taxes                      |  Attending civic meetings
 *     Defending the nation              |  Petitioning the government
 *     Registering for selective service |  Running for offices
 *     Performing duty on juries         |  Serving community services
 *
 * `grid.js` sized its canvas from the grid and the auto-legend ONLY. `cellText`, `rowLabel` and
 * `colLabel` never touched the geometry, so a 2x5 of 30-unit cells produced a **49.7-unit-wide**
 * body inside a 455-unit column, each phrase was drawn centred on a 30-unit cell with no wrapping,
 * and the two columns printed straight through each other. The module's own comment states the law
 * it was breaking: *"THE CANVAS MUST FIT THE READOUT THIS TYPE GENERATES FOR ITSELF."*
 *
 * THE CHECK IS ON THE EMITTED SVG. `lib/measure.js`: *"a type module can believe whatever it likes
 * about its own arithmetic; what ships is the string, and the string is what gets checked"* — so
 * this suite cannot pass by agreeing with the bug.
 */

const path = require('path');

const V = path.join(__dirname, '..', '..', 'bot', 'vendor', 'lp-v9');
const grid = require(path.join(V, 'diagrams', 'types', 'grid.js'));
const { checkOverlaps, elementBoxes } = require(path.join(V, 'diagrams', 'lib', 'measure.js'));

function collisions(svg) {
  return checkOverlaps(svg).map((o) => `${o.kind}: ${o.a} ✕ ${o.b}  (${o.detail})`);
}

const box = (svg) => {
  const m = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
  return { w: Number(m[1]), h: Number(m[2]) };
};

/** Page 2's figure, as the LP actually specified it. */
const HER_FIGURE = {
  type: 'grid',
  rows: 5,
  cols: 2,
  rowLabel: 'Duties (required by law)',
  colLabel: 'Responsibilities (benefit the community)',
  title: 'Duties of Citizens vs. Rights and Responsibilities of Citizens (p.62)',
  cellText: [
    [0, 0, 'Obeying laws'], [0, 1, 'Voting'],
    [1, 0, 'Paying taxes'], [1, 1, 'Attending civic meetings'],
    [2, 0, 'Defending the nation'], [2, 1, 'Petitioning the government'],
    [3, 0, 'Registering for selective service'], [3, 1, 'Running for offices'],
    [4, 0, 'Performing duty on juries'], [4, 1, 'Serving community services'],
  ],
};

describe('a grid whose cells hold phrases, not digits', () => {
  test('nothing overlaps anything — the page-2 board figure', () => {
    expect(collisions(grid.render(HER_FIGURE))).toEqual([]);
  });

  test('every label stays inside the drawing', () => {
    // Text pushed off an edge is not "not overlapping", it is gone. This is what caught the
    // colLabel, which measured 123 units against a 49.7-unit canvas.
    const svg = grid.render(HER_FIGURE);
    const { w } = box(svg);
    const escaped = elementBoxes(svg).boxes
      .filter((b) => (b.kind === 'text' || b.kind === 'fo') && (b.x < -0.5 || b.x + b.w > w + 0.5))
      .map((b) => `${b.text || '?'} at x=${Math.round(b.x)}..${Math.round(b.x + b.w)} of ${w}`);
    expect(escaped).toEqual([]);
  });

  test('the canvas grows to hold the cell text instead of cramming it', () => {
    // 2 cols x 30 units + padding is 76. A renderer still drawing at that width has not
    // measured its own cell text.
    expect(box(grid.render(HER_FIGURE)).w).toBeGreaterThan(300);
  });

  test('the rowLabel gets a gutter as wide as the rowLabel', () => {
    // It is end-anchored at `x0 - 8`, so a fixed 26-unit gutter put a 71-unit label 45 units
    // to the LEFT of the canvas and across the grid's own first column.
    const withLabel = box(grid.render(HER_FIGURE)).w;
    const without = box(grid.render({ ...HER_FIGURE, rowLabel: undefined })).w;
    expect(withLabel - without).toBeGreaterThan(26);
  });

  test('Urdu cell text is not exempt — the foreignObject path grows too', () => {
    const svg = grid.render({
      type: 'grid', rows: 3, cols: 2, lang: 'ur',
      rowLabel: 'شہری فرائض', colLabel: 'شہری ذمہ داریاں',
      cellText: [
        [0, 0, 'قانون کی پابندی کرنا'], [0, 1, 'ووٹ ڈالنا'],
        [1, 0, 'ٹیکس ادا کرنا'], [1, 1, 'اجلاسوں میں شرکت کرنا'],
        [2, 0, 'ملک کا دفاع کرنا'], [2, 1, 'برادری کی خدمت کرنا'],
      ],
    });
    expect(collisions(svg)).toEqual([]);
    expect(box(svg).w).toBeGreaterThan(76);
  });
});

describe('the shapes that used to be fine stay fine', () => {
  test('a hundred square is byte-identical — no cell text, no edge labels', () => {
    const svg = grid.render({ type: 'grid', rows: 10, cols: 10, shaded: 37, majorEvery: 5 });
    // gw 300 + pad 16, and the auto legend fits inside that.
    expect(box(svg)).toEqual({ w: 316, h: 343.55 });
    expect(collisions(svg)).toEqual([]);
  });

  test('an area model with digit cell text keeps its 34-unit cells', () => {
    const svg = grid.render({
      type: 'grid', rows: 4, cols: 6, cellSize: 34, shaded: 24,
      rowLabel: '4', colLabel: '6', cellText: [[0, 0, '1'], [1, 1, '2']],
    });
    // 6 x 34 = 204, + pad 16 + the old fixed 26-unit gutter. A digit still fits its cell, so
    // none of the growth logic may fire.
    expect(box(svg)).toEqual({ w: 246, h: 201.55 });
    expect(collisions(svg)).toEqual([]);
  });

  test('the shipped examples still draw clean', () => {
    for (const ex of grid.examples) {
      expect({ [ex.name]: collisions(grid.render(ex.spec)) }).toEqual({ [ex.name]: [] });
    }
  });
});
