'use strict';
/**
 * bd-60174 (STEPS v1.1, principal-dashboard feedback item 1).
 *
 * "Remove the numeric scoring and total marks currently shown against each
 * teacher. Replace with a short written feedback/comment section 2 to 3 lines."
 *
 * The score stays COMPUTED AND STORED — the operator's decision, 2026-09-22, is
 * to hide it, not to drop it. Removing the maths would reach the whole
 * observation pipeline; this is a presentation change, so the API keeps
 * returning `score`, `points` and `maxPoints` and the leader UI stops rendering
 * them. Anything still reading the score (a coach's debrief, the analytics
 * trend, any export) is therefore untouched.
 *
 * What the UI needs INSTEAD is prose, and it already exists. Measured on prod
 * 2026-09-22: `analysis_data.executive_summary` is present on 200 of 200 recent
 * sessions — median 382 characters, p90 606 — and reads as exactly the two or
 * three lines asked for, naming a strength and a growth area. Coverage beats
 * `focus_area`, which was present on only 7 of 12 sampled sessions, so the
 * summary is the field to lead with.
 */

const { getPatchTeacherDetail } = require('../../dashboard/services/leader-teacher-detail.service');

const MEMBER = [{ id: 'u-1', name: 'Irene Khan', phone_number: '923001234567' }];

const SUMMARY =
  'Syed frequently engaged students with calls to recite and write; his strongest '
  + 'area is High-Leverage Practices. The key growth area is Lesson Plan Fidelity: '
  + 'objectives were not stated or revisited.';

const SESSION_ROWS = [{
  id: 's-1',
  created_at: '2026-09-15T06:00:00Z',
  analysis_data: {
    executive_summary: SUMMARY,
    // The real score shape: flat on `scores`, per getOverall.
    scores: { overall_marks: 71, overall_max_marks: 148, percentage: 64 },
  },
}];

/** Older sessions predate the summary field. */
const SESSION_NO_SUMMARY = [{
  id: 's-0',
  created_at: '2026-06-01T06:00:00Z',
  analysis_data: { scores: { overall_marks: 59, overall_max_marks: 148, percentage: 40 } },
}];

function fakeQuery(sessionRows) {
  return async (sql) => {
    if (/FROM users|membership/i.test(sql) || /school_id/i.test(sql)) return { rows: MEMBER };
    if (/coaching_sessions/i.test(sql)) return { rows: sessionRows };
    if (/lesson_plans/i.test(sql)) return { rows: [{ lesson_plans: '4', reading_assessments: '1' }] };
    return { rows: MEMBER };
  };
}

describe('a session carries the written summary the leader UI shows', () => {
  test('the summary reaches the session as prose', async () => {
    const d = await getPatchTeacherDetail(fakeQuery(SESSION_ROWS), 'leader-1', 'u-1');
    expect(d.sessions[0].summary).toBe(SUMMARY);
  });

  test('a session written before the field existed reports null, not undefined', async () => {
    const d = await getPatchTeacherDetail(fakeQuery(SESSION_NO_SUMMARY), 'leader-1', 'u-1');
    expect(d.sessions[0].summary).toBeNull();
  });

  test('the newest summary is surfaced on stats, for the header', async () => {
    const d = await getPatchTeacherDetail(fakeQuery(SESSION_ROWS), 'leader-1', 'u-1');
    expect(d.stats.lastSummary).toBe(SUMMARY);
  });
});

describe('the score is HIDDEN in the UI, never dropped from the API', () => {
  test('score, points and maxPoints still ship — the pipeline is untouched', async () => {
    const d = await getPatchTeacherDetail(fakeQuery(SESSION_ROWS), 'leader-1', 'u-1');
    expect(d.sessions[0].score).toBe(64);
    expect(d.sessions[0].points).toBe(71);
    expect(d.sessions[0].maxPoints).toBe(148);
    expect(d.stats.lastScore).toBe(64);
  });
});
