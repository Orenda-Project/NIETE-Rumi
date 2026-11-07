'use strict';
/**
 * bd-rj6w0n.14.16.3 — the segment import takes GB Grades 1-5 books (curriculum nbf_snc) and still refuses a
 * Grade 1-5 segment that is not GB: the 6-12 range guard is widened for nbf_snc only.
 */
const { validateSegment, toRow, parseGradeSpan } = require('../../bot/scripts/import-lp612-segments');

const gbSeg = (over = {}) => ({
  segment_id: 'nbf_snc_grade_2_urdu.c07.s005',
  book_stem: 'nbf_snc_grade_2_urdu',
  grade: 2,
  subject: 'Urdu',
  language: 'ur',
  chapter_key: 'c07',
  subtopic_title: 'حروف',
  menu_title: 'حروف',
  printed_page_start: 40,
  order_index: 5,
  ...over,
});

describe('import — GB Grades 1-5', () => {
  test('a Grade 2 nbf_snc segment validates when the file is nbf_snc', () => {
    expect(validateSegment(gbSeg(), { curriculum: 'nbf_snc' }).errors).toEqual([]);
  });

  test('a Grade 2 nbf_snc segment validates by its own tag', () => {
    expect(validateSegment(gbSeg({ curriculum: 'nbf_snc' })).errors).toEqual([]);
  });

  test('a Grade 2 ICT segment is still refused', () => {
    const errs = validateSegment(gbSeg({ book_stem: 'grade_2_urdu', segment_id: 'grade_2_urdu.c07.s005' })).errors;
    expect(errs).toContain('grade 2 is outside 6-12');
  });

  test('toRow writes grade 2 and the nbf_snc tag', () => {
    const row = toRow(gbSeg(), { corpusVersion: 'gb_k5_v1', curriculum: 'nbf_snc' });
    expect(row.grade).toBe(2);
    expect(row.curriculum).toBe('nbf_snc');
    expect(row.also_grades).toEqual([]);
  });

  test('the bare 6-12 guard is unchanged', () => {
    expect(parseGradeSpan(2)).toBeNull();
    expect(parseGradeSpan('9-10')).toEqual({ grade: 9, alsoGrades: [10] });
    expect(parseGradeSpan(0, { curriculum: 'nbf_snc' })).toBeNull();
    expect(parseGradeSpan(13, { curriculum: 'nbf_snc' })).toBeNull();
  });
});
