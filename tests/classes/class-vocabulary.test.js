/**
 * bd-2720 — resolving the legacy grade/subject encodings through the seeded
 * reference tables.
 *
 * Written BEFORE the service exists. The point of `grade_levels.aliases` and
 * `subjects.aliases` is that the four incompatible grade encodings and five
 * subject spellings in production can resolve to a canonical code WITHOUT
 * migrating their columns. This is the test of that claim.
 *
 * The band cases are the ugly ones. `leader_teachers.level` (7,149 rows) holds
 * 32 distinct spellings of three bands, including 'MIDDLE+HIGH', 'HIGH+MIDDLE',
 * 'Middle and High', 'MIDDLE/HIGH', 'PRIMARY + MIDDLE' and the typos 'PRIMAYR'
 * and 'Parimary+HIGH+MIDDLE'. All of them are real values.
 */

const mockSupabase = { from: jest.fn() };
jest.mock('../../bot/shared/config/supabase', () => mockSupabase);
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

// The seeded reference rows, as V1.1.3 / 02_seed-data.sql write them.
const GRADE_ROWS = [
  { code: 'early_years', ordinal: 0,  band: 'early_years',      aliases: ['early_years', 'Early Years', 'ECE', 'Katchi', 'KG', 'Nursery', 'Prep', 'Montessori'] },
  { code: 'grade_1',     ordinal: 1,  band: 'primary',          aliases: ['grade_1', 'Grade 1', 'Grade One', '1', '1st'] },
  { code: 'grade_3',     ordinal: 3,  band: 'primary',          aliases: ['grade_3', 'Grade 3', 'Grade Three', '3', '3rd'] },
  { code: 'grade_5',     ordinal: 5,  band: 'primary',          aliases: ['grade_5', 'Grade 5', 'Grade Five', '5', '5th'] },
  { code: 'grade_8',     ordinal: 8,  band: 'middle',           aliases: ['grade_8', 'Grade 8', 'Grade Eight', '8', '8th'] },
  { code: 'grade_10',    ordinal: 10, band: 'high',             aliases: ['grade_10', 'Grade 10', 'Grade Ten', '10', '10th', 'Matric'] },
  { code: 'grade_12',    ordinal: 12, band: 'higher_secondary', aliases: ['grade_12', 'Grade 12', 'Grade Twelve', '12', '12th'] },
];

const SUBJECT_ROWS = [
  { code: 'urdu',              parent_code: null, aliases: ['urdu', 'Urdu', 'Reading Hour Urdu'] },
  { code: 'english',           parent_code: null, aliases: ['english', 'English', 'Reading Hour English'] },
  { code: 'maths',             parent_code: null, aliases: ['maths', 'Maths', 'Math', 'Mathematics', 'Numeracy'] },
  { code: 'science',           parent_code: null, aliases: ['science', 'Science', 'General Science', 'general_science', 'GK-Science'] },
  { code: 'social_studies',    parent_code: null, aliases: ['social_studies', 'Social Studies'] },
  { code: 'general_knowledge', parent_code: null, aliases: ['general_knowledge', 'General Knowledge', 'GK'] },
];

/** Stub the two reference-table reads. */
function db({ grades = GRADE_ROWS, subjects = SUBJECT_ROWS, failOn = null } = {}) {
  mockSupabase.from.mockImplementation((table) => {
    const rows = table === 'grade_levels' ? grades : subjects;
    const result = failOn === table
      ? { data: null, error: { message: 'boom' } }
      : { data: rows, error: null };
    return { select: () => ({ eq: () => Promise.resolve(result) }) };
  });
}

let vocab;
beforeEach(() => {
  jest.resetModules();
  jest.clearAllMocks();
  db();
  vocab = require('../../bot/shared/services/classes/class-vocabulary.service');
});

describe('resolveGradeLevel — the four legacy grade encodings', () => {
  it('resolves the grade_N slug used by users.grades_taught', async () => {
    await expect(vocab.resolveGradeLevel('grade_3')).resolves.toMatchObject({ code: 'grade_3', ordinal: 3, band: 'primary' });
  });

  it('resolves the word form used across 62,000 lesson_plan_catalog rows', async () => {
    await expect(vocab.resolveGradeLevel('Grade Five')).resolves.toMatchObject({ code: 'grade_5', ordinal: 5 });
  });

  it('resolves a bare digit', async () => {
    await expect(vocab.resolveGradeLevel('10')).resolves.toMatchObject({ code: 'grade_10', band: 'high' });
  });

  it('resolves case- and whitespace-insensitively', async () => {
    await expect(vocab.resolveGradeLevel('  gRaDe fIvE  ')).resolves.toMatchObject({ code: 'grade_5' });
  });

  it('resolves a pre-primary alias', async () => {
    await expect(vocab.resolveGradeLevel('Katchi')).resolves.toMatchObject({ code: 'early_years', ordinal: 0 });
  });

  it('returns null for a BAND, which is not a grade', async () => {
    // The important negative: 'PRIMARY' means five grades, not one. Coercing it
    // to grade_1 would silently pick the wrong reading passage.
    await expect(vocab.resolveGradeLevel('PRIMARY')).resolves.toBeNull();
  });

  it('returns null for junk', async () => {
    await expect(vocab.resolveGradeLevel('Full Attendance Class')).resolves.toBeNull();
  });
});

describe('resolveBand — the 32 spellings in leader_teachers.level', () => {
  it.each([
    ['PRIMARY',                  ['primary']],
    ['MIDDLE',                   ['middle']],
    ['HIGH',                     ['high']],
    ['Middle',                   ['middle']],
    ['MIDDLE+HIGH',              ['middle', 'high']],
    ['HIGH+MIDDLE',              ['middle', 'high']],
    ['PRIMARY+MIDDLE',           ['primary', 'middle']],
    ['PRIMARY + MIDDLE',         ['primary', 'middle']],
    ['PRIMARY+ MIDDLE',          ['primary', 'middle']],
    ['Primary+ MIDDLE',          ['primary', 'middle']],
    ['primary+MIDDLE',           ['primary', 'middle']],
    ['PRIMARY+MIDDLE+HIGH',      ['primary', 'middle', 'high']],
    ['MIDDLE+HIGH+PRIMARY',      ['primary', 'middle', 'high']],
    ['MIDDLE/HIGH',              ['middle', 'high']],
    ['Middle and High',          ['middle', 'high']],
    ['Middle + High',            ['middle', 'high']],
    ['higher_secondary',         ['higher_secondary']],
    ['early_years',              ['early_years']],
  ])('normalizes %s', async (input, expected) => {
    await expect(vocab.resolveBand(input)).resolves.toEqual(expected);
  });

  it.each([
    ['PRIMAYR',                  ['primary']],
    ['Parimary+HIGH+MIDDLE',     ['primary', 'middle', 'high']],
  ])('tolerates the observed typo %s', async (input, expected) => {
    await expect(vocab.resolveBand(input)).resolves.toEqual(expected);
  });

  it('returns bands in canonical ascending order regardless of input order', async () => {
    await expect(vocab.resolveBand('HIGH+PRIMARY')).resolves.toEqual(['primary', 'high']);
  });

  it('returns an empty array for an unrecognised band', async () => {
    await expect(vocab.resolveBand('SOMETHING ELSE')).resolves.toEqual([]);
  });

  it('returns an empty array for null', async () => {
    await expect(vocab.resolveBand(null)).resolves.toEqual([]);
  });
});

describe('gradesInBand', () => {
  it('expands a band to its grades, so a band-only value is not coerced to one grade', async () => {
    await expect(vocab.gradesInBand('primary')).resolves.toEqual(['grade_1', 'grade_3', 'grade_5']);
  });
});

describe('resolveSubject — the five competing spellings', () => {
  it.each([
    ['Math',            'maths'],
    ['Maths',           'maths'],
    ['maths',           'maths'],
    ['Mathematics',     'maths'],
    ['Numeracy',        'maths'],
    ['Science',         'science'],
    ['General Science', 'science'],
    ['GK-Science',      'science'],
    ['english',         'english'],
    ['English',         'english'],
    ['Reading Hour Urdu', 'urdu'],
    ['General Knowledge', 'general_knowledge'],
  ])('resolves %s → %s', async (input, expected) => {
    await expect(vocab.resolveSubject(input)).resolves.toBe(expected);
  });

  it('returns null for a subject the LP corpus cannot serve', async () => {
    // Deliberately excluded from the seed: we do not claim to support a subject
    // we cannot give the teacher a lesson plan for.
    await expect(vocab.resolveSubject('Islamiat')).resolves.toBeNull();
    await expect(vocab.resolveSubject('Physics')).resolves.toBeNull();
  });
});

describe('caching', () => {
  it('reads each reference table once across many resolutions', async () => {
    await vocab.resolveGradeLevel('grade_3');
    await vocab.resolveGradeLevel('Grade Five');
    await vocab.resolveSubject('Math');
    await vocab.resolveSubject('Urdu');

    const tables = mockSupabase.from.mock.calls.map((c) => c[0]);
    expect(tables.filter((t) => t === 'grade_levels')).toHaveLength(1);
    expect(tables.filter((t) => t === 'subjects')).toHaveLength(1);
  });
});

describe('failure behaviour', () => {
  it('fails CLOSED — a DB error resolves to null, never a guessed code', async () => {
    jest.resetModules();
    db({ failOn: 'grade_levels' });
    const v = require('../../bot/shared/services/classes/class-vocabulary.service');
    await expect(v.resolveGradeLevel('grade_3')).resolves.toBeNull();
  });

  it('does not cache a failed load, so a transient error self-heals', async () => {
    jest.resetModules();
    let failing = true;
    mockSupabase.from.mockImplementation((table) => ({
      select: () => ({
        eq: () => Promise.resolve(
          failing ? { data: null, error: { message: 'transient' } }
                  : { data: table === 'grade_levels' ? GRADE_ROWS : SUBJECT_ROWS, error: null },
        ),
      }),
    }));
    const v = require('../../bot/shared/services/classes/class-vocabulary.service');
    await expect(v.resolveGradeLevel('grade_3')).resolves.toBeNull();
    failing = false;
    await expect(v.resolveGradeLevel('grade_3')).resolves.toMatchObject({ code: 'grade_3' });
  });
});
