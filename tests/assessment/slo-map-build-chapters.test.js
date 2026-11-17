'use strict';
/**
 * slo-map/build-chapters.js (bd-5jmnfj.38.30 item 4), the CLI that writes slo-map/chapters/<grade>_<code>.json from the
 * G6-12 LP matrix: its parsing, on a tiny in-memory matrix (no book text, no files read).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const B = require('../../bot/shared/services/assessment/slo-map/build-chapters');

const CSV = [
  'Physics matrix,,',
  'Day#,SLO Codes,SLO Description',
  'GRADE 9,,',
  'Ch 2: Motion,,',
  '1,"G9-U2-LO1-3","Describe motion [p.12] in a straight line with words"',
  '2,"P-09-A-02 · book p16 outcome 1","Speed · Velocity"',
  '3,"G9-U1-LO1, G9-U2-LO4",Revision roll-up',
  '4,not printed — see Comments,',
  'GRADE 8,,',
  'Ch 1: Skip,,',
  '1,G8-U1-LO1,Not asked',
].join('\r\n');

describe('build-chapters', () => {
  test('parseCsv keeps quoted commas and doubled quotes', () => {
    expect(B.parseCsv('a,"b, c","d ""e"""\nx')).toEqual([['a', 'b, c', 'd "e"'], ['x']]);
  });

  test('splitCodes expands an LO range; kindOf names lo / official / book and drops the rest', () => {
    expect(B.splitCodes('G9-U2-LO1-3 · P-09-A-02')).toEqual(['G9-U2-LO1', 'G9-U2-LO2', 'G9-U2-LO3', 'P-09-A-02']);
    expect(['G9-U2-LO1', 'P-09-A-02', 'book p16 outcome 1', 'A-11-A-12'].map(B.kindOf)).toEqual(['lo', 'official', 'book', null]);
  });

  test('chaptersOf: the asked grades only, a multi-unit roll-up skipped, descriptions short and bracket-free', () => {
    const out = B.chaptersOf(CSV);
    expect(Object.keys(out)).toEqual(['9']);
    expect(out[9][2].map((x) => [x.code, x.kind])).toEqual([
      ['G9-U2-LO1', 'lo'], ['G9-U2-LO2', 'lo'], ['G9-U2-LO3', 'lo'], ['P-09-A-02', 'official'], ['book p16 outcome 1', 'book'],
    ]);
    expect(out[9][2][0].desc).toBe('Describe motion in a straight line with words');
    expect(out[9][2][3].desc).toBe('Speed');
  });

  test('build writes one file per grade for a matrix it finds, and skips the ones it does not', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'slo-matrix-'));
    const outDir = path.join(root, 'out');
    try {
      fs.mkdirSync(path.join(root, 'stem'));
      fs.writeFileSync(path.join(root, 'stem', 'physics_6_12.csv'), CSV);
      expect(B.build(root, outDir)).toEqual(['9_physics.json']);
      const doc = JSON.parse(fs.readFileSync(path.join(outDir, '9_physics.json'), 'utf8'));
      expect([doc.grade, doc.code, doc.source.kind, Object.keys(doc.chapters)]).toEqual([9, 'physics', 'lp_matrix', ['2']]);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
});
