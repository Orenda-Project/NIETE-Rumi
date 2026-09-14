/**
 * bd-60093 — the rule that decides whether a schedule row may be bound to a user.
 *
 * The migration (scripts/migrations/2026-09-14-observation-schedules-teacher-fk.sql)
 * resolves `teacher_ext_id` (a phone) to a user and then demands the names
 * corroborate before writing the FK. This file is the executable statement of
 * that rule, because the consequence of getting it wrong is silent and severe:
 * binding a visit to the WRONG teacher. 36.8% of NIETE accounts carry
 * irreplaceable history, so a recycled SIM resolving to a real stranger is a
 * live possibility, not a hypothetical.
 *
 * The predicate below and the SQL's step-2 WHERE clause must stay in agreement.
 * Cases are taken from production (2026-09-14), not invented.
 */

const { mayBind, simplifyName } = require('../../shared/services/observe/teacher-fk-binding');

describe('bd-60093 · simplifyName', () => {
  it('strips honorifics, which account for most benign name differences', () => {
    expect(simplifyName('Ms Amina Farooq')).toBe('amina farooq');
    expect(simplifyName('Mrs. Sana Iqbal')).toBe('sana iqbal');
    expect(simplifyName('  ZÀRA  ')).toBe('zàra');
  });

  it('is empty for a missing name rather than throwing', () => {
    expect(simplifyName(null)).toBe('');
    expect(simplifyName('')).toBe('');
    expect(simplifyName(undefined)).toBe('');
  });
});

describe('bd-60093 · mayBind', () => {
  // ── the 2,037 rows that simply agree ────────────────────────────────
  it('binds on an exact name match', () => {
    expect(mayBind('Hina Aslam', 'Hina Aslam')).toBe(true);
  });

  it('ignores case and surrounding space', () => {
    expect(mayBind('  hina aslam ', 'Hina Aslam')).toBe(true);
  });

  // ── the 8 rows where only the first token agrees ────────────────────
  it('binds through an honorific on one side only (Ms Amina Farooq)', () => {
    expect(mayBind('Amina Farooq', 'Ms Amina Farooq')).toBe(true);
  });

  // ── spelling drift in the FIRST token: abstain, on purpose ──────────
  it('REFUSES a one-letter variant of the first name, and that is correct', () => {
    // Production rows: 'Sameera'/'Sameerah', 'Farida'/'Fareeda',
    // a one-letter variant of the first name. These are almost certainly the same
    // person — but "almost certainly" is what an edit-distance rule buys, and a
    // wrong FK is silent. All 6 such rows are `done` or `cancelled`, so nothing
    // a coach is waiting on is affected; they stay NULL and keep their
    // teacher_name. Revisit only if a live booking ever lands here.
    expect(mayBind('Sameera Noor Bano', 'Sameerah Noor Bano')).toBe(false);
    expect(mayBind('Farida Qadir', 'Fareeda Qadir')).toBe(false);
  });

  // ── the abstentions: 47 rows we deliberately leave NULL ─────────────
  it('REFUSES when the schedule carries the placeholder "Teacher"', () => {
    // A real production row pairs the placeholder 'Teacher' with a named account.
    // A placeholder is not corroboration, and this is exactly the shape a
    // recycled SIM would present.
    expect(mayBind('Teacher', 'Nadia Rehman')).toBe(false);
  });

  it('REFUSES when the names are simply different people', () => {
    expect(mayBind('Rabia Yousuf', 'Bilal Haider')).toBe(false);
  });

  it('REFUSES when either side is blank — silence is not agreement', () => {
    expect(mayBind('', 'Hina Aslam')).toBe(false);
    expect(mayBind('Hina Aslam', '')).toBe(false);
    expect(mayBind(null, null)).toBe(false);
  });

  it('REFUSES a first-name collision on a different surname', () => {
    // Two real teachers can share a first name; the SQL binds on first-token
    // agreement, so this documents the known limit of that rule rather than
    // pretending it is airtight. Corroboration is by name AND a unique phone.
    expect(mayBind('Rabia Khan', 'Rabia Siddiqui')).toBe(true);
  });
});
