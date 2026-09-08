/**
 * The diagram roster, asserted on the SERVING copy.
 *
 * Upstream's own suites do not run here (SYNC.md §5), so a fix that landed in the skill and
 * was then half-vendored looks exactly like a fix that shipped. These assertions run against
 * `bot/vendor/lp-v9/diagrams` — the engine a teacher's lesson is actually drawn by — and each
 * one pins a defect that reached this repo and would reach it again on a sloppy re-vendor.
 *
 * Red-first: verified failing against `origin/develop`'s vendored tree before the copy.
 *
 * bd-09m6a.
 */

const fs = require('fs');
const path = require('path');

const DIAGRAMS = path.resolve(__dirname, '../../bot/vendor/lp-v9/diagrams');
const { renderDiagram, listTypes, checkOverlaps } = require(DIAGRAMS);
const MANIFEST = require(path.join(DIAGRAMS, 'types_manifest.json'));

describe('the vendored diagram roster matches its manifest', () => {
  it('the manifest is vendored alongside the engine', () => {
    expect(fs.existsSync(path.join(DIAGRAMS, 'types_manifest.json'))).toBe(true);
  });

  it('lists exactly the types the vendored registry serves', () => {
    const live = listTypes().map((t) => t.type).sort();
    expect(MANIFEST.types.map((t) => t.type).sort()).toEqual(live);
    expect(MANIFEST.count).toBe(live.length);
  });

  it.each(MANIFEST.types.map((t) => [t.type, t]))(
    '%s: its aliases resolve and its minimal spec renders',
    (_name, t) => {
      const live = listTypes().find((x) => x.type === t.type);
      expect([...t.aliases].sort()).toEqual([...live.aliases].sort());
      for (const alias of t.aliases) {
        expect(renderDiagram({ ...t.minimal_spec, type: alias })).toMatch(/^<svg/);
      }
      expect(renderDiagram(JSON.parse(JSON.stringify(t.minimal_spec)))).toMatch(/^<svg/);
    }
  );
});

describe('the Urdu defects that made a legal spec fail the DIAGRAM_OVERLAP gate', () => {
  // Each of these rendered a lesson UNSHIPPABLE, not merely ugly: lint_lp.js treats a
  // colliding pair as a hard fail, so one Urdu circuit value cost the whole document.
  it('an Urdu component VALUE clears its Urdu label', () => {
    const svg = renderDiagram({
      type: 'circuit', lang: 'ur', layout: 'series',
      cells: [
        { kind: 'battery', label: 'بیٹری', value: '6 V' },
        { kind: 'switch', label: 'سوئچ', value: 'بند', closed: true },
        { kind: 'lamp', label: 'بلب' },
      ],
    });
    expect(checkOverlaps(svg)).toEqual([]);
  });

  it('an Urdu molecule name clears the formula subscript', () => {
    expect(checkOverlaps(renderDiagram({
      type: 'molecule', lang: 'ur', smiles: 'O', formula: 'H2O', name: 'پانی',
    }))).toEqual([]);
  });
});

describe('a minimal grid does not fail the lint for being a grid', () => {
  // grid GENERATES its own readout from rows/cols/shaded but used to size the canvas from the
  // grid alone, so a 2x2 carried a readout wider than itself: the text ran edge to edge and
  // DIAGRAM_OVERLAP — a hard lint fail — rejected a correct, minimal spec. Only below ~5x5,
  // which is why the 10x10 hundred square never showed it. The worst shape of the failure this
  // lane exists to remove: a lesson fails BECAUSE it carries a diagram.
  it.each([
    [2, 2, 1], [3, 3, 4], [4, 4, 7], [1, 3, 2],
    [5, 5, 9], [10, 10, 37],
  ])('%ix%i with %i shaded renders without a collision', (rows, cols, shaded) => {
    expect(checkOverlaps(renderDiagram({ type: 'grid', rows, cols, shaded }))).toEqual([]);
  });

  it('holds for an Urdu grid and for a supplied over-long legend', () => {
    expect(checkOverlaps(renderDiagram({ type: 'grid', rows: 2, cols: 2, shaded: 1, lang: 'ur' }))).toEqual([]);
    expect(checkOverlaps(renderDiagram({
      type: 'grid', rows: 2, cols: 2, shaded: 1, legend: 'one quarter of the whole square',
    }))).toEqual([]);
  });
});

describe('a Latin mass inside an Urdu free-body chip is bidi-isolated', () => {
  // Invisible to every gate: the SVG string is correct and the reversal happens in the
  // browser's text layout, so "ڈبہ 5 kg" printed as "kg 5 ڈبہ" on a real teacher's PDF.
  const LRI = '⁦';
  const PDI = '⁩';

  it('wraps the mass so bidi cannot reorder it', () => {
    const svg = renderDiagram({
      type: 'free_body', lang: 'ur',
      body: { shape: 'box', label: 'ڈبہ', mass: '5 kg' },
      forces: [
        { name: 'W', label: 'وزن', angle: 270, magnitude: 50, color: 'warn' },
        { name: 'N', label: 'عمودی قوت', angle: 90, magnitude: 50, color: 'cool' },
      ],
    });
    expect(svg).toContain(`${LRI}5 kg${PDI}`);
  });

  it('leaves an all-Latin diagram free of isolate characters', () => {
    const svg = renderDiagram({
      type: 'free_body',
      body: { shape: 'box', label: 'Box', mass: '5 kg' },
      forces: [{ name: 'W', label: 'weight', angle: 270, magnitude: 50, color: 'warn' }],
    });
    expect(svg).not.toContain(LRI);
    expect(svg).not.toContain(PDI);
  });
});

describe('the dot-and-cross alias draws dot-and-cross, not Bohr shells', () => {
  const NACL = { element: 'Na', partner: { element: 'Cl' }, bond: 'ionic', transfer: 1 };
  const isBohr = (svg) => /\dp⁺/.test(svg);

  it('via the type alias', () => {
    expect(isBohr(renderDiagram({ type: 'dot_and_cross', ...NACL }))).toBe(false);
  });

  it('via mode:"dot_and_cross" as well as mode:"dot_cross"', () => {
    expect(isBohr(renderDiagram({ type: 'atom', mode: 'dot_and_cross', ...NACL }))).toBe(false);
    expect(isBohr(renderDiagram({ type: 'atom', mode: 'dot_cross', ...NACL }))).toBe(false);
  });

  it('but a bare atom, and an explicit mode, still get Bohr', () => {
    expect(isBohr(renderDiagram({ type: 'atom', element: 'Na' }))).toBe(true);
    expect(isBohr(renderDiagram({ type: 'dot_and_cross', mode: 'bohr', element: 'Na' }))).toBe(true);
  });
});

describe('labelled_figure carries its own example asset', () => {
  // It used to resolve seven levels up, into a workspace folder that does not exist in this
  // repo, so the vendored copy could only ever render an "image not found" card.
  it('the crop is vendored inside the engine', () => {
    const p = path.join(DIAGRAMS, 'assets', 'fig_1_11_leaf.jpg');
    expect(fs.existsSync(p)).toBe(true);
    expect(fs.statSync(p).size).toBeGreaterThan(1000);
  });

  it('the type module points at it, and not out of this repo', () => {
    const src = fs.readFileSync(path.join(DIAGRAMS, 'types', 'labelled_figure.js'), 'utf8');
    expect(src).not.toMatch(/\/Users\//);
    // The old form built the path from a `REPO` root seven levels up and a workspace-relative
    // string, landing in an operator investigation folder that does not exist in this repo at
    // all — so the vendored copy could only ever draw the "image not found" card. Assert the
    // CODE, not the prose: a comment explaining the old form must not fail this.
    expect(src).toMatch(/const LEAF = path\.join\(__dirname, "\.\.", "assets"/);
    expect(src).not.toMatch(/^const REPO = path\.resolve\(/m);
  });
});
