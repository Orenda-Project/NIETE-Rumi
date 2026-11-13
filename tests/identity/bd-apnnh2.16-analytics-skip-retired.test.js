/**
 * bd-apnnh2.16: a retired account is in no per-school teacher count.
 *
 * A fold (coach Edit today; the number-change mover and "Is this you?" later) retires a teacher's
 * spare account: deleted_at set, the phone a `merged:` tombstone, its school and role kept. The
 * schools analytics roster ("today's roster": role teacher, a school, not a test user) asked
 * nothing about liveness, so each fold added the retired copy to its school's teacher count, to
 * "x of N teachers opened an LP" and to the training roll-up. The LP engagement fallback roster
 * (read when the RDF teacher lists are not loaded) uses the same definition.
 *
 * The training-levels analytics already counts only live rows, "the RDF's population": deleted_at
 * NULL and the phone not a merged: tombstone. The roster now asks the same two things, so the two
 * analytics paths agree.
 */
const fs = require('fs');
const path = require('path');
const {
  ROSTER_TEACHER,
  loadSchoolsAnalyticsRows,
  createScoreMemo,
} = require('../../dashboard/services/schools-analytics.service');
const { loadLpEngagementRows } = require('../../dashboard/services/lp-engagement.service');

const LIVE = /u\.deleted_at IS NULL/;
const NOT_TOMBSTONE = /COALESCE\(u\.phone_number, ''\) NOT LIKE 'merged%'/;

/** A query double that records every read and answers each with no rows. */
function recorder() {
  const calls = [];
  const query = async (sql, params) => {
    calls.push({ sql, params });
    return { rows: [] };
  };
  return { calls, query };
}

describe('per-school teacher counts leave out retired accounts (bd-apnnh2.16)', () => {
  it("today's roster asks for a live row: deleted_at NULL and no merged: tombstone", () => {
    expect(ROSTER_TEACHER).toMatch(LIVE);
    expect(ROSTER_TEACHER).toMatch(NOT_TOMBSTONE);
    // the teacher base itself is unchanged
    expect(ROSTER_TEACHER).toMatch(/u\.role = 'teacher'/);
    expect(ROSTER_TEACHER).toMatch(/u\.school_id IS NOT NULL/);
    expect(ROSTER_TEACHER).toMatch(/u\.is_test_user IS NOT TRUE/);
  });

  it('asks the same two things as the RDF population in the training-levels analytics', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../../dashboard/services/training-levels-analytics.service.js'), 'utf8');
    const members = /members AS MATERIALIZED \(([\s\S]*?)\n {2}\),/.exec(src);
    expect(members).not.toBeNull();
    expect(members[1]).toMatch(LIVE);
    expect(members[1]).toMatch(NOT_TOMBSTONE);
  });

  it('the schools read applies it to the teacher count and to the training roll-up', async () => {
    const { calls, query } = recorder();
    await loadSchoolsAnalyticsRows(query, { from: '2026-10-01', to: '2026-10-13' }, { memo: createScoreMemo() });
    const schools = calls.find((c) => /FROM schools/i.test(c.sql));
    expect(schools).toBeDefined();
    expect(schools.sql.match(/u\.deleted_at IS NULL/g)).toHaveLength(2);
    expect(schools.sql.match(/NOT LIKE 'merged%'/g)).toHaveLength(2);
  });

  it('the LP engagement fallback roster (no RDF teacher lists) applies it too', async () => {
    const { calls, query } = recorder();
    const lists = {
      fdeSchoolEmis: null, primary: null, midHigh: null, coaches: null, asOf: {},
      missing: { schools: true, teachers: true, coaches: true },
    };
    await loadLpEngagementRows(query, { from: '2026-10-04', to: '2026-10-13' }, 'primary', { lists });
    const roster = calls.find((c) => /teacher_level/.test(c.sql));
    expect(roster).toBeDefined();
    expect(roster.sql).toMatch(LIVE);
    expect(roster.sql).toMatch(NOT_TOMBSTONE);
  });
});
