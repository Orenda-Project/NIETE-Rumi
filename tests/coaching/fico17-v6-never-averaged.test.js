'use strict';
/**
 * bd-ra8xu.38 — a FICO17 v6 score is never averaged with a V3 one (V3 C5 is not v6 C5; V3 /148 is not v6 /44).
 *
 * Every v6 writer stamps scores.rubric = 'fico17_v6' (the DC v6 scorer, the /observe v6 review, an /observe2 v6
 * visit), and every reader that compares or averages overall scores across sessions treats a stamped score as "no
 * V3 score": dashboard getOverall (the funnel for the portal's 18 call sites), the coaching trend, the leader
 * brief's overall, the coach-disagreement list, the visit-request ping and the teacher-home order. A V3 row carries
 * no stamp, so every V3 number is exactly what it was.
 */
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));

const { getOverall, isV6Scored: dashIsV6 } = require('../../dashboard/services/coaching-frameworks.service');
const { isV6Scored } = require('../../bot/shared/services/coaching/frameworks/fico17-v6/stamp');
const v6fw = require('../../bot/shared/services/coaching/frameworks/fico17-v6-framework');
const { pctFromRow } = require('../../bot/shared/services/coaching/coaching-trend.service');
const { overallScoreFromAnalysis } = require('../../bot/shared/services/observe/assignment/leader-source');
const { sessionPct } = require('../../dashboard/services/schools-analytics.service');

const V3_FICO = { framework: 'fico', scores: { overall_marks: 96, overall_max_marks: 148, overall_percentage: 64.9, has_lesson_plan: false, max_marks: 100 } };
const V3_OECD = { scores: { grand_total: 70, max_marks: 100, percentage: 70 } };
const V3_MEASURED = { framework: 'fico', scores: { overall_marks: 80, overall_max_marks: 120, overall_percentage: 66.7 } };
const V6_OBSERVE = { framework: 'fico17_v6', rubric: 'fico17_v6', scores: { overall_marks: 30, overall_max_marks: 44, overall_percentage: 68.2, max_marks: 100, rubric: 'fico17_v6' } };
const V6_OBSERVE2 = { framework: 'fico', observe2: { rubric: 'fico17_v6' }, scores: { overall_marks: 50, overall_max_marks: 68, overall_percentage: 73.5, rubric: 'fico17_v6' } };
const V5_OBSERVE2 = { framework: 'fico', observe2: { rubric: 'fico-ict-17-2026-09' }, scores: { overall_marks: 50, overall_max_marks: 68, overall_percentage: 73.5 } };

describe('the stamp', () => {
  test('a v6 analysis, its scores alone, and an /observe2 v6 analysis are all recognised; V3 and v5 are not', () => {
    for (const f of [isV6Scored, dashIsV6]) {
      expect(f(V6_OBSERVE)).toBe(true);
      expect(f(V6_OBSERVE.scores)).toBe(true);
      expect(f(V6_OBSERVE2)).toBe(true);
      expect(f({ framework: 'fico', observe2: { rubric: 'fico17_v6' }, scores: {} })).toBe(true);
      expect(f(V3_FICO)).toBe(false);
      expect(f(V3_FICO.scores)).toBe(false);
      expect(f(V5_OBSERVE2)).toBe(false);
      expect(f(null)).toBe(false);
      expect(f(undefined)).toBe(false);
      expect(f('fico17_v6')).toBe(false);
    }
  });

  test('the DC v6 scorer stamps its scores', () => {
    const levels = Object.fromEntries(['C1', 'C2', 'C4', 'C6', 'C8', 'D1', 'D5', 'F1', 'F2', 'F3', 'F4'].map((c) => [c, { result: 3, because: 'x', evidence: [] }]));
    const a = v6fw.computeScores({ levels, combined_evidence: {} });
    expect(a.scores.rubric).toBe('fico17_v6');
  });
});

describe('dashboard getOverall', () => {
  test('V3 rows: exactly as before', () => {
    expect(getOverall(V3_FICO)).toEqual({ points: 96, maxPoints: 148, percentage: 64.9 });
    expect(getOverall(V3_OECD)).toEqual({ points: 70, maxPoints: 100, percentage: 70 });
    expect(getOverall(V3_MEASURED)).toEqual({ points: 80, maxPoints: 120, percentage: 66.7 });
    expect(getOverall({ scores: V3_MEASURED.scores })).toEqual({ points: 80, maxPoints: 120, percentage: 66.7 });
    expect(getOverall(null)).toEqual({ points: 0, maxPoints: 0, percentage: 0 });
    expect(getOverall(V5_OBSERVE2)).toEqual({ points: 50, maxPoints: 68, percentage: 73.5 });
  });

  test('a v6 row is "no V3 score": no percentage and no max, so no average counts it', () => {
    for (const x of [V6_OBSERVE, { scores: V6_OBSERVE.scores }, V6_OBSERVE2]) {
      const o = getOverall(x);
      expect(o.percentage).toBeNull();
      expect(o.maxPoints).toBe(0);
      expect(o.rubric).toBe('fico17_v6');
    }
  });

  test('a consumer that averages (schools analytics) skips v6 and keeps V3', () => {
    expect(sessionPct(V3_MEASURED.scores)).toBe(66.7);
    expect(sessionPct(V6_OBSERVE.scores)).toBeNull();
    expect(sessionPct(V6_OBSERVE2.scores)).toBeNull();
  });
});

describe('bot readers', () => {
  test('the coaching trend leaves a v6 session out, V3 as before', () => {
    expect(pctFromRow({ analysis_data: V3_FICO })).toBe(64.9);
    expect(pctFromRow({ analysis_data: V3_OECD })).toBe(70);
    expect(pctFromRow({ analysis_data: V6_OBSERVE })).toBeNull();
    expect(pctFromRow({ analysis_data: V6_OBSERVE2 })).toBeNull();
  });

  test("the leader brief's overall ignores a v6 analysis, V3 as before", () => {
    expect(overallScoreFromAnalysis({ scores: { overall_percentage: 64.9 } })).toBeCloseTo(0.649);
    expect(overallScoreFromAnalysis(V6_OBSERVE)).toBeNull();
    expect(overallScoreFromAnalysis(V6_OBSERVE2)).toBeNull();
  });
});
