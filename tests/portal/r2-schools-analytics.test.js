/**
 * FICO6 r2 fix-dashboard (bd-qix9oh, redteam T7.D5; CONTRACTS §11.6): a FICO17 v6 visit never joins a V3
 * FICO section average on /analytics/observations (fico17-v6/stamp.js: "V3 and v6 never meet in one total or
 * average"). The overall % already drops it (getOverall); the sections read `domains.*` and did not.
 *
 * The v6 row is the real one: buildAnalysis() of a checked /observe2 v6 form (framework 'fico', FICO domain keys,
 * scores.rubric 'fico17_v6'), as redteam t7 builds it. The database is a fake `query`; the services are real.
 * A v6 visit still counts as an observation, gives no section %, and is counted in overview.v6_visits.
 * v5 /observe2 rows (no stamp) keep their section % (pre-existing; unchanged here).
 */
'use strict';

jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));

const { loadCountedSessions, createScoreMemo } = require('../../dashboard/services/schools-analytics.service');
const {
  loadObservationsAnalyticsRows,
  summarizeObservationsAnalytics,
} = require('../../dashboard/services/observations-analytics.service');
const { FICO_SECTIONS } = require('../../dashboard/services/steps-grid.service');

const LEVELS = { C1: '3', C2: '4', C3: '3', C4: '2', C5: '2', C6: '3', C7: '3', C8: '3', D1: '3', D2: '4', D3: '2', D4: '3', D5: '2', F1: '3', F2: '2', F3: '2', F4: '1' };
const v6Analysis = () => require('../../bot/shared/services/observe/observe2/analysis').buildAnalysis({
  id: 'form-v6', rubric_version: 'fico17_v6', period_minutes: 40,
  answers: { lp: 'none', priority: 'C5' }, final_levels: { ...LEVELS },
  rumi_moments: { moments: [] }, evidence_review: { priority_final: 'C5' },
});

// A V3 (or v5 /observe2) row: no rubric stamp, C 50 %, D 75 %.
const V3_SCORES = { overall_marks: 60, overall_max_marks: 100 };
const V3_DOMAINS = {
  lesson_plan_fidelity: { domain_score: null, domain_max: null, assessed: false },
  high_leverage_practices: { domain_score: 24, domain_max: 48, assessed: null },
  student_engagement: { domain_score: 21, domain_max: 28, assessed: null },
};

const text = (v) => (v === null || v === undefined ? null : String(v));
const cols = (domains) => Object.fromEntries(Object.entries(FICO_SECTIONS).flatMap(([k, key]) => [
  [`${k}_score`, text(domains[key].domain_score)], [`${k}_max`, text(domains[key].domain_max)], [`${k}_assessed`, text(domains[key].assessed)],
]));

const AT = '2026-11-11T05:00:00Z';
const session = (id, extra = {}) => ({ id, updated_at: AT, user_id: `t-${id}`, school_id: 'sch-1', is_test: false, observation_type: 'leader_observation', framework: 'fico', ...extra });

function makeQuery(sessions, scoreRows) {
  return jest.fn(async (sql, params) => {
    if (/'scores'/.test(sql)) return { rows: params[0].map((id) => scoreRows[id]) };
    if (/FROM schools/i.test(sql)) return { rows: [{ id: 'sch-1', name: 'School 1', emis: 'E-1', region: 'B.K', is_active: true, is_probable_test: false }] };
    if (/FROM coaching_sessions c/i.test(sql)) return { rows: sessions };
    throw new Error(`unexpected SQL: ${sql}`);
  });
}

function rowsFor() {
  const a = v6Analysis();
  return {
    sessions: [session('v6'), session('v3')],
    scores: {
      v6: { id: 'v6', updated_at: AT, scores: a.scores, ...cols(a.domains) },
      v3: { id: 'v3', updated_at: AT, scores: V3_SCORES, ...cols(V3_DOMAINS) },
    },
  };
}

describe('T7.D5: loadCountedSessions gives a v6-stamped visit no FICO section %', () => {
  test('the v6 row really carries C/D domain scores and the fico17_v6 stamp (the break is reachable)', () => {
    const a = v6Analysis();
    expect(a.scores.rubric).toBe('fico17_v6');
    expect(a.domains.high_leverage_practices.domain_score).toEqual(expect.any(Number));
  });

  test('v6 → sections all null, flagged v6; the V3 row beside it keeps its sections', async () => {
    const { sessions, scores } = rowsFor();
    const out = await loadCountedSessions(makeQuery(sessions, scores), { from: null, to: null }, { memo: createScoreMemo() });
    const byId = Object.fromEntries(out.sessions.map((s) => [s.id, s]));
    expect(byId.v6.pct).toBeNull();
    expect(byId.v6.sections).toEqual({ b: null, c: null, d: null });
    expect(byId.v6.v6).toBe(true);
    expect(byId.v3.sections).toEqual({ b: null, c: 50, d: 75 });
    expect(byId.v3.pct).toBe(60);
    expect(byId.v3).not.toHaveProperty('v6');
  });

  test('a memo hit (second request) still gives the v6 row no sections and keeps the flag', async () => {
    const { sessions, scores } = rowsFor();
    const memo = createScoreMemo();
    await loadCountedSessions(makeQuery(sessions, scores), {}, { memo });
    const again = await loadCountedSessions(makeQuery(sessions, scores), {}, { memo });
    expect(again.scoreReads).toBe(0);
    const v6 = again.sessions.find((s) => s.id === 'v6');
    expect(v6.sections).toEqual({ b: null, c: null, d: null });
    expect(v6.v6).toBe(true);
  });
});

describe('T7.D5: /analytics/observations averages V3 only and counts v6 visits apart', () => {
  test('section C/D are the V3 row alone; observations count both; overview.v6_visits = 1', async () => {
    const { sessions, scores } = rowsFor();
    const rows = await loadObservationsAnalyticsRows(makeQuery(sessions, scores), {}, { memo: createScoreMemo() });
    const out = summarizeObservationsAnalytics(rows);
    expect(out.human.overview).toMatchObject({ observations: 2, sectionC: 50, sectionCN: 1, sectionD: 75, sectionDN: 1, v6_visits: 1 });
    expect(out.dc.overview.v6_visits).toBe(0);
    const bk = out.human.regions.find((r) => r.region === 'B.K');
    expect(bk).toMatchObject({ observations: 2, sectionC: 50, sectionCN: 1 });
  });

  test('no v6 rows → v6_visits 0, everything else as before', () => {
    const out = summarizeObservationsAnalytics({});
    expect(out.dc.overview.v6_visits).toBe(0);
    expect(out.human.overview.v6_visits).toBe(0);
  });
});
