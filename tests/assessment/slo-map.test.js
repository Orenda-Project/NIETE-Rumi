'use strict';
/** SLO crosswalk files + loader (contracts/tags/slo-map/README.md §6). */
const fs = require('fs');
const path = require('path');

const SLO = require('../../bot/shared/services/assessment/slo-map');
const REGISTRY = require('./fixtures/g612/subject-config.contract.json');

const DIR = path.join(__dirname, '../../bot/shared/services/assessment/slo-map');
const core = REGISTRY.rows.filter((r) => r.status === 'core');
const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.json'));
const load = (f) => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
const CODE = /^(B|C|CS|E|I|M|P|PS|U)-\d{2}-[A-Z]\d?-\d{2,3}$/;

describe('the 61 files', () => {
  it('one per core registry row, none for any other row', () => {
    expect(files.sort()).toEqual(core.map((r) => `${r.grade}_${r.code}.json`).sort());
  });

  it('match the schema; slos empty iff policy null; null files say A4a notAssessable', () => {
    for (const f of files) {
      const m = load(f);
      expect(`${m.grade}_${m.code}.json`).toBe(f);
      expect(['stamp', 'null']).toContain(m.policy);
      expect(['fbise_af', 'book_inline', 'none']).toContain(m.source.kind);
      expect(Array.isArray(m.slos)).toBe(true);
      expect(m.slos.length === 0).toBe(m.policy === 'null');
      if (m.policy === 'null') expect(m.unmapped_reason).toMatch(/A4a notAssessable/);
      for (const s of m.slos) {
        expect(typeof s.official_slo).toBe('string');
        expect(typeof s.gist).toBe('string');
        expect(s.chapter === null || Number.isInteger(s.chapter)).toBe(true);
      }
    }
  });

  it('G6-8 are all null; G9-12 all stamp', () => {
    for (const f of files) expect(load(f).policy).toBe(load(f).grade <= 8 ? 'null' : 'stamp');
  });

  it('codes are unique per file, well-formed, and no gist is an SLO sentence', () => {
    for (const f of files) {
      const codes = load(f).slos.map((s) => s.official_slo);
      expect(new Set(codes).size).toBe(codes.length);
      for (const c of codes) expect(c).toMatch(CODE);
      for (const s of load(f).slos) {
        if (!s.gist.startsWith('design_pending')) expect(s.gist.split(/\s+/).length).toBeLessThanOrEqual(8);
      }
    }
  });

  it('twins carry the same list', () => {
    for (const g of [10, 12]) {
      expect(load(`${g}_pakistan_studies.json`).slos).toEqual(load(`${g}_pakistan_studies_ur.json`).slos);
    }
  });

  it('off-year cells keep only their own grade: 10_islamiat I-10 x17, 9_pakistan_studies_ur PS-09 x35', () => {
    const isl = load('10_islamiat.json').slos.map((s) => s.official_slo);
    expect(isl).toHaveLength(17);
    for (const c of isl) expect(c.startsWith('I-10-')).toBe(true);
    const ps = load('9_pakistan_studies_ur.json').slos.map((s) => s.official_slo);
    expect(ps).toHaveLength(35);
    for (const c of ps) expect(c.startsWith('PS-09-')).toBe(true);
  });
});

describe('officialSloFor(grade, code, tag)', () => {
  it('G6-8 never stamps', () => {
    expect(SLO.officialSloFor(7, 'maths', { code: 'G7-U2-LO1' })).toBeNull();
  });

  it('a named code in the map stamps, upper-cased and trimmed', () => {
    const code = load('9_physics.json').slos[0].official_slo;
    expect(SLO.officialSloFor(9, 'physics', { code })).toBe(code);
    expect(SLO.officialSloFor('9', 'physics', { code: ` ${code.toLowerCase()} ` })).toBe(code);
    expect(SLO.officialSloFor(9, ' Physics ', { code })).toBe(code);
  });

  it('a subject code that is a path never loads a file', () => {
    const code = load('9_physics.json').slos[0].official_slo;
    expect(SLO.officialSloFor(9, 'physics/../9_physics', { code })).toBeNull();
  });

  it('a code from another grade does not stamp', () => {
    expect(SLO.officialSloFor(9, 'physics', { code: 'P-10-C-01' })).toBeNull();
  });

  it('missing cell, garbage tag, grade <= 5 -> null, never throws', () => {
    expect(SLO.officialSloFor(12, 'physics', { code: 'P-12-A-01' })).toBeNull();
    expect(SLO.officialSloFor(9, '../9_physics', { code: 'P-09-A-01' })).toBeNull();
    expect(SLO.officialSloFor(5, 'english', { code: 'E-05-A-01' })).toBeNull();
    expect(SLO.officialSloFor(9, 'physics', null)).toBeNull();
    expect(SLO.officialSloFor(9, 'physics', { code: 42 })).toBeNull();
    expect(SLO.officialSloFor('x', 'physics', {})).toBeNull();
  });

  it('a model-set official_slo is ignored', () => {
    expect(SLO.officialSloFor(9, 'physics', { code: 'g9.physics.ch2.lo3', official_slo: 'P-09-A-01' })).toBeNull();
  });

  it('cells() lists what has been loaded', () => {
    SLO.officialSloFor(10, 'chemistry', { code: 'x' });
    expect(SLO.cells()).toContain('10_chemistry');
    SLO.officialSloFor(6, 'maths', { code: 'x' });
    expect(SLO.cells()).toContain('6_maths');
  });
});

describe('stamp(map, tag) — the chapter step', () => {
  const map = {
    policy: 'stamp',
    slos: [
      { official_slo: 'P-09-A-01', gist: 'g', chapter: 3 },
      { official_slo: 'P-09-A-02', gist: 'g', chapter: 3 },
      { official_slo: 'P-09-B-01', gist: 'g', chapter: 4 },
      { official_slo: 'P-09-B-02', gist: 'g', chapter: null },
    ],
  };

  it('exactly one entry at the chapter stamps it; two or more -> null', () => {
    expect(SLO.stamp(map, { chapter: 4, code: 'g9.physics.ch4.lo1' })).toBe('P-09-B-01');
    expect(SLO.stamp(map, { chapter: 3, code: 'g9.physics.ch3.lo1' })).toBeNull();
    expect(SLO.stamp(map, { chapter: 9, code: 'g9.physics.ch9.lo1' })).toBeNull();
  });

  it('a named code wins over the chapter step', () => {
    expect(SLO.stamp(map, { chapter: 4, code: 'P-09-A-02' })).toBe('P-09-A-02');
  });

  it('policy null, or no map -> null', () => {
    expect(SLO.stamp({ ...map, policy: 'null' }, { chapter: 4 })).toBeNull();
    expect(SLO.stamp(null, { chapter: 4 })).toBeNull();
    expect(SLO.stamp({ policy: 'stamp' }, { chapter: 4 })).toBeNull();
  });
});
