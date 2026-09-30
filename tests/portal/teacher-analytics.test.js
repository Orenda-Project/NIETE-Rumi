'use strict';
/**
 * A teacher's own Analytics page mirrors what her principal sees when she
 * picks that teacher, plus one data point for everyone: exams generated
 * (operator, 2026-09-30). Four decisions shape it:
 *   1. She sees the remark she received — her principal's comment and each
 *      area's rating.
 *   2. Her own Digital Coach Observations carry their ratings on HER page
 *      (on the principal's page they carry none).
 *   3. Attendance: her own presence and her students', kept separate.
 *   4. Exams generated counts only papers that finished (status 'ready').
 */

const {
  getPatchTeachers, PATCH_TEACHERS_SQL, PRINCIPAL_PATCH_SQL,
} = require('../../dashboard/services/leader-patch.service');
const { summarizeSchoolAnalytics } = require('../../dashboard/services/school-analytics.service');
const { remarksReceived } = require('../../dashboard/services/steps-remarks.service');

describe('exams generated — ready Assessment Generator papers, per teacher', () => {
  test('both roster entry points count ready papers through the request that asked for them', () => {
    for (const sql of [PATCH_TEACHERS_SQL, PRINCIPAL_PATCH_SQL]) {
      expect(sql).toMatch(/assessment_papers/);
      expect(sql).toMatch(/assessment_requests/);
      expect(sql).toMatch(/status\s*=\s*'ready'/);
    }
  });

  test('the count reaches the row as a number, 0 when absent', async () => {
    const base = { teacher_ext_id: 'x', name: 'Ayesha', phone: '92300', role: 'teacher', rumi_user_id: 'u1',
      coaching_sessions: '0', observations: '0', lesson_plans: '3', school_ext_id: 'niete:1' };
    const q = (rows) => async () => ({ rows });
    const [withExams] = await getPatchTeachers(q([{ ...base, exams_generated: '7' }]), 'p1');
    const [without] = await getPatchTeachers(q([{ ...base }]), 'p1');
    expect(withExams.examsGenerated).toBe(7);
    expect(without.examsGenerated).toBe(0);
  });
});

describe('her own Digital Coach Observations are rated on HER page', () => {
  const dom = { student_engagement: { domain_score: 12, domain_max: 14 } };
  const sessions = [
    { created_at: '2026-09-15T09:00:00Z', observation_type: 'leader_observation',
      analysis_data: { scores: { overall_marks: 64, overall_max_marks: 100, overall_percentage: 64 }, domains: dom } },
    { created_at: '2026-09-20T09:00:00Z', observation_type: null,
      analysis_data: { scores: { overall_marks: 90, overall_max_marks: 100, overall_percentage: 90 }, domains: dom } },
  ];

  test('rateDigital gives a Digital Coach Observation its rating', () => {
    const { observations } = summarizeSchoolAnalytics(sessions, { rateDigital: true });
    expect(observations.find((o) => o.kind === 'digital_coach').percentage).toBe(90);
  });

  test("without it — the principal's page — a Digital Coach Observation stays unrated", () => {
    const { observations } = summarizeSchoolAnalytics(sessions);
    expect(observations.find((o) => o.kind === 'digital_coach').percentage).toBeNull();
  });

  test('Progress and the areas stay Human-only either way, so her page and her principal\'s never disagree', () => {
    const a = summarizeSchoolAnalytics(sessions, { rateDigital: true });
    expect(a.scoreTrend.map((p) => p.percentage)).toEqual([64]);
    expect(a.averageScore).toBe(64);
  });
});

describe('the remarks she received', () => {
  const rows = [
    { cycle_name: 'Second Quarter 2026', submitted_at: '2026-06-20T10:00:00Z', comment_text: 'Good start.',
      scores: [{ ordinal: 1, score: 2 }, { ordinal: 2, score: 3 }] },
    { cycle_name: 'Third Quarter 2026', submitted_at: '2026-09-24T10:00:00Z', comment_text: 'Prepares well.',
      scores: [{ ordinal: 1, score: 3 }, { ordinal: 2, score: 4 }, { ordinal: 3, score: 2 }, { ordinal: 4, score: 3 }, { ordinal: 5, score: 4 }] },
    { cycle_name: 'Third Quarter 2026', submitted_at: null, comment_text: 'half-written draft', scores: [] },
  ];

  test('only submitted remarks, newest first', () => {
    const r = remarksReceived(rows);
    expect(r.map((x) => x.cycleName)).toEqual(['Third Quarter 2026', 'Second Quarter 2026']);
    expect(r.some((x) => x.comment === 'half-written draft')).toBe(false);
  });

  test('each carries the comment and every area by name with its score out of 4', () => {
    const [latest] = remarksReceived(rows);
    expect(latest.comment).toBe('Prepares well.');
    expect(latest.areas).toHaveLength(5);
    expect(latest.areas[0]).toEqual({ ordinal: 1, name: 'Professional Growth & Feedback Uptake', score: 3 });
    expect(latest.areas[4]).toEqual({ ordinal: 5, name: 'Parents & Community Engagement', score: 4 });
  });

  test('nothing submitted → an empty list, never a fabricated remark', () => {
    expect(remarksReceived([])).toEqual([]);
    expect(remarksReceived([rows[2]])).toEqual([]);
  });
});
