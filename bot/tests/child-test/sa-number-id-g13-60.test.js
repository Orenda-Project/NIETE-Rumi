/**
 * Number identification, Grades 1-3: the continuation runs to 60 numerals (behind sa_r28_ceiling), so a fast reader in
 * Grade 3 is still naming numbers when the minute ends. Cells 43-60 come from published EGMA grids, in printed order,
 * none a numeral the run already holds. The fixture pins what the forms served before this change: OFF is unchanged,
 * Grades 4-5 are unchanged, and the first 42 cells of Grades 1-3 are byte-equal.
 */
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { applySwitches } = require('../../../dashboard/routes/sa-battery-switches');

const SA = path.join(__dirname, '../../shared/data/child-test/sa');
const BASE = require('./fixtures/sa-number-id-served.base.json');
const read = (f) => JSON.parse(fs.readFileSync(path.join(SA, f), 'utf8'));
const sha = (x) => crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const FILES = Object.keys(BASE.off);
const numId = (b) => b.tasks.find((t) => t && t.id === 'ma.number_id8');
const G13 = FILES.filter((f) => /^sa\.coach\.G[123]\./.test(f));
const G45 = FILES.filter((f) => /^sa\.coach\.G[45]\./.test(f));
const ON = { rdfW3Forms: true, r28Ceiling: true };

const CELLS_43_60 = [
  ['21', 'jordan_egma_2021_protocol:p.1, cell 5'], ['18', 'jordan_egma_2021_protocol:p.1, cell 7'],
  ['17', 'jordan_egma_2021_protocol:p.1, cell 10'], ['66', 'jordan_egma_2021_protocol:p.1, cell 16'],
  ['72', 'jordan_egma_2021_protocol:p.1, cell 18'], ['26', 'jordan_egma_2021_protocol:p.1, cell 20'],
  ['13', 'malawi_egma2010:p.A-5, Sheet 2(1), cell 3'], ['97', 'malawi_egma2010:p.A-6, Sheet 2(2), cell 6'],
  ['234', 'malawi_egma2010:p.A-6, Sheet 2(2), cell 8'], ['468', 'malawi_egma2010:p.A-6, Sheet 2(2), cell 9'],
  ['16', 'zambia_nas2014:p.13, cell 4'], ['27', 'zambia_nas2014:p.13, cell 9'], ['59', 'zambia_nas2014:p.13, cell 11'],
  ['553', 'zambia_nas2014:p.13, cell 18'], ['600', 'zambia_nas2014:p.13, cell 19'],
  ['100', 'morocco_egma2012:p.76, cell 4'], ['81', 'morocco_egma2012:p.76, cell 7'], ['32', 'morocco_egma2012:p.76, cell 8'],
];

describe('number identification, Grades 1-3: 60 cells with sa_r28_ceiling ON', () => {
  test('the pinned base covers every coach form', () => {
    expect(G13).toHaveLength(6);
    expect(G45).toHaveLength(4);
  });

  test.each(G13)('%s ON: 60 cells, the first 42 byte-equal to today, cells 43-60 as printed with their src', (f) => {
    const t = numId(applySwitches(read(f), ON));
    expect(t.items).toHaveLength(60);
    expect(t.base_n).toBe(8); // the band reads the first 8 (level.js), as today
    expect(sha(t.items.slice(0, 42))).toBe(BASE.on_first42[f]);
    expect(t.items.slice(42).map((x) => [String(x.show), x.src])).toEqual(CELLS_43_60);
    t.items.slice(42).forEach((x, i) => {
      expect(x).toMatchObject({ id: `ma.number_id8.c${43 + i}`, target: Number(x.show), answer: Number(x.show), ext: true });
    });
    if (t.grid) expect(t.grid).toEqual(t.items.map((x) => x.show));
    const shown = t.items.map((x) => String(x.show));
    expect(shown.filter((n, i) => shown.indexOf(n) !== i)).toEqual([]);
    expect(shown.slice(42).filter((n) => !/^\d{1,3}$/.test(n))).toEqual([]); // plain digits, nothing above three digits
    shown.forEach((n, i) => expect([i, n === shown[i - 1]]).toEqual([i, false]));
  });

  test.each(FILES)('%s OFF: deep-equal to today (with and without the W3 forms)', (f) => {
    expect(sha(applySwitches(read(f), { rdfW3Forms: true, r28Ceiling: false }))).toBe(BASE.off[f]);
    expect(sha(applySwitches(read(f), {}))).toBe(BASE.off_plain[f]);
  });

  test.each(FILES.filter((f) => !G13.includes(f)))('%s ON: unchanged (Grades 4-5 and the game forms)', (f) => {
    expect(sha(applySwitches(read(f), ON))).toBe(BASE.on[f]);
  });

  test('ON, across G1-G5: an item id means one numeral on every form (.43-.50 stay the G4-5 cells)', () => {
    const seen = new Map();
    for (const f of [...G13, ...G45]) for (const x of numId(applySwitches(read(f), ON)).items) {
      if (!seen.has(x.id)) seen.set(x.id, new Set());
      seen.get(x.id).add(String(x.show));
    }
    expect([...seen].filter(([, s]) => s.size > 1).map(([id, s]) => [id, [...s]])).toEqual([]);
  });

  test.each(G45)('%s ON: still 50 cells, none of the Grades 1-3 continuation', (f) => {
    const t = numId(applySwitches(read(f), ON));
    expect(t.items).toHaveLength(50);
    expect(t.items.some((x) => CELLS_43_60.some(([, src]) => src === x.src))).toBe(false);
  });
});
