/**
 * bd-2672 — training-assignment backfill: band derivation
 *
 * ICT sheet Row 8: "New users do not get assigned trainings."
 * 228 of 283 registration_completed users have no active teacher_training_assignments
 * row, because nothing in the running app ever creates one.
 *
 * These tests pin the derivation that decides which program(s) an unassigned
 * teacher gets. Pure functions, no DB, no side effects.
 *
 * The load-bearing decision (operator, 2026-08-13): a teacher with NO grade
 * signal gets NOTHING. No default program, no guessed band. 125 users are in
 * that bucket; assigning them would be inventing access from thin air.
 */

const {
  deriveBands,
  programsForUser,
  OVERRIDES,
} = require('../../scripts/lib/training-band-derivation');

describe('deriveBands — grade ids to PRIMARY/MIDDLE/HIGH', () => {
  // Grade vocabulary: bot/shared/config/registration-data.js:111-124
  test.each([
    ['early_years', ['PRIMARY']],
    ['grade_1', ['PRIMARY']],
    ['grade_5', ['PRIMARY']],
    ['grade_6', ['MIDDLE']],
    ['grade_8', ['MIDDLE']],
    ['grade_9', ['HIGH']],
    ['grade_10', ['HIGH']],
    ['higher_secondary', ['HIGH']],
  ])('%s -> %j', (grade, expected) => {
    expect(deriveBands({ grades_taught: JSON.stringify([grade]) })).toEqual(expected);
  });

  test('primary boundary: grades 1-5 never leak into MIDDLE', () => {
    const g = ['grade_1', 'grade_2', 'grade_3', 'grade_4', 'grade_5'];
    expect(deriveBands({ grades_taught: JSON.stringify(g) })).toEqual(['PRIMARY']);
  });

  test('middle boundary: grades 6-8 only', () => {
    const g = ['grade_6', 'grade_7', 'grade_8'];
    expect(deriveBands({ grades_taught: JSON.stringify(g) })).toEqual(['MIDDLE']);
  });

  test('mixed array yields multiple bands, sorted and deduped', () => {
    const g = ['grade_3', 'grade_1', 'grade_7', 'grade_10'];
    expect(deriveBands({ grades_taught: JSON.stringify(g) })).toEqual(['HIGH', 'MIDDLE', 'PRIMARY']);
  });
});

describe('deriveBands — users.levels wins over grades_taught', () => {
  test('levels is trusted verbatim when present', () => {
    const u = { levels: ['MIDDLE', 'HIGH'], grades_taught: '["grade_1"]' };
    expect(deriveBands(u)).toEqual(['HIGH', 'MIDDLE']);
  });

  test('empty levels array falls through to grades_taught', () => {
    const u = { levels: [], grades_taught: '["grade_2"]' };
    expect(deriveBands(u)).toEqual(['PRIMARY']);
  });
});

describe('deriveBands — the migrated-user shape', () => {
  // scripts/migrate-users.py:318 sets grades_taught = ", ".join(levels),
  // so imported users carry a comma-joined BAND string, not grade ids.
  test('comma-joined band string parses', () => {
    expect(deriveBands({ grades_taught: 'MIDDLE, HIGH' })).toEqual(['HIGH', 'MIDDLE']);
  });

  test('comma-joined band string is case-insensitive', () => {
    expect(deriveBands({ grades_taught: 'primary' })).toEqual(['PRIMARY']);
  });
});

describe('deriveBands — no signal returns null, never a default', () => {
  test.each([
    ['null grades', { grades_taught: null }],
    ['undefined grades', {}],
    ['empty string', { grades_taught: '' }],
    ['whitespace', { grades_taught: '   ' }],
    ['empty JSON array', { grades_taught: '[]' }],
    ['malformed JSON', { grades_taught: '["grade_1"' }],
    ['unrecognized tokens', { grades_taught: '["banana","???"]' }],
    ['null levels and null grades', { levels: null, grades_taught: null }],
  ])('%s -> null', (_label, user) => {
    expect(deriveBands(user)).toBeNull();
  });
});

describe('programsForUser — band to program key', () => {
  test('PRIMARY only -> niete_primary', () => {
    expect(programsForUser({ grades_taught: '["grade_3"]' })).toEqual(['niete_primary']);
  });

  test('MIDDLE only -> niete_middle_high', () => {
    expect(programsForUser({ grades_taught: '["grade_7"]' })).toEqual(['niete_middle_high']);
  });

  test('HIGH only -> niete_middle_high', () => {
    expect(programsForUser({ grades_taught: '["grade_10"]' })).toEqual(['niete_middle_high']);
  });

  test('MIDDLE and HIGH collapse to a single niete_middle_high row', () => {
    expect(programsForUser({ grades_taught: '["grade_7","grade_10"]' })).toEqual(['niete_middle_high']);
  });

  test('PRIMARY plus MIDDLE -> both programs', () => {
    const got = programsForUser({ grades_taught: '["grade_2","grade_7"]' });
    expect(got.sort()).toEqual(['niete_middle_high', 'niete_primary']);
  });
});

describe('programsForUser — the 125 no-signal users are SKIPPED', () => {
  // Operator decision, 2026-08-13: "dont assign them anything yet."
  // This is the guard: if a future change reintroduces a default program for
  // signal-less users, this suite fails rather than silently granting access.
  test.each([
    ['null grades', { grades_taught: null }],
    ['empty string', { grades_taught: '' }],
    ['empty JSON array', { grades_taught: '[]' }],
    ['both columns null', { levels: null, grades_taught: null }],
  ])('%s -> no programs', (_label, user) => {
    expect(programsForUser(user)).toEqual([]);
  });

  test('niete_standard is never handed out by derivation', () => {
    const users = [
      { grades_taught: null },
      { grades_taught: '' },
      { grades_taught: '[]' },
      { levels: [], grades_taught: null },
    ];
    for (const u of users) {
      expect(programsForUser(u)).not.toContain('niete_standard');
    }
  });
});

describe('Row 8 regression — the two reported phone numbers', () => {
  test('923251670765 derives to middle_high, matching the reviewer', () => {
    // Real prod value for this user.
    const grades = '["grade_9","higher_secondary","grade_10","grade_8","grade_7","grade_6"]';
    expect(deriveBands({ grades_taught: grades })).toEqual(['HIGH', 'MIDDLE']);
    expect(programsForUser({ grades_taught: grades })).toEqual(['niete_middle_high']);
  });

  test('923215531977 has no signal, so only the human override assigns it', () => {
    const user = { phone_number: '923215531977', levels: null, grades_taught: null };
    // Derivation alone gives nothing...
    expect(programsForUser(user)).toEqual([]);
    // ...and the sheet supplies the band explicitly.
    expect(OVERRIDES['923215531977']).toEqual(['niete_primary']);
    expect(programsForUser(user, OVERRIDES)).toEqual(['niete_primary']);
  });

  test('an override wins over derivation', () => {
    const user = { phone_number: '923215531977', grades_taught: '["grade_9"]' };
    expect(programsForUser(user, OVERRIDES)).toEqual(['niete_primary']);
  });

  test('overrides do not leak to other users', () => {
    const other = { phone_number: '923000000000', grades_taught: null };
    expect(programsForUser(other, OVERRIDES)).toEqual([]);
  });

  test('the override list is exactly the one number from the sheet', () => {
    expect(Object.keys(OVERRIDES)).toEqual(['923215531977']);
  });
});
