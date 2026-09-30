/**
 * bd-es2eg.12 — a lesson too long for one period becomes two teaching days (TDD, red first).
 *
 * Part 1 keeps its lesson_id, so a teacher's ✓ tick, R2 key and sheet link survive. Part 2 is a
 * new entry, id + "b", on the SAME segment_index, directly after it. Every consumer keys on
 * lesson_id as a string and the DB has no catalog foreign key, so nothing downstream changes.
 */

const fs = require('fs');
const { execFileSync } = require('child_process');
const path = require('path');

const S = require('../../bot/scripts/lp-catalog-splits');
const B = require('../../bot/scripts/build-lp-catalog');

const DATA = path.join(__dirname, '..', '..', 'bot', 'data');
const catalog = JSON.parse(fs.readFileSync(path.join(DATA, 'lp_catalog.json'), 'utf8'));
const SPLITS = ['grade_4_urdu_ch10_seg2', 'grade_4_urdu_ch9_seg4', 'grade_4_math_ch10_seg9'];
const cps = (s) => [...String(s)].length;

function lesson(seg, extra = {}) {
  return {
    lesson_id: `grade_4_urdu_ch10_seg${seg}`, segment_index: seg, lp_type: 'content', day_label: `Day ${seg}`,
    section: 'متن کا سفر', topic: 'بلند خوانی', pages: [88, 89, 90], pages_label: 'p.88-90', ...extra,
  };
}
function tinyCatalog() {
  return {
    counts: { books: 1, chapters: 1, lessons: 3 },
    books: [{ stem: 'grade_4_urdu', rtl: true, chapters: [{ number: 10, lessons: [lesson(1), lesson(2), lesson(3)] }] }],
  };
}
const idsOf = (c) => c.books[0].chapters[0].lessons.map((l) => l.lesson_id);
const find = (c, id) => {
  for (const b of c.books) for (const ch of b.chapters) for (const l of ch.lessons) if (l.lesson_id === id) return l;
  return null;
};

describe('applySplits', () => {
  test('inserts part 2 right after part 1, same segment_index, id + "b"', () => {
    const out = S.applySplits(tinyCatalog(), ['grade_4_urdu_ch10_seg2'], B);
    expect(idsOf(out)).toEqual(['grade_4_urdu_ch10_seg1', 'grade_4_urdu_ch10_seg2',
      'grade_4_urdu_ch10_seg2b', 'grade_4_urdu_ch10_seg3']);
    const [p1, p2] = [find(out, 'grade_4_urdu_ch10_seg2'), find(out, 'grade_4_urdu_ch10_seg2b')];
    expect([p1.part, p2.part]).toEqual([1, 2]);
    expect(p2.segment_index).toBe(2);
    expect([p1.day_label, p2.day_label]).toEqual(['Day 2 · part 1', 'Day 2 · part 2']);
    expect(out.counts.lessons).toBe(4);
  });

  test('labels an Urdu row in Urdu script and digits', () => {
    const out = S.applySplits(tinyCatalog(), ['grade_4_urdu_ch10_seg2'], B);
    expect(find(out, 'grade_4_urdu_ch10_seg2').row.description).toMatch(/^‏دن ۲ · حصہ ۱/);
    expect(find(out, 'grade_4_urdu_ch10_seg2b').row.description).toMatch(/^‏دن ۲ · حصہ ۲/);
  });

  test('is pure and idempotent', () => {
    const input = tinyCatalog();
    const before = JSON.stringify(input);
    const once = S.applySplits(input, ['grade_4_urdu_ch10_seg2'], B);
    expect(JSON.stringify(input)).toBe(before);
    expect(S.applySplits(once, ['grade_4_urdu_ch10_seg2'], B)).toEqual(once);
  });

  test('refuses an id the catalog does not have', () => {
    expect(() => S.applySplits(tinyCatalog(), ['grade_4_urdu_ch10_seg9'], B)).toThrow(/grade_4_urdu_ch10_seg9/);
  });
});

describe('the committed catalog', () => {
  test('data/lp_splits.json lists exactly the three G4 splits', () => {
    expect(JSON.parse(fs.readFileSync(path.join(DATA, 'lp_splits.json'), 'utf8'))).toEqual(SPLITS);
  });

  test('carries both parts of every split, within the row caps', () => {
    expect(catalog.counts.lessons).toBe(2041);
    for (const id of SPLITS) {
      const [p1, p2] = [find(catalog, id), find(catalog, `${id}b`)];
      expect([p1 && p1.part, p2 && p2.part]).toEqual([1, 2]);
      for (const l of [p1, p2]) {
        expect(cps(l.row.title)).toBeLessThanOrEqual(B.SECTION_CAP);
        expect(cps(l.row.description)).toBeLessThanOrEqual(B.DESC_CAP);
        expect(cps(l.row.metadata)).toBeLessThanOrEqual(B.META_CAP);
      }
    }
  });

  test('is exactly what applySplits gives, so the CLI and the builder agree', () => {
    expect(S.applySplits(catalog, SPLITS, B)).toEqual(catalog);
  });

  test('apply-lp-splits.js --check agrees the committed catalog is up to date', () => {
    const out = execFileSync('node', [path.join(__dirname, '..', '..', 'bot', 'scripts', 'apply-lp-splits.js'), '--check'], { encoding: 'utf8' });
    expect(out).toMatch(/every split is in the catalog/);
  });
});
