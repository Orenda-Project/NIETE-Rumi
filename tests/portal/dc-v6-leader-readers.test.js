'use strict';
/**
 * Queue #282 / bd-ra8xu.64.2 — two leader readers when a teacher's newest self-recording is scored on FICO17 v6.
 *
 *   - Leader teacher detail: the header's written line was the newest summary that HAS one, so behind a v6 lesson with
 *     no summary (any she did not reflect on) it showed an older V3 lesson's summary as her latest. Now: when the newest
 *     session is on a rubric of its own, its own summary or none.
 *   - Principal school analytics: totalSessions counts scored sessions of both kinds; a v6 one (scored, on its own
 *     rubric) was left out. It is counted; it never enters the average.
 */
const { getPatchTeacherDetail } = require('../../dashboard/services/leader-teacher-detail.service');
const { summarizeSchoolAnalytics } = require('../../dashboard/services/school-analytics.service');

const MEMBER = [{ id: 'u-1', name: 'Irene Khan', phone_number: '92' + '000' + '0000001' }];
const V6_SCORES = { overall_marks: 17, overall_max_marks: 28, overall_percentage: 60.7, counted: 7, rubric: 'fico17_v6' };
const v3 = (id, date, summary) => ({ id, created_at: date, analysis_data: { ...(summary ? { executive_summary: summary } : {}), scores: { overall_marks: 71, overall_max_marks: 148, percentage: 48 } } });
const v6 = (id, date, summary) => ({ id, created_at: date, analysis_data: { framework: 'fico17_v6', ...(summary ? { executive_summary: summary } : {}), scores: V6_SCORES } });

function fakeQuery(sessionRows) {
  return async (sql) => {
    if (/FROM users|membership/i.test(sql) || /school_id/i.test(sql)) return { rows: MEMBER };
    if (/coaching_sessions/i.test(sql)) return { rows: sessionRows };
    if (/lesson_plans/i.test(sql)) return { rows: [{ lesson_plans: '0', reading_assessments: '0' }] };
    return { rows: MEMBER };
  };
}

describe('queue #282 / bd-ra8xu.64.2: leader teacher detail, the written line', () => {
  test('newest is v6 with no summary: none, never the older V3 lesson\'s summary', async () => {
    const d = await getPatchTeacherDetail(fakeQuery([v6('s2', '2026-11-24T06:00:00Z'), v3('s1', '2026-11-01T06:00:00Z', 'An older V3 summary.')]), 'leader-1', 'u-1');
    expect(d.stats.lastSummary).toBeNull();
    expect(d.stats.lastScore).toBeNull();
  });

  test('newest is v6 with its own summary: that one', async () => {
    const d = await getPatchTeacherDetail(fakeQuery([v6('s2', '2026-11-24T06:00:00Z', 'Her v6 lesson summary.'), v3('s1', '2026-11-01T06:00:00Z', 'An older V3 summary.')]), 'leader-1', 'u-1');
    expect(d.stats.lastSummary).toBe('Her v6 lesson summary.');
  });

  test('newest is V3 with none: the newest V3 summary behind it, as before', async () => {
    const d = await getPatchTeacherDetail(fakeQuery([v3('s2', '2026-11-24T06:00:00Z'), v3('s1', '2026-11-01T06:00:00Z', 'An older V3 summary.')]), 'leader-1', 'u-1');
    expect(d.stats.lastSummary).toBe('An older V3 summary.');
  });
});

describe('queue #282 / bd-ra8xu.64.2: principal school analytics, totalSessions', () => {
  test('a v6 self-recording is a scored session; the average stays the V3 human observations', () => {
    const out = summarizeSchoolAnalytics([
      { created_at: '2026-11-24T06:00:00Z', observation_type: null, analysis_data: { framework: 'fico17_v6', scores: V6_SCORES } },
      { created_at: '2026-11-20T06:00:00Z', observation_type: 'leader_observation', analysis_data: { scores: { percentage: 64, overall_marks: 64, overall_max_marks: 100 } } },
      { created_at: '2026-11-19T06:00:00Z', observation_type: null, analysis_data: { grade: 3 } }, // unscored: still out
    ]);
    expect(out.totalSessions).toBe(2);
    expect(out.averageScore).toBe(64);
  });
});
