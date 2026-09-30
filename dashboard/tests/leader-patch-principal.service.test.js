/**
 * bd-60117 — a principal's patch is HER SCHOOL (TDD, red-first).
 *
 * The bug this encodes, measured on NIETE prod (ihzciabopbttygxxgrkm) on
 * 2026-09-17: PATCH_TEACHERS_SQL is anchored on `leader_schools.leader_user_id`,
 * which is the COACH→school assignment. A principal is tied to her school by
 * `users.school_id` instead and holds no leader_schools row — only 24 of 460
 * principals do. So for the other 436 the WHERE matched nothing, the query
 * returned zero rows, and summarizePatch reported totalTeachers: 0. My Patch
 * rendered empty with no error: the failure was silent, which is why it lasted.
 *
 * The data was there the whole time. Of 40 sampled principals who can log in
 * and have a school (252 such users), every one had staff (avg 14.7) and 34 had
 * scored coaching sessions — schools with 15, 68, 135 sessions.
 *
 * So resolution is now role-dependent: a coach enters through leader_schools,
 * a principal through her own users.school_id. Same shaped output either way,
 * because everything downstream (summarizePatch, the roster, teacher detail)
 * already consumes that shape.
 */

const {
  getPatchTeachers,
  PATCH_TEACHERS_SQL,
  PRINCIPAL_PATCH_SQL,
} = require('../services/leader-patch.service');

function fakeQuery(rows) {
  const calls = [];
  const fn = async (sql, params) => { calls.push({ sql, params }); return { rows }; };
  fn.calls = calls;
  return fn;
}

// One teacher at the principal's school, plus the principal herself — the SQL
// admits role IN ('teacher','principal'), so she appears in her own roster.
const SCHOOL_ROWS = [
  {
    teacher_ext_id: '923001111111',
    name: 'Ayesha Bibi',
    phone: '923001111111',
    role: 'teacher',
    rumi_user_id: 'u-ayesha',
    coaching_sessions: '4',
    observations: '1',
    lesson_plans: '9',
    last_analysis_data: { scores: { overall_marks: 105, overall_max_marks: 148, overall_percentage: 71 } },
    last_session_at: '2026-09-10T10:00:00Z',
    school_name: 'GGPS Sector G-9',
    school_ext_id: 'niete:509',
  },
  {
    teacher_ext_id: '923002222222',
    name: 'Nosheen',
    phone: '923002222222',
    role: 'principal',
    rumi_user_id: 'u-principal',
    coaching_sessions: '0',
    observations: '0',
    lesson_plans: '2',
    last_analysis_data: null,
    last_session_at: null,
    school_name: 'GGPS Sector G-9',
    school_ext_id: 'niete:509',
  },
];

describe('getPatchTeachers — principal resolves by users.school_id', () => {
  it('uses the principal SQL, not the leader_schools SQL, when role is principal', async () => {
    const q = fakeQuery(SCHOOL_ROWS);
    await getPatchTeachers(q, 'u-principal', { role: 'principal' });
    expect(q.calls).toHaveLength(1);
    // The whole point: the coach entry point must NOT be what runs.
    expect(q.calls[0].sql).not.toMatch(/leader_schools/);
    // She is found by her own id on users, then joined out to her school.
    expect(q.calls[0].sql).toMatch(/users/);
    expect(q.calls[0].params).toEqual(['u-principal']);
  });

  it('scopes to the school via users.school_id — the link a principal actually has', () => {
    expect(PRINCIPAL_PATCH_SQL).toMatch(/school_id/);
    // Anchored on the principal's own id, never on a coach assignment.
    expect(PRINCIPAL_PATCH_SQL).toMatch(/\$1/);
    expect(PRINCIPAL_PATCH_SQL).not.toMatch(/leader_schools/);
  });

  it('returns the whole school roster, shaped exactly like a coach patch', async () => {
    const out = await getPatchTeachers(fakeQuery(SCHOOL_ROWS), 'u-principal', { role: 'principal' });
    expect(out).toHaveLength(2);
    const ayesha = out.find((t) => t.name === 'Ayesha Bibi');
    expect(ayesha.onRumi).toBe(true);
    expect(ayesha.coachingSessions).toBe(4);
    expect(ayesha.lessonPlans).toBe(9);
    expect(ayesha.lastScore).toBe(71);
    expect(ayesha.schoolName).toBe('GGPS Sector G-9');
    expect(ayesha.isPrincipal).toBe(false);
  });

  it('labels the principal in her own roster (an unlabelled one gets observed by mistake)', async () => {
    const out = await getPatchTeachers(fakeQuery(SCHOOL_ROWS), 'u-principal', { role: 'principal' });
    const her = out.find((t) => t.rumiUserId === 'u-principal');
    expect(her.isPrincipal).toBe(true);
  });

  it('still uses the leader_schools path for a coach — no regression', async () => {
    const q = fakeQuery([]);
    await getPatchTeachers(q, 'coach-1', { role: 'coach' });
    expect(q.calls[0].sql).toBe(PATCH_TEACHERS_SQL);
    expect(q.calls[0].sql).toMatch(/leader_schools/);
  });

  it('defaults to the coach path when no role is given (back-compat)', async () => {
    const q = fakeQuery([]);
    await getPatchTeachers(q, 'coach-1');
    expect(q.calls[0].sql).toBe(PATCH_TEACHERS_SQL);
  });
});
