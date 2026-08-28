/**
 * bd-2434 — Leader → single teacher detail (TDD, red-first). NIETE port of bd-2388.
 *
 * SECURITY-CRITICAL: a leader may only view a teacher who is in THEIR patch.
 * getPatchTeacherDetail first proves membership (the coach's schools ∩ the teacher's
 * Rumi user) and returns null otherwise — the endpoint 404s, so a leader cannot
 * enumerate arbitrary teachers' coaching data by guessing user ids.
 *
 * When in-patch, it returns the teacher's identity + coaching sessions (with
 * framework-agnostic scores) + lifetime counts. query() is injected and routed
 * by SQL so the test needs no live DB.
 */

const { getPatchTeacherDetail } = require('../services/leader-teacher-detail.service');

// Route the injected query by which table it hits.
function router(fixtures) {
  const calls = [];
  const fn = async (sql, params) => {
    calls.push({ sql, params });
    // Membership is derived from the coach's schools now, not the stored roster.
    if (/FROM\s+leader_schools/i.test(sql)) return { rows: fixtures.member || [] };
    if (/FROM\s+coaching_sessions/i.test(sql)) return { rows: fixtures.sessions || [] };
    if (/lesson_plans/i.test(sql)) return { rows: fixtures.counts || [{ lesson_plans: 0, reading_assessments: 0 }] };
    return { rows: [] };
  };
  fn.calls = calls;
  return fn;
}

const IN_PATCH = {
  member: [{ id: 'teach-1', first_name: 'Ayesha', phone_number: '923001234567' }],
  sessions: [
    { id: 's2', created_at: '2026-07-22T10:00:00Z', analysis_data: { scores: { overall_percentage: 48 } } },
    { id: 's1', created_at: '2026-07-10T10:00:00Z', analysis_data: { scores: { overall_percentage: 71 } } },
  ],
  counts: [{ lesson_plans: 7, reading_assessments: 3 }],
};

describe('getPatchTeacherDetail', () => {
  it('returns null when the teacher is NOT in the leader\'s patch (no data leak)', async () => {
    const q = router({ member: [] });   // membership query returns nothing
    const out = await getPatchTeacherDetail(q, 'leader-1', 'someone-elses-teacher');
    expect(out).toBeNull();
    // must NOT have gone on to fetch that teacher's sessions
    expect(q.calls.every((c) => !/FROM\s+coaching_sessions/i.test(c.sql))).toBe(true);
  });

  it('scopes the membership check to BOTH the leader and the teacher id', async () => {
    const q = router(IN_PATCH);
    await getPatchTeacherDetail(q, 'leader-1', 'teach-1');
    const memberCall = q.calls.find((c) => /FROM\s+leader_schools/i.test(c.sql));
    expect(memberCall.params).toEqual(['leader-1', 'teach-1']);
  });

  it('returns identity + counts + scored sessions for an in-patch teacher', async () => {
    const out = await getPatchTeacherDetail(router(IN_PATCH), 'leader-1', 'teach-1');
    expect(out.teacher).toMatchObject({ rumiUserId: 'teach-1', name: 'Ayesha', phone: '923001234567' });
    expect(out.stats.coachingSessions).toBe(2);
    expect(out.stats.lessonPlans).toBe(7);
    expect(out.stats.readingAssessments).toBe(3);
    // most-recent session first, score via getOverall
    expect(out.sessions[0]).toMatchObject({ id: 's2', score: 48 });
    expect(out.sessions[1]).toMatchObject({ id: 's1', score: 71 });
    expect(out.stats.lastScore).toBe(48);   // latest session's score
  });

  it('handles an in-patch teacher who has never been coached', async () => {
    const out = await getPatchTeacherDetail(
      router({ member: IN_PATCH.member, sessions: [], counts: [{ lesson_plans: 1, reading_assessments: 0 }] }),
      'leader-1', 'teach-1',
    );
    expect(out.stats.coachingSessions).toBe(0);
    expect(out.stats.lastScore).toBeNull();
    expect(out.sessions).toEqual([]);
  });
});
