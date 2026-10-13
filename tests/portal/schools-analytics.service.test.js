/**
 * Schools analytics (FDE / AEO view) — the pure summariser and the row loader (Plan v3).
 *
 * Objective counts only: LPs opened / generated, Digital Coach and human observations,
 * coach visits, each "x of N teachers" where it applies, and the average FICO / HITL score
 * with its n. No percentages, no bands, no thresholds. No teacher-level data leaves the
 * server, and every roll-up is a SUM (averages pooled), never a mean of school means.
 */

const {
  summarizeSchoolsAnalytics,
  sessionPct,
  parseRegionFilter,
  windowBounds,
  loadSchoolsAnalyticsRows,
  createScoreMemo,
  REGION_BUCKETS,
  LP_OPENS_LOGGED_SINCE,
} = require('../../dashboard/services/schools-analytics.service');

const METRIC_KEYS = [
  'teachers', 'lpsOpened', 'teachersOpenedLp', 'lpsGenerated', 'dcObservations', 'teachersWithDc',
  'humanObservations', 'coachVisits', 'avgFico', 'ficoN', 'avgHitl', 'hitlN',
];
const COUNT_KEYS = METRIC_KEYS.filter((k) => !k.startsWith('avg'));
const SCHOOL_KEYS = ['schoolId', 'emis', 'name', 'region', ...METRIC_KEYS].sort();
const REGION_KEYS = ['region', 'schools', ...METRIC_KEYS].sort();
const OVERVIEW_KEYS = ['schools', ...METRIC_KEYS].sort();

const school = (id, region, extra = {}) => ({
  id, name: `School ${id}`, emis: `E-${id}`, region, is_active: true, is_probable_test: false, coach_visits: 0, ...extra,
});
const roster = (school_id, is_test, teachers, lps_generated, lps_opened, teachers_opened_lp) => ({
  school_id, is_test, teachers, lps_generated, lps_opened, teachers_opened_lp,
});

function fixture() {
  return {
    schools: [
      school('s1', 'B.K', { coach_visits: 3 }),
      school('s2', 'B.K'),
      school('s3', 'Sihala', { coach_visits: 1 }),
      school('s4', null, { coach_visits: 2 }),
      school('s5', '   ', { coach_visits: undefined }),
      school('s6', 'Durbeen'),
      school('s7', 'B.K', { is_probable_test: true, coach_visits: 5 }),
      school('s8', 'Tarnol', { is_active: false, coach_visits: 4 }),
      school('s9', 'Nilore'),
    ],
    teachers: [
      roster('s1', false, 10, 25, 7, 4),
      roster('s1', true, 3, 9, 9, 3),
      roster('s2', false, 2, 4, 3, 2),
      roster('s3', false, 4, 0, 0, 0),
      roster('s4', false, 1, 2, 1, 1),
      roster('s5', false, 1, 0, 0, 0),
      roster('s6', false, 2, 1, 2, 1),
      roster('s7', false, 50, 50, 50, 50),
      roster('s8', false, 7, 7, 7, 7),
      roster('ghost', false, 5, 5, 5, 5),
    ],
    sessions: [
      { id: 'c1', school_id: 's1', user_id: 't1', is_test: false, observation_type: null, pct: 60 },
      { id: 'c2', school_id: 's1', user_id: 't1', is_test: false, observation_type: null, pct: 80 },
      { id: 'c3', school_id: 's1', user_id: 't2', is_test: false, observation_type: null, pct: null },
      { id: 'c4', school_id: 's1', user_id: 't3', is_test: false, observation_type: 'leader_observation', pct: 50 },
      { id: 'c5', school_id: 's1', user_id: 'tx', is_test: true, observation_type: null, pct: 0 },
      { id: 'c6', school_id: 's2', user_id: 't4', is_test: false, observation_type: null, pct: 40 },
      { id: 'c7', school_id: 's2', user_id: 't5', is_test: false, observation_type: 'leader_observation', pct: 90 },
      { id: 'c8', school_id: 's2', user_id: 't4', is_test: false, observation_type: 'leader_observation', pct: 70 },
      { id: 'c9', school_id: 's7', user_id: 't9', is_test: false, observation_type: null, pct: 10 },
      { id: 'c10', school_id: 's2', user_id: 't4', is_test: false, observation_type: 'something_else', pct: 5 },
      // Activity at schools outside the six regions (no region, blank, Durbeen): must not reach any total.
      { id: 'c11', school_id: 's4', user_id: 't6', is_test: false, observation_type: null, pct: 99 },
      { id: 'c12', school_id: 's5', user_id: 't7', is_test: false, observation_type: 'leader_observation', pct: 11 },
      { id: 'c13', school_id: 's6', user_id: 't8', is_test: false, observation_type: null, pct: 13 },
      { id: 'c14', school_id: 's6', user_id: 't8', is_test: false, observation_type: 'leader_observation', pct: 14 },
    ],
  };
}

describe('summarizeSchoolsAnalytics', () => {
  const out = summarizeSchoolsAnalytics(fixture());
  const bySchool = Object.fromEntries(out.schools.map((s) => [s.schoolId, s]));
  const byRegion = Object.fromEntries(out.regions.map((r) => [r.region, r]));

  it('returns exactly overview / regions / schools, with the v3 key sets', () => {
    expect(Object.keys(out).sort()).toEqual(['overview', 'regions', 'schools']);
    expect(Object.keys(out.overview).sort()).toEqual(OVERVIEW_KEYS);
    for (const r of out.regions) expect(Object.keys(r).sort()).toEqual(REGION_KEYS);
    for (const s of out.schools) expect(Object.keys(s).sort()).toEqual(SCHOOL_KEYS);
  });

  it('carries no percentage, band, threshold or rate — anywhere', () => {
    const keys = [];
    const walk = (v) => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { keys.push(k); walk(x); }
    };
    walk(out);
    for (const k of keys) expect(k).not.toMatch(/pct|percent|band|threshold|ratio|(^|[a-z])rate$|Rate$|engag|level|colou?r|status/i);
  });

  it('carries no teacher-level data', () => {
    const text = JSON.stringify(out);
    for (const teacherId of ['t1', 't2', 't3', 't4', 't5', 't6', 't7', 't8', 'tx']) expect(text).not.toContain(`"${teacherId}"`);
    expect(text).not.toMatch(/user_?id|teacherName|phone/i);
  });

  it('lists exactly the six ICT regions, in order, whatever the data holds — no Unassigned bucket', () => {
    expect(REGION_BUCKETS).toEqual(['B.K', 'Sihala', 'Urban-I', 'Nilore', 'Urban-II', 'Tarnol']);
    expect(out.regions.map((r) => r.region)).toEqual(REGION_BUCKETS);
    expect(JSON.stringify(out)).not.toMatch(/unassigned/i);
  });

  it('excludes probable-test and inactive schools, and roster rows attached to no known school', () => {
    expect(Object.keys(bySchool).sort()).toEqual(['s1', 's2', 's3', 's9']);
    expect(out.overview.schools).toBe(4);
    expect(out.overview.teachers).toBe(10 + 2 + 4 + 0);
    expect(out.overview.coachVisits).toBe(3 + 0 + 1 + 0); // s7 (test) and s8 (inactive) excluded
  });

  it('a school with no region, a blank one, or one outside the six (Durbeen) is left out of everything', () => {
    // Not a row, not a bucket...
    for (const id of ['s4', 's5', 's6']) expect(bySchool[id]).toBeUndefined();
    expect(JSON.stringify(out)).not.toMatch(/School s[456]"|E-s[456]|Durbeen/);
    // ...and none of its teachers, LPs, visits or observations reach a total (bd-s6qbts.4).
    expect(out.overview).toEqual({
      schools: 4, teachers: 16, lpsOpened: 10, teachersOpenedLp: 6, lpsGenerated: 29,
      dcObservations: 4, teachersWithDc: 3, humanObservations: 3, coachVisits: 4,
      avgFico: 60, ficoN: 3, avgHitl: 70, hitlN: 3,
    });
    // The same holds with the leak sources alone: they add nothing.
    const outside = summarizeSchoolsAnalytics({
      schools: fixture().schools.filter((s) => ['s4', 's5', 's6'].includes(s.id)),
      teachers: fixture().teachers,
      sessions: fixture().sessions,
    });
    expect(outside.schools).toEqual([]);
    expect(outside.overview).toMatchObject({ schools: 0, teachers: 0, lpsOpened: 0, lpsGenerated: 0, dcObservations: 0, humanObservations: 0, coachVisits: 0, ficoN: 0, hitlN: 0 });
    for (const r of outside.regions) expect(r.schools).toBe(0);
  });

  it('Σ over the six region cards = the overview, for every count field', () => {
    for (const k of ['schools', ...COUNT_KEYS]) {
      expect(out.regions.reduce((n, r) => n + r[k], 0)).toBe(out.overview[k]);
    }
  });

  it('per school: every field, test teachers and their sessions excluded, DC vs human split', () => {
    expect(bySchool.s1).toEqual({
      schoolId: 's1', emis: 'E-s1', name: 'School s1', region: 'B.K', teachers: 10,
      lpsOpened: 7, teachersOpenedLp: 4, lpsGenerated: 25,
      dcObservations: 3, teachersWithDc: 2, humanObservations: 1, coachVisits: 3,
      avgFico: 70, ficoN: 2, avgHitl: 50, hitlN: 1,
    });
    expect(bySchool.s2).toEqual({
      schoolId: 's2', emis: 'E-s2', name: 'School s2', region: 'B.K', teachers: 2,
      lpsOpened: 3, teachersOpenedLp: 2, lpsGenerated: 4,
      dcObservations: 1, teachersWithDc: 1, humanObservations: 2, coachVisits: 0,
      avgFico: 40, ficoN: 1, avgHitl: 80, hitlN: 2,
    });
  });

  it('counts are never null; only averages are null, and only when their n is 0', () => {
    expect(bySchool.s9).toEqual({
      schoolId: 's9', emis: 'E-s9', name: 'School s9', region: 'Nilore', teachers: 0,
      lpsOpened: 0, teachersOpenedLp: 0, lpsGenerated: 0,
      dcObservations: 0, teachersWithDc: 0, humanObservations: 0, coachVisits: 0,
      avgFico: null, ficoN: 0, avgHitl: null, hitlN: 0,
    });
    for (const row of [...out.schools, ...out.regions, out.overview]) {
      for (const k of COUNT_KEYS) expect(typeof row[k]).toBe('number');
      expect(row.avgFico === null).toBe(row.ficoN === 0);
      expect(row.avgHitl === null).toBe(row.hitlN === 0);
    }
  });

  it('a bucket with no schools is all zeros and null averages', () => {
    expect(byRegion['Urban-I']).toEqual({
      region: 'Urban-I', schools: 0, teachers: 0, lpsOpened: 0, teachersOpenedLp: 0, lpsGenerated: 0,
      dcObservations: 0, teachersWithDc: 0, humanObservations: 0, coachVisits: 0,
      avgFico: null, ficoN: 0, avgHitl: null, hitlN: 0,
    });
    expect(byRegion.Tarnol.schools).toBe(0); // its only school is inactive
  });

  it('region roll-ups are sums, and averages are POOLED, not a mean of school means', () => {
    expect(byRegion['B.K']).toEqual({
      region: 'B.K', schools: 2, teachers: 12, lpsOpened: 10, teachersOpenedLp: 6, lpsGenerated: 29,
      dcObservations: 4, teachersWithDc: 3, humanObservations: 3, coachVisits: 3,
      avgFico: 60, ficoN: 3,    // (60+80+40)/3 — school means would give 55
      avgHitl: 70, hitlN: 3,    // (50+90+70)/3 — school means would give 65
    });
  });

  it('Σ per-school = overview for EVERY count field, and = each region card within its region', () => {
    const sum = (rows, k) => rows.reduce((n, s) => n + s[k], 0);
    for (const k of COUNT_KEYS) expect(sum(out.schools, k)).toBe(out.overview[k]);
    for (const r of out.regions) {
      const inRegion = out.schools.filter((s) => s.region === r.region);
      expect(inRegion.length).toBe(r.schools);
      for (const k of COUNT_KEYS) expect(sum(inRegion, k)).toBe(r[k]);
    }
  });

  it('a region filter scopes overview + schools; regions[] is unchanged and the overview equals its card', () => {
    for (const bucket of REGION_BUCKETS) {
      const f = summarizeSchoolsAnalytics(fixture(), { region: bucket });
      expect(f.regions).toEqual(out.regions);
      expect(f.schools.every((s) => s.region === bucket)).toBe(true);
      const { region, ...card } = byRegion[bucket];
      expect(region).toBe(bucket);
      expect(f.overview).toEqual(card);
    }
    expect(summarizeSchoolsAnalytics(fixture(), { region: 'B.K' }).schools.map((s) => s.schoolId).sort()).toEqual(['s1', 's2']);
  });

  it('an empty window gives zero counts and null averages, never a 0 score', () => {
    const empty = summarizeSchoolsAnalytics({
      schools: fixture().schools.map((s) => ({ ...s, coach_visits: 0 })),
      teachers: fixture().teachers.map((t) => ({ ...t, lps_generated: 0, lps_opened: 0, teachers_opened_lp: 0 })),
      sessions: [],
    });
    expect(empty.overview).toEqual({
      schools: 4, teachers: 16, lpsOpened: 0, teachersOpenedLp: 0, lpsGenerated: 0,
      dcObservations: 0, teachersWithDc: 0, humanObservations: 0, coachVisits: 0,
      avgFico: null, ficoN: 0, avgHitl: null, hitlN: 0,
    });
  });

  it('copes with no rows at all', () => {
    const none = summarizeSchoolsAnalytics({});
    expect(none.schools).toEqual([]);
    expect(none.regions).toHaveLength(6);
    expect(none.overview).toMatchObject({ schools: 0, teachers: 0, lpsOpened: 0, avgFico: null });
  });

  it('LP opens are logged from 4 Oct 2026 — the contract says so', () => {
    expect(LP_OPENS_LOGGED_SINCE).toBe('2026-10-04');
  });
});

describe('sessionPct — the same reading of a score the principal Analytics page uses', () => {
  it('reads overall_percentage when the session was measured against a max', () => {
    expect(sessionPct({ overall_marks: 60, overall_max_marks: 90, overall_percentage: 66.7 })).toBe(66.7);
  });
  it('derives the percentage from marks when no percentage is stored', () => {
    expect(sessionPct({ overall_marks: 30, overall_max_marks: 60 })).toBe(50);
  });
  it('an unmeasured or empty score is null, never 0', () => {
    expect(sessionPct(null)).toBeNull();
    expect(sessionPct({})).toBeNull();
    expect(sessionPct({ overall_percentage: 50 })).toBeNull(); // no max: not measured against anything
    expect(sessionPct('x')).toBeNull();
  });
});

describe('parseRegionFilter', () => {
  it('blank / all is every region', () => {
    for (const v of [undefined, null, '', 'all', 'ALL', ' All ']) {
      expect(parseRegionFilter(v)).toEqual({ ok: true, region: null, key: 'all' });
    }
  });
  it('accepts one of the six sectors (any case), as the canonical name', () => {
    expect(parseRegionFilter('b.k')).toEqual({ ok: true, region: 'B.K', key: 'B.K' });
    expect(parseRegionFilter('Urban-II')).toEqual({ ok: true, region: 'Urban-II', key: 'Urban-II' });
  });
  it('refuses anything else rather than guessing — "unassigned" included, like any unknown region', () => {
    for (const v of ['unassigned', 'Unassigned', ' UNASSIGNED ', 'Durbeen', "B.K'; drop table users", 'Lahore', ['B.K'], 42]) {
      expect(parseRegionFilter(v).ok).toBe(false);
    }
  });
});

describe('windowBounds — Pakistan days to UTC instants, inclusive of the last day', () => {
  it('maps [from, to] to [from 00:00 PKT, to+1 00:00 PKT)', () => {
    expect(windowBounds({ from: '2026-10-01', to: '2026-10-13' })).toEqual({
      fromTs: '2026-09-30T19:00:00.000Z', toTs: '2026-10-13T19:00:00.000Z',
    });
  });
  it('leaves an open end open', () => {
    expect(windowBounds({ from: null, to: null })).toEqual({ fromTs: null, toTs: null });
    expect(windowBounds({ from: '2026-09-01', to: null })).toEqual({ fromTs: '2026-08-31T19:00:00.000Z', toTs: null });
  });
});

describe('loadSchoolsAnalyticsRows — set-based, at most four queries, scores memoised', () => {
  const SESSIONS = [
    { id: 'c1', updated_at: '2026-10-02T10:00:00Z', user_id: 't1', school_id: 's1', is_test: false, observation_type: null },
    { id: 'c2', updated_at: '2026-10-03T10:00:00Z', user_id: 't3', school_id: 's1', is_test: false, observation_type: 'leader_observation' },
  ];
  const SCORES = {
    c1: { overall_marks: 60, overall_max_marks: 100 },
    c2: { overall_marks: 45, overall_max_marks: 90, overall_percentage: 50 },
  };
  const ROSTER = [roster('s1', false, 4, 6, 3, 2)];

  function makeQuery(sessions = SESSIONS) {
    const calls = [];
    const query = jest.fn(async (sql, params) => {
      calls.push({ sql, params });
      if (/'scores'/.test(sql)) {
        return { rows: params[0].map((id) => ({ id, updated_at: sessions.find((s) => s.id === id).updated_at, scores: SCORES[id] })) };
      }
      if (/FROM schools/i.test(sql)) return { rows: [school('s1', 'B.K', { coach_visits: 2 })] };
      if (/lesson_plans/i.test(sql)) return { rows: ROSTER };
      if (/FROM coaching_sessions/i.test(sql)) return { rows: sessions };
      throw new Error(`unexpected SQL: ${sql}`);
    });
    return { query, calls };
  }
  const kind = (c) => (/'scores'/.test(c.sql) ? 'scores' : /FROM schools/i.test(c.sql) ? 'schools'
    : /lesson_plans/i.test(c.sql) ? 'roster' : 'sessions');

  it('runs schools(+visits), roster(+LPs), sessions as three set-based reads plus one score read', async () => {
    const { query, calls } = makeQuery();
    const rows = await loadSchoolsAnalyticsRows(query, { from: '2026-10-01', to: '2026-10-13' }, { memo: createScoreMemo() });
    expect(calls.map(kind).sort()).toEqual(['roster', 'schools', 'scores', 'sessions']);
    // No per-school loop: no query is parameterised by a school id.
    for (const c of calls) expect(JSON.stringify(c.params || [])).not.toContain('"s1"');
    expect(rows.sessions.map((s) => [s.id, s.pct])).toEqual([['c1', 60], ['c2', 50]]);
    expect(rows.teachers).toEqual(ROSTER);
    expect(rows.schools[0].coach_visits).toBe(2);
  });

  it('timestamps get UTC instants; the visit date gets the Pakistan days themselves', async () => {
    const { query, calls } = makeQuery();
    await loadSchoolsAnalyticsRows(query, { from: '2026-10-01', to: '2026-10-13' }, { memo: createScoreMemo() });
    for (const c of calls.filter((x) => ['roster', 'sessions'].includes(kind(x)))) {
      expect(c.params).toEqual(['2026-09-30T19:00:00.000Z', '2026-10-13T19:00:00.000Z']);
    }
    expect(calls.find((x) => kind(x) === 'schools').params).toEqual(['2026-10-01', '2026-10-13']);
  });

  it('an open window passes no bounds at all', async () => {
    const { query, calls } = makeQuery();
    await loadSchoolsAnalyticsRows(query, { from: null, to: null }, { memo: createScoreMemo() });
    for (const c of calls.filter((x) => kind(x) !== 'scores')) expect(c.params).toEqual([]);
  });

  it('reads each source by its v3 rule', async () => {
    const { query, calls } = makeQuery();
    await loadSchoolsAnalyticsRows(query, { from: '2026-10-01', to: '2026-10-13' }, { memo: createScoreMemo() });
    const sql = (k) => calls.find((c) => kind(c) === k).sql;
    // Visits: done only, the school by id or else by 'niete:'||emis, dated by the visit's own date.
    expect(sql('schools')).toMatch(/observation_schedules/);
    expect(sql('schools')).toMatch(/status = 'done'/);
    expect(sql('schools')).toMatch(/'niete:' \|\| \w+\.emis/);
    expect(sql('schools')).toMatch(/scheduled_for >= \$1::date/);
    expect(sql('schools')).not.toMatch(/updated_at/);
    // Roster: teachers with a school; LPs generated = successful rows; opens = distinct plans by opened_at.
    expect(sql('roster')).toMatch(/u\.role = 'teacher'/);
    expect(sql('roster')).toMatch(/l\.status = 'completed'/);
    expect(sql('roster')).toMatch(/count\(DISTINCT \(o\.plan_kind, o\.plan_ref\)\)/);
    expect(sql('roster')).toMatch(/o\.opened_at >= \$1::timestamptz/);
    // Sessions: DC completed, human terminal.
    expect(sql('sessions')).toMatch(/observation_type IS NULL AND c\.status = 'completed'/);
    expect(sql('sessions')).toMatch(/observation_type = 'leader_observation' AND c\.status IN \('completed', 'observer_review_complete'\)/);
  });

  it('a warm memo skips the score read; a changed row (new updated_at) is re-read', async () => {
    const memo = createScoreMemo();
    const first = makeQuery();
    await loadSchoolsAnalyticsRows(first.query, { from: null, to: null }, { memo });
    const second = makeQuery();
    const rows = await loadSchoolsAnalyticsRows(second.query, { from: null, to: null }, { memo });
    expect(second.calls.map(kind)).not.toContain('scores');
    expect(rows.sessions.map((s) => s.pct)).toEqual([60, 50]);

    const edited = [SESSIONS[0], { ...SESSIONS[1], updated_at: '2026-10-05T10:00:00Z' }];
    const third = makeQuery(edited);
    await loadSchoolsAnalyticsRows(third.query, { from: null, to: null }, { memo });
    expect(third.calls.find((c) => kind(c) === 'scores').params[0]).toEqual(['c2']);
  });

  it('no sessions in the window means no score read at all', async () => {
    const { query, calls } = makeQuery([]);
    const rows = await loadSchoolsAnalyticsRows(query, { from: null, to: null }, { memo: createScoreMemo() });
    expect(calls).toHaveLength(3);
    expect(rows.sessions).toEqual([]);
  });
});
