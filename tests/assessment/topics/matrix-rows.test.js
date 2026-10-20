'use strict';
/** Task 2 — pure parser: one curriculum-matrix tab (2-D cell array) -> day rows. */
const { parseMatrixTab } = require('../../../bot/shared/services/assessment/topics/matrix-rows');
const sample = require('./fixtures/matrix-sample.json');

const HEADER = ['Day#', 'Seg', 'LP Type', 'Topic', 'Skill Type', 'CPA', 'Section', 'Pages', 'SLO Codes', 'SLO Description'];
const day = (d, extra = {}) => {
  const r = Array(14).fill('');
  Object.assign(r, { 0: String(d), 1: String(d), 2: 'content', 3: ' T ', 7: '1', 8: 'X-01', 9: 'd' }, extra);
  return r;
};

describe('parseMatrixTab', () => {
  test('locates the header by cell names, not by position', () => {
    const rows = parseMatrixTab([['junk'], ['more junk'], ['banner'], HEADER, ['GRADE 2 — MATHS'], ['Ch 1: A'], day(1)], 'maths');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ grade: 2, chapter: 1, chapterTitle: 'A', day: 1, seg: 1 });
  });

  test('throws when there is no header row', () => {
    expect(() => parseMatrixTab([['a'], ['b']], 'maths')).toThrow(/header/i);
  });

  test('rejects an unknown subject', () => {
    expect(() => parseMatrixTab(sample.maths, 'art')).toThrow(/subject/i);
  });

  test('GRADE row sets the grade; empty chapter title for "Ch 1: "', () => {
    const rows = parseMatrixTab(sample.english, 'english');
    expect(rows).toHaveLength(10);
    expect(rows[0]).toMatchObject({ grade: 1, chapter: 1, chapterTitle: '', day: 1, seg: 1, lpType: 'content', topic: 'All About Me: Key Words (Memory Lane)', skillType: 'vocabulary_grammar', cpa: '', section: 'Memory Lane' });
    expect(new Set(rows.map((r) => r.chapter))).toEqual(new Set([1, 2]));
  });

  test('chapter title is parsed from "Ch 1: Number Buddies 0-9"', () => {
    const rows = parseMatrixTab(sample.maths, 'maths');
    expect(rows[0].chapterTitle).toBe('Number Buddies 0-9');
    expect(rows[0].cpa).toBe('concrete');
    expect(rows.some((r) => r.chapter === 2 && r.chapterTitle === 'Double-Digit Dazzle')).toBe(true);
  });

  test('pages "4,5,6" -> [4,5,6]; SLO codes split on comma, descriptions on " / "', () => {
    const [r] = parseMatrixTab([HEADER, ['GRADE 1 — ENGLISH'], ['Ch 1: x'], day(1, { 7: '4,5,6', 8: 'E-01-VO-01, E-01-PH-01', 9: 'Pronounce words / Name objects (sort / group)' })], 'english');
    expect(r.pages).toEqual([4, 5, 6]);
    expect(r.sloCodes).toEqual(['E-01-VO-01', 'E-01-PH-01']);
    expect(r.sloDescriptions).toEqual(['Pronounce words', 'Name objects (sort', 'group)']);
  });

  test('blank pages / SLO cells give empty arrays', () => {
    const [r] = parseMatrixTab([HEADER, ['GRADE 1 — ENGLISH'], ['Ch 1: x'], day(1, { 7: '', 8: '', 9: '' })], 'english');
    expect([r.pages, r.sloCodes, r.sloDescriptions]).toEqual([[], [], []]);
  });

  test('keeps the Urdu "⟢" topic intact and Urdu chapter titles', () => {
    const rows = parseMatrixTab(sample.urdu, 'urdu');
    const r8 = rows.find((r) => r.day === 8);
    expect(r8.topic).toContain('⟢');
    expect(r8.pages).toEqual([8, 9]);
    expect(rows[0].chapterTitle).toBe('حمد – میرا خُدا');
  });

  test('blank rows are skipped', () => {
    const rows = parseMatrixTab([HEADER, [], [''], ['GRADE 1 — ENGLISH'], ['Ch 1: x'], Array(14).fill(''), day(1)], 'english');
    expect(rows).toHaveLength(1);
  });

  test('science: G4 and G5 kept, everything from the 6-12 banner onward dropped', () => {
    const rows = parseMatrixTab(sample.science, 'science');
    expect(new Set(rows.map((r) => r.grade))).toEqual(new Set([4, 5]));
    expect(rows.filter((r) => r.grade === 5).every((r) => r.chapter === 1)).toBe(true);
    expect(rows.some((r) => /Cellular/.test(r.chapterTitle))).toBe(false);
    expect(rows[rows.length - 1].topic).toMatch(/Chapter Review/);
  });

  test('rows under grades > 5 are dropped', () => {
    const rows = parseMatrixTab([HEADER, ['GRADE 6 — GENERAL SCIENCE'], ['Ch 1: x'], day(1)], 'science');
    expect(rows).toEqual([]);
  });

  test('a day row before any chapter header throws, naming the row', () => {
    expect(() => parseMatrixTab([HEADER, ['GRADE 1 — ENGLISH'], day(1)], 'english')).toThrow(/row 3/);
    expect(() => parseMatrixTab([HEADER, day(1)], 'english')).toThrow(/row 2/);
  });
});
