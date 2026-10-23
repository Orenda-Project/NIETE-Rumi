/**
 * bd-yggj4o.2 — the ch11-18 diagram types reach the VENDORED engine.
 *
 * The grade 1-5 ch11-18 build (bd-yggj4o.1, Amena 8 Oct: "pictures for Maths - we should create
 * them, words wont do") added three families to the lp-v9 diagram engine upstream: `solid`
 * (cube/cuboid/cylinder/cone/sphere/pyramid, plus prisms and pyramids on a 3-8 sided base, with
 * hideable names), `bar_graph` and `thermometer`. The bot renders lesson plans through
 * `bot/vendor/lp-v9`, so until they are vendored a spec using them throws "unknown type" and the
 * page ships a placeholder instead of the picture.
 *
 * Every test drives the real `renderDiagram` entry point, so a red run proves the vendored copy
 * is what lacks them.
 */

const path = require('path');

const DIAGRAMS = path.resolve(__dirname, '../../bot/vendor/lp-v9/diagrams');
const { renderDiagram, listTypes, checkOverlaps } = require(DIAGRAMS);
const MANIFEST = require(path.join(DIAGRAMS, 'types_manifest.json'));
const VC = require('../../bot/vendor/lp-v9/visual_check.js');

const count = (svg, re) => (svg.match(re) || []).length;
const polygons = (svg) => [...svg.matchAll(/<polygon points="([^"]+)"/g)]
  .map((m) => m[1].trim().split(/\s+/));

describe('solid — 3-D shapes', () => {
  test('all six G2 solids render side by side, each named once', () => {
    const kinds = ['cube', 'cuboid', 'cylinder', 'cone', 'sphere', 'pyramid'];
    const svg = renderDiagram({ type: 'solid', shapes: kinds.map((kind) => ({ kind })) });
    expect(svg).toMatch(/^<svg/);
    for (const k of kinds) expect(count(svg, new RegExp(`>${k}<`, 'g'))).toBe(1);
  });

  test.each([[3, 'triangular'], [4, 'square'], [5, 'pentagonal'], [6, 'hexagonal'], [8, 'octagonal']])(
    'a prism and a pyramid on a %i-sided base render and are named',
    (n, word) => {
      const prism = renderDiagram({ type: 'solid', shapes: [{ kind: 'prism', sides: n }] });
      expect(polygons(prism).filter((p) => p.length === n).length).toBeGreaterThanOrEqual(1);
      expect(prism).toMatch(/stroke-dasharray/);
      const pyr = renderDiagram({ type: 'solid', shapes: [{ kind: 'pyramid', sides: n }] });
      expect(pyr).toMatch(/stroke-dasharray/);
      expect(prism).toContain(`>${word} prism<`);
      expect(pyr).toContain(`>${word} pyramid<`);
    }
  );

  test('name:false hides the answer on a "name this shape" item; a custom name prints', () => {
    const svg = renderDiagram({ type: 'solid', shapes: [{ kind: 'cone', name: false }, { kind: 'cube', name: 'A' }] });
    expect(svg).not.toContain('>cone<');
    expect(svg).not.toContain('>cube<');
    expect(svg).toContain('>A<');
  });

  test('an unsupported base or an unknown kind is a build-time error, not a blank box', () => {
    expect(() => renderDiagram({ type: 'solid', shapes: [{ kind: 'pyramid', sides: 7 }] })).toThrow(/sides/);
    expect(() => renderDiagram({ type: 'solid', shapes: [{ kind: 'torus' }] })).toThrow(/unknown shape kind/);
  });
});

describe('bar_graph', () => {
  const FRUIT = {
    type: 'bar_graph', categories: ['Orange', 'Apple', 'Kiwi', 'Banana'], values: [4, 2, 3, 5],
    yMax: 6, xLabel: 'Fruit', yLabel: 'Number of children',
  };
  const bars = (svg) => [...svg.matchAll(/<rect [^>]*data-bar="([^"]+)"[^>]*height="([\d.]+)"/g)]
    .map((m) => [m[1], Number(m[2])]);

  test('one bar per category, heights in proportion, axes and scale labelled', () => {
    const svg = renderDiagram(FRUIT);
    const b = bars(svg);
    expect(b.map((x) => x[0])).toEqual(FRUIT.categories);
    const unit = b[0][1] / 4;
    b.forEach(([, h], i) => expect(Math.abs(h - unit * FRUIT.values[i])).toBeLessThan(0.6));
    for (const t of [...FRUIT.categories, FRUIT.xLabel, FRUIT.yLabel, '0', '6']) expect(svg).toContain(`>${t}<`);
    expect(checkOverlaps(svg)).toEqual([]);
  });

  test('blank:true draws the labelled axes with no bars', () => {
    const svg = renderDiagram({ ...FRUIT, values: undefined, blank: true });
    expect(bars(svg)).toHaveLength(0);
    expect(svg).toContain('>Number of children<');
  });

  test('missing axis labels fail the build', () => {
    expect(() => renderDiagram({ ...FRUIT, xLabel: '' })).toThrow(/xLabel and yLabel/);
  });
});

describe('thermometer', () => {
  const THREE = {
    type: 'thermometer', min: 0, max: 50, step: 10,
    thermometers: [{ value: 33, name: 'A' }, { value: 29, name: 'B' }, { value: 45, name: 'C' }],
  };
  const fills = (svg) => [...svg.matchAll(/<rect [^>]*data-fill="([^"]+)"[^>]*height="([\d.]+)"/g)]
    .map((m) => [m[1], Number(m[2])]);

  test('one fill per thermometer, height in proportion to the reading, with a °C scale', () => {
    const svg = renderDiagram(THREE);
    const f = fills(svg);
    expect(f.map((x) => x[0])).toEqual(['A', 'B', 'C']);
    const unit = f[0][1] / 33;
    f.forEach(([, h], i) => expect(Math.abs(h - unit * THREE.thermometers[i].value)).toBeLessThan(0.6));
    expect(svg).toContain('>°C<');
    expect(checkOverlaps(svg)).toEqual([]);
  });

  test('showValue prints each reading; blank draws no fill', () => {
    const shown = renderDiagram({ ...THREE, showValue: true });
    for (const v of ['33°C', '29°C', '45°C']) expect(shown).toContain(`>${v}<`);
    expect(fills(renderDiagram({ ...THREE, blank: true }))).toHaveLength(0);
  });

  test('a reading outside the scale fails the build', () => {
    expect(() => renderDiagram({ ...THREE, thermometers: [{ value: 60 }] })).toThrow(/outside/);
  });
});

describe('the three families are registered everywhere the roster is read', () => {
  const NEW = ['solid', 'bar_graph', 'thermometer'];

  test('the registry, the manifest and V5 all carry them, aliases included', () => {
    const live = listTypes();
    for (const t of NEW) {
      const reg = live.find((x) => x.type === t);
      expect(reg).toBeDefined();
      const entry = MANIFEST.types.find((x) => x.type === t);
      expect(entry).toBeDefined();
      for (const name of [t, ...entry.aliases]) {
        expect(VC.DIAGRAM_TYPES.has(name)).toBe(true);
        expect(renderDiagram({ ...entry.minimal_spec, type: name })).toMatch(/^<svg/);
        if (name !== t) expect(VC.CANON[name]).toBe(t);
      }
    }
  });
});
