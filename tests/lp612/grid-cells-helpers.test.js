/**
 * grid_cells — the shaded-cell half of the `grid` type.
 *
 * These four functions were inline in diagrams/types/grid.js until grid.js went over the
 * 300-line limit and had to be split. The split was meant to be BEHAVIOUR-FREE: the
 * corpus byte-identity block in grid-place-value-regroup.test.js proves the rendered SVG
 * did not move, and this file pins the helpers themselves so a later "tidy-up" of one of
 * them cannot quietly change what a grid shades or what its caption says.
 *
 * The four are not general utilities and are not tested as if they were. Each one has a
 * job the type depends on:
 *
 *   resolveShaded    which cells are shaded — four different author spellings, one Set
 *   autoLegend       the caption a grid writes for itself when the author gives none
 *   blockH           the height a wrapped cell string will actually consume
 *   edgeLabelMetrics how much gutter an edge label needs, measured not guessed
 *
 * blockH and edgeLabelMetrics exist to keep RESERVATION and DRAWING in agreement — the
 * law this whole engine is built on: THE CANVAS MUST FIT THE READOUT THIS TYPE GENERATES
 * FOR ITSELF. So they are tested for the property that matters (a longer or taller thing
 * never reserves less room) rather than pinned to a pixel count that has no meaning on
 * its own and would turn every font-metric tweak into a red test.
 */

const path = require('path');

const V = path.join(__dirname, '..', '..', 'bot', 'vendor', 'lp-v9');
// lib/, not types/ — diagrams/index.js registers every .js under types/ as a diagram type.
const cells = require(path.join(V, 'diagrams', 'lib', 'grid_cells.js'));
const { SIZE } = require(path.join(V, 'diagrams', 'lib', 'svg.js'));

const idx = (spec, rows, cols) => [...cells.resolveShaded(spec, rows, cols)].sort((a, b) => a - b);

describe('resolveShaded reads all four spellings an author may use', () => {
  test('a count shades the first N cells, reading order', () => {
    expect(idx({ shaded: 3 }, 2, 4)).toEqual([0, 1, 2]);
  });

  test('a count larger than the grid is clamped, not drawn off the end', () => {
    expect(idx({ shaded: 99 }, 2, 2)).toEqual([0, 1, 2, 3]);
  });

  test('a list of indices is taken as indices', () => {
    expect(idx({ shaded: [0, 5, 7] }, 2, 4)).toEqual([0, 5, 7]);
  });

  test('a list of [row, col] pairs is resolved against the COLUMN count', () => {
    // [1,2] in a 4-wide grid is index 6; in a 3-wide grid it is index 5.
    expect(idx({ shaded: [[1, 2]] }, 2, 4)).toEqual([6]);
    expect(idx({ shaded: [[1, 2]] }, 2, 3)).toEqual([5]);
  });

  test('a fraction string shades that fraction of the whole grid, rounded', () => {
    expect(idx({ shaded: '1/4' }, 2, 2)).toEqual([0]);
    expect(idx({ shaded: '3/4' }, 2, 2)).toEqual([0, 1, 2]);
    // 1/3 of 10 is 3.33 -> 3 cells. Rounding, not truncation.
    expect(idx({ shaded: '1/3' }, 2, 5)).toHaveLength(3);
  });

  test('duplicates collapse — a cell is shaded or it is not', () => {
    expect(idx({ shaded: [1, 1, [0, 1]] }, 2, 2)).toEqual([1]);
  });

  test('no shading at all is an empty set, never undefined', () => {
    expect(cells.resolveShaded({}, 3, 3).size).toBe(0);
  });
});

describe('autoLegend writes the caption only when the author did not', () => {
  test('it states the fraction, its reduction, the percentage and the decimal', () => {
    expect(cells.autoLegend({}, 1, 2, 2)).toBe('1/4 = 25% = 0.25');
    expect(cells.autoLegend({}, 2, 2, 2)).toBe('2/4 = 1/2 = 50% = 0.5');
  });

  test('an unreducible fraction skips the reduction term instead of repeating itself', () => {
    expect(cells.autoLegend({}, 37, 10, 10)).toBe('37/100 = 37% = 0.37');
  });

  test("an author's own legend always wins", () => {
    expect(cells.autoLegend({ legend: '3,600 - 47' }, 1, 2, 2)).toBe('3,600 - 47');
  });

  test('an explicit empty legend means NO legend — it is not the same as omitting it', () => {
    expect(cells.autoLegend({ legend: '' }, 1, 2, 2)).toBe('');
  });

  test('nothing shaded means nothing to caption', () => {
    expect(cells.autoLegend({}, 0, 4, 4)).toBeUndefined();
  });
});

describe('blockH reserves room for what will actually be drawn', () => {
  test('an empty string costs nothing', () => {
    expect(cells.blockH('', 12, 100)).toBe(0);
    expect(cells.blockH(null, 12, 100)).toBe(0);
  });

  test('text that must wrap reserves more height than text that fits on one line', () => {
    const oneLine = cells.blockH('Duties', 12, 200);
    const wrapped = cells.blockH('Duties required by law of every citizen', 12, 60);
    expect(wrapped).toBeGreaterThan(oneLine);
  });

  test('a narrower column never reserves LESS height for the same string', () => {
    const s = 'Registering for selective service';
    expect(cells.blockH(s, 12, 60)).toBeGreaterThanOrEqual(cells.blockH(s, 12, 200));
  });

  test('Urdu is not exempt — the foreignObject path reserves height too', () => {
    expect(cells.blockH('اکائی', 12, 60)).toBeGreaterThan(0);
  });
});

describe('edgeLabelMetrics measures the gutter instead of guessing it', () => {
  const { labelW, labelH } = cells.edgeLabelMetrics({});

  test('an absent label needs no gutter at all', () => {
    expect(labelW(undefined)).toBe(0);
    expect(labelH('')).toBe(0);
  });

  test('a phrase reserves more width than a digit — the bug that printed over column one', () => {
    expect(labelW('Duties (required by law)')).toBeGreaterThan(labelW('4'));
  });

  test('an Urdu label reserves at least the 3em floor _urduText will draw at', () => {
    const { labelW: urW } = cells.edgeLabelMetrics({ lang: 'ur' });
    expect(urW('۴')).toBeGreaterThanOrEqual(SIZE.small * 3);
  });

  test('lang:"ur" puts a Latin label on the Urdu box arithmetic as well', () => {
    const { labelW: urW } = cells.edgeLabelMetrics({ lang: 'ur' });
    expect(urW('4')).toBeGreaterThan(labelW('4'));
  });

  test('a taller Urdu box than a Latin one of the same string, so descenders survive', () => {
    expect(labelH('اکائی')).toBeGreaterThan(labelH('O'));
  });
});
