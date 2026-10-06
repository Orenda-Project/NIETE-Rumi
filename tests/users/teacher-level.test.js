/**
 * One teacher level — the helper every consumer must read through.
 *
 * Before this, three columns claimed to hold a teacher's band and 233 teachers
 * on production carried contradictory values across them. `bandOf()` in
 * patch-resolver read TWO of them with a fallback and returned only the FIRST
 * band, so a MIDDLE+HIGH teacher was silently treated as MIDDLE.
 *
 * These tests pin the two properties that fix cost us:
 *   · ONE source. teacher_level, never a fallback to another column.
 *   · ALL bands, not the first one.
 */

const {
  teacherLevelOf,
  primaryBandOf,
  bandsFromGrades,
  VALID_LEVELS,
} = require('../../bot/shared/utils/teacher-level');

describe('teacherLevelOf — every band, from one column', () => {
  it('returns all bands, not just the first', () => {
    // The bug this replaces: bandOf() returned 'MIDDLE' and dropped HIGH.
    expect(teacherLevelOf({ teacher_level: ['MIDDLE', 'HIGH'] })).toEqual(['MIDDLE', 'HIGH']);
  });

  it('normalises case and stray whitespace', () => {
    expect(teacherLevelOf({ teacher_level: [' primary ', 'High'] })).toEqual(['PRIMARY', 'HIGH']);
  });

  it('drops unknown tokens rather than defaulting them to PRIMARY', () => {
    // A silent default is how a HIGH teacher ends up in a primary programme.
    expect(teacherLevelOf({ teacher_level: ['PRIMARY', 'GRADE_4', ''] })).toEqual(['PRIMARY']);
  });

  it('de-duplicates', () => {
    expect(teacherLevelOf({ teacher_level: ['HIGH', 'high', 'HIGH'] })).toEqual(['HIGH']);
  });

  it('is empty for a user with no level — never a guess', () => {
    expect(teacherLevelOf({})).toEqual([]);
    expect(teacherLevelOf({ teacher_level: null })).toEqual([]);
    expect(teacherLevelOf(null)).toEqual([]);
  });

  it('does NOT fall back to grades_taught, even when teacher_level is empty', () => {
    // The whole point of the consolidation. A fallback is how two columns
    // disagreeing became two different answers for one teacher.
    expect(teacherLevelOf({ teacher_level: [], grades_taught: 'PRIMARY' })).toEqual([]);
  });

  it('ignores the deleted columns entirely', () => {
    expect(teacherLevelOf({ teacher_level: ['HIGH'], levels: ['PRIMARY'], grade: '3' })).toEqual(['HIGH']);
  });
});

describe('primaryBandOf — one band, where a single value is genuinely needed', () => {
  it('returns the first band in canonical order, not array order', () => {
    // PRIMARY < MIDDLE < HIGH, so the answer does not depend on how the array
    // happened to be stored.
    expect(primaryBandOf({ teacher_level: ['HIGH', 'PRIMARY'] })).toBe('PRIMARY');
    expect(primaryBandOf({ teacher_level: ['HIGH', 'MIDDLE'] })).toBe('MIDDLE');
  });

  it('is null when there is no level', () => {
    expect(primaryBandOf({ teacher_level: [] })).toBeNull();
  });
});

describe('bandsFromGrades — signup grades to bands, for the backfill only', () => {
  it('maps grade granularity onto the three bands', () => {
    expect(bandsFromGrades(['grade_1', 'grade_5'])).toEqual(['PRIMARY']);
    expect(bandsFromGrades(['grade_7'])).toEqual(['MIDDLE']);
    expect(bandsFromGrades(['grade_10', 'higher_secondary'])).toEqual(['HIGH']);
    expect(bandsFromGrades(['early_years'])).toEqual(['PRIMARY']);
  });

  it('accepts the comma-string form production stores', () => {
    expect(bandsFromGrades('PRIMARY, MIDDLE')).toEqual(['PRIMARY', 'MIDDLE']);
  });

  it('accepts the stringified-array form production also stores', () => {
    // 233 rows look like '["grade_6","grade_7"]'.
    expect(bandsFromGrades('["grade_6","grade_7"]')).toEqual(['MIDDLE']);
  });

  it('returns bands in canonical order regardless of input order', () => {
    expect(bandsFromGrades(['grade_10', 'grade_2', 'grade_7'])).toEqual(['PRIMARY', 'MIDDLE', 'HIGH']);
  });

  it('is empty for junk rather than guessing', () => {
    expect(bandsFromGrades(['banana'])).toEqual([]);
    expect(bandsFromGrades(null)).toEqual([]);
    expect(bandsFromGrades('')).toEqual([]);
  });
});

describe('VALID_LEVELS', () => {
  it('is exactly the three bands', () => {
    expect(VALID_LEVELS).toEqual(['PRIMARY', 'MIDDLE', 'HIGH']);
  });
});
