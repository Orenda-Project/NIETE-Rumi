'use strict';
/**
 * fraction_bar model:"circle" — a roti/pizza drawn as n equal sectors, k
 * shaded, through the quiz lane's own entry point (so a red here proves the
 * VENDORED copy is what changed, not just the upstream skill file).
 */

jest.mock('../../bot/shared/utils/html-to-pdf', () => ({ htmlToImage: jest.fn() }));
jest.mock('../../bot/shared/storage/r2', () => ({ uploadBuffer: jest.fn() }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const Figure = require('../../bot/shared/services/quiz/transcript-quiz-figure');
const { checkOverlaps, checkDegenerate } = require('../../bot/vendor/lp-v9/diagrams');

function circleCount(svg) {
  return (svg.match(/<circle\b/g) || []).length;
}
function sectorPathCount(svg) {
  // a sector wedge path starts at the centre and arcs out — "A" is the arc command
  return (svg.match(/<path\b[^>]*\bd="M[^"]*A[^"]*"/g) || []).length;
}

describe('fraction_bar model:"circle"', () => {
  test('4 sectors, 1 shaded, en: an outer ring plus 4 sector wedges, zero overlaps, zero degenerate rows', () => {
    const spec = { type: 'fraction_bar', model: 'circle', bars: [{ parts: 4, shaded: 1 }] };
    const svg = Figure.renderFigureSvg(spec, 'en');
    expect(svg.startsWith('<svg')).toBe(true);
    expect(circleCount(svg)).toBe(1); // the outer ring
    expect(sectorPathCount(svg)).toBe(4);
    expect(checkOverlaps(svg)).toEqual([]);
    expect(checkDegenerate(svg)).toEqual([]);
  });

  test('same spec in ur: renders, zero overlaps, zero degenerate rows', () => {
    const spec = { type: 'fraction_bar', model: 'circle', bars: [{ parts: 4, shaded: 1 }] };
    const svg = Figure.renderFigureSvg(spec, 'ur');
    expect(svg.startsWith('<svg')).toBe(true);
    expect(checkOverlaps(svg)).toEqual([]);
    expect(checkDegenerate(svg)).toEqual([]);
  });

  test('two circles with different parts on one spec — both drawn, same radius, zero degenerate rows', () => {
    const spec = {
      type: 'fraction_bar',
      model: 'circle',
      bars: [{ parts: 4, shaded: 3 }, { parts: 8, shaded: 6 }],
    };
    const svg = Figure.renderFigureSvg(spec, 'en');
    expect(circleCount(svg)).toBe(2);
    expect(sectorPathCount(svg)).toBe(12); // 4 + 8 wedges
    const radii = [...svg.matchAll(/<circle\b[^>]*\br="([\d.]+)"/g)].map((m) => Number(m[1]));
    expect(new Set(radii).size).toBe(1); // one shared radius
    expect(checkOverlaps(svg)).toEqual([]);
    expect(checkDegenerate(svg)).toEqual([]);
  });

  test('parts: 1 — a whole disc, no crash, no sector wedges, zero overlaps', () => {
    const spec = { type: 'fraction_bar', model: 'circle', bars: [{ parts: 1, shaded: 1 }] };
    const svg = Figure.renderFigureSvg(spec, 'en');
    expect(svg.startsWith('<svg')).toBe(true);
    expect(circleCount(svg)).toBe(1);
    expect(sectorPathCount(svg)).toBe(0);
    expect(checkOverlaps(svg)).toEqual([]);
    expect(checkDegenerate(svg)).toEqual([]);
  });

  test('a per-bar label under the circle in ur is present in the rendered text and not colliding', () => {
    const spec = {
      type: 'fraction_bar',
      model: 'circle',
      bars: [{ parts: 4, shaded: 2, label: 'علی' }],
    };
    const svg = Figure.renderFigureSvg(spec, 'ur');
    expect(Figure.svgText(svg).join(' ')).toMatch(/علی/);
    expect(checkOverlaps(svg)).toEqual([]);
  });

  test('regression guard: the default bar mode (no model) still renders exactly as before', () => {
    const spec = { type: 'fraction_bar', bars: [{ parts: 4, shaded: 3 }] };
    const svg = Figure.renderFigureSvg(spec, 'en');
    expect((svg.match(/<rect\b/g) || []).length).toBe(6); // 4 segments + 1 outline + 1 page background
    expect(circleCount(svg)).toBe(0);
    expect(checkDegenerate(svg)).toEqual([]);
  });

  test('renderFigurePng produces a non-empty buffer for the circle spec (en and ur)', async () => {
    jest.resetModules();
    jest.doMock('../../bot/shared/utils/html-to-pdf', () => ({
      htmlToImage: jest.fn().mockResolvedValue(Buffer.from('png-bytes')),
    }));
    jest.doMock('../../bot/shared/storage/r2', () => ({ uploadBuffer: jest.fn() }));
    jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
    jest.doMock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
    let Fig;
    jest.isolateModules(() => {
      // eslint-disable-next-line global-require
      Fig = require('../../bot/shared/services/quiz/transcript-quiz-figure');
    });
    const spec = { type: 'fraction_bar', model: 'circle', bars: [{ parts: 8, shaded: 3, label: 'Sample' }] };
    for (const lang of ['en', 'ur']) {
      const svg = Fig.renderFigureSvg(spec, lang);
      // eslint-disable-next-line no-await-in-loop
      const png = await Fig.renderFigurePng(svg, lang);
      expect(Buffer.isBuffer(png)).toBe(true);
      expect(png.length).toBeGreaterThan(0);
    }
  }, 20000);
});
