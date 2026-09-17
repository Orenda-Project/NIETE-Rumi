/**
 * bd-60117 — a principal may open a teacher AT HER SCHOOL (TDD, red-first).
 *
 * MEMBERSHIP_SQL is the access-control boundary for the teacher drawer: prove
 * the teacher is in this leader's patch, or 404. It proves it through
 * leader_schools, which a principal has no row in — so before this change a
 * principal was refused EVERY teacher in her own school, including herself.
 * That is the same root cause as the empty My Patch, showing up as a 404
 * instead of a blank list.
 *
 * The check must stay exactly as strict in the new direction: a principal may
 * see her own school and nothing else.
 */

const {
  getPatchTeacherDetail,
  MEMBERSHIP_SQL,
  PRINCIPAL_MEMBERSHIP_SQL,
} = require('../services/leader-teacher-detail.service');

function fakeQuery(bySql) {
  const calls = [];
  const fn = async (sql, params) => {
    calls.push({ sql, params });
    for (const [needle, rows] of bySql) if (sql.includes(needle)) return { rows };
    return { rows: [] };
  };
  fn.calls = calls;
  return fn;
}

const MEMBER = [{ id: 'u-teacher', name: 'Ayesha Bibi', phone_number: '923001111111' }];

describe('getPatchTeacherDetail — principal is scoped to her own school', () => {
  it('proves membership via users.school_id, never via leader_schools', async () => {
    const q = fakeQuery([['FROM users me', MEMBER], ['coaching_sessions', []], ['lesson_plans', [{ lesson_plans: '0', reading_assessments: '0' }]]]);
    const out = await getPatchTeacherDetail(q, 'u-principal', 'u-teacher', { role: 'principal' });
    expect(out).not.toBeNull();
    const membershipCall = q.calls[0];
    expect(membershipCall.sql).not.toMatch(/leader_schools/);
    expect(membershipCall.params).toEqual(['u-principal', 'u-teacher']);
  });

  it('the principal membership SQL is anchored on her own row AND her role', () => {
    expect(PRINCIPAL_MEMBERSHIP_SQL).toMatch(/school_id/);
    expect(PRINCIPAL_MEMBERSHIP_SQL).not.toMatch(/leader_schools/);
    // Without the role guard, any leader-family user with a school_id would
    // quietly get single-school membership instead of their real patch.
    expect(PRINCIPAL_MEMBERSHIP_SQL).toMatch(/role\s*=\s*'principal'/);
  });

  it('still 404s a teacher outside her school (the boundary must not loosen)', async () => {
    // No membership row comes back ⇒ null ⇒ the route 404s.
    const q = fakeQuery([]);
    const out = await getPatchTeacherDetail(q, 'u-principal', 'u-somebody-else', { role: 'principal' });
    expect(out).toBeNull();
    // And it must not have gone on to read that teacher's data.
    expect(q.calls).toHaveLength(1);
  });

  it('a coach still goes through leader_schools — no regression', async () => {
    const q = fakeQuery([['leader_schools', MEMBER], ['coaching_sessions', []], ['lesson_plans', [{ lesson_plans: '0', reading_assessments: '0' }]]]);
    await getPatchTeacherDetail(q, 'coach-1', 'u-teacher', { role: 'coach' });
    expect(q.calls[0].sql).toBe(MEMBERSHIP_SQL);
  });

  it('defaults to the coach path when no role is passed (back-compat)', async () => {
    const q = fakeQuery([['leader_schools', MEMBER], ['coaching_sessions', []], ['lesson_plans', [{ lesson_plans: '0', reading_assessments: '0' }]]]);
    await getPatchTeacherDetail(q, 'coach-1', 'u-teacher');
    expect(q.calls[0].sql).toBe(MEMBERSHIP_SQL);
  });
});
