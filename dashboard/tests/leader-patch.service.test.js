/**
 * bd-2434 — Leader patch resolver (TDD, red-first). NIETE port of bd-2387.
 *
 * A leader's "patch" is DERIVED — leader_schools (coach → school) x
 * users.school_id (person → school) — rather than stored. The stored table
 * disagreed with the schools on 230 rows; a join cannot disagree with itself.
 * (Updated for that change + the name-column sweep: the SQL projects u.name,
 * not a teacher_name/first_name pair, and resolves it via fullNameOf.)
 *
 * getPatchTeachers takes an injected query(sql, params) so it is unit-testable
 * without a live DB. Score is normalised framework-agnostically via getOverall —
 * the fixture uses the NIETE FICO shape (scores.overall_marks /
 * overall_max_marks / overall_percentage, written by observe-framework.js).
 */

const { getPatchTeachers } = require('../services/leader-patch.service');

// Rows as the SQL would return them (snake_case, one on-Rumi w/ a completed
// FICO session, one patch teacher not yet on Rumi).
const ROWS = [
  {
    teacher_ext_id: 'T-100',
    name: 'Ayesha Bibi',
    phone: '923001234567',
    rumi_user_id: 'u-ayesha',
    rumi_first_name: 'Ayesha',
    coaching_sessions: '3',
    lesson_plans: '7',
    // NIETE FICO shape: observe-framework.js writes overall_marks +
    // overall_max_marks (148) + overall_percentage into analysis_data.scores.
    last_analysis_data: { scores: { overall_marks: 105, overall_max_marks: 148, overall_percentage: 71 } },
    last_session_at: '2026-07-20T10:00:00Z',
  },
  {
    teacher_ext_id: 'T-200',
    name: 'Zainab Khan',
    phone: '923009999999',
    rumi_user_id: null,          // not yet on Rumi
    rumi_first_name: null,
    coaching_sessions: '0',
    lesson_plans: '0',
    last_analysis_data: null,
    last_session_at: null,
  },
];

function fakeQuery(rows) {
  const calls = [];
  const fn = async (sql, params) => { calls.push({ sql, params }); return { rows }; };
  fn.calls = calls;
  return fn;
}

describe('getPatchTeachers', () => {
  it('queries the derived patch scoped to the leader user id', async () => {
    const q = fakeQuery(ROWS);
    await getPatchTeachers(q, 'leader-1');
    expect(q.calls).toHaveLength(1);
    expect(q.calls[0].params).toEqual(['leader-1']);
    // leader_schools x users.school_id — NOT the deprecated leader_teachers.
    expect(q.calls[0].sql).toMatch(/leader_schools/);
    expect(q.calls[0].sql).not.toMatch(/leader_teachers/);
    expect(q.calls[0].sql).toMatch(/leader_user_id\s*=\s*\$1/);
  });

  it('shapes an on-Rumi teacher with counts + framework-agnostic last score (FICO shape)', async () => {
    const out = await getPatchTeachers(fakeQuery(ROWS), 'leader-1');
    const ayesha = out.find((t) => t.name === 'Ayesha Bibi');
    expect(ayesha.onRumi).toBe(true);
    expect(ayesha.rumiUserId).toBe('u-ayesha');
    expect(ayesha.coachingSessions).toBe(3);      // numeric, not the '3' string
    expect(ayesha.lessonPlans).toBe(7);
    expect(ayesha.lastScore).toBe(71);            // from getOverall(analysis_data)
    expect(ayesha.lastSessionAt).toBe('2026-07-20T10:00:00Z');
  });

  it('shows a patch teacher not yet on Rumi (onRumi:false, null stats)', async () => {
    const out = await getPatchTeachers(fakeQuery(ROWS), 'leader-1');
    const zainab = out.find((t) => t.name === 'Zainab Khan');
    expect(zainab.onRumi).toBe(false);
    expect(zainab.rumiUserId).toBeNull();
    expect(zainab.coachingSessions).toBe(0);
    expect(zainab.lastScore).toBeNull();
  });

  it('returns every patch teacher (on-Rumi and not)', async () => {
    const out = await getPatchTeachers(fakeQuery(ROWS), 'leader-1');
    expect(out).toHaveLength(2);
  });

  it('returns an empty array for a leader with no patch', async () => {
    const out = await getPatchTeachers(fakeQuery([]), 'leader-empty');
    expect(out).toEqual([]);
  });
});
