/**
 * THE `cycle` DIAGRAM TYPE — bd-zrdvmi.51.
 *
 * The author brief has shown the model `{"type": "cycle"}` as its copy-this diagram shape
 * (brief_author_v3.md, "EXACT BLOCK SHAPES": `dg-water-cycle`), and the flash science brief lists
 * `cycle` among the legal spec types. The engine had no such type: renderDiagram threw "unknown
 * diagram type", the renderer substituted its placeholder, and a lesson on the Krebs, water,
 * carbon or cell cycle could only draw its cycle as a straight line of boxes. Sheet "Lesson Plans
 * (6 - 12)" row 7 (G9 Biology, Krebs cycle on the end-of-lesson board) had to be fixed by hand
 * with a ring image for exactly this reason.
 *
 * Red-first: every test below fails on origin/sandbox 2dd1190587 (no `cycle` type, no roster
 * entry, not legal to V5, not a Biology process figure).
 */

const fs = require('fs');
const path = require('path');

const V = path.resolve(__dirname, '../../bot/vendor/lp-v9');
const { renderDiagram, checkOverlaps, checkDegenerate } = require(path.join(V, 'diagrams'));
const MANIFEST = require(path.join(V, 'diagrams', 'types_manifest.json'));
const VC = require(path.join(V, 'visual_check.js'));

const KREBS = {
  type: 'cycle',
  title: 'THE KREBS CYCLE',
  centre: 'Krebs cycle',
  stages: [
    'Acetyl CoA (2C) joins',
    'Citric acid (6C)',
    'Loses CO₂ (5C)',
    'Loses CO₂ (4C)',
    'Makes ATP, FADH₂',
    'Oxaloacetate (4C) again',
  ],
  arrowLabels: ['', 'NADH', 'CO₂ + NADH', 'CO₂ + NADH', 'NADH', ''],
  caption: 'Each turn: 2 CO₂, 3 NADH, 1 FADH₂, 1 ATP.',
};

const WATER_UR = {
  type: 'cycle',
  lang: 'ur',
  centre: 'آبی چکر',
  stages: ['بخارات بننا', 'بادل بننا', 'بارش', 'پانی کا جمع ہونا'],
  arrowLabels: ['سورج کی گرمی', 'ٹھنڈک', '', ''],
};

describe('cycle draws a closed ring of stages', () => {
  test('the Krebs board renders as an SVG carrying every stage and arrow label', () => {
    const svg = renderDiagram(KREBS);
    expect(svg).toMatch(/^<svg/);
    for (const s of KREBS.stages) expect(svg).toContain(s.split(' ')[0]);
    expect(svg).toContain('NADH');
    expect(svg).toContain('Krebs cycle');
  });

  test('it has one arrow per stage — the last stage leads back to the first', () => {
    const svg = renderDiagram({ type: 'cycle', stages: ['A', 'B', 'C', 'D', 'E'] });
    expect((svg.match(/class="cycle-arrow"/g) || []).length).toBe(5);
  });

  test.each([3, 4, 5, 6, 7, 8])('%i stages with arrow labels clear the overlap and degeneracy gates', (n) => {
    const stages = Array.from({ length: n }, (_, i) => `Stage ${i + 1} of the cycle`);
    const arrowLabels = stages.map((_, i) => (i % 2 ? `out ${i}` : ''));
    const svg = renderDiagram({ type: 'cycle', centre: 'One cycle', stages, arrowLabels });
    expect(checkOverlaps(svg)).toEqual([]);
    expect(checkDegenerate(svg)).toEqual([]);
  });

  test('the Krebs board and an Urdu water cycle clear the overlap gate', () => {
    expect(checkOverlaps(renderDiagram(KREBS))).toEqual([]);
    expect(checkOverlaps(renderDiagram(WATER_UR))).toEqual([]);
  });

  test('stages may be objects with a label and short lines', () => {
    const svg = renderDiagram({
      type: 'cycle',
      stages: [{ label: 'Evaporation', lines: ['sun heats water'] }, { label: 'Condensation' }, { label: 'Rain' }],
    });
    expect(svg).toContain('sun heats water');
    expect(checkOverlaps(svg)).toEqual([]);
  });
});

describe('cycle is on every roster that decides what a lesson may draw', () => {
  test('the manifest lists it with its aliases', () => {
    const t = MANIFEST.types.find((x) => x.type === 'cycle');
    expect(t).toBeDefined();
    expect(t.required).toEqual(['stages']);
    expect(t.aliases).toEqual(expect.arrayContaining(['ring', 'cyclic_process']));
  });

  test('V5 accepts it and every alias, all of the same family', () => {
    for (const nm of ['cycle', 'ring', 'cyclic_process']) {
      expect(VC.DIAGRAM_TYPES.has(nm)).toBe(true);
    }
    expect(VC.CANON.ring).toBe('cycle');
  });

  test('a cycle satisfies the Biology and General Science process requirement', () => {
    for (const subj of ['biology', 'general science']) {
      const groups = VC.SUBJECT_RULES[subj].one_of;
      expect(groups.some((g) => g.includes('cycle') && g.includes('flow'))).toBe(true);
    }
  });

  test('the brief example `dg-water-cycle` now names a type the engine draws', () => {
    const brief = fs.readFileSync(path.join(V, 'brief_author_v3.md'), 'utf8');
    expect(brief).toContain('"type": "cycle"');
    expect(() => renderDiagram({ type: 'cycle', stages: ['a', 'b', 'c'] })).not.toThrow();
  });
});
