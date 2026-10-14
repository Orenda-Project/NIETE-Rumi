/**
 * Coaching analytics (schools-analytics v6 Coaching tab, bd-97x22y.1) — the pure summariser
 * and the row loader behind GET /api/portal/analytics/coaching.
 *
 * Contract (PLAN v6 §3), counts only, never null:
 *   overview { coaches, coachVisits, schoolsVisited }
 *   regions  [{ region, coaches, coachVisits, schoolsVisited }]  — the six ICT sectors, in order
 *   schools  [{ schoolId, emis, name, region, coachVisits }]
 *
 *   coachVisits    observation_schedules status 'done', dated by scheduled_for (a date: the
 *                  Pakistan day) in the window, school by school_id else school_ext_id =
 *                  'niete:'||emis; a visit that resolves to no counted school is not counted.
 *   coaches        users.role 'coach', not a test user, with >=1 leader_schools school in the
 *                  region (school_id OR 'niete:'||emis — the leader-patch join). A coach in two
 *                  regions counts in both cards and ONCE in the overview. Not window-dependent.
 *   schoolsVisited distinct counted schools with >=1 counted visit.
 *   A school counts only when active, not probable-test, and in one of the six sectors.
 */

const {
  summarizeCoachingAnalytics,
  loadCoachingAnalyticsRows,
  REGION_BUCKETS,
} = require('../../dashboard/services/coaching-analytics.service');
const SchoolsAnalytics = require('../../dashboard/services/schools-analytics.service');

const SIX = ['B.K', 'Sihala', 'Urban-I', 'Nilore', 'Urban-II', 'Tarnol'];
const OVERVIEW_KEYS = ['coachVisits', 'coaches', 'schoolsVisited'];
const REGION_KEYS = ['coachVisits', 'coaches', 'region', 'schoolsVisited'];
const SCHOOL_KEYS = ['coachVisits', 'emis', 'name', 'region', 'schoolId'];

// One row per school from the schools read, with its coach visits in the window.
const school = (id, region, coach_visits = 0, extra = {}) => ({
  id, name: `School ${id}`, emis: `E-${id}`, region, is_active: true, is_probable_test: false, coach_visits, ...extra,
});
// One row per (non-test coach, school) from the coach read.
const pair = (coach_id, school_id) => ({ coach_id, school_id });

const ROWS = {
  schools: [
    school('bk1', 'B.K', 3),
    school('bk2', 'B.K', 0),
    school('sh1', 'Sihala', 2),
    school('ur1', 'Urban-I', 1),
    // Left out of everything: inactive, probable test, no region, outside the six.
    school('off', 'B.K', 9, { is_active: false }),
    school('tst', 'Sihala', 7, { is_probable_test: true }),
    school('nor', null, 5),
    school('dur', 'Durbeen', 4),
  ],
  coachSchools: [
    pair('cA', 'bk1'), pair('cA', 'bk2'), // two schools, one region: once in B.K
    pair('cB', 'bk2'), pair('cB', 'sh1'), // two regions: in B.K and Sihala, once overall
    pair('cC', 'ur1'),
    pair('cD', 'off'), pair('cE', 'tst'), pair('cF', 'nor'), pair('cG', 'dur'), // only uncounted schools
    pair('cH', 'nowhere'), // a school the schools read did not return
  ],
};

describe('summarizeCoachingAnalytics', () => {
  it('returns exactly overview / regions / schools with the §3 key sets', () => {
    const out = summarizeCoachingAnalytics(ROWS);
    expect(Object.keys(out).sort()).toEqual(['overview', 'regions', 'schools']);
    expect(Object.keys(out.overview).sort()).toEqual(OVERVIEW_KEYS);
    for (const r of out.regions) expect(Object.keys(r).sort()).toEqual(REGION_KEYS);
    for (const s of out.schools) expect(Object.keys(s).sort()).toEqual(SCHOOL_KEYS);
  });

  it('lists exactly the six ICT regions, in order — no Unassigned bucket', () => {
    expect(REGION_BUCKETS).toEqual(SIX);
    expect(summarizeCoachingAnalytics(ROWS).regions.map((r) => r.region)).toEqual(SIX);
    expect(summarizeCoachingAnalytics({}).regions.map((r) => r.region)).toEqual(SIX);
  });

  it('per region: coaches, visits and schools visited', () => {
    const card = (r) => summarizeCoachingAnalytics(ROWS).regions.find((x) => x.region === r);
    expect(card('B.K')).toEqual({ region: 'B.K', coaches: 2, coachVisits: 3, schoolsVisited: 1 });
    expect(card('Sihala')).toEqual({ region: 'Sihala', coaches: 1, coachVisits: 2, schoolsVisited: 1 });
    expect(card('Urban-I')).toEqual({ region: 'Urban-I', coaches: 1, coachVisits: 1, schoolsVisited: 1 });
    for (const r of ['Nilore', 'Urban-II', 'Tarnol']) {
      expect(card(r)).toEqual({ region: r, coaches: 0, coachVisits: 0, schoolsVisited: 0 });
    }
  });

  it('a coach covering two regions counts in both cards but once in the overview', () => {
    const out = summarizeCoachingAnalytics(ROWS);
    // Cards: B.K {cA, cB}, Sihala {cB}, Urban-I {cC} → 4; distinct coaches: cA, cB, cC → 3.
    expect(out.regions.reduce((n, r) => n + r.coaches, 0)).toBe(4);
    expect(out.overview.coaches).toBe(3);
  });

  it('a coach whose only schools are not counted (inactive, test, no region, outside the six, unknown) is no coach here', () => {
    const only = summarizeCoachingAnalytics({
      schools: ROWS.schools,
      coachSchools: [pair('cD', 'off'), pair('cE', 'tst'), pair('cF', 'nor'), pair('cG', 'dur'), pair('cH', 'nowhere')],
    });
    expect(only.overview.coaches).toBe(0);
    for (const r of only.regions) expect(r.coaches).toBe(0);
  });

  it('inactive, probable-test, no-region and out-of-six schools are in no row, no card, no total', () => {
    const out = summarizeCoachingAnalytics(ROWS);
    expect(out.schools.map((s) => s.schoolId)).toEqual(['bk1', 'bk2', 'sh1', 'ur1']);
    expect(out.overview).toEqual({ coaches: 3, coachVisits: 6, schoolsVisited: 3 });
    expect(JSON.stringify(out)).not.toMatch(/Durbeen|School off|School tst|School nor|unassigned/i);
  });

  it('Σ school coachVisits = overview coachVisits = Σ region coachVisits; schoolsVisited sums the same way', () => {
    const out = summarizeCoachingAnalytics(ROWS);
    const sum = (xs, k) => xs.reduce((n, x) => n + x[k], 0);
    expect(sum(out.schools, 'coachVisits')).toBe(out.overview.coachVisits);
    expect(sum(out.regions, 'coachVisits')).toBe(out.overview.coachVisits);
    expect(sum(out.regions, 'schoolsVisited')).toBe(out.overview.schoolsVisited);
    expect(out.schools.filter((s) => s.coachVisits > 0)).toHaveLength(out.overview.schoolsVisited);
  });

  it('per school: its visits, emis as a string (or null), sorted by region order then name', () => {
    const out = summarizeCoachingAnalytics({
      schools: [
        school('z', 'Tarnol', 1, { name: 'Alpha', emis: 707 }),
        school('y', 'B.K', '4', { name: 'Zulu', emis: null }),
        school('x', 'b.k', null, { name: 'Bravo' }),
      ],
      coachSchools: [],
    });
    expect(out.schools).toEqual([
      { schoolId: 'x', emis: 'E-x', name: 'Bravo', region: 'B.K', coachVisits: 0 },
      { schoolId: 'y', emis: null, name: 'Zulu', region: 'B.K', coachVisits: 4 },
      { schoolId: 'z', emis: '707', name: 'Alpha', region: 'Tarnol', coachVisits: 1 },
    ]);
  });

  it('a region filter scopes overview + schools; regions[] is unchanged and the overview equals its card', () => {
    const all = summarizeCoachingAnalytics(ROWS);
    for (const b of SIX) {
      const f = summarizeCoachingAnalytics(ROWS, { region: b });
      expect(f.regions).toEqual(all.regions);
      const { region, ...card } = all.regions.find((r) => r.region === b);
      expect(f.overview).toEqual(card);
      expect(f.schools.every((s) => s.region === b)).toBe(true);
    }
    expect(summarizeCoachingAnalytics(ROWS, { region: 'B.K' }).schools.map((s) => s.schoolId)).toEqual(['bk1', 'bk2']);
  });

  it('an empty window gives zero visits and zero schools visited, never null — coaches are still counted', () => {
    const empty = summarizeCoachingAnalytics({
      schools: ROWS.schools.map((s) => ({ ...s, coach_visits: 0 })),
      coachSchools: ROWS.coachSchools,
    });
    expect(empty.overview).toEqual({ coaches: 3, coachVisits: 0, schoolsVisited: 0 });
    for (const s of empty.schools) expect(s.coachVisits).toBe(0);
  });

  it('copes with no rows at all: every count is 0, never null', () => {
    for (const rows of [{}, undefined, { schools: [], coachSchools: [] }]) {
      const out = summarizeCoachingAnalytics(rows);
      expect(out.overview).toEqual({ coaches: 0, coachVisits: 0, schoolsVisited: 0 });
      expect(out.schools).toEqual([]);
      for (const r of out.regions) expect([r.coaches, r.coachVisits, r.schoolsVisited]).toEqual([0, 0, 0]);
    }
  });

  it('carries no coach or teacher identity — only counts', () => {
    const s = JSON.stringify(summarizeCoachingAnalytics(ROWS));
    expect(s).not.toMatch(/"c[A-H]"|coach_id|coachId|user_id|userId|phone/);
  });
});

describe('loadCoachingAnalyticsRows — two set-based reads, no per-school loop', () => {
  function makeQuery() {
    const calls = [];
    const query = jest.fn(async (sql, params) => {
      calls.push({ sql, params });
      if (/FROM leader_schools/i.test(sql)) return { rows: ROWS.coachSchools };
      if (/FROM schools sch/i.test(sql)) return { rows: ROWS.schools };
      throw new Error(`unexpected SQL: ${sql}`);
    });
    return { query, calls };
  }
  const kind = (c) => (/FROM leader_schools/i.test(c.sql) ? 'coaches' : 'schools');
  const OCT = { from: '2026-10-01', to: '2026-10-13' };

  it('runs the schools(+visits) read and the coach read, and hands their rows back as they came', async () => {
    const { query, calls } = makeQuery();
    const rows = await loadCoachingAnalyticsRows(query, OCT);
    expect(calls.map(kind).sort()).toEqual(['coaches', 'schools']);
    expect(rows).toEqual({ schools: ROWS.schools, coachSchools: ROWS.coachSchools });
    // No per-school loop: no query is parameterised by a school id.
    for (const c of calls) expect(JSON.stringify(c.params || [])).not.toMatch(/bk1|sh1/);
  });

  it('visits: status done, dated by scheduled_for — a date column, so the Pakistan days themselves, both ends inclusive', async () => {
    const { query, calls } = makeQuery();
    await loadCoachingAnalyticsRows(query, OCT);
    const v = calls.find((c) => kind(c) === 'schools');
    expect(v.sql).toMatch(/FROM observation_schedules s/);
    expect(v.sql).toMatch(/s\.status = 'done'/);
    expect(v.sql).toMatch(/s\.scheduled_for >= \$1::date/);
    expect(v.sql).toMatch(/s\.scheduled_for <= \$2::date/);
    expect(v.params).toEqual(['2026-10-01', '2026-10-13']);
  });

  it('visits: school by school_id, else school_ext_id = niete:||emis; driven by schools, so an unmatched visit has no row', async () => {
    const { query, calls } = makeQuery();
    await loadCoachingAnalyticsRows(query, OCT);
    const sql = calls.find((c) => kind(c) === 'schools').sql;
    expect(sql).toMatch(/COALESCE\(s\.school_id, byemis\.id\) AS school_id/);
    expect(sql).toMatch(/s\.school_id IS NULL AND byemis\.emis IS NOT NULL AND s\.school_ext_id = 'niete:' \|\| byemis\.emis/);
    // Every school comes back (zeros included) and a visit joins on only through its school.
    expect(sql).toMatch(/FROM schools sch\s+LEFT JOIN \(/);
    expect(sql).toMatch(/\) v ON v\.school_id = sch\.id/);
    expect(sql).toMatch(/COALESCE\(v\.coach_visits, 0\)::int AS coach_visits/);
    expect(sql).toMatch(/sch\.is_active/);
    expect(sql).toMatch(/sch\.is_probable_test/);
    expect(sql).toMatch(/sch\.region/);
  });

  it('an open window passes no bounds at all; a half-open one passes only its end', async () => {
    let { query, calls } = makeQuery();
    await loadCoachingAnalyticsRows(query, { from: null, to: null });
    let v = calls.find((c) => kind(c) === 'schools');
    expect(v.params).toEqual([]);
    expect(v.sql).not.toMatch(/\$\d/);

    ({ query, calls } = makeQuery());
    await loadCoachingAnalyticsRows(query, { from: null, to: '2026-10-13' });
    v = calls.find((c) => kind(c) === 'schools');
    expect(v.params).toEqual(['2026-10-13']);
    expect(v.sql).toMatch(/s\.scheduled_for <= \$1::date/);
    expect(v.sql).not.toMatch(/>= \$/);

    ({ query, calls } = makeQuery());
    await loadCoachingAnalyticsRows(query, { from: '2026-10-01', to: null });
    v = calls.find((c) => kind(c) === 'schools');
    expect(v.params).toEqual(['2026-10-01']);
    expect(v.sql).toMatch(/s\.scheduled_for >= \$1::date/);
    expect(v.sql).not.toMatch(/<= \$/);
  });

  it('coaches: role coach, test users out, the leader-patch school match (school_id OR niete:||emis), distinct pairs — and no window', async () => {
    for (const range of [OCT, { from: null, to: null }]) {
      const { query, calls } = makeQuery();
      // eslint-disable-next-line no-await-in-loop
      await loadCoachingAnalyticsRows(query, range);
      const c = calls.find((x) => kind(x) === 'coaches');
      // leader-patch's `school_id = sch.id OR 'niete:'||emis = school_ext_id`, written as the
      // UNION of its two equi-joins (same pairs on prod, 91 ms → 4.5 ms); UNION de-duplicates.
      const branches = c.sql.split(/\bUNION\b/);
      expect(branches).toHaveLength(2);
      expect(c.sql).not.toMatch(/UNION ALL/);
      expect(branches[0]).toMatch(/JOIN schools sch ON sch\.id = lsch\.school_id/);
      expect(branches[1]).toMatch(/JOIN schools sch ON 'niete:' \|\| sch\.emis = lsch\.school_ext_id/);
      for (const b of branches) {
        expect(b).toMatch(/SELECT lsch\.leader_user_id AS coach_id, sch\.id AS school_id/);
        expect(b).toMatch(/FROM leader_schools lsch/);
        expect(b).toMatch(/JOIN users u ON u\.id = lsch\.leader_user_id/);
        expect(b).toMatch(/u\.role = 'coach'/);
        expect(b).toMatch(/u\.is_test_user IS NOT TRUE/);
      }
      expect(c.params).toEqual([]);
      expect(c.sql).not.toMatch(/\$\d|scheduled_for|created_at/);
    }
  });

  it('reads no coaching_sessions, lesson plans or training — the Coaching tab costs only its own two reads', async () => {
    const { query, calls } = makeQuery();
    await loadCoachingAnalyticsRows(query, OCT);
    expect(calls).toHaveLength(2);
    for (const c of calls) expect(c.sql).not.toMatch(/coaching_sessions|lesson_plans|niete_lp_opens|teacher_training_progress/);
  });
});

describe('the schools service is reused, not duplicated', () => {
  it('shares the region list and the region parser with /analytics/schools', () => {
    expect(REGION_BUCKETS).toBe(SchoolsAnalytics.REGION_BUCKETS);
    expect(typeof SchoolsAnalytics.bucketOf).toBe('function');
    expect(SchoolsAnalytics.bucketOf(' urban-ii ')).toBe('Urban-II');
    expect(SchoolsAnalytics.bucketOf('Durbeen')).toBeNull();
    expect(SchoolsAnalytics.bucketOf(null)).toBeNull();
  });
});
