/**
 * bd-2720 — parsing the free-text class labels production actually holds.
 *
 * Written BEFORE the parser exists. Every input below is a real value from the
 * NIETE production `students.self_reported_class` column (21 rows, 18 distinct
 * spellings of what are really about three classes) or from
 * `lesson_plan_catalog.grade` (62,000 rows of 'Grade One'..'Grade Five').
 *
 * The parser's job is to turn those into a (grade_code, section) pair so the
 * classes model can adopt them — and, just as importantly, to REFUSE the junk
 * rather than inventing a grade from an incidental digit.
 */

const { parseClassLabel, normalizeDigits } = require('../../bot/shared/services/classes/class-label-parser');

describe('normalizeDigits', () => {
  it('folds the superscript digit found in production', () => {
    // '⁴ A' is a real self_reported_class value — U+2074, not an ASCII 4.
    expect(normalizeDigits('⁴ A')).toBe('4 A');
  });

  it('folds Arabic-Indic and Extended Arabic-Indic digits', () => {
    expect(normalizeDigits('٤')).toBe('4');   // U+0664, Arabic-Indic
    expect(normalizeDigits('۴')).toBe('4');   // U+06F4, Urdu/Persian
  });

  it('leaves ASCII digits and letters alone', () => {
    expect(normalizeDigits('4B')).toBe('4B');
  });
});

describe('parseClassLabel — the real production spellings', () => {
  // Every one of these is a live value from students.self_reported_class.
  const CASES = [
    ['3',          'grade_3', null],
    ['4',          'grade_4', null],
    ['5',          'grade_5', null],
    ['3b',         'grade_3', 'B'],
    ['3c',         'grade_3', 'C'],
    ['3-c',        'grade_3', 'C'],
    ['3 C',        'grade_3', 'C'],
    ['3-A',        'grade_3', 'A'],
    ['4A',         'grade_4', 'A'],
    ['4B',         'grade_4', 'B'],
    ['4-A',        'grade_4', 'A'],
    ['4 B',        'grade_4', 'B'],
    ['⁴ A',        'grade_4', 'A'],
    ['5th A',      'grade_5', 'A'],
    ['class 5-c',  'grade_5', 'C'],
    ['Class:3',    'grade_3', null],
    ['Grade 3',    'grade_3', null],
  ];

  for (const [input, gradeCode, section] of CASES) {
    it(`parses ${JSON.stringify(input)} → ${gradeCode}${section ? '/' + section : ''}`, () => {
      expect(parseClassLabel(input)).toEqual({ gradeCode, section });
    });
  }

  it('normalizes section case, so "a" and "A" cannot become two classes', () => {
    expect(parseClassLabel('4a')).toEqual({ gradeCode: 'grade_4', section: 'A' });
  });
});

describe('parseClassLabel — the word forms used by the LP corpus', () => {
  // lesson_plan_catalog.grade holds these across 62,000 rows.
  it.each([
    ['Grade One',   'grade_1'],
    ['Grade Two',   'grade_2'],
    ['Grade Three', 'grade_3'],
    ['Grade Four',  'grade_4'],
    ['Grade Five',  'grade_5'],
  ])('parses %s → %s', (input, gradeCode) => {
    expect(parseClassLabel(input)).toEqual({ gradeCode, section: null });
  });

  it('parses a word form carrying a section', () => {
    expect(parseClassLabel('Grade Four B')).toEqual({ gradeCode: 'grade_4', section: 'B' });
  });
});

describe('parseClassLabel — pre-primary', () => {
  it.each(['KG', 'kg', 'Katchi', 'Kachi', 'Nursery', 'Prep', 'ECE', 'Montessori'])(
    'maps %s to early_years',
    (input) => {
      expect(parseClassLabel(input)).toEqual({ gradeCode: 'early_years', section: null });
    },
  );
});

describe('parseClassLabel — refuses to guess', () => {
  // This is the important half. The main bot's backfill had to special-case
  // exactly this: a digit inside junk text is incidental, not a grade.
  it.each([
    'Full Attendance Class',
    'Voice Test Class',
    'Test Class 3A',
    'my class',
    '',
    '   ',
    null,
    undefined,
    'Grade Thirteen',
    '13',
    '0',
    '99',
  ])('returns null for %s', (input) => {
    expect(parseClassLabel(input)).toBeNull();
  });

  it('refuses a multi-letter section, which is not a section', () => {
    expect(parseClassLabel('4 ABCD')).toBeNull();
  });
});
