/**
 * The Grade 9–10 chemistry practicals book.
 *
 * 34 segments carry `grade: "9-10"` — one book, taught to both years. The column is
 * `INTEGER CHECK (grade BETWEEN 6 AND 12)`, so the importer skipped all 34 and the corpus landed
 * at 5,448 of 5,482.
 *
 * Operator's call: visible under BOTH grade 9 and grade 10 chemistry, WITHOUT authoring it twice.
 *
 * That rules out the obvious fix. Two rows cannot share a `segment_id` — it is the PRIMARY KEY,
 * and it is the key deliberately, because `niete_lp612_renders` carries a foreign key to it and
 * the R2 cache is keyed `(segment_id, lang, template_version)`. Duplicating the book into a
 * second row would mean a second segment_id, a second cache entry, and the same lesson authored
 * twice at ~$0.60 and several minutes a go — exactly what was ruled out.
 *
 * So: ONE row, with the extra years listed in `also_grades`. One segment_id, one render, one
 * cache entry, served into two menus. The cache dedupes by construction rather than by luck.
 */

const Import = require('../../bot/scripts/import-lp612-segments');
const { toRow, validateSegment, parseGradeSpan } = Import;

const seg = (over = {}) => ({
  segment_id: 'grade_9_10_chemistry_experiment.c01.p026-028',
  book_stem: 'grade_9_10_chemistry_experiment',
  grade: '9-10',
  subject: 'Chemistry',
  medium: 'English',
  language: 'en',
  chapter_number: 1,
  chapter_title: 'Practical work',
  chapter_key: 'c01',
  subtopic_title: 'Measuring with a burette',
  menu_title: 'Using a burette',
  printed_page_start: 26,
  printed_page_end: 28,
  order_index: 1,
  lp_type: 'practical',
  ...over,
});

describe('a grade span is read as a primary grade plus the others', () => {
  test.each([
    ['9-10', 9, [10]],
    ['11-12', 11, [12]],
    ['9–10', 9, [10]],   // en-dash: the corpus is written by hand in places
  ])('%s -> grade %d, also %j', (spec, grade, also) => {
    expect(parseGradeSpan(spec)).toEqual({ grade, alsoGrades: also });
  });

  test('a plain grade has no extra years', () => {
    expect(parseGradeSpan(9)).toEqual({ grade: 9, alsoGrades: [] });
    expect(parseGradeSpan('9')).toEqual({ grade: 9, alsoGrades: [] });
  });

  test('a span outside 6-12 is still rejected — the guard is not weakened', () => {
    expect(parseGradeSpan('4-5')).toBeNull();
    expect(parseGradeSpan('nonsense')).toBeNull();
  });
});

describe('the shared book now imports', () => {
  test('it validates instead of being skipped', () => {
    expect(validateSegment(seg()).errors).toEqual([]);
  });

  test('the row carries grade 9 and also_grades [10]', () => {
    const row = toRow(seg());
    expect(row.grade).toBe(9);
    expect(row.also_grades).toEqual([10]);
  });

  test('ONE row, ONE segment_id — the cache key is unchanged', () => {
    // If this ever becomes two rows, the same lesson is authored and paid for twice.
    const row = toRow(seg());
    expect(row.segment_id).toBe('grade_9_10_chemistry_experiment.c01.p026-028');
  });

  test('an ordinary segment gets an empty also_grades, never null', () => {
    // INTEGER[] NOT NULL DEFAULT '{}' — a null fails the whole chunk, not the row.
    expect(toRow(seg({ grade: 9 })).also_grades).toEqual([]);
  });

  test('a genuinely out-of-range grade is STILL rejected', () => {
    expect(validateSegment(seg({ grade: 5 })).errors.join(' ')).toMatch(/outside 6-12/);
    expect(validateSegment(seg({ grade: '4-5' })).errors.join(' ')).toMatch(/outside 6-12/);
  });
});
