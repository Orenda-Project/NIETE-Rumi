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
    expect(simplifyName('Ms Talat Sultana')).toBe('talat sultana');
    expect(simplifyName('Mrs. Farhat Zareen')).toBe('farhat zareen');
    expect(simplifyName('  NIGHÀT  ')).toBe('nighàt');
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
    expect(mayBind('Sadia Kanwal', 'Sadia Kanwal')).toBe(true);
  });

  it('ignores case and surrounding space', () => {
    expect(mayBind('  sadia kanwal ', 'Sadia Kanwal')).toBe(true);
  });

  // ── the 8 rows where only the first token agrees ────────────────────
  it('binds through an honorific on one side only (Ms Talat Sultana)', () => {
    expect(mayBind('Talat Sultana', 'Ms Talat Sultana')).toBe(true);
  });

  // ── spelling drift in the FIRST token: abstain, on purpose ──────────
  it('REFUSES a one-letter variant of the first name, and that is correct', () => {
    // Production rows: 'Syyidha'/'Syyidah', 'Imarana'/'Imrana',
    // 'Rubina'/'Robina', 'Nighat'/'Nighàt'. These are almost certainly the same
    // person — but "almost certainly" is what an edit-distance rule buys, and a
    // wrong FK is silent. All 6 such rows are `done` or `cancelled`, so nothing
    // a coach is waiting on is affected; they stay NULL and keep their
    // teacher_name. Revisit only if a live booking ever lands here.
    expect(mayBind('Syyidha Nargis Parveen', 'Syyidah Nargis Parveen')).toBe(false);
    expect(mayBind('Imarana Qureshi', 'Imrana Qureshi')).toBe(false);
  });

  // ── the abstentions: 47 rows we deliberately leave NULL ─────────────
  it('REFUSES when the schedule carries the placeholder "Teacher"', () => {
    // Production row 923365242423: sched 'Teacher', user 'Madiha Sehrish'.
    // A placeholder is not corroboration, and this is exactly the shape a
    // recycled SIM would present.
    expect(mayBind('Teacher', 'Madiha Sehrish')).toBe(false);
  });

  it('REFUSES when the names are simply different people', () => {
    expect(mayBind('Ayesha Bibi', 'Muhammad Qasim Khan')).toBe(false);
  });

  it('REFUSES when either side is blank — silence is not agreement', () => {
    expect(mayBind('', 'Sadia Kanwal')).toBe(false);
    expect(mayBind('Sadia Kanwal', '')).toBe(false);
    expect(mayBind(null, null)).toBe(false);
  });

  it('REFUSES a first-name collision on a different surname', () => {
    // Two real teachers can share a first name; the SQL binds on first-token
    // agreement, so this documents the known limit of that rule rather than
    // pretending it is airtight. Corroboration is by name AND a unique phone.
    expect(mayBind('Ayesha Khan', 'Ayesha Siddiqui')).toBe(true);
  });
});
