'use strict';

/**
 * bd-31ziu8.1 — FICO-S v1.1 ("FICO for Secondary", ICT HITL grades 6-12), branched off FICO17 v6.
 *
 * Operator 18 Nov ~14:30: "for ICT we get 2 rubrics only. For 1 to 5, remains the same FICO v6. For 6 onwards all the
 * way to 12, it is going to be FICO-S v1.1 ... FICO-S v1.1 is branched off of FICO v6." The binding text is the
 * operator's sheet (1HLMlVbvKZCw8CLuKSzWBd6xiQEPyFc5kRZq7HqqUobg, tab 'Framework'); the repo keeps a snapshot of it
 * (fico_s_v1_1.source.json) and the rubric data is generated from that snapshot (bot/scripts/build-fico-s-rubric.js).
 */

const path = require('path');
const fs = require('fs');

const DIR = path.join(__dirname, '../../bot/shared/services/coaching/frameworks/fico-s');

describe('FICO-S v1.1 — the rubric as data', () => {
  const S = require('../../bot/shared/services/coaching/frameworks/fico-s');

  test('id, label, version and lineage', () => {
    // The sheet's text is v1.1 (frozen); a new form is v1.2 from queue #218 (tests/coaching/fico-s-v1-2.test.js).
    expect(S.BASE_KEY).toBe('fico_s_v1_1');
    expect(S.RUBRIC.rubric).toBe('fico_s_v1_1');
    // operator 18 Nov ~17:00: people see 'FICO 6-12'; the code name stays FICO-S v1.1
    expect(S.labelOf('fico_s_v1_1')).toBe('FICO 6-12');
    expect(S.RUBRIC.code_name).toBe('FICO-S v1.1');
    expect(S.RUBRIC.title).toMatch(/^FICO 6-12 · /);
    expect(S.RUBRIC.version).toBe('1.1');
    expect(S.RUBRIC.branched_from).toBe('fico17_v6');
    expect(S.RUBRIC.source.sheet_id).toBe('1HLMlVbvKZCw8CLuKSzWBd6xiQEPyFc5kRZq7HqqUobg');
    expect(S.RUBRIC.grades).toEqual([6, 7, 8, 9, 10, 11, 12]);
  });

  test('23 indicators in five sections, in the sheet order', () => {
    expect(S.CODES).toEqual([
      'A1', 'A2', 'A3',
      'B1', 'B2', 'B3', 'B4', 'B5',
      'C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8',
      'D1', 'D2', 'D3', 'D4',
      'E1', 'E2', 'E3',
    ]);
    expect(S.SECTIONS.map((s) => [s.key, s.codes.length])).toEqual([['A', 3], ['B', 5], ['C', 8], ['D', 4], ['E', 3]]);
    expect(S.SECTIONS[0].name).toBe('Lesson planning & structure');
    expect(S.SECTIONS[0].question).toMatch(/clear learning objective/);
  });

  test('every indicator: name, what to look for, how, four level texts, the v6 indicator it is aligned to', () => {
    for (const code of S.CODES) {
      const i = S.indicator(code);
      expect(i.name).toBeTruthy();
      expect(i.look_for).toBeTruthy();
      expect(i.look_for).not.toMatch(/How:/);
      expect(i.how).toBeTruthy();
      expect(i.levels.map((l) => l.n)).toEqual([1, 2, 3, 4]);
      for (const l of i.levels) expect(l.text.length).toBeGreaterThan(10);
      // The Examples tab gives up to one example a level (B4 B5 C7 D4 have none for level 1; E2 has none).
      expect(i.examples.length).toBeLessThanOrEqual(4);
    }
    expect(S.indicator('A1').examples).toHaveLength(4);
    expect(S.indicator('E2').examples).toHaveLength(0);
    expect(S.indicator('C1').aligned_v6).toEqual(['C1']);
    expect(S.indicator('C6').aligned_v6).toEqual(['C6', 'D4']);
    expect(S.indicator('D4').aligned_v6).toEqual(['D5']);
    expect(S.indicator('A1').aligned_v6).toEqual([]);
    expect(S.indicator('E3').origin).toMatch(/FDE only/);
    expect(S.indicator('A1').name).toBe('Lesson objective (SLO)');
    expect(S.indicator('E2').how).toMatch(/5 random students/);
  });

  test('level names are FICO-S own (not v6 Not Observed / Highly Effective)', () => {
    expect(S.LEVEL_LABELS).toEqual({ 1: 'Below standard', 2: 'Developing', 3: 'Proficient', 4: 'Exemplary' });
    expect(S.levelName(4)).toBe('Exemplary');
  });

  test('N/A only where the indicator could not happen: C2 (no answer was wrong) on a v1.1 form', () => {
    expect(S.naCodes('fico_s_v1_1')).toEqual(['C2']);
    expect(S.normLevel('NA', 'C2', 'fico_s_v1_1')).toBe('NA');
    expect(S.normLevel('NA', 'C3', 'fico_s_v1_1')).toBeNull();
    expect(S.normLevel('NA', 'C1')).toBeNull();
    expect(S.normLevel('3', 'C1')).toBe(3);
    expect(S.normLevel(5, 'C1')).toBeNull();
  });

  test('scoring as the sheet says: domain = average; overall % = total ÷ (4 × scored) × 100; bands 85/65/45', () => {
    const all = (n) => Object.fromEntries(S.CODES.map((c) => [c, n]));
    expect(S.score(all(4)).pct).toBe(100);
    expect(S.score(all(4)).band.label).toBe('Exemplary');
    expect(S.score(all(1)).pct).toBe(25);
    expect(S.score(all(1)).band.label).toBe('Below standard');
    const r = S.score({ ...all(3), C2: 'NA' });
    expect(r.counted).toBe(22);
    expect(r.na).toEqual(['C2']);
    expect(r.max).toBe(88);
    expect(r.total).toBe(66);
    expect(r.pct).toBe(75);
    expect(r.band.label).toBe('Proficient');
    const c = r.sections.find((s) => s.key === 'C');
    expect(c.scored).toBe(7);
    expect(c.average).toBe(3);
    // band edges: 85 Exemplary, 84.9 Proficient, 65 Proficient, 45 Developing, 44.9 Below standard
    expect(S.bandFor(85).label).toBe('Exemplary');
    expect(S.bandFor(84.9).label).toBe('Proficient');
    expect(S.bandFor(65).label).toBe('Proficient');
    expect(S.bandFor(64.9).label).toBe('Developing');
    expect(S.bandFor(45).label).toBe('Developing');
    expect(S.bandFor(44.9).label).toBe('Below standard');
    expect(S.bandFor(null)).toBeNull();
  });

  test('missing levels are listed and left out of the sums', () => {
    const r = S.score({ A1: 4, A2: 2 });
    expect(r.counted).toBe(2);
    expect(r.pct).toBe(75);
    expect(r.missing).toHaveLength(21);
  });

  test('the checklist (not scored) and the feedback rule are carried', () => {
    expect(S.RUBRIC.checklist).toHaveLength(12);
    expect(S.RUBRIC.checklist[0]).toEqual(expect.objectContaining({ key: 'cl_1', group: 'Classroom environment' }));
    expect(S.RUBRIC.feedback_rule).toMatch(/ONE \(at most two\)/);
  });

  test('Urdu: every indicator, level name and section has a draft; English is the fallback', () => {
    const ur = JSON.parse(fs.readFileSync(path.join(DIR, 'fico_s_v1_1.ur.json'), 'utf8'));
    expect(ur.status).toMatch(/DRAFT/);
    for (const code of S.CODES) {
      const t = S.indicatorText(code, 'ur');
      expect(t.name).toMatch(/[؀-ۿ]/);
      expect(t.look_for).toMatch(/[؀-ۿ]/);
      expect(t.levels).toHaveLength(4);
      for (const l of t.levels) expect(l).toMatch(/[؀-ۿ]/);
    }
    for (const n of [1, 2, 3, 4]) expect(S.levelName(n, 'ur')).toMatch(/[؀-ۿ]/);
    for (const s of S.SECTIONS) expect(S.sectionName(s.key, 'ur')).toMatch(/[؀-ۿ]/);
    expect(S.indicatorText('A1', 'en').name).toBe('Lesson objective (SLO)');
  });

  test('the rubric JSON is what the build script makes from the sheet snapshot (never hand-edited)', () => {
    const { build } = require('../../bot/scripts/build-fico-s-rubric');
    const source = JSON.parse(fs.readFileSync(path.join(DIR, 'fico_s_v1_1.source.json'), 'utf8'));
    const built = build(source);
    const onDisk = JSON.parse(fs.readFileSync(path.join(DIR, 'fico_s_v1_1.rubric.json'), 'utf8'));
    expect(built).toEqual(onDisk);
  });
});

describe('FICO-S v1.1 — one rubric of its own, never a FICO V3/v6 number', () => {
  test('the grade 6-12 form registry knows it as a tool', () => {
    const O = require('../../bot/shared/services/coaching/frameworks/obs612');
    expect(O.isObs612Id('fico_s_v1_1')).toBe(true);
    expect(O.toolOf('fico_s_v1_1')).toBe('ficos');
    expect(O.toolById('fico_s_v1_1')).toBeTruthy();
    expect(O.labelOf('fico_s_v1_1')).toBe('FICO 6-12');
    expect(O.labelOf('obs612-enur-v1')).toBe('FDE v1');
    // FDE's ids are unchanged
    expect(O.toolOf('obs612-msci-v1')).toBe('msci');
    expect(O.isObs612Id('fico_s_v9_9')).toBe(false);
  });

  test('own-rubric: kept out of every FICO total and average', () => {
    const { isOwnRubric, ownRubricOf } = require('../../bot/shared/services/coaching/frameworks/own-rubric');
    expect(isOwnRubric({ framework: 'fico_s_v1_1' })).toBe(true);
    expect(ownRubricOf({ scores: { rubric: 'fico_s_v1_1' } })).toBe('fico_s_v1_1');
  });

  test('rubric label: FICO 6-12 on every surface', () => {
    const { rubricLabelOf } = require('../../bot/shared/services/coaching/rubric-label');
    expect(rubricLabelOf({ form: { rubric_version: 'fico_s_v1_1' } })).toEqual({ id: 'fico_s_v1_1', label: 'FICO 6-12' });
    expect(rubricLabelOf({ session: { framework: 'fico_s_v1_1' } })).toEqual({ id: 'fico_s_v1_1', label: 'FICO 6-12' });
    expect(rubricLabelOf({ session: { framework: 'obs612-gen-v1' } })).toEqual({ id: 'obs612-gen-v1', label: 'FDE v1' });
  });

  test('dashboard frameworks service treats it as its own rubric', () => {
    const svc = require('../../dashboard/services/coaching-frameworks.service');
    const own = svc.isOwnRubric || svc.isOwnRubricScore;
    expect(typeof own).toBe('function');
    expect(own({ framework: 'fico_s_v1_1' })).toBe(true);
  });
});
