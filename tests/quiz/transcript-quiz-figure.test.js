'use strict';
/**
 * Picture questions — the figure module.
 *
 * A figure is a deterministic diagram spec the author attaches to a question.
 * This suite pins the four things that stop a bad figure reaching a child:
 * the type allowlist, the render+overlap gate, the answer-leak rule, and the
 * R2 key the sender consumes.
 */

jest.mock('../../bot/shared/utils/html-to-pdf', () => ({ htmlToImage: jest.fn() }));
jest.mock('../../bot/shared/storage/r2', () => ({ uploadBuffer: jest.fn() }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const { htmlToImage } = require('../../bot/shared/utils/html-to-pdf');
const { uploadBuffer } = require('../../bot/shared/storage/r2');
const Figure = require('../../bot/shared/services/quiz/transcript-quiz-figure');

const NUMBERLINE = {
  type: 'numberline',
  from: -5,
  to: 5,
  step: 1,
  labelFormat: 'integer',
  points: [{ at: -3, style: 'dot', label: 'A' }, { at: 1, style: 'dot', label: 'B' }, { at: 4, style: 'dot', label: 'C' }],
};

beforeEach(() => jest.clearAllMocks());

/** The thrown error's code, or the raw error when it carried none. */
function codeOf(fn) {
  try { fn(); } catch (e) { return e.code || e.message; }
  return null;
}

describe('ALLOWED_TYPES', () => {
  test('is exactly the fourteen phone-safe types, and excludes the six that are not', () => {
    expect(Figure.ALLOWED_TYPES).toEqual([
      'numberline', 'fraction_bar', 'grid', 'geometry', 'graph', 'chem_equation', 'circuit',
      'free_body', 'atom', 'punnett', 'ray_diagram', 'flow', 'timeline', 'cell',
    ]);
    ['illustrative', 'labelled_figure', 'mindmap', 'molecule', 'panels', 'dna_helix']
      .forEach((t) => expect(Figure.ALLOWED_TYPES).not.toContain(t));
  });

  test('an alias of an allowlisted type resolves to its canonical type', () => {
    expect(Figure.canonicalType('bar_model')).toBe('fraction_bar');
    expect(Figure.canonicalType('number_line')).toBe('numberline');
    expect(Figure.canonicalType('bio_schematic')).toBe('cell');
    expect(Figure.canonicalType('fraction_bar')).toBe('fraction_bar');
  });

  test('an alias of an EXCLUDED type does not sneak past the allowlist', () => {
    expect(Figure.canonicalType('concept_map')).toBeNull();   // mindmap
    expect(Figure.canonicalType('ai_art')).toBeNull();        // illustrative
    expect(Figure.canonicalType('smiles')).toBeNull();        // molecule
    expect(Figure.canonicalType('nope')).toBeNull();
  });
});

describe('renderFigureSvg', () => {
  test('a bare hundred square does not print the count that is the answer', () => {
    const svg = Figure.renderFigureSvg({ type: 'grid', rows: 10, cols: 10, shaded: 37, majorEvery: 5 }, 'en');
    expect(Figure.svgText(svg).join(' ')).not.toMatch(/37/);
  });

  test('a bare fraction bar does not print the fraction that is the answer', () => {
    const svg = Figure.renderFigureSvg({ type: 'fraction_bar', bars: [{ parts: 4, shaded: 3 }] }, 'ur');
    expect(svg).not.toMatch(/۳\s*\/\s*۴/);
    expect(svg).not.toMatch(/3\s*\/\s*4/);
  });

  test('returns an SVG for an allowlisted spec', () => {
    const svg = Figure.renderFigureSvg(NUMBERLINE, 'en');
    expect(svg.startsWith('<svg')).toBe(true);
  });

  test('routes Urdu labels through the Nastaliq foreignObject path', () => {
    const svg = Figure.renderFigureSvg({ ...NUMBERLINE, title: 'عدد کی لکیر' }, 'ur');
    expect(svg).toMatch(/<foreignObject/);
    expect(svg).toMatch(/Nastaliq/);
  });

  test('does not mutate the caller\'s spec when it sets lang', () => {
    const spec = { ...NUMBERLINE };
    Figure.renderFigureSvg(spec, 'ur');
    expect(spec.lang).toBeUndefined();
  });

  test('throws FIGURE_TYPE with a one-line reason for a type off the allowlist', () => {
    expect(codeOf(() => Figure.renderFigureSvg({ type: 'mindmap', centre: { label: 'X' }, branches: [] }, 'en')))
      .toBe('FIGURE_TYPE');
    try {
      Figure.renderFigureSvg({ type: 'mindmap' }, 'en');
      throw new Error('did not throw');
    } catch (e) {
      expect(e.message).toMatch(/mindmap/);
      expect(e.message.split('\n')).toHaveLength(1);
    }
  });

  test('wraps an engine throw as FIGURE_RENDER, one line, naming the type', () => {
    // The engine is defensive and draws something for almost any spec, so this
    // branch is reached by making it throw rather than by feeding it garbage.
    jest.doMock('../../bot/vendor/lp-v9/diagrams', () => ({
      renderDiagram: () => { throw new Error('boom\nstack line two'); },
      checkOverlaps: () => [],
    }));
    let err = null;
    jest.isolateModules(() => {
      // eslint-disable-next-line global-require
      const Isolated = require('../../bot/shared/services/quiz/transcript-quiz-figure');
      try { Isolated.renderFigureSvg({ type: 'numberline', from: 0, to: 5 }, 'en'); } catch (e) { err = e; }
    });
    jest.dontMock('../../bot/vendor/lp-v9/diagrams');
    expect(err && err.code).toBe('FIGURE_RENDER');
    expect(err.message).toMatch(/numberline/);
    expect(err.message.split('\n')).toHaveLength(1);
  });

  test('throws FIGURE_OVERLAP when labels collide (checkOverlaps is a hard gate)', () => {
    // A hundred ticks on a phone-width line: the engine draws it happily and
    // every label sits on its neighbour. Unreadable is a failure, not a warning.
    //
    // The code is FIGURE_OVERLAP, not FIGURE_RENDER (round 4, PLAN_R4 D7c):
    // the retry prompt quotes these codes back to the model, and "the engine
    // threw" and "the engine drew two labels on top of each other" need
    // different fixes. Same name the lesson-plan lane's lint uses.
    const crowded = { type: 'numberline', from: -50, to: 50, step: 1, labelFormat: 'integer' };
    expect(codeOf(() => Figure.renderFigureSvg(crowded, 'en'))).toBe('FIGURE_OVERLAP');
  });

  test('applies the phone-lane default that stops geometry clipping its side label', () => {
    // The manifest minimal spec has no height and clips off the left edge in a
    // 620-unit canvas; the default is what makes it renderable here.
    expect(Figure.TYPE_DEFAULTS.geometry.height).toBeGreaterThan(0);
    const spec = { type: 'geometry', shapes: [{ kind: 'triangle', points: [[0, 0], [4, 0], [0, 3]], labels: ['A', 'B', 'C'], sides: ['4 cm', '5 cm', '3 cm'] }] };
    expect(Figure.renderFigureSvg(spec, 'en').startsWith('<svg')).toBe(true);
  });
});

describe('figureLeaksAnswer', () => {
  const opts = ['A', 'B', 'C'];

  test('a figure that labels every option is legal ("which point is at -3?")', () => {
    expect(Figure.figureLeaksAnswer(NUMBERLINE, opts, 0)).toBe(false);
  });

  test('a figure that names ONLY the correct option leaks', () => {
    const spec = { ...NUMBERLINE, points: [{ at: -3, style: 'dot', label: 'A' }] };
    expect(Figure.figureLeaksAnswer(spec, opts, 0)).toBe(true);
  });

  test('the leak check is case- and whitespace-insensitive', () => {
    const spec = { type: 'fraction_bar', bars: [{ parts: 4, shaded: 3, label: '  Three Quarters ' }] };
    expect(Figure.figureLeaksAnswer(spec, ['three quarters', 'two thirds', 'one half'], 0)).toBe(true);
  });

  test('Urdu and ASCII digits are the same digit to the leak check', () => {
    const spec = { type: 'grid', rows: 10, cols: 10, shaded: 37, caption: '۳۷ خانے' };
    expect(Figure.figureLeaksAnswer(spec, ['37', '73', '3'], 0)).toBe(true);
  });

  test('structural enum values are not label text (a plant cell picture is the question, not the answer)', () => {
    const spec = { type: 'cell', kind: 'plant' };
    expect(Figure.figureLeaksAnswer(spec, ['plant', 'animal', 'bacteria'], 0)).toBe(false);
  });

  test('the DRAWN text is checked too, not just the spec', () => {
    // A fraction bar prints "3/4" beside itself from `shaded`/`parts` — no
    // label in the spec anywhere. Reading only the spec certified the answer
    // as hidden while the picture said it out loud.
    const spec = { type: 'fraction_bar', showLabels: true, bars: [{ parts: 4, shaded: 3 }] };
    const svg = Figure.renderFigureSvg(spec, 'en');
    expect(Figure.figureLeaksAnswer(spec, ['1/2', '3/4', '2/3'], 1)).toBe(false);
    expect(Figure.figureLeaksAnswer(spec, ['1/2', '3/4', '2/3'], 1, svg)).toBe(true);
  });

  test('a value inside a compound readout still leaks ("37/100" says 37)', () => {
    const spec = { type: 'grid', rows: 10, cols: 10, shaded: 37, legend: undefined, majorEvery: 5 };
    const svg = Figure.renderFigureSvg({ ...spec, legend: null }, 'en');
    // legend:null opts back into a drawn readout being possible; assert on the
    // engine's own compound string rather than on how it was produced
    const withReadout = '<svg><text>37/100 = 37% = 0.37</text></svg>';
    expect(Figure.figureLeaksAnswer(spec, ['37', '73', '3'], 0, withReadout)).toBe(true);
    expect(svg.startsWith('<svg')).toBe(true);
  });

  test('a short numeric option matches a whole label, never a fragment of one', () => {
    const spec = { type: 'graph', xMin: 0, xMax: 40, yMin: 0, yMax: 40, xStep: 10, yStep: 10, xLabel: 'x', yLabel: 'y' };
    const svg = Figure.renderFigureSvg(spec, 'en');
    // the axis prints "30"; the option "3" is not that label
    expect(Figure.figureLeaksAnswer(spec, ['3', '7', '9'], 0, svg)).toBe(false);
  });

  test('an empty or missing correct option never counts as a leak', () => {
    expect(Figure.figureLeaksAnswer(NUMBERLINE, ['', 'B', 'C'], 0)).toBe(false);
    expect(Figure.figureLeaksAnswer(null, opts, 0)).toBe(false);
  });
});

describe('figureHtml', () => {
  test('is self-contained: the fonts are embedded, nothing is fetched', () => {
    const html = Figure.figureHtml('<svg xmlns="http://www.w3.org/2000/svg"></svg>', 'ur');
    expect(html).toMatch(/@font-face/);
    expect(html).toMatch(/data:font\/ttf;base64,/);
    expect(html).toMatch(/Noto Nastaliq Urdu/);
    // nothing is fetched at render time: no remote font, stylesheet or image
    expect(html).not.toMatch(/@import/);
    expect(html).not.toMatch(/url\(\s*['"]?https?:/);
    expect(html).not.toMatch(/<(link|script|img)\b/);
  });

  test('paints the NIETE tokens and a phone-width white ground', () => {
    const html = Figure.figureHtml('<svg></svg>', 'en');
    expect(html).toMatch(/--navy:\s*#333748/);
    expect(html).toMatch(/--amber:\s*#47BA7D/);
    expect(html).toMatch(/--ink:\s*#232735/);
    expect(html).toMatch(/width:\s*1080px/);
    expect(html).not.toMatch(/#001F3F/i);
    expect(html).toMatch(/class="fig"/);
  });
});

describe('renderFigurePng', () => {
  test('screenshots the .fig element at 1080px, scale 1', async () => {
    htmlToImage.mockResolvedValue(Buffer.from('png'));
    const png = await Figure.renderFigurePng('<svg></svg>', 'en');
    expect(png.toString()).toBe('png');
    expect(htmlToImage).toHaveBeenCalledWith(expect.stringContaining('class="fig"'),
      expect.objectContaining({ width: 1080, deviceScaleFactor: 1, selector: '.fig' }));
  });

  test('an empty screenshot is a failure, not a blank picture', async () => {
    htmlToImage.mockResolvedValue(Buffer.alloc(0));
    await expect(Figure.renderFigurePng('<svg></svg>', 'en')).rejects.toThrow(/FIGURE_RENDER|empty/i);
  });
});

describe('uploadFigure', () => {
  test('writes the per-question key the sender consumes and returns the URL', async () => {
    uploadBuffer.mockResolvedValue('https://acct.r2.cloudflarestorage.com/bucket/transcript_quizzes/u-1/q-9/q2.png');
    const url = await Figure.uploadFigure({ teacherId: 'u-1', quizId: 'q-9', index: 2, png: Buffer.from('p') });
    expect(uploadBuffer).toHaveBeenCalledWith(expect.any(Buffer), 'transcript_quizzes/u-1/q-9/q2.png', 'image/png');
    expect(url).toMatch(/q2\.png$/);
  });
});

describe('minimalSpecBlock', () => {
  test('is generated from the engine manifest, one line per allowlisted type', () => {
    const block = Figure.minimalSpecBlock();
    Figure.ALLOWED_TYPES.forEach((t) => expect(block).toContain(`"type":"${t}"`));
    expect(block).not.toMatch(/"type":"mindmap"/);
    expect(block).not.toMatch(/"type":"molecule"/);
    // every emitted minimal spec must itself render, or the prompt teaches a
    // shape the validator will reject
    Figure.ALLOWED_TYPES.forEach((t) => {
      expect(() => Figure.renderFigureSvg(Figure.minimalSpecFor(t), 'en')).not.toThrow();
    });
  });
});

describe('the picture a child receives is a fixed 1.91:1 canvas (WhatsApp crops image headers to that shape)', () => {
  const Fig = require('../../bot/shared/services/quiz/transcript-quiz-figure');
  test('figureHtml sizes the canvas 1080 x 565 and centres the drawing inside it', () => {
    const html = Fig.figureHtml('<svg viewBox="0 0 600 100"></svg>', 'en');
    const css = html.match(/\.fig\{([^}]*)\}/)[1];
    expect(css).toMatch(/width:1080px/);
    expect(css).toMatch(/height:565px/);
    expect(css).toMatch(/display:flex/);
    expect(html).toMatch(/\.fig svg\{[^}]*max-height:100%/);
  });
});
