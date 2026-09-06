/**
 * A GRAPH MUST NAME ITS AXES, AND ITS POINTS MUST AGREE WITH ITS CURVE — bd-gel97.
 *
 * The defect, seen on the first gated Physics lesson (grade_9_physics.c05.p123-124,
 * `visual_gate_2026-09-04/e2e/page-08.png`): a board `graph` titled "ATMOSPHERIC PRESSURE FALLS
 * WITH ALTITUDE", captioned correctly, with two marked points written "(8.8 km, 33 kPa)" and
 * "(11 km, 23 kPa)" and PLOTTED at (33, 8.8) and (23, 11) — the numbers the other way round —
 * on axes carrying no labels at all. A teacher cannot tell which reading is intended, and the
 * lesson's own Activity asks pupils to read that graph.
 *
 * The visual gate asks "is there a graph", not "is the graph true". These are the deterministic
 * parts of "is it true", and every one of them drives the real `lint()` on a real lp_doc, so
 * each test executes the wiring in `lint_lp.js` rather than the checker in isolation.
 *
 * Red-first: verified failing against this branch's own base (the whole file is red before the
 * `graphDefects` block exists — `lint()` reports neither code).
 */

const fs = require('fs');
const path = require('path');

const LINT = path.join(__dirname, '..', '..', 'bot', 'vendor', 'lp-v9', 'lint_lp.js');
const { lint } = require(LINT);
const { renderDiagram } = require(path.join(__dirname, '..', '..', 'bot', 'vendor', 'lp-v9', 'diagrams'));
const MANIFEST = require(path.join(__dirname, '..', '..', 'bot', 'vendor', 'lp-v9', 'diagrams', 'types_manifest.json'));

const BASE = path.join(__dirname, '__fixtures__', 'v9_gate_base.lp.json');
const raw = fs.readFileSync(BASE, 'utf8');

/** A real v9 document carrying exactly the board graph the test is about. */
function docWithBoard(spec) {
  const d = JSON.parse(raw);
  for (const s of d.sections) s.blocks = (s.blocks || []).filter((b) => b.type !== 'diagram');
  d.page2.board_final.diagram = spec;
  return d;
}
/** A real v9 document carrying the graph as a development block instead. */
function docWithBody(spec) {
  const d = JSON.parse(raw);
  for (const s of d.sections) s.blocks = (s.blocks || []).filter((b) => b.type !== 'diagram');
  delete d.page2.board_final.diagram;
  const dev = d.sections.find((s) => s.id === 'development');
  dev.blocks.push({ type: 'diagram', id: 'dia-graph-1', spec });
  return d;
}
const graphFails = (d) => lint(d, null, {}).fails.filter((f) => /^GRAPH_/.test(f));
const withCode = (d, code) => graphFails(d).filter((f) => f.startsWith(`${code}: `));

/** The spec exactly as it shipped, from the delivered lp_doc. */
const SHIPPED = {
  type: 'graph',
  title: 'ATMOSPHERIC PRESSURE FALLS WITH ALTITUDE',
  xMin: 0, xMax: 110, yMin: 0, yMax: 12, xStep: 10, yStep: 2,
  functions: [{ expr: '8.8 * (33/x)', label: 'pressure falls as altitude rises', color: 'var(--navy)' }],
  points: [
    { x: 33, y: 8.8, label: 'Mount Everest (8.8 km, 33 kPa)', color: 'var(--warn)' },
    { x: 23, y: 11, label: 'Boeing 747 (11 km, 23 kPa)', color: 'var(--amber)' },
  ],
  caption: 'Based on Fig 5.11, p.124: pressure decreases as altitude increases.',
};
/** The same lesson, authored the way the rule asks for. */
const FIXED = {
  ...SHIPPED,
  xMin: 0, xMax: 12, yMin: 0, yMax: 110, xStep: 2, yStep: 20,
  xLabel: 'Altitude (km)',
  yLabel: 'Atmospheric pressure (kPa)',
  functions: [{ expr: '101 - 7.7*x', label: 'pressure falls as altitude rises', color: 'var(--navy)' }],
  points: [
    { x: 8.8, y: 33, label: 'Mount Everest (8.8 km, 33 kPa)', color: 'var(--warn)' },
    { x: 11, y: 23, label: 'Boeing 747 (11 km, 23 kPa)', color: 'var(--amber)' },
  ],
};

describe('R1 · GRAPH_AXES — a teaching graph names both axes', () => {
  it('the shipped barometer graph fails for carrying neither label', () => {
    const fails = withCode(docWithBoard(SHIPPED), 'GRAPH_AXES');
    expect(fails).toHaveLength(1);
    expect(fails[0]).toContain('has no xLabel/yLabel');
    expect(fails[0]).toContain('a teaching graph names both axes with units');
    // the message has to tell the model exactly what to add
    expect(fails[0]).toContain('"xLabel"');
    expect(fails[0]).toContain('"yLabel"');
  });

  it('names the ONE that is missing when only one is', () => {
    const one = withCode(docWithBoard({ ...SHIPPED, xLabel: 'Pressure (kPa)' }), 'GRAPH_AXES');
    expect(one).toHaveLength(1);
    expect(one[0]).toContain('has no yLabel');
    expect(one[0]).not.toContain('xLabel/yLabel');
  });

  it('an empty or whitespace label does not count as a label', () => {
    expect(withCode(docWithBoard({ ...SHIPPED, xLabel: '  ', yLabel: '' }), 'GRAPH_AXES')).toHaveLength(1);
  });

  it('fires on a graph in the body as well as on the board', () => {
    expect(withCode(docWithBody(SHIPPED), 'GRAPH_AXES')).toHaveLength(1);
  });

  it('a pure-maths graph passes with x and y', () => {
    const pure = {
      type: 'graph', xMin: -3, xMax: 5, yMin: -6, yMax: 8, xStep: 1, yStep: 2,
      xLabel: 'x', yLabel: 'y',
      functions: [{ expr: 'x*x - 2*x - 3', label: 'y = x2 - 2x - 3', color: 'var(--navy)' }],
      points: [{ x: 3, y: 0, label: '(3, 0)', color: 'var(--warn)' }],
    };
    expect(graphFails(docWithBoard(pure))).toEqual([]);
  });

  it('leaves every other diagram type alone', () => {
    const flow = { type: 'flow', direction: 'lr', steps: [{ title: 'A' }, { title: 'B' }] };
    expect(graphFails(docWithBoard(flow))).toEqual([]);
  });
});

describe('R2a · GRAPH_POINT_ORDER — a stated pair is the plotted pair, not its reverse', () => {
  it('catches BOTH shipped points by name', () => {
    const fails = withCode(docWithBoard(SHIPPED), 'GRAPH_POINT_ORDER');
    expect(fails).toHaveLength(2);
    expect(fails.join('\n')).toContain('Mount Everest');
    expect(fails.join('\n')).toContain('Boeing 747');
    expect(fails[0]).toContain('(33, 8.8)');           // where it actually sits
  });

  it('the corrected lesson is clean', () => {
    expect(graphFails(docWithBoard(FIXED))).toEqual([]);
  });

  it('a pair that matches straight is silent, minus signs and all', () => {
    const ok = {
      type: 'graph', xMin: -3, xMax: 5, yMin: -6, yMax: 8, xLabel: 'x', yLabel: 'y',
      functions: [{ expr: 'x*x - 2*x - 3', color: 'var(--navy)' }],
      points: [
        { x: -1, y: 0, label: '(−1, 0)' },
        { x: 1, y: -4, label: 'vertex (1, −4)' },
      ],
    };
    expect(graphFails(docWithBoard(ok))).toEqual([]);
  });

  it('is silent when the two numbers are equal — a swap is not observable', () => {
    const sym = {
      type: 'graph', xMin: 0, xMax: 6, yMin: 0, yMax: 6, xLabel: 'x', yLabel: 'y',
      segments: [{ from: [0, 0], to: [6, 6] }],
      points: [{ x: 3, y: 3, label: '(3, 3)' }],
    };
    expect(graphFails(docWithBoard(sym))).toEqual([]);
  });

  it('is silent when a label states only one number, or none', () => {
    const one = {
      type: 'graph', xMin: 0, xMax: 12, yMin: 0, yMax: 110, xLabel: 'Altitude (km)', yLabel: 'Pressure (kPa)',
      functions: [{ expr: '101 - 7.7*x' }],
      points: [{ x: 8.8, y: 33, label: 'Everest' }, { x: 11, y: 23, label: 'cruise height' }],
    };
    expect(graphFails(docWithBoard(one))).toEqual([]);
  });
});

describe('R2b · GRAPH_POINT_ORDER — a number carrying an axis unit sits on that axis', () => {
  const base = {
    type: 'graph', xMin: 0, xMax: 12, yMin: 0, yMax: 110,
    xLabel: 'Altitude (km)', yLabel: 'Pressure (kPa)',
    functions: [{ expr: '101 - 7.7*x' }],
  };

  it('flags a lone "33 kPa" that is plotted on the x axis', () => {
    const d = docWithBoard({ ...base, points: [{ x: 33, y: 8.8, label: 'Everest at 33 kPa' }] });
    const fails = withCode(d, 'GRAPH_POINT_ORDER');
    expect(fails).toHaveLength(1);
    expect(fails[0]).toContain('kPa');
    expect(fails[0]).toContain('wrong axis');
  });

  it('is silent when the number matches neither coordinate — it may be a third quantity', () => {
    const d = docWithBoard({ ...base, points: [{ x: 8.8, y: 33, label: 'summit, 5 km of ice' }] });
    expect(graphFails(d)).toEqual([]);
  });

  it('is silent when the two axes share a unit — the test cannot tell them apart', () => {
    const d = docWithBoard({
      type: 'graph', xMin: 0, xMax: 10, yMin: 0, yMax: 10,
      xLabel: 'Width (cm)', yLabel: 'Height (cm)',
      segments: [{ from: [0, 0], to: [10, 10] }],
      points: [{ x: 4, y: 7, label: 'a 7 cm side' }],
    });
    expect(graphFails(d)).toEqual([]);
  });
});

describe('R3 · GRAPH_ORIENTATION — a point agrees with the curve it sits on', () => {
  const quad = (points) => ({
    type: 'graph', xMin: 0, xMax: 10, yMin: 0, yMax: 100, xLabel: 'side (cm)', yLabel: 'area (cm2)',
    functions: [{ expr: 'x*x', color: 'var(--navy)' }], points,
  });

  it('flags a point plotted in the curve\'s opposite axis order', () => {
    const fails = withCode(docWithBoard(quad([{ x: 81, y: 9 }])), 'GRAPH_ORIENTATION');
    expect(fails).toHaveLength(1);
    expect(fails[0]).toContain('(81, 9)');
    expect(fails[0]).toContain('(9, 81)');
  });

  it('does NOT flag a legitimate outlier whose swap is also outside', () => {
    expect(withCode(docWithBoard(quad([{ x: 5, y: 300 }])), 'GRAPH_ORIENTATION')).toEqual([]);
  });

  it('does NOT flag a point on, or near, the curve', () => {
    expect(withCode(docWithBoard(quad([{ x: 5, y: 25 }, { x: 9, y: 78 }])), 'GRAPH_ORIENTATION')).toEqual([]);
  });

  it('does NOT fire when the extent is square — the swap is unobservable by construction', () => {
    const square = {
      type: 'graph', xMin: 0, xMax: 20, yMin: 0, yMax: 20, xLabel: 'x', yLabel: 'y',
      segments: [{ from: [0, 0], to: [10, 10] }],
      points: [{ x: 20, y: 5 }],
    };
    expect(graphFails(docWithBoard(square))).toEqual([]);
  });

  it('does NOT fire on a points-only scatter — there is no curve to disagree with', () => {
    const scatter = {
      type: 'graph', xMin: 0, xMax: 100, yMin: 0, yMax: 10, xLabel: 'x', yLabel: 'y',
      points: [{ x: 90, y: 2 }, { x: 3, y: 9 }],
    };
    expect(graphFails(docWithBoard(scatter))).toEqual([]);
  });

  it('measures the curve\'s DRAWN extent, not the declared window', () => {
    const { drawnExtent } = require(path.join(__dirname, '..', '..', 'bot', 'vendor', 'lp-v9', 'diagrams', 'types', 'graph.js'));
    const ext = drawnExtent(SHIPPED);          // window y is 0..12; 290.4/x only draws 2.64..12
    expect(ext.y[0]).toBeCloseTo(2.64, 2);
    expect(ext.y[1]).toBeCloseTo(12, 2);
    expect(ext.x[0]).toBeGreaterThan(24);      // the curve leaves the window below x = 24.2
  });
});

describe('the axis labels actually reach the SVG', () => {
  it('both titles are drawn, and the y title is rotated onto its own axis', () => {
    const svg = renderDiagram(FIXED);
    expect(svg).toContain('Altitude (km)');
    expect(svg).toContain('Atmospheric pressure (kPa)');
    expect(svg).toMatch(/rotate\(-90/);
  });
});

describe('the three places the spec shape is written down agree — bd-09m6a drift guard', () => {
  const V = path.join(__dirname, '..', '..', 'bot', 'vendor', 'lp-v9');
  const graph = MANIFEST.types.find((t) => t.type === 'graph');

  it('the manifest lists xLabel and yLabel as REQUIRED, not optional', () => {
    expect(graph.required).toEqual(expect.arrayContaining(['xLabel', 'yLabel']));
    expect(graph.optional).not.toContain('xLabel');
    expect(graph.optional).not.toContain('yLabel');
  });

  it('the manifest minimal_spec obeys its own rule and still renders', () => {
    expect(String(graph.minimal_spec.xLabel || '').trim()).not.toBe('');
    expect(String(graph.minimal_spec.yLabel || '').trim()).not.toBe('');
    expect(renderDiagram(JSON.parse(JSON.stringify(graph.minimal_spec)))).toMatch(/^<svg/);
  });

  it('the manifest states the orientation rule', () => {
    expect(graph.limits.join(' ')).toMatch(/same order/i);
  });

  it.each([
    ['brief_author_v3.md'],
    ['brief_author_v3_flash_maths.md'],
    ['brief_author_v3_flash_sci.md'],
    ['brief_author_v3_flash_prose.md'],
  ])('%s carries the rule up front, and every graph example obeys it', (file) => {
    const src = fs.readFileSync(path.join(V, file), 'utf8');
    const specs = (src.match(/\{"type":"graph"[\s\S]*?\n(?=[/{]|\n|```)/g) || []);
    expect(specs.length).toBeGreaterThan(0);
    for (const spec of specs) {
      expect(spec).toContain('"xLabel"');
      expect(spec).toContain('"yLabel"');
    }
    // the model is told the rule, not only failed for breaking it
    expect(src).toMatch(/x-quantity[^\n]*y-quantity/);
  });
});
