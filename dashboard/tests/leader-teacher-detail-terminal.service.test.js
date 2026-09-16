/**
 * The teacher's Coaching history must count every observation the teacher list counts.
 *
 * A leader observation reaches `observer_review_complete`, not `completed` — the coach
 * submits the review and that IS the end state. bd-2671 taught the teacher LIST that,
 * via a shared TERMINAL set, and the fix never reached this service: SESSIONS_SQL still
 * filtered `status = 'completed'`, so 629 of 2,625 observations (24%) were counted in
 * the list and missing from the drawer you open from it. Every one of those 629 carries
 * analysis_data, so there was nothing to fall back on — they were simply absent.
 *
 * The test drives getPatchTeacherDetail so line 35's SQL actually executes against the
 * stub. A grep of the SQL string would satisfy red-first and prove nothing.
 */

const { getPatchTeacherDetail, SESSIONS_SQL } = require('../services/leader-teacher-detail.service');
const { TERMINAL } = require('../services/leader-patch.service');

function router(fixtures) {
  const calls = [];
  const fn = async (sql, params) => {
    calls.push({ sql, params });
    if (/FROM\s+leader_schools/i.test(sql)) return { rows: fixtures.member || [] };
    if (/FROM\s+coaching_sessions/i.test(sql)) {
      // The stub is the DATABASE's job: it returns only what the WHERE clause asks for.
      // A service that still filters on 'completed' therefore receives no
      // observer_review_complete row and its own output proves it.
      const wantsReviewComplete = /observer_review_complete/.test(sql);
      const rows = (fixtures.sessions || []).filter(
        (s) => s.status === 'completed' || wantsReviewComplete,
      );
      return { rows };
    }
    if (/lesson_plans/i.test(sql)) return { rows: fixtures.counts || [{ lesson_plans: 0, reading_assessments: 0 }] };
    return { rows: [] };
  };
  fn.calls = calls;
  return fn;
}

const MEMBER = [{ id: 'teach-1', name: 'Ayesha', phone_number: '923001234567' }];

// A real coach's patch teacher: two observations she submitted reviews for, one the
// teacher self-recorded. Today only the last one survives the filter.
const MIXED = {
  member: MEMBER,
  sessions: [
    { id: 'obs-2', status: 'observer_review_complete', created_at: '2026-09-10T10:00:00Z', analysis_data: { scores: { overall_percentage: 66 } } },
    { id: 'obs-1', status: 'observer_review_complete', created_at: '2026-08-28T10:00:00Z', analysis_data: { scores: { overall_percentage: 54 } } },
    { id: 'self-1', status: 'completed', created_at: '2026-08-02T10:00:00Z', analysis_data: { scores: { overall_percentage: 48 } } },
  ],
  counts: [{ lesson_plans: 7, reading_assessments: 3 }],
};

describe('leader teacher detail counts every terminal observation', () => {
  it('an observer_review_complete observation appears in the history', async () => {
    const out = await getPatchTeacherDetail(router(MIXED), 'leader-1', 'teach-1');
    expect(out.sessions.map((s) => s.id)).toEqual(['obs-2', 'obs-1', 'self-1']);
    expect(out.stats.coachingSessions).toBe(3);
  });

  it('lastScore comes from the newest terminal observation, not the newest completed one', async () => {
    const out = await getPatchTeacherDetail(router(MIXED), 'leader-1', 'teach-1');
    expect(out.stats.lastScore).toBe(66);
  });

  it('a teacher observed ONLY by her coach is no longer shown as never coached', async () => {
    const onlyReviewed = { ...MIXED, sessions: MIXED.sessions.filter((s) => s.status === 'observer_review_complete') };
    const out = await getPatchTeacherDetail(router(onlyReviewed), 'leader-1', 'teach-1');
    expect(out.stats.coachingSessions).toBe(2);
    expect(out.sessions).toHaveLength(2);
  });

  it('uses the SAME terminal set as the teacher list — one definition, not two spellings', async () => {
    expect(TERMINAL).toBe("('completed', 'observer_review_complete')");
    expect(SESSIONS_SQL).toContain(TERMINAL);
    expect(SESSIONS_SQL).not.toMatch(/status\s*=\s*'completed'/);
  });

  it('still requires analysis_data — an unscored row has nothing to plot', async () => {
    expect(SESSIONS_SQL).toContain('analysis_data IS NOT NULL');
  });

  it('membership is still proven before any session is fetched', async () => {
    const q = router({ member: [] });
    expect(await getPatchTeacherDetail(q, 'leader-1', 'not-mine')).toBeNull();
    expect(q.calls.every((c) => !/FROM\s+coaching_sessions/i.test(c.sql))).toBe(true);
  });
});
