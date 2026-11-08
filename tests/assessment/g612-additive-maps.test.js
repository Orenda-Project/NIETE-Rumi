'use strict';
/**
 * G6-12 additive map entries (subject-config.md §4): new codes only, every G1-5 entry unchanged.
 * Old values are the base (origin/sandbox 5ace97f39) maps, written out here by hand.
 */
const fs = require('fs');
const path = require('path');

const A = '../../bot/shared/services/assessment';
const Book = require(`${A}/book-content.service`);
const Renderer = require(`${A}/assessment-paper.renderer`);
const Vocab = require(`${A}/assessment-vocabulary`);
const Revision = require(`${A}/assessment-revision.service`);
const SC = require(`${A}/subject-config`);

const NEW = ['general_science', 'computer_science', 'history', 'geography', 'zarai_taleem', 'physics', 'chemistry',
  'biology', 'pakistan_studies', 'pakistan_studies_ur'];

const OLD_CODES = {
  eng: 'english', english: 'english', urdu: 'urdu', maths: 'maths', math: 'maths', mathematics: 'maths',
  islamiat: 'islamiat', science: 'science', gensci: 'science', genk: 'general_knowledge',
  general_knowledge: 'general_knowledge', sst: 'social_studies', social_studies: 'social_studies',
};
const OLD_NAMES = {
  eng: 'English', english: 'English', urdu: 'Urdu', maths: 'Mathematics', math: 'Mathematics',
  mathematics: 'Mathematics', islamiat: 'Islamiat', science: 'Science', gensci: 'Science',
  genk: 'General Knowledge', general_knowledge: 'General Knowledge', sst: 'Social Studies', social_studies: 'Social Studies',
};
const OLD_RTL = ['urdu', 'islamiat', 'genk', 'general_knowledge', 'sst', 'social_studies'];
const OLD_LABEL = {
  english: 'English', urdu: 'Urdu', maths: 'Maths', islamiat: 'Islamiat', science: 'Science',
  general_knowledge: 'General Knowledge', social_studies: 'Social Studies',
};

it('the ten new codes are exactly the registry codes G1-5 does not know', () => {
  const known = new Set(Object.values(OLD_CODES));
  expect([...SC.codes()].filter((c) => !known.has(c) && SC.listed(9).concat(SC.offered(6), SC.offered(7),
    SC.offered(8), SC.offered(10), SC.offered(11), SC.offered(12)).some((r) => r.code === c && r.status === 'core'))
    .sort()).toEqual([...NEW].sort());
});

describe('SUBJECT_CODES (book-content.service.js)', () => {
  it('every old entry resolves as before', () => {
    for (const [k, v] of Object.entries(OLD_CODES)) expect(Book.normaliseSubject(k)).toBe(v);
  });
  it('the new codes resolve to themselves for grade >= 6 only', () => {
    for (const c of NEW) {
      expect(Book.normaliseSubject(c, 6)).toBe(c);
      expect(Book.normaliseSubject(` ${c.toUpperCase()} `, '12')).toBe(c);
      expect(Book.normaliseSubject(c)).toBeNull();
      expect(Book.normaliseSubject(c, 5)).toBeNull();
    }
    expect(Book.normaliseSubject('eng', 9)).toBe('english');
    expect(Book.normaliseSubject('nope', 9)).toBeNull();
  });

  it('a G1 request for a G6-12 code still refuses before any query; G9 reaches the table', async () => {
    jest.resetModules();
    const calls = [];
    const chain = { select: () => chain, eq: (...a) => { calls.push(a); return chain; }, maybeSingle: async () => ({ data: null, error: null }), single: async () => ({ data: null, error: null }), then: (r) => r({ data: [], error: null }) };
    jest.doMock('../../bot/shared/config/supabase', () => ({ from: () => chain }));
    jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
    const B = require(`${A}/book-content.service`);
    await expect(B.listChapters({ grade: 1, subject: 'physics' })).rejects.toMatchObject({ code: 'BOOK_NOT_FOUND' });
    expect(calls).toHaveLength(0);
    await B.listChapters({ grade: 9, subject: 'physics' }).catch(() => {});
    expect(calls).toContainEqual(['subject', 'physics']);
  });
});

describe('SUBJECT_NAMES / RTL_SUBJECTS (assessment-paper.renderer.js)', () => {
  it('every old name and RTL answer is unchanged', () => {
    for (const [k, v] of Object.entries(OLD_NAMES)) expect(Renderer.subjectName(k)).toBe(v);
    for (const k of Object.keys(OLD_NAMES)) expect(Renderer.isRtl(k)).toBe(OLD_RTL.includes(k));
  });
  it('the new codes have a name, and RTL agrees with the registry medium', () => {
    for (const c of NEW) {
      expect(Renderer.subjectName(c)).not.toBe(c);
      const rows = [6, 7, 8, 9, 10, 11, 12].flatMap((g) => SC.offered(g)).filter((r) => r.code === c);
      for (const r of rows) expect([c, Renderer.isRtl(c)]).toEqual([c, r.rtl]);
    }
  });
});

describe('untouched maps', () => {
  it('SUBJECT_LABEL is unchanged, bar the English-medium GK/SST codes (bd-uam6dh)', () => {
    const { general_knowledge_en: gk, social_studies_en: sst, ...rest } = Vocab.SUBJECT_LABEL;
    expect(rest).toEqual(OLD_LABEL);
    expect([gk, sst]).toEqual(['General Knowledge', 'Social Studies']);
  });
  it('URDU_MEDIUM line is unchanged', () => {
    const src = fs.readFileSync(path.join(__dirname, A, 'assessment-generation.service.js'), 'utf8');
    expect(src).toContain("const URDU_MEDIUM = new Set(['urdu', 'islamiat', 'genk', 'sst']);");
  });
});

describe('revision service labels', () => {
  it('G1-5 file names are unchanged', () => {
    expect(Revision.fileName({ grade: 3, subject: 'maths' })).toBe('Grade3_Maths.pdf');
    expect(Revision.fileName({ grade: 5, subject: 'physics' })).toBe('Grade5_physics.pdf');
    expect(Revision.fileName({ grade: 4, subject: '' })).toBe('Grade4_Subject.pdf');
  });
  it('G6-12 uses the registry label', () => {
    expect(Revision.fileName({ grade: 10, subject: 'pakistan_studies_ur' })).toBe('Grade10_PakistanStudiesUrdu.pdf');
    expect(Revision.fileName({ grade: 9, subject: 'maths' })).toBe('Grade9_Mathematics.pdf');
    expect(Revision.fileName({ grade: 9, subject: 'nope' })).toBe('Grade9_nope.pdf');
  });
});
