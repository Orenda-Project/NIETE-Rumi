/**
 * Editing a teacher from /observe — name, level, and the phone number.
 *
 * The phone change is the dangerous one. A teacher's identity is keyed to her
 * handset: `getOrCreateUser` looks her up by phone and CREATES on a miss, so a
 * new SIM mints an empty account and strands her history. Moving her onto the
 * new number is therefore a merge, and a merge that picks the wrong target is
 * silent and very hard to unpick.
 *
 * Measured on NIETE production: 5,364 of 14,566 accounts (36.8%) carry
 * irreplaceable history — certificates, exam attempts, training progress,
 * coaching sessions. So a recycled SIM landing on a REAL teacher is a live
 * possibility, not a hypothetical, and the classifier below must refuse rather
 * than guess.
 */

const {
  classifyTarget,
  planNameEdit,
  planLevelEdit,
  CASE_FREE,
  CASE_SHELL,
  CASE_TAKEN,
} = require('../../bot/shared/services/observe/teacher-edit.service');

// ── the three cases ────────────────────────────────────────────────────

describe('classifyTarget — what sits on the new number', () => {
  it('FREE when no account exists', () => {
    expect(classifyTarget(null)).toBe(CASE_FREE);
    expect(classifyTarget(undefined)).toBe(CASE_FREE);
  });

  it('SHELL when the account holds nothing a teacher cannot redo', () => {
    // Lesson plans and conversations do NOT make an account irreplaceable —
    // she can ask for another lesson plan. This is the row-21 shape: a fully
    // registered account with a school and 5 LPs, and no training history.
    expect(classifyTarget({
      registration_completed: true,
      school_id: 'a-school',
      counts: { certificates: 0, attempts: 0, progress: 0, coaching: 0 },
    })).toBe(CASE_SHELL);
  });

  it('TAKEN on a single certificate', () => {
    expect(classifyTarget({
      counts: { certificates: 1, attempts: 0, progress: 0, coaching: 0 },
    })).toBe(CASE_TAKEN);
  });

  it('TAKEN on training progress alone', () => {
    expect(classifyTarget({
      counts: { certificates: 0, attempts: 0, progress: 171, coaching: 0 },
    })).toBe(CASE_TAKEN);
  });

  it('TAKEN on a coaching session alone', () => {
    expect(classifyTarget({
      counts: { certificates: 0, attempts: 0, progress: 0, coaching: 1 },
    })).toBe(CASE_TAKEN);
  });

  it('does NOT classify on registration state — the row-21 shell looked fully registered', () => {
    // registration_completed/school_id/grades were all set on the shell. Judging
    // by onboarding rather than history is exactly the mistake that would have
    // discarded a live account.
    expect(classifyTarget({
      registration_completed: true,
      school_id: 's',
      grades_taught: 'PRIMARY',
      counts: { certificates: 0, attempts: 0, progress: 0, coaching: 0 },
    })).toBe(CASE_SHELL);
  });

  it('treats a missing counts block as TAKEN — never assume empty', () => {
    // If we could not read the history, we do not know it is safe.
    expect(classifyTarget({ id: 'u1' })).toBe(CASE_TAKEN);
  });
});

// ── name ───────────────────────────────────────────────────────────────

describe('planNameEdit', () => {
  it('trims and title-cases, writing users.name only', () => {
    const p = planNameEdit({ id: 'u1', name: 'old' }, '  fatima   rehman ');
    expect(p.ok).toBe(true);
    expect(p.patch).toEqual({ name: 'Fatima Rehman' });
  });

  it('refuses an empty name rather than blanking the record', () => {
    expect(planNameEdit({ id: 'u1', name: 'Fatima' }, '   ').ok).toBe(false);
    expect(planNameEdit({ id: 'u1', name: 'Fatima' }, null).ok).toBe(false);
  });

  it('is a no-op when the name is unchanged', () => {
    const p = planNameEdit({ id: 'u1', name: 'Fatima Rehman' }, 'Fatima Rehman');
    expect(p.ok).toBe(true);
    expect(p.unchanged).toBe(true);
  });

  it('never touches first_name or last_name — they no longer exist', () => {
    const p = planNameEdit({ id: 'u1', name: 'x' }, 'Yasmin Khan');
    expect(Object.keys(p.patch)).toEqual(['name']);
  });
});

// ── level ──────────────────────────────────────────────────────────────

describe('planLevelEdit — delegates to the one writer, keeps the cooldown', () => {
  const NOW = Date.parse('2026-09-14T12:00:00Z');

  it('accepts a valid band set', () => {
    const p = planLevelEdit({ id: 'u1', teacher_level_updated_at: null }, ['MIDDLE', 'HIGH'], NOW);
    expect(p.ok).toBe(true);
    expect(p.bands).toEqual(['MIDDLE', 'HIGH']);
  });

  it('REFUSES inside the 48h cooldown, and says how long is left', () => {
    // The cooldown is the teacher's protection against a coach flipping her
    // programme repeatedly; a coach edit must not be a way around it.
    const twoHoursAgo = new Date(NOW - 2 * 3600 * 1000).toISOString();
    const p = planLevelEdit({ id: 'u1', teacher_level_updated_at: twoHoursAgo }, ['HIGH'], NOW);
    expect(p.ok).toBe(false);
    expect(p.reason).toBe('cooldown');
    expect(p.hoursRemaining).toBe(46);
  });

  it('allows a change once the window has passed', () => {
    const threeDaysAgo = new Date(NOW - 72 * 3600 * 1000).toISOString();
    expect(planLevelEdit({ id: 'u1', teacher_level_updated_at: threeDaysAgo }, ['HIGH'], NOW).ok).toBe(true);
  });

  it('refuses an empty selection rather than revoking all training access', () => {
    const p = planLevelEdit({ id: 'u1', teacher_level_updated_at: null }, [], NOW);
    expect(p.ok).toBe(false);
    expect(p.reason).toBe('empty_selection');
  });

  it('drops unknown bands rather than defaulting them', () => {
    const p = planLevelEdit({ id: 'u1', teacher_level_updated_at: null }, ['HIGH', 'BANANA'], NOW);
    expect(p.bands).toEqual(['HIGH']);
  });
});

// ── role ───────────────────────────────────────────────────────────────

/**
 * bd-60112 — a coach corrects Teacher vs Principal.
 *
 * This is the one edit on this screen that changes what the PERSON may do, not
 * just how they read. `role` is the input to role-features.js: `principal`
 * carries `observe: true`, so this write hands someone the ability to observe
 * OTHER teachers and re-routes their audio to the HITL binding list. It is
 * therefore constrained to the two roles the patch already contains — a coach
 * must never be able to mint a `coach`/`aeo`/`supervisor` from this screen.
 */
describe('planRoleEdit — Teacher <-> Principal, and nothing else', () => {
  const { planRoleEdit } = require('../../bot/shared/services/observe/teacher-edit.service');

  it('promotes a teacher to principal', () => {
    const p = planRoleEdit({ id: 'u1', role: 'teacher' }, 'principal');
    expect(p.ok).toBe(true);
    expect(p.role).toBe('principal');
    expect(p.patch).toEqual({ role: 'principal' });
  });

  it('demotes a principal back to teacher', () => {
    const p = planRoleEdit({ id: 'u1', role: 'principal' }, 'teacher');
    expect(p.ok).toBe(true);
    expect(p.patch).toEqual({ role: 'teacher' });
  });

  it('treats a NULL role as teacher, so the no-op is not mistaken for a change', () => {
    // 'role' is nullable and bulk-seeded rows carry NULL. Reading that as
    // "teacher" matches role-features.js, whose default grants DC and no HITL.
    const p = planRoleEdit({ id: 'u1', role: null }, 'teacher');
    expect(p.ok).toBe(true);
    expect(p.unchanged).toBe(true);
  });

  it('is unchanged when the role already matches', () => {
    const p = planRoleEdit({ id: 'u1', role: 'principal' }, 'principal');
    expect(p.ok).toBe(true);
    expect(p.unchanged).toBe(true);
  });

  it('REFUSES any role outside the two — no minting a coach or an aeo', () => {
    // role-features.js grants `observe` to coach/aeo/supervisor/school_leader.
    // If this screen could write them, a coach could grant a teacher the right
    // to observe others AND strip her own Classroom Coaching, from a picker.
    for (const bad of ['coach', 'aeo', 'supervisor', 'school_leader', 'admin', '']) {
      const p = planRoleEdit({ id: 'u1', role: 'teacher' }, bad);
      expect(p.ok).toBe(false);
      expect(p.reason).toBe('invalid_role');
    }
  });

  it('normalises case and surrounding space', () => {
    const p = planRoleEdit({ id: 'u1', role: 'teacher' }, '  Principal ');
    expect(p.ok).toBe(true);
    expect(p.patch).toEqual({ role: 'principal' });
  });

  it('writes role and nothing else', () => {
    const p = planRoleEdit({ id: 'u1', role: 'teacher' }, 'principal');
    expect(Object.keys(p.patch)).toEqual(['role']);
  });
});
