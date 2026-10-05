'use strict';
/**
 * Figures the child can read at phone size on the web page (a 344 px wide box, at most
 * 46% of a 740 px screen tall). The page draws its own copy of a figure; the WhatsApp
 * PNG and the teacher PDF draw the stored spec as before.
 *  - A graph is drawn narrower on the page, so its smallest label is at least 11 px on
 *    the phone (it was ~7 px: a 620-unit graph shrunk to 344 px).
 *  - A base-ten mat of blocks stacks its flats (and thousands) one above the other on
 *    the page, so the tens rods are at least 8.5 px wide (they were 6.5 px: an 849-unit
 *    mat, three flats side by side, shrunk to 344 px). Stacked, the mat is bound by the
 *    46% height, and a rod is a tenth of a flat by design, so this is the honest gain.
 */
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('openchemlib', () => require('../../../../tests/__mocks__/openchemlib.js'));

const Fig = require('../../../shared/services/quiz/web-quiz-figure');
const { renderFigureSvg } = require('../../../shared/services/quiz/transcript-quiz-figure');

const BOX_W = 344;
const BOX_H = 0.46 * 740;
const viewBox = (svg) => /viewBox="([-\d.]+)\s+([-\d.]+)\s+([\d.]+)\s+([\d.]+)"/.exec(svg).slice(3, 5).map(Number);
const scaleOf = (svg) => { const [w, h] = viewBox(svg); return Math.min(BOX_W / w, BOX_H / h); };
const minFont = (svg) => Math.min(...[...svg.matchAll(/font-size="([\d.]+)"/g)].map((m) => Number(m[1])));

const GRAPH = {
  type: 'graph', xMin: 0, xMax: 120, yMin: 0, yMax: 7, xStep: 18, yStep: 1,
  points: [{ x: 18, y: 6, label: '(18, 6)' }, { x: 27, y: 4, label: '(27, 4)' }, { x: 36, y: 3, label: '(36, 3)' }, { x: 54, y: 2, label: '(54, 2)' }],
  xLabel: 'Speed (km/h)', yLabel: 'Time (hours)', functions: [{ expr: '108/x', label: 'y = 108/x' }],
};
const BLOCKS = { type: 'base_ten', model: 'blocks', hundreds: 3, tens: 2, ones: 5 };
const row = (figure, language = 'en') => ({ id: 'q1', question_text: 'x', media: { figure, language } });

describe('a graph on the page: labels a child can read', () => {
  test('the smallest label is at least 11 px on the phone', () => {
    const f = Fig.figureFor(row(GRAPH));
    expect(f.kind).toBe('svg');
    expect(minFont(f.svg) * scaleOf(f.svg)).toBeGreaterThanOrEqual(11);
  });
  test('a graph that sets its own width keeps it', () => {
    const f = Fig.figureFor(row({ ...GRAPH, width: 600 }));
    expect(viewBox(f.svg)[0]).toBe(600);
  });
  test('a graph the narrow page width would crowd is drawn as stored instead of not at all', () => {
    const pts = Array.from({ length: 10 }, (_, i) => ({ x: 10 + i * 4, y: 3 + (i % 3) * 0.3, label: `(${10 + i * 4}, ${(3 + (i % 3) * 0.3).toFixed(1)})` }));
    const crowded = { type: 'graph', xMin: 0, xMax: 60, yMin: 0, yMax: 6, xStep: 10, yStep: 1, points: pts, xLabel: 'x', yLabel: 'y' };
    const f = Fig.figureFor(row(crowded));
    expect(f && f.kind).toBe('svg');
    expect(viewBox(f.svg)[0]).toBe(620);
  });
  test('the WhatsApp drawing of the same spec is unchanged (620 wide)', () => {
    expect(viewBox(renderFigureSvg(GRAPH, 'en'))[0]).toBe(620);
  });
});

describe('a base-ten mat of blocks on the page: rods a child can count', () => {
  const rodWidth = (svg) => {
    const m = /<g data-bt="ten"><rect[^>]*?\swidth="([\d.]+)"/.exec(svg);
    return Number(m[1]) * scaleOf(svg);
  };
  test.each(['en', 'ur'])('the tens rods are at least 8.5 px wide on the phone (%s)', (lang) => {
    const f = Fig.figureFor(row(BLOCKS, lang));
    expect(f.kind).toBe('svg');
    expect(rodWidth(f.svg)).toBeGreaterThanOrEqual(8.5);
  });
  test('every piece is still drawn: 3 flats, 2 rods, 5 cubes', () => {
    const { svg } = Fig.figureFor(row(BLOCKS));
    expect((svg.match(/data-bt="hundred"/g) || []).length).toBe(3);
    expect((svg.match(/data-bt="ten"/g) || []).length).toBe(2);
    expect((svg.match(/data-bt="one"/g) || []).length).toBe(5);
  });
  test('the WhatsApp drawing keeps the flats side by side', () => {
    const svg = renderFigureSvg(BLOCKS, 'en');
    expect(viewBox(svg)[0]).toBeGreaterThan(800);
  });
});
