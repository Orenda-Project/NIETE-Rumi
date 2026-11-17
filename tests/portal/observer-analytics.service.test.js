/**
 * bd-97daxo.33 — observers analytics: Moawin's human observations by WHO observed WHOM, scored on FICO17 v6.
 *
 * Moawin's head office (17 Nov): in Gilgit-Baltistan every FINISHED observation counts — FMO → teacher, FMO → principal,
 * principal → teacher — split by observer (principals primary, FMOs secondary), each school showing who observed
 * whom; FICO17 v6 is the main score, the V3 visits and the HOTS visits copied from old Rumi kept out of it.
 * The operator (17 Nov): name FMOs, principals by role only, never a teacher.
 *
 * The pure summariser over placed school rows (analytics-areas placeSchools: region = the area) and the loader's
 * three reads.
 */
const OA = require('../../dashboard/services/observer-analytics.service');

const AREAS = ['Gilgit', 'Baltistan', 'Area not set'];
const sch = (id, name, region, district, extra = {}) => ({
  id, name, emis: `E${id}`, region, district, is_active: true, is_probable_test: false, ...extra,
});
const SCHOOLS = [
  sch('g1', 'Warza Basin', 'Gilgit', 'Gilgit'),
  sch('g2', 'Harpandas', 'Gilgit', 'Diamer'),
  sch('b1', 'Nar Shigar', 'Baltistan', 'Shigar'),
  sch('b2', 'Qumra', 'Baltistan', 'Skardu'),
  sch('t1', 'GB Test Middle', 'Baltistan', 'Skardu', { is_probable_test: true }),
];
const ROSTER = [
  { school_id: 'g1', teachers: 6, principals: 1 }, { school_id: 'g2', teachers: 6, principals: 1 },
  { school_id: 'b1', teachers: 10, principals: 1 }, { school_id: 'b2', teachers: 10, principals: 2 },
  { school_id: 't1', teachers: 3, principals: 1 },
];

let n = 0;
const visit = (school_id, observer, observed, rubric, extra = {}) => {
  n += 1;
  return {
    id: `v${n}`,
    user_id: extra.user_id || `${observed}-${school_id}-${n}`,
    school_id,
    observed_role: observed,
    observed_test: false,
    observer_user_id: extra.observer_user_id || (observer === 'coach' ? 'fmo-1' : `pr-${school_id}`),
    observer_role: observer,
    observer_test: false,
    observer_name: observer === 'coach' ? (extra.observer_name || 'Rafiq Testwala') : null,
    status: extra.status || 'observer_review_complete',
    framework: rubric === 'v6' ? 'fico17_v6' : rubric === 'v3' ? 'fico' : rubric === 'hots' ? 'hots' : rubric === 'fde' ? 'obs612-msci-v1' : rubric,
    created_at: extra.created_at || '2026-11-12T05:00:00.000Z',
    ...extra,
  };
};
const v6Score = (pct, c, d, f) => ({
  scores: { rubric: 'fico17_v6', overall_percentage: pct, overall_marks: 1, overall_max_marks: 2 },
  c_score: String(c[0]), c_max: String(c[1]), d_score: String(d[0]), d_max: String(d[1]), f_score: String(f[0]), f_max: String(f[1]),
});
const v3Score = (marks, max) => ({ scores: { overall_marks: marks, overall_max_marks: max } });

function fixture() {
  n = 0;
  const sessions = [
    // Gilgit: Warza Basin — FMO → teacher on v6 ×2, a copied HOTS visit
    visit('g1', 'coach', 'teacher', 'v6', { created_at: '2026-11-17T05:43:00Z' }),
    visit('g1', 'coach', 'teacher', 'v6', { created_at: '2026-11-17T06:34:00Z', observer_user_id: 'fmo-2', observer_name: '  Zara   Testwala ' }),
    visit('g1', 'coach', 'teacher', 'hots', { created_at: '2026-11-04T11:20:00Z' }),
    // Gilgit: Harpandas — FMO → principal on V3, FMO → teacher on V3
    visit('g2', 'coach', 'principal', 'v3', { created_at: '2026-11-13T05:30:00Z' }),
    visit('g2', 'coach', 'teacher', 'v3', { created_at: '2026-11-11T07:21:00Z' }),
    // Baltistan: Nar Shigar — principal → teacher HOTS ×2 (same teacher), FMO → teacher v6, an FDE 6-8 tool visit
    visit('b1', 'principal', 'teacher', 'hots', { user_id: 'tch-b1', created_at: '2026-11-05T05:08:00Z' }),
    visit('b1', 'principal', 'teacher', 'hots', { user_id: 'tch-b1', created_at: '2026-11-05T05:45:00Z' }),
    visit('b1', 'coach', 'teacher', 'v6', { created_at: '2026-11-17T14:33:00Z' }),
    visit('b1', 'coach', 'teacher', 'fde', { created_at: '2026-11-17T06:45:00Z' }),
    // waiting for review: counted apart, never as an observation
    visit('b2', 'principal', 'teacher', 'v6', { status: 'awaiting_observer_review' }),
    visit('b2', 'coach', 'principal', 'v6', { status: 'awaiting_observer_review' }),
    // out: a test school, a test observed user, a test observer, an observed coach
    visit('t1', 'principal', 'principal', 'v6'),
    visit('b2', 'coach', 'teacher', 'v6', { observed_test: true }),
    visit('b2', 'coach', 'teacher', 'v6', { observer_test: true }),
    visit('b2', 'coach', 'coach', 'v6'),
  ];
  const scores = new Map([
    ['v1', v6Score(67.6, [14, 20], [3, 8], [12, 16])],
    ['v2', v6Score(55.9, [10, 20], [4, 8], [8, 16])],
    ['v3', { scores: { overall_marks: 36, overall_max_marks: 48 } }], // a HOTS score: never a FICO number
    ['v4', v3Score(80, 100)],
    ['v5', v3Score(52, 100)],
    ['v6', { scores: { overall_marks: 9, overall_max_marks: 48 } }],
    ['v7', { scores: { overall_marks: 13, overall_max_marks: 48 } }],
    ['v8', v6Score(52.9, [9, 20], [2, 8], [7, 16])],
    ['v9', { scores: { rubric: 'obs612-msci-v1', overall_percentage: 70 } }],
  ]);
  return { schools: SCHOOLS, roster: ROSTER, sessions, scores };
}

describe('summarizeObserverAnalytics', () => {
  const out = OA.summarizeObserverAnalytics(fixture(), { regions: AREAS });

  test('every finished visit counts, whoever was observed; waiting-for-review, test and non-teacher/principal rows do not', () => {
    expect(out.overview.observations).toBe(9);
    expect(out.overview.schools).toBe(4);
  });

  test('by observer (principals first) and who observed whom', () => {
    expect(out.overview.byObserver).toEqual({ principal: 2, fmo: 7, other: 0 });
    expect(out.overview.pairs).toEqual({
      principalTeacher: 2, principalPrincipal: 0, fmoTeacher: 6, fmoPrincipal: 1, otherTeacher: 0, otherPrincipal: 0,
    });
    expect(out.overview.observers).toEqual({ principal: 1, fmo: 2 });
    expect(out.overview.awaitingReview).toEqual({ principal: 1, fmo: 1, other: 0 });
  });

  test('people observed against the roster: teachers and principals', () => {
    expect(out.overview.teachersObserved).toBe(7);
    expect(out.overview.principalsObserved).toBe(1);
    expect(out.overview.teachers).toBe(32);
    expect(out.overview.principals).toBe(5);
  });

  test('FICO17 v6 is the main score, its sections C / D / F; V3, HOTS and FDE 6-8 visits counted apart', () => {
    const avg = (...xs) => Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10;
    expect(out.overview.v6).toEqual({
      avg: avg(67.6, 55.9, 52.9), n: 3,
      sections: { c: { avg: avg(70, 50, 45), n: 3 }, d: { avg: avg(37.5, 50, 25), n: 3 }, f: { avg: avg(75, 50, 43.75), n: 3 } },
    });
    expect(out.overview.v3).toEqual({ avg: 66, n: 2 });
    expect(out.overview.hots).toBe(3);
    expect(out.overview.fde612).toBe(1);
    expect(out.overview.unscored).toBe(0);
  });

  test('areas: each with its own numbers, summing to the whole; empty areas are still listed', () => {
    expect(out.regions.map((r) => r.region)).toEqual(AREAS);
    const [gil, bal, none] = out.regions;
    expect([gil.observations, bal.observations, none.observations]).toEqual([5, 4, 0]);
    expect(gil.byObserver).toEqual({ principal: 0, fmo: 5, other: 0 });
    expect(bal.byObserver).toEqual({ principal: 2, fmo: 2, other: 0 });
    expect(gil.v6.n).toBe(2);
    expect(bal.v6).toEqual({ avg: 52.9, n: 1, sections: { c: { avg: 45, n: 1 }, d: { avg: 25, n: 1 }, f: { avg: 43.8, n: 1 } } });
    expect(gil.schools).toBe(2);
    expect(bal.schools).toBe(2);
    expect(none.v6).toEqual({ avg: null, n: 0, sections: { c: { avg: null, n: 0 }, d: { avg: null, n: 0 }, f: { avg: null, n: 0 } } });
    expect(out.overview.areasActive).toBe(2);
  });

  test('each school: who observed whom, visit by visit — FMOs by name, principals by role, teachers never', () => {
    const warza = out.schools.find((s) => s.schoolId === 'g1');
    expect(warza).toMatchObject({ name: 'Warza Basin', emis: 'Eg1', region: 'Gilgit', district: 'Gilgit', observations: 3, teachers: 6, principals: 1 });
    expect(warza.visits).toEqual([
      { date: '2026-11-04', observer: 'fmo', observerName: 'Rafiq Testwala', observed: 'teacher', rubric: 'hots', pct: null },
      { date: '2026-11-17', observer: 'fmo', observerName: 'Rafiq Testwala', observed: 'teacher', rubric: 'v6', pct: 67.6 },
      { date: '2026-11-17', observer: 'fmo', observerName: 'Zara Testwala', observed: 'teacher', rubric: 'v6', pct: 55.9 },
    ]);
    const nar = out.schools.find((s) => s.schoolId === 'b1');
    expect(nar.visits.map((v) => [v.observer, v.observerName, v.observed, v.rubric])).toEqual([
      ['principal', null, 'teacher', 'hots'], ['principal', null, 'teacher', 'hots'],
      ['fmo', 'Rafiq Testwala', 'teacher', 'fde612'], ['fmo', 'Rafiq Testwala', 'teacher', 'v6'],
    ]);
    // the same teacher twice is one teacher observed: tch-b1 (twice) and the two FMO visits' teachers
    expect(nar.teachersObserved).toBe(3);
    expect(nar.pairs.principalTeacher).toBe(2);
    // Pakistan day: 14:33Z on the 17th is 19:33 PKT, still the 17th; a visit's day is never UTC's
    expect(nar.visits[3].date).toBe('2026-11-17');
    const json = JSON.stringify(out);
    expect(json).not.toMatch(/tch-b1|teacher-g1|pr-b1|fmo-1|fmo-2/);
  });

  test('a school with no visit still has its row (0, empty list); a test school has none', () => {
    const qumra = out.schools.find((s) => s.schoolId === 'b2');
    expect(qumra).toMatchObject({ observations: 0, visits: [] });
    expect(qumra.awaitingReview).toEqual({ principal: 1, fmo: 1, other: 0 });
    expect(out.schools.find((s) => s.schoolId === 't1')).toBeUndefined();
  });

  test('a visit day in Pakistan time: 20:00Z is the next day', () => {
    const f = fixture();
    f.sessions = [visit('g1', 'coach', 'teacher', 'v3', { created_at: '2026-11-11T20:00:00Z' })];
    f.scores = new Map([[f.sessions[0].id, v3Score(1, 2)]]);
    const out1 = OA.summarizeObserverAnalytics(f, { regions: AREAS });
    expect(out1.schools.find((x) => x.schoolId === 'g1').visits[0].date).toBe('2026-11-12');
  });

  test('the area filter scopes the overview and the schools; the area cards always carry every area', () => {
    const bal = OA.summarizeObserverAnalytics(fixture(), { regions: AREAS, region: 'Baltistan' });
    expect(bal.overview.observations).toBe(4);
    expect(bal.overview.schools).toBe(2);
    expect(bal.schools.map((s) => s.schoolId).sort()).toEqual(['b1', 'b2']);
    expect(bal.regions.map((r) => r.observations)).toEqual([5, 4, 0]);
    expect(bal.overview.areasActive).toBe(1);
  });

  test('an observer neither principal nor coach is "other", still counted', () => {
    const f = fixture();
    f.sessions = [visit('g1', 'admin', 'teacher', 'v6')];
    f.scores = new Map([[f.sessions[0].id, v6Score(60, [1, 2], [1, 2], [1, 2])]]);
    const o = OA.summarizeObserverAnalytics(f, { regions: AREAS }).overview;
    expect(o.byObserver).toEqual({ principal: 0, fmo: 0, other: 1 });
    expect(o.pairs.otherTeacher).toBe(1);
  });

  test('nothing at all: zeros and nulls, never a missing key', () => {
    const o = OA.summarizeObserverAnalytics({}, { regions: AREAS });
    expect(o.overview).toMatchObject({ observations: 0, schools: 0, teachers: 0, principals: 0, areasActive: 0, v3: { avg: null, n: 0 } });
    expect(o.schools).toEqual([]);
  });
});

describe('loadObserverAnalyticsRows', () => {
  test('three reads narrowed to the view\'s regions, then one score read of the finished visits only', async () => {
    const calls = [];
    const f = fixture();
    const query = async (sql, params) => {
      calls.push({ sql, params });
      if (/analysis_data/.test(sql)) {
        return { rows: params[0].map((id) => ({ id, ...(f.scores.get(id) || { scores: null }) })) };
      }
      if (/FROM coaching_sessions c/.test(sql)) return { rows: f.sessions };
      if (/count\(\*\) FILTER/.test(sql)) return { rows: f.roster };
      if (/FROM schools/.test(sql)) return { rows: f.schools };
      return { rows: [] };
    };
    const rows = await OA.loadObserverAnalyticsRows(query, { from: '2026-11-01', to: '2026-11-17' }, { regions: ['Gilgit-Baltistan'] });
    const sessionsCall = calls.find((c) => /FROM coaching_sessions c/.test(c.sql));
    expect(sessionsCall.sql).toMatch(/u\.role IN \('teacher', 'principal'\)/);
    expect(sessionsCall.sql).toMatch(/observation_type = 'leader_observation'/);
    expect(sessionsCall.sql).toMatch(/'awaiting_observer_review'/);
    // Pakistan days: 1 Nov 00:00 PKT is 31 Oct 19:00Z; the 17th runs to the 18th 00:00 PKT
    expect(sessionsCall.params).toEqual(['2026-10-31T19:00:00.000Z', '2026-11-17T19:00:00.000Z', ['Gilgit-Baltistan']]);
    for (const c of calls.filter((x) => !/analysis_data/.test(x.sql))) expect(c.params[c.params.length - 1]).toEqual(['Gilgit-Baltistan']);
    const scoreCall = calls.find((c) => /analysis_data/.test(c.sql));
    // waiting-for-review visits are never scored here
    expect(scoreCall.params[0]).not.toContain('v10');
    expect(scoreCall.params[0]).toContain('v1');
    expect(rows.scores.get('v1').scores.rubric).toBe('fico17_v6');
    expect(calls).toHaveLength(4);
  });

  test('regions are required: an area view is never read across every region', async () => {
    await expect(OA.loadObserverAnalyticsRows(async () => ({ rows: [] }), {}, {})).rejects.toThrow(/regions/);
  });
});
