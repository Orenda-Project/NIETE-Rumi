'use strict';
/**
 * G6-12 grade x subject registry (contract 2, subject-config.md §8).
 * The contract JSON is the fixture: the module's rows must deep-equal it.
 */
const fs = require('fs');
const path = require('path');

const SC = require('../../bot/shared/services/assessment/subject-config');
const CONTRACT = require('./fixtures/g612/subject-config.contract.json');

const A = path.join(__dirname, '../../bot/shared/services/assessment');
const core = CONTRACT.rows.filter((r) => r.status === 'core');
const nonCore = CONTRACT.rows.filter((r) => r.status !== 'core');

function thrown(fn) {
  try { fn(); } catch (e) { return e; }
  return null;
}

describe('rows', () => {
  it('deep-equal the contract JSON, in order', () => {
    expect(SC.rows()).toEqual(CONTRACT.rows);
  });

  it('hold 61 core rows, per grade 9/9/8/9/10/8/8, 53 board-or-term', () => {
    expect(core).toHaveLength(61);
    const per = [6, 7, 8, 9, 10, 11, 12].map((g) => SC.offered(g).length);
    expect(per).toEqual([9, 9, 8, 9, 10, 8, 8]);
    expect(core.filter((r) => ['board', 'term'].includes(r.board_mode))).toHaveLength(53);
  });

  it('are frozen, so no caller can mutate the registry', () => {
    const row = SC.resolve(10, 'physics');
    expect(Object.isFrozen(row)).toBe(true);
    expect(Object.isFrozen(row.tos_default)).toBe(true);
    expect(Object.isFrozen(row.tos_default.levels)).toBe(true);
    expect(Object.isFrozen(SC.rows())).toBe(true);
  });

  it('every core row obeys the field rules', () => {
    const typeSets = require('./fixtures/g612/question-types-6-12.contract.json').type_sets;
    for (const r of core) {
      expect(r.prompt_key).toBe(`eg.ict.${r.code}.${r.band}.system`);
      expect(r.prompt_key).toMatch(/^eg\.ict\.[a-z_]+\.(6_8|9_10|11_12)\.system$/);
      expect(typeSets[r.type_set]).toBeDefined();
      expect(r.rtl).toBe(r.medium === 'ur');
      expect(r.model_family).toBe(r.medium === 'ur' ? 'urdu' : 'eng');
      const sum = Object.values(r.tos_default.levels).reduce((s, n) => s + n, 0);
      expect(sum).toBe(100);
      expect(r.book_stem).toBeTruthy();
      expect(r.reason).toBeNull();
    }
  });

  it('every non-core row has a reason and no prompt key', () => {
    expect(nonCore).toHaveLength(32);
    for (const r of nonCore) {
      expect(typeof r.reason).toBe('string');
      expect(r.reason.trim().length).toBeGreaterThan(0);
      expect(r.prompt_key).toBeNull();
    }
  });

  it('book_stem has no chemistry experiment book', () => {
    expect(core.map((r) => r.book_stem)).not.toContain('grade_9_10_chemistry_experiment');
  });

  it('no data file exceeds 300 lines', () => {
    const files = ['subject-config.js', ...fs.readdirSync(path.join(A, 'subject-config'))
      .map((f) => `subject-config/${f}`)];
    for (const f of files) {
      const lines = fs.readFileSync(path.join(A, f), 'utf8').split('\n').length;
      expect(lines).toBeLessThanOrEqual(300);
    }
  });
});

describe('resolve(grade, code)', () => {
  it('returns the core row', () => {
    const r = SC.resolve(10, 'physics');
    expect(r).toEqual(core.find((x) => x.grade === 10 && x.code === 'physics'));
    expect(SC.resolve('10', ' Physics ')).toBe(r);
  });

  it('resolves every core row by number and by string grade', () => {
    for (const r of core) {
      expect(SC.resolve(r.grade, r.code)).toEqual(r);
      expect(SC.resolve(String(r.grade), r.code.toUpperCase())).toEqual(r);
    }
  });

  it('throws SUBJECT_UNKNOWN with status and reason for a book_pending row', () => {
    const e = thrown(() => SC.resolve(12, 'physics'));
    expect(e).toBeInstanceOf(Error);
    expect(e.code).toBe('SUBJECT_UNKNOWN');
    expect(e.grade).toBe(12);
    expect(e.subject).toBe('physics');
    expect(e.status).toBe('book_pending');
    expect(e.reason).toBe(nonCore.find((x) => x.grade === 12 && x.code === 'physics').reason);
  });

  it('throws with status design_pending for tarjuma_quran at 6', () => {
    const e = thrown(() => SC.resolve(6, 'tarjuma_quran'));
    expect(e.code).toBe('SUBJECT_UNKNOWN');
    expect(e.status).toBe('design_pending');
    expect(e.reason).toBeTruthy();
  });

  it('never aliases: science at 7 is unknown, with no status', () => {
    const e = thrown(() => SC.resolve(7, 'science'));
    expect(e.code).toBe('SUBJECT_UNKNOWN');
    expect(e.message).toMatch(/science/);
    expect(e.status).toBeUndefined();
    expect(e.reason).toBeUndefined();
  });

  it('throws for a bad grade or empty code at the top band', () => {
    for (const g of [13, 'x', NaN, 6.5, -1, null, undefined, '']) {
      if (g !== null && g !== undefined && g !== '' && Number(g) <= 5) continue;
      expect(thrown(() => SC.resolve(g, 'maths')).code).toBe('SUBJECT_UNKNOWN');
    }
    expect(thrown(() => SC.resolve('x', 'maths')).grade).toBe('x');
    expect(thrown(() => SC.resolve('9', 'nope')).grade).toBe(9);
    expect(thrown(() => SC.resolve(9, '')).code).toBe('SUBJECT_UNKNOWN');
    expect(thrown(() => SC.resolve(9, null)).code).toBe('SUBJECT_UNKNOWN');
  });

  it('returns null for grade <= 5 and never throws', () => {
    expect(SC.resolve(5, 'english')).toBeNull();
    expect(SC.resolve(3, 'physics')).toBeNull();
    expect(SC.resolve('4', 'x')).toBeNull();
    expect(SC.resolve(1, 'maths')).toBeNull();
    expect(SC.resolve(0, 'maths')).toBeNull();
  });

  it('grade 6 is the first registry grade', () => {
    expect(SC.resolve(6, 'maths').grade).toBe(6);
    expect(SC.resolve(12, 'maths').grade).toBe(12);
  });
});

describe('listed / offered / label / codes', () => {
  it('listed(grade) includes pending rows; offered(grade) only core, in registry order', () => {
    const l9 = SC.listed(9);
    expect(l9).toEqual(CONTRACT.rows.filter((r) => r.grade === 9));
    expect(l9.some((r) => r.status === 'book_pending')).toBe(true);
    expect(SC.offered(9)).toEqual(core.filter((r) => r.grade === 9));
    expect(SC.offered('9')).toEqual(SC.offered(9));
  });

  it('listed/offered are empty outside 6-12', () => {
    for (const g of [1, 5, 13, 'x']) {
      expect(SC.listed(g)).toEqual([]);
      expect(SC.offered(g)).toEqual([]);
    }
  });

  it('label(grade, code, lang)', () => {
    const r = core.find((x) => x.grade === 10 && x.code === 'pakistan_studies_ur');
    expect(SC.label(10, 'pakistan_studies_ur', 'en')).toBe(r.label_en);
    expect(SC.label(10, 'pakistan_studies_ur', 'ur')).toBe(r.label_ur);
    expect(SC.label(10, 'pakistan_studies_ur')).toBe(r.label_en);
    expect(SC.label(5, 'english', 'en')).toBeNull();
    // a pending row is listed by name (the go package), so it still has a label
    expect(SC.label(12, 'physics', 'en')).toBe(nonCore.find((x) => x.grade === 12 && x.code === 'physics').label_en);
    expect(SC.label(9, 'nope', 'en')).toBeNull();
  });

  it('codes() is every code the registry knows', () => {
    const want = new Set(CONTRACT.rows.map((r) => r.code));
    expect(SC.codes()).toEqual(want);
    expect(SC.codes().has('pakistan_studies_ur')).toBe(true);
  });
});
