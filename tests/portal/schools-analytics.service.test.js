/**
 * Schools analytics (FDE / AEO view) — the pure summariser and the row loader.
 *
 * One page, region-filterable, school-wise: LP engagement, Digital Coach engagement,
 * observations (DC / human), Avg FICO (DC) and Avg HITL (human, post-review). No
 * teacher-level data leaves the server, and every roll-up is POOLED, never a mean of
 * school means.
 */

const {
  summarizeSchoolsAnalytics,
  sessionPct,
  parseRegionFilter,
  windowBounds,
  loadSchoolsAnalyticsRows,
  createScoreMemo,
  REGION_BUCKETS,
} = require('../../dashboard/services/schools-analytics.service');

const SCHOOL_KEYS = [
  'avgFico', 'avgHitl', 'dcEngagementPct', 'dcSessions', 'emis', 'ficoN', 'hitlN',
  'humanObservations', 'lpEngagementPct', 'name', 'region', 'schoolId', 'teachers',
].sort();
const REGION_KEYS = [
  'avgFico', 'avgHitl', 'dcEngagementPct', 'dcSessions', 'ficoN', 'hitlN',
  'humanObservations', 'lpEngagementPct', 'region', 'schools', 'teachers',
].sort();
const OVERVIEW_KEYS = REGION_KEYS.filter((k) => k !== 'region');

const school = (id, region, extra = {}) => ({
  id, name: `School ${id}`, emis: `E-${id}`, region, is_active: true, is_probable_test: false, ...extra,
});

function fixture() {
  return {
    schools: [
      school('s1', 'B.K'),
      school('s2', 'B.K'),
      school('s3', 'Sihala'),
      school('s4', null),
      school('s5', '   '),
      school('s6', 'Durbeen'),
      school('s7', 'B.K', { is_probable_test: true }),
      school('s8', 'Tarnol', { is_active: false }),
      school('s9', 'Nilore'),
    ],
    teachers: [
      { school_id: 's1', is_test: false, teachers: 10, lp_teachers: 5 },
      { school_id: 's1', is_test: true, teachers: 3, lp_teachers: 3 },
      { school_id: 's2', is_test: false, teachers: 2, lp_teachers: 2 },
      { school_id: 's3', is_test: false, teachers: 4, lp_teachers: 0 },
      { school_id: 's4', is_test: false, teachers: 1, lp_teachers: 1 },
      { school_id: 's5', is_test: false, teachers: 1, lp_teachers: 0 },
      { school_id: 's6', is_test: false, teachers: 2, lp_teachers: 1 },
      { school_id: 's7', is_test: false, teachers: 50, lp_teachers: 50 },
      { school_id: 's8', is_test: false, teachers: 7, lp_teachers: 7 },
      { school_id: 'ghost', is_test: false, teachers: 5, lp_teachers: 5 },
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
    ],
  };
}

describe('summarizeSchoolsAnalytics', () => {
  const out = summarizeSchoolsAnalytics(fixture());
  const bySchool = Object.fromEntries(out.schools.map((s) => [s.schoolId, s]));
  const byRegion = Object.fromEntries(out.regions.map((r) => [r.region, r]));

  it('returns exactly overview / regions / schools, with no teacher-level keys anywhere', () => {
    expect(Object.keys(out).sort()).toEqual(['overview', 'regions', 'schools']);
    expect(Object.keys(out.overview).sort()).toEqual(OVERVIEW_KEYS);
    for (const r of out.regions) expect(Object.keys(r).sort()).toEqual(REGION_KEYS);
    for (const s of out.schools) expect(Object.keys(s).sort()).toEqual(SCHOOL_KEYS);
    const text = JSON.stringify(out);
    for (const teacherId of ['t1', 't2', 't3', 't4', 't5', 'tx']) expect(text).not.toContain(`"${teacherId}"`);
  });

  it('lists all seven region buckets, in order, whatever the data holds', () => {
    expect(REGION_BUCKETS).toEqual(['B.K', 'Sihala', 'Urban-I', 'Nilore', 'Urban-II', 'Tarnol', 'Unassigned']);
    expect(out.regions.map((r) => r.region)).toEqual(REGION_BUCKETS);
  });

  it('excludes probable-test and inactive schools, and teachers attached to no known school', () => {
    expect(Object.keys(bySchool).sort()).toEqual(['s1', 's2', 's3', 's4', 's5', 's6', 's9']);
    expect(out.overview.schools).toBe(7);
    expect(out.overview.teachers).toBe(10 + 2 + 4 + 1 + 1 + 2 + 0);
  });

  it('NULL, blank and unknown regions all land in Unassigned', () => {
    for (const id of ['s4', 's5', 's6']) expect(bySchool[id].region).toBe('Unassigned');
    expect(byRegion.Unassigned.schools).toBe(3);
    expect(byRegion.Unassigned.teachers).toBe(4);
    expect(byRegion.Unassigned.lpEngagementPct).toBe(50);
  });

  it('per school: test teachers and their sessions are excluded; DC vs human are split', () => {
    expect(bySchool.s1).toEqual({
      schoolId: 's1', emis: 'E-s1', name: 'School s1', region: 'B.K', teachers: 10,
      lpEngagementPct: 50, dcEngagementPct: 20, dcSessions: 3, humanObservations: 1,
      avgFico: 70, avgHitl: 50, ficoN: 2, hitlN: 1,
    });
    expect(bySchool.s2).toMatchObject({
      teachers: 2, lpEngagementPct: 100, dcEngagementPct: 50, dcSessions: 1, humanObservations: 2,
      avgFico: 40, avgHitl: 80, ficoN: 1, hitlN: 2,
    });
  });

  it('a school with no teachers has null engagement, never 0%', () => {
    expect(bySchool.s9).toMatchObject({
      teachers: 0, lpEngagementPct: null, dcEngagementPct: null, dcSessions: 0, avgFico: null, avgHitl: null,
    });
    expect(byRegion.Nilore).toMatchObject({ schools: 1, teachers: 0, lpEngagementPct: null, dcEngagementPct: null });
  });

  it('teachers but no activity is a real 0%, while scores with no sessions are null', () => {
    expect(bySchool.s3).toMatchObject({ teachers: 4, lpEngagementPct: 0, dcEngagementPct: 0, avgFico: null, avgHitl: null, ficoN: 0, hitlN: 0 });
  });

  it('a bucket with no schools reports zero counts and null rates', () => {
    expect(byRegion['Urban-I']).toEqual({
      region: 'Urban-I', schools: 0, teachers: 0, lpEngagementPct: null, dcEngagementPct: null,
      dcSessions: 0, humanObservations: 0, avgFico: null, avgHitl: null, ficoN: 0, hitlN: 0,
    });
    expect(byRegion.Tarnol.schools).toBe(0); // its only school is inactive
  });

  it('region roll-ups are POOLED over sessions and teachers, not a mean of school means', () => {
    const bk = byRegion['B.K'];
    expect(bk).toMatchObject({ schools: 2, teachers: 12, dcSessions: 4, humanObservations: 3, ficoN: 3, hitlN: 3 });
    expect(bk.avgFico).toBe(60);            // (60+80+40)/3 — school means would give 55
    expect(bk.avgHitl).toBe(70);            // (50+90+70)/3 — school means would give 65
    expect(bk.lpEngagementPct).toBe(58.3);  // 7/12
    expect(bk.dcEngagementPct).toBe(25);    // 3/12
  });

  it('Σ school teachers and Σ school DC sessions equal the overview', () => {
    const sum = (k) => out.schools.reduce((n, s) => n + s[k], 0);
    expect(sum('teachers')).toBe(out.overview.teachers);
    expect(sum('dcSessions')).toBe(out.overview.dcSessions);
    expect(sum('humanObservations')).toBe(out.overview.humanObservations);
  });

  it('a region filter scopes overview + schools; regions[] is unchanged and the overview equals its card', () => {
    const f = summarizeSchoolsAnalytics(fixture(), { region: 'B.K' });
    expect(f.schools.map((s) => s.schoolId).sort()).toEqual(['s1', 's2']);
    expect(f.regions).toEqual(out.regions);
    const { region, ...card } = byRegion['B.K'];
    expect(region).toBe('B.K');
    expect(f.overview).toEqual(card);

    const u = summarizeSchoolsAnalytics(fixture(), { region: 'Unassigned' });
    expect(u.schools.map((s) => s.schoolId).sort()).toEqual(['s4', 's5', 's6']);
    const { region: _r, ...ucard } = byRegion.Unassigned;
    expect(u.overview).toEqual(ucard);
  });

  it('an empty window gives null averages, never 0', () => {
    const empty = summarizeSchoolsAnalytics({ ...fixture(), sessions: [] });
    expect(empty.overview).toMatchObject({ dcSessions: 0, humanObservations: 0, avgFico: null, avgHitl: null, ficoN: 0, hitlN: 0 });
    for (const s of empty.schools) {
      expect(s.avgFico).toBeNull();
      expect(s.avgHitl).toBeNull();
    }
  });

  it('copes with no rows at all', () => {
    const none = summarizeSchoolsAnalytics({});
    expect(none.schools).toEqual([]);
    expect(none.regions).toHaveLength(7);
    expect(none.overview).toMatchObject({ schools: 0, teachers: 0, lpEngagementPct: null, avgFico: null });
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
  it('accepts a sector (any case) or unassigned, as the canonical bucket name', () => {
    expect(parseRegionFilter('b.k')).toEqual({ ok: true, region: 'B.K', key: 'B.K' });
    expect(parseRegionFilter('Urban-II')).toEqual({ ok: true, region: 'Urban-II', key: 'Urban-II' });
    expect(parseRegionFilter('unassigned')).toEqual({ ok: true, region: 'Unassigned', key: 'Unassigned' });
  });
  it('refuses anything else rather than guessing', () => {
    for (const v of ['Durbeen', "B.K'; drop table users", 'Lahore', ['B.K'], 42]) {
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

  function makeQuery(sessions = SESSIONS) {
    const calls = [];
    const query = jest.fn(async (sql, params) => {
      calls.push({ sql, params });
      if (/FROM schools/i.test(sql)) return { rows: [school('s1', 'B.K')] };
      if (/lesson_plans/i.test(sql)) return { rows: [{ school_id: 's1', is_test: false, teachers: 4, lp_teachers: 2 }] };
      if (/'scores'/.test(sql)) {
        return { rows: params[0].map((id) => ({ id, updated_at: sessions.find((s) => s.id === id).updated_at, scores: SCORES[id] })) };
      }
      if (/FROM coaching_sessions/i.test(sql)) return { rows: sessions };
      throw new Error(`unexpected SQL: ${sql}`);
    });
    return { query, calls };
  }

  it('runs schools, teachers and sessions as three set-based reads plus one score read', async () => {
    const { query, calls } = makeQuery();
    const rows = await loadSchoolsAnalyticsRows(query, { from: '2026-10-01', to: '2026-10-13' }, { memo: createScoreMemo() });
    expect(calls.length).toBeLessThanOrEqual(4);
    expect(calls).toHaveLength(4);
    // No per-school loop: no query is parameterised by a school id.
    for (const c of calls) expect(JSON.stringify(c.params || [])).not.toContain('"s1"');
    expect(rows.sessions.map((s) => [s.id, s.pct])).toEqual([['c1', 60], ['c2', 50]]);
    expect(rows.teachers).toEqual([{ school_id: 's1', is_test: false, teachers: 4, lp_teachers: 2 }]);
  });

  it('passes the window as UTC instants to the dated reads', async () => {
    const { query, calls } = makeQuery();
    await loadSchoolsAnalyticsRows(query, { from: '2026-10-01', to: '2026-10-13' }, { memo: createScoreMemo() });
    const dated = calls.filter((c) => /lesson_plans|FROM coaching_sessions c/i.test(c.sql));
    expect(dated).toHaveLength(2);
    for (const c of dated) expect(c.params).toEqual(['2026-09-30T19:00:00.000Z', '2026-10-13T19:00:00.000Z']);
  });

  it('counts DC as completed and human observations as terminal, teachers only', async () => {
    const { query, calls } = makeQuery();
    await loadSchoolsAnalyticsRows(query, { from: null, to: null }, { memo: createScoreMemo() });
    const sess = calls.find((c) => /FROM coaching_sessions c/i.test(c.sql)).sql;
    expect(sess).toMatch(/observation_type IS NULL AND c\.status = 'completed'/);
    expect(sess).toMatch(/observation_type = 'leader_observation' AND c\.status IN \('completed', 'observer_review_complete'\)/);
    expect(sess).toMatch(/u\.role = 'teacher'/);
  });

  it('a warm memo skips the score read; a changed row (new updated_at) is re-read', async () => {
    const memo = createScoreMemo();
    const first = makeQuery();
    await loadSchoolsAnalyticsRows(first.query, { from: null, to: null }, { memo });
    const second = makeQuery();
    const rows = await loadSchoolsAnalyticsRows(second.query, { from: null, to: null }, { memo });
    expect(second.calls).toHaveLength(3);
    expect(rows.sessions.map((s) => s.pct)).toEqual([60, 50]);

    const edited = [SESSIONS[0], { ...SESSIONS[1], updated_at: '2026-10-05T10:00:00Z' }];
    const third = makeQuery(edited);
    await loadSchoolsAnalyticsRows(third.query, { from: null, to: null }, { memo });
    const scoreCall = third.calls.find((c) => /'scores'/.test(c.sql));
    expect(scoreCall.params[0]).toEqual(['c2']);
  });

  it('no sessions in the window means no score read at all', async () => {
    const { query, calls } = makeQuery([]);
    const rows = await loadSchoolsAnalyticsRows(query, { from: null, to: null }, { memo: createScoreMemo() });
    expect(calls).toHaveLength(3);
    expect(rows.sessions).toEqual([]);
  });
});
