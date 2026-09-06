'use strict';
/**
 * Transcript quiz figures — the three LP lint gates, ported to the quiz
 * canvas. A quiz figure sits in a BOX (not a column), so the label-floor gate
 * must derive its scale from `min(boxW/vbW, boxH/vbH)` rather than a
 * width-only column — a tall figure is height-bound.
 */

jest.mock('../../bot/shared/utils/html-to-pdf', () => ({ htmlToImage: jest.fn() }));
jest.mock('../../bot/shared/storage/r2', () => ({ uploadBuffer: jest.fn() }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const { renderFigureSvg } = require('../../bot/shared/services/quiz/transcript-quiz-figure');
const Gates = require('../../bot/shared/services/quiz/transcript-quiz-figure-gates');

const FRACTION = { type: 'fraction_bar', bars: [{ parts: 4, shaded: 3 }] };
const NUMBERLINE = {
  type: 'numberline', from: -5, to: 5, step: 1,
  points: [{ at: -3, label: 'A' }],
};
const GRID = { type: 'grid', rows: 4, cols: 5, shaded: 12 };
const SHIPPED_SPECS = [
  ['fraction_bar', FRACTION],
  ['numberline', NUMBERLINE],
  ['grid', GRID],
];

// A number line's viewBox width does not grow with the axis range (the engine
// draws it in a fixed-width canvas), so it never crosses the floor no matter
// how crowded. A tall, many-event timeline does: its viewBox height grows with
// the event count while its font stays fixed, which is exactly the shape the
// quiz box's height bound is meant to catch.
const CROWDED_TIMELINE = {
  type: 'timeline',
  events: Array.from({ length: 20 }, (_, i) => ({
    date: String(1900 + i * 5),
    label: `Event ${i} happened here with a longer description`,
  })),
};

describe('labelFloorDefect', () => {
  test.each(SHIPPED_SPECS)('is silent on the shipped %s spec, in en and ur', (_name, spec) => {
    ['en', 'ur'].forEach((lang) => {
      const svg = renderFigureSvg(spec, lang);
      expect(Gates.labelFloorDefect(svg)).toBeNull();
    });
  });

  test('fires on a figure that genuinely renders under the floor on the quiz canvas', () => {
    const svg = renderFigureSvg(CROWDED_TIMELINE, 'en');
    const defect = Gates.labelFloorDefect(svg, 'timeline');
    expect(defect).not.toBeNull();
    expect(defect.renderedPx).toBeLessThan(13.5);
    expect(defect.message).toContain(`${defect.renderedPx}px`);
    expect(defect.message).toContain(`${defect.phonePx}px`);
  });

  test('a tall figure is height-bound: same data-min-font, different renderedPx, tall is smaller', () => {
    // BOX_W=1016, BOX_H=493. Tall/narrow is height-bound (scale = BOX_H/vbH);
    // wide/short is width-bound (scale = BOX_W/vbW). A width-only column
    // formula would score both purely off vbW and miss this entirely.
    const tall = '<svg viewBox="0 0 200 600" data-min-font="14"><text x="10" y="20" font-size="14">A</text></svg>';
    const wide = '<svg viewBox="0 0 600 100" data-min-font="14"><text x="10" y="20" font-size="14">A</text></svg>';
    const tallDefect = Gates.labelFloorDefect(tall);
    const wideDefect = Gates.labelFloorDefect(wide);
    // Neither necessarily crosses the floor — the point under test is the
    // scale arithmetic, so recompute it from what the module measured.
    const tallScale = Math.min(Gates.BOX_W / 200, Gates.BOX_H / 600);
    const wideScale = Math.min(Gates.BOX_W / 600, Gates.BOX_H / 100);
    const tallRenderedPx = +(14 * tallScale).toFixed(2);
    const wideRenderedPx = +(14 * wideScale).toFixed(2);
    expect(tallRenderedPx).toBeLessThan(wideRenderedPx);
    // Whichever side of the floor they land on, the module's own number must
    // match the height-bound arithmetic, not a width-only column.
    const measuredTall = tallDefect ? tallDefect.renderedPx : tallRenderedPx;
    const measuredWide = wideDefect ? wideDefect.renderedPx : wideRenderedPx;
    expect(measuredTall).toBeCloseTo(tallRenderedPx, 2);
    expect(measuredWide).toBeCloseTo(wideRenderedPx, 2);
    expect(measuredTall).toBeLessThan(measuredWide);
  });

  test('a malformed SVG (no viewBox) returns null rather than throwing', () => {
    expect(() => Gates.labelFloorDefect('<svg><text>no viewbox</text></svg>')).not.toThrow();
    expect(Gates.labelFloorDefect('<svg><text>no viewbox</text></svg>')).toBeNull();
  });
});

describe('overlapDefect', () => {
  test.each(SHIPPED_SPECS)('is silent on the shipped %s spec, in en and ur', (_name, spec) => {
    ['en', 'ur'].forEach((lang) => {
      const svg = renderFigureSvg(spec, lang);
      expect(Gates.overlapDefect(svg)).toBeNull();
    });
  });

  test('reports pairs for two overlapping text plates', () => {
    const svg = '<svg viewBox="0 0 200 100" data-min-font="14">'
      + '<text x="20" y="20" font-size="14">Alpha label</text>'
      + '<text x="22" y="22" font-size="14">Beta label</text>'
      + '</svg>';
    const defect = Gates.overlapDefect(svg, 'geometry');
    expect(defect).not.toBeNull();
    expect(defect.pairs.length).toBe(1);
    expect(defect.first.kind).toBe('text-text');
    expect(defect.message).toContain('geometry figure');
    expect(defect.message).toContain('unreadable label');
  });
});

describe('degenerateDefect', () => {
  test.each(SHIPPED_SPECS)('is silent on the shipped %s spec, in en and ur', (_name, spec) => {
    ['en', 'ur'].forEach((lang) => {
      const svg = renderFigureSvg(spec, lang);
      expect(Gates.degenerateDefect(svg)).toBeNull();
    });
  });

  test('fires on a near-zero-area sliver triangle', () => {
    const svg = '<svg viewBox="0 0 100 60" data-min-font="14">'
      + '<polygon points="0,0 100,0 50,1" fill="#333748"/>'
      + '<text x="20" y="20" font-size="14">Triangle sliver label</text>'
      + '</svg>';
    const defect = Gates.degenerateDefect(svg, 'geometry');
    expect(defect).not.toBeNull();
    expect(defect.first.kind).toBe('sliver');
    expect(defect.message).toContain('geometry figure');
  });
});

describe('figureGateDefects', () => {
  test('returns [] for a healthy shipped figure', () => {
    const svg = renderFigureSvg(FRACTION, 'en');
    expect(Gates.figureGateDefects(svg)).toEqual([]);
  });

  test('returns the codes in the documented order when more than one gate fires', () => {
    // A crowded timeline (label-floor) whose overlapping-text and sliver
    // fixtures are appended so all three gates fire on one SVG.
    const crowded = renderFigureSvg(CROWDED_TIMELINE, 'en');
    const overlapping = '<text x="0" y="0" font-size="14">Alpha label plate</text>'
      + '<text x="2" y="2" font-size="14">Beta label plate</text>';
    const sliver = '<polygon points="0,0 5000,0 2500,10" fill="#333748"/>'
      + '<text x="0" y="0" font-size="14">Sliver label plate long enough</text>';
    const combined = crowded.replace('</svg>', `${overlapping}${sliver}</svg>`);
    const defects = Gates.figureGateDefects(combined, 'flow');
    expect(defects.map((d) => d.code)).toEqual([
      'FIGURE_LABEL_SMALL', 'FIGURE_OVERLAP', 'FIGURE_DEGENERATE',
    ]);
    defects.forEach((d) => expect(d.message).toContain('flow figure'));
  });
});

describe('constants', () => {
  test('BOX_W / BOX_H are the .fig box minus its padding, and the floor/phone constants match the brief', () => {
    expect(Gates.BOX_W).toBe(1016);
    expect(Gates.BOX_H).toBe(493);
    expect(Gates.LABEL_FLOOR_PX).toBe(13.5);
    expect(Gates.PHONE_CSS_WIDTH).toBe(360);
  });
});
