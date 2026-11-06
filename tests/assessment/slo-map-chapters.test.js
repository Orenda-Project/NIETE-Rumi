'use strict';
/**
 * bd-5jmnfj.38.30 item 4: chapter codes from the G6-12 LP matrix, built by slo-map/build-chapters.js and appended
 * to the board prompt's CURRICULUM CODES by listFor(grade, code, chapter). Fictional matrix rows only.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const DIR = path.join(__dirname, '../../bot/shared/services/assessment/slo-map');
const B = require(`${DIR}/build-chapters`);
const SLO = require(DIR);

const HEAD = 'Day#,Seg,LP Type,Topic,Skill Type,CPA,Section,Pages,SLO Codes,SLO Description,Bloom';
const MATRIX = [
  'Made-up matrix title,,,,,,,,,,',
  HEAD,
  'GRADE 8 — PHYSICS,,,,,,,,,,',
  'Ch 2: LAMPS,,,,,,,,,,',
  '1,1,Theory,Lamps,hook,,Lamps,"3,4",P-08-A-01,Name the parts of a made-up lamp,understand',
  'GRADE 9 — PHYSICS,,,,,,,,,,',
  'Ch 2: BRIDGES AND ROPES,,,,,,,,,,',
  '1,1,Theory,Ropes,hook,,Ropes,"5,6",G9-U2-LO1-3,"Describe how a made-up rope bridge carries a load across a river  [matched by heading — confirm] · Name a rope · Tie a knot",understand',
  '9,9,Revision,All,hook,,All,"9",G9-U1-LO7 · G9-U2-LO9,rolls up the outcome lists of 2 chapters,apply',
  '2,2,Theory,Ropes,hook,,Ropes,"7",G9-U2-LO2 · P-09-A-02,Second description that never wins,apply',
  '3,3,Theory,Ropes,hook,,Ropes,"8",not printed — see Comments,Nothing,apply',
  'Ch 3: EMPTY,,,,,,,,,,',
  '4,1,Theory,None,hook,,None,"9",,,apply',
  'GRADE 11 — PHYSICS,,,,,,,,,,',
  'Ch 1: KITES,,,,,,,,,,',
  '5,1,Theory,Kites,hook,,Kites,"2",book p16 outcome 1,Fly a made-up kite,apply',
].join('\n');

describe('build-chapters: the matrix to chapter codes', () => {
  const got = B.chaptersOf(MATRIX);
  test('G9-12 only, by chapter; LO ranges expanded; unknown forms and empty chapters dropped', () => {
    expect(Object.keys(got)).toEqual(['9', '11']);
    expect(Object.keys(got[9])).toEqual(['2']);
    expect(got[9][2].map((x) => [x.code, x.kind])).toEqual([
      ['G9-U2-LO1', 'lo'], ['G9-U2-LO2', 'lo'], ['G9-U2-LO3', 'lo'], ['P-09-A-02', 'official'],
    ]);
    expect(got[11][1]).toEqual([{ code: 'book p16 outcome 1', kind: 'book', desc: 'Fly a made-up kite' }]);
  });
  test('descriptions pair with the expanded codes, at most 8 words, without the bracketed note; the first wins', () => {
    expect(got[9][2].slice(0, 3).map((x) => x.desc)).toEqual(['Describe how a made-up rope bridge carries a', 'Name a rope', 'Tie a knot']);
  });
  test('a revision row whose codes span two units adds nothing', () => {
    expect(got[9][2].map((x) => x.code)).not.toContain('G9-U2-LO9');
    expect(got[9][2].map((x) => x.code)).not.toContain('G9-U1-LO7');
  });
  test('Urdu grade and chapter rows, in Urdu digits, are read', () => {
    const ur = ['Day#,Seg,LP Type,Topic,Skill Type,Section,Pages,SLO Codes,SLO Description', 'درجہ ۱۰ — اردو,,,,,,,,', 'باب ۴: فرضی سبق,,,,,,,,', '1,1,x,x,x,x,3,U-10-R-01,Read a made-up poem'].join('\n');
    expect(B.chaptersOf(ur)).toEqual({ 10: { 4: [{ code: 'U-10-R-01', kind: 'official', desc: 'Read a made-up poem' }] } });
  });
  test('build() writes one file per grade with codes, tagged as the lp_matrix source', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mx-'));
    const out = path.join(root, 'out');
    fs.mkdirSync(path.join(root, 'stem'));
    fs.writeFileSync(path.join(root, 'stem/physics_6_12.csv'), MATRIX);
    expect(B.build(root, out).sort()).toEqual(['11_physics.json', '9_physics.json']);
    const doc = JSON.parse(fs.readFileSync(path.join(out, '9_physics.json'), 'utf8'));
    expect(doc).toMatchObject({ grade: 9, code: 'physics', source: { file: 'stem/physics_6_12.csv', kind: 'lp_matrix' } });
  });
});

describe('the generated chapter files', () => {
  const files = fs.readdirSync(path.join(DIR, 'chapters')).filter((f) => f.endsWith('.json'));
  test('G9-12 only; every code has a known form and a short description; no chapter is empty', () => {
    expect(files.length).toBeGreaterThan(10);
    files.forEach((f) => {
      const doc = JSON.parse(fs.readFileSync(path.join(DIR, 'chapters', f), 'utf8'));
      expect(`${doc.grade}_${doc.code}.json`).toBe(f);
      expect(doc.grade).toBeGreaterThanOrEqual(9);
      Object.values(doc.chapters).forEach((list) => {
        expect(list.length).toBeGreaterThan(0);
        list.forEach((x) => {
          expect(B.kindOf(x.code)).toBe(x.kind);
          expect(x.desc.split(/\s+/).length).toBeLessThanOrEqual(8);
        });
      });
    });
  });
  test('gaps stay gaps: no G9 Pakistan Studies, G12 Physics or G12 Islamiat file', () => {
    ['9_pakistan_studies.json', '12_physics.json', '12_islamiat.json'].forEach((f) => expect(files).not.toContain(f));
  });
});

describe('listFor with a chapter', () => {
  test('the chapter codes follow the subject list; no chapter, or a chapter not in the file, leaves it as it was', () => {
    const base = SLO.listFor(9, 'physics');
    const ch2 = SLO.listFor(9, 'physics', 2);
    expect(ch2.startsWith(base)).toBe(true);
    expect(ch2).toMatch(/\nThis chapter \(ch 2\):\n/);
    expect(ch2).toMatch(/\nG9-U2-LO1 — /);
    expect(SLO.listFor(9, 'physics', 999)).toBe(base);
    expect(SLO.listFor(9, 'physics', null)).toBe(base);
  });
});
