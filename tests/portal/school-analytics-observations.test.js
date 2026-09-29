'use strict';
/**
 * Analytics splits observations by WHO observed (operator, 2026-09-29):
 *   Human Observation          — a coach or principal watched the lesson in class
 *                                (coaching_sessions.observation_type = 'leader_observation')
 *   Digital Coach Observation  — the teacher recorded her own lesson
 *                                (every other analysed session)
 *
 * Why it matters: on NIETE prod 2026-09-29, 17,282 of 20,725 analysed sessions
 * (83%) were Digital Coach Observations, and the page pooled them all under
 * "Observed lessons — a coach sat in". STEPS feeds each teacher's ACR, so the
 * RATINGS — the progress line, the strong and weak areas, the average — come
 * from Human Observations only. The COUNTS and the monthly chart show both.
 *
 * The strong and weak areas are the three STEPS observation letters, not the
 * four rubric parts — the same words as the principal's STEPS home.
 */

const { summarizeSchoolAnalytics } = require('../../dashboard/services/school-analytics.service');

const dom = (score, max) => ({ domain_score: score, domain_max: max });
const session = (kind, date, pct, { b, c, d, f } = {}, teacher = 'Ayesha Bibi') => ({
  created_at: date,
  observation_type: kind === 'human' ? 'leader_observation' : null,
  teacher_name: teacher,
  analysis_data: {
    scores: { percentage: pct, overall_marks: pct, overall_max_marks: 100 },
    domains: {
      ...(b ? { lesson_plan_fidelity: dom(...b) } : {}),
      ...(c ? { high_leverage_practices: dom(...c) } : {}),
      ...(d ? { student_engagement: dom(...d) } : {}),
      ...(f ? { teacher_subject_knowledge: dom(...f) } : {}),
    },
  },
});

const HUMAN_1 = session('human', '2026-08-12T09:00:00Z', 48, { b: [8, 20], c: [12, 24], d: [13, 14], f: [2, 16] });
const HUMAN_2 = session('human', '2026-09-15T09:00:00Z', 64, { b: [16, 20], c: [12, 24], d: [12, 14], f: [4, 16] });
const DIGITAL_1 = session('digital', '2026-09-02T09:00:00Z', 95, { b: [20, 20], c: [24, 24], d: [14, 14], f: [16, 16] });
const DIGITAL_2 = session('digital', '2026-09-20T09:00:00Z', 90, { b: [19, 20], c: [22, 24], d: [14, 14], f: [15, 16] });
const ALL = [HUMAN_2, DIGITAL_1, HUMAN_1, DIGITAL_2];

describe('the two counts — both kinds', () => {
  test('Human and Digital Coach Observations are counted separately', () => {
    const a = summarizeSchoolAnalytics(ALL);
    expect(a.humanObservations).toBe(2);
    expect(a.digitalCoachObservations).toBe(2);
  });
});

describe('the ratings — Human Observations only', () => {
  test('the progress line holds only Human Observations, oldest first', () => {
    const a = summarizeSchoolAnalytics(ALL);
    expect(a.scoreTrend.map((p) => p.percentage)).toEqual([48, 64]);
  });

  test('the average ignores Digital Coach Observations', () => {
    // Pooled it would be (48+64+95+90)/4 = 74.3 — "Good", from lessons nobody watched.
    expect(summarizeSchoolAnalytics(ALL).averageScore).toBe(56);
  });

  test('the strong and weak areas are the three STEPS letters, strongest first', () => {
    const { areas } = summarizeSchoolAnalytics(ALL);
    expect(areas.map((x) => x.key)).toEqual(['e', 't', 's']);
    expect(areas.map((x) => x.name)).toEqual(['Engagement', 'Teaching skills', 'Subject knowledge']);
    // E: mean(13/14, 12/14) = 89.3 · T: mean(20/44, 28/44) = 54.5 · S: mean(2/16, 4/16) = 18.8
    expect(areas.map((x) => x.band)).toEqual(['excellent', 'average', 'needs_support']);
    expect(areas.every((x) => x.observations === 2)).toBe(true);
  });

  test('Digital Coach Observations alone produce no ratings, only counts', () => {
    const a = summarizeSchoolAnalytics([DIGITAL_1, DIGITAL_2]);
    expect(a.humanObservations).toBe(0);
    expect(a.digitalCoachObservations).toBe(2);
    expect(a.scoreTrend).toEqual([]);
    expect(a.areas).toEqual([]);
    expect(a.averageScore).toBeNull();
  });
});

describe('when observations happened — both kinds', () => {
  test('counted by month, split by kind, oldest month first', () => {
    expect(summarizeSchoolAnalytics(ALL).byMonth).toEqual([
      { month: '2026-08', human: 1, digitalCoach: 0 },
      { month: '2026-09', human: 1, digitalCoach: 2 },
    ]);
  });

  test('every observation is listed newest first; only a Human one carries a rating', () => {
    const { observations } = summarizeSchoolAnalytics(ALL);
    expect(observations.map((o) => [o.date.slice(0, 10), o.kind])).toEqual([
      ['2026-09-20', 'digital_coach'],
      ['2026-09-15', 'human'],
      ['2026-09-02', 'digital_coach'],
      ['2026-08-12', 'human'],
    ]);
    expect(observations.filter((o) => o.kind === 'human').map((o) => o.percentage)).toEqual([64, 48]);
    expect(observations.filter((o) => o.kind === 'digital_coach').every((o) => o.percentage === null)).toBe(true);
    expect(observations[0].teacherName).toBe('Ayesha Bibi');
  });

  test('a month with no observations is not invented', () => {
    const a = summarizeSchoolAnalytics([HUMAN_1, session('human', '2026-10-01T09:00:00Z', 50)]);
    expect(a.byMonth.map((m) => m.month)).toEqual(['2026-08', '2026-10']);
  });
});
