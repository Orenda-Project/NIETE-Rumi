/**
 * Observations analytics (schools-analytics v7 Observations tab, bd-97x22y.5) — the pure
 * summariser and the row loader behind GET /api/portal/analytics/observations.
 *
 * Her ICT dashboard's Observations tab, 1 to 1 (PLAN v7 "Observations"): for each kind — Human
 * and Digital Coach — the OBSERVATION SUMMARY (observations, teachers observed, sectors active),
 * the FICO SCORE BREAKDOWN (Section B LP Fidelity, C Teaching Practices, D Engagement), the same
 * per sector and per school. Her section score is a per-observation share of the section's marks
 * (sync_observations.py:157-159); ours is the session's own domain, points-pooled (steps-grid
 * pooledPct), with NIETE's rule that a section marked `assessed: false` is not scored
 * (fico-framework.js:796, 847 — no lesson plan, no Section B).
 *
 * Averaging, as hers (operator, 2026-10-15: "follow HER rule for the sections ported"): a school's
 * and the overview's section score average their observations (her Avg over observations,
 * views.py ObservationsView type_summary / school_stats); a SECTOR's is the mean of its schools'
 * averages, each school with a score counting once (views.py:2300-2330). n stays the observations
 * scored at every level, so Section B's smaller base is visible.
 *
 *   B = lesson_plan_fidelity · C = high_leverage_practices · D = student_engagement
 *   (teacher_subject_knowledge is not in her rubric and is not shown)
 *
 * The domains live in the ~23 KB analysis_data, so they ride the SAME per-session memo read as
 * the overall score (schools-analytics.service): one analysis_data read per session per
 * process, reduced to six numbers in SQL — never the ~25 KB domains object to Node.
 */

const {
  summarizeObservationsAnalytics,
  loadObservationsAnalyticsRows,
  REGION_BUCKETS,
} = require('../../dashboard/services/observations-analytics.service');
const SchoolsAnalytics = require('../../dashboard/services/schools-analytics.service');
const { FICO_SECTIONS, sectionPct, pooledPct } = require('../../dashboard/services/steps-grid.service');

const SIX = ['B.K', 'Sihala', 'Urban-I', 'Nilore', 'Urban-II', 'Tarnol'];
const SECTION_KEYS = ['sectionB', 'sectionBN', 'sectionC', 'sectionCN', 'sectionD', 'sectionDN'];
const OVERVIEW_KEYS = ['observations', 'schools', 'sectorsActive', 'teachersObserved', ...SECTION_KEYS].sort();
const REGION_KEYS = ['observations', 'region', 'schools', 'teachersObserved', ...SECTION_KEYS].sort();
const SCHOOL_KEYS = ['emis', 'name', 'observations', 'region', 'schoolId', 'teachersObserved', ...SECTION_KEYS].sort();

const school = (id, region, extra = {}) => ({
  id, name: `School ${id}`, emis: `E-${id}`, region, is_active: true, is_probable_test: false, ...extra,
});
// A counted session as the loader hands it over: its kind, and its three section scores (null = not scored).
const dc = (id, schoolId, userId, [b, c, d], extra = {}) => ({
  id, school_id: schoolId, user_id: userId, is_test: false, observation_type: null, sections: { b, c, d }, ...extra,
});
const human = (id, schoolId, userId, secs, extra = {}) => dc(id, schoolId, userId, secs, { observation_type: 'leader_observation', ...extra });

function fixture() {
  return {
    schools: [
      school('bk1', 'B.K'),
      school('bk2', 'B.K'),
      school('sh1', 'Sihala'),
      school('ur1', 'Urban-I'),
      // Left out of everything: inactive, probable test, no region, outside the six.
      school('off', 'B.K', { is_active: false }),
      school('tst', 'Sihala', { is_probable_test: true }),
      school('nor', null),
      school('dur', 'Durbeen'),
    ],
    sessions: [
      dc('d1', 'bk1', 't1', [60, 70, 80]),
      dc('d2', 'bk1', 't1', [null, 50, 40]), // B not assessed (no lesson plan): C and D still scored
      dc('d3', 'bk1', 't2', [80, 90, 100]),
      dc('d4', 'bk2', 't3', [40, 30, 20]),
      dc('d5', 'sh1', 't4', [null, null, null]), // nothing scored: counted, never a 0
      human('h1', 'bk1', 't1', [70, 60, 50]), // t1 also had DC observations: observed in both kinds
      human('h2', 'sh1', 't5', [90, 80, 70]),
      human('h3', 'sh1', 't5', [null, 70, 60]),
      // Out: a test teacher, an uncounted school, an unknown school, another kind of session.
      dc('x1', 'bk1', 'tx', [0, 0, 0], { is_test: true }),
      human('x2', 'bk1', 'tx', [0, 0, 0], { is_test: true }),
      dc('x3', 'off', 't8', [0, 0, 0]),
      dc('x4', 'dur', 't9', [0, 0, 0]),
      human('x5', 'nor', 't9', [0, 0, 0]),
      dc('x6', 'ghost', 't9', [0, 0, 0]),
      dc('x7', 'bk1', 't1', [0, 0, 0], { observation_type: 'something_else' }),
    ],
  };
}

describe('steps-grid: the FICO sections her tab shows', () => {
  it('B / C / D are LP Fidelity, Teaching Practices and Engagement — not subject knowledge', () => {
    expect(FICO_SECTIONS).toEqual({ b: 'lesson_plan_fidelity', c: 'high_leverage_practices', d: 'student_engagement' });
    expect(Object.values(FICO_SECTIONS)).not.toContain('teacher_subject_knowledge');
  });

  it('a section is its points-pooled percentage (pooledPct)', () => {
    const domains = { student_engagement: { domain_score: 21, domain_max: 28 } };
    expect(sectionPct(domains, 'student_engagement')).toBe(75);
    expect(sectionPct(domains, 'student_engagement')).toBe(pooledPct(domains, ['student_engagement']));
  });

  it('a section marked assessed:false is NOT scored, though its proxy score is still stamped (fico-framework.js:796)', () => {
    const domains = { lesson_plan_fidelity: { assessed: false, domain_score: 26, domain_max: 40, not_assessed_reason: 'fidelity_unavailable' } };
    expect(sectionPct(domains, 'lesson_plan_fidelity')).toBeNull();
    expect(sectionPct({ lesson_plan_fidelity: { assessed: true, domain_score: 25, domain_max: 40 } }, 'lesson_plan_fidelity')).toBe(62.5);
  });

  it('no domain, no max, or no domains at all is no score — never a 0', () => {
    expect(sectionPct({}, 'student_engagement')).toBeNull();
    expect(sectionPct({ student_engagement: { domain_score: 0, domain_max: 0 } }, 'student_engagement')).toBeNull();
    expect(sectionPct(null, 'student_engagement')).toBeNull();
    expect(sectionPct({ student_engagement: { domain_score: 0, domain_max: 28 } }, 'student_engagement')).toBe(0);
  });
});

describe('summarizeObservationsAnalytics', () => {
  const out = summarizeObservationsAnalytics(fixture());
  const card = (kind, r) => out[kind].regions.find((x) => x.region === r);
  const row = (kind, id) => out[kind].schools.find((x) => x.schoolId === id);

  it('returns exactly dc / human, each overview / regions / schools with the v7 key sets', () => {
    expect(Object.keys(out).sort()).toEqual(['dc', 'human']);
    for (const kind of ['dc', 'human']) {
      expect(Object.keys(out[kind]).sort()).toEqual(['overview', 'regions', 'schools']);
      expect(Object.keys(out[kind].overview).sort()).toEqual(OVERVIEW_KEYS);
      for (const r of out[kind].regions) expect(Object.keys(r).sort()).toEqual(REGION_KEYS);
      for (const s of out[kind].schools) expect(Object.keys(s).sort()).toEqual(SCHOOL_KEYS);
    }
  });

  it('lists exactly the six ICT regions, in order, for both kinds — no Unassigned', () => {
    expect(REGION_BUCKETS).toBe(SchoolsAnalytics.REGION_BUCKETS);
    for (const kind of ['dc', 'human']) {
      expect(out[kind].regions.map((r) => r.region)).toEqual(SIX);
      expect(summarizeObservationsAnalytics({})[kind].regions.map((r) => r.region)).toEqual(SIX);
    }
    expect(JSON.stringify(out)).not.toMatch(/unassigned/i);
  });

  it('DC = observation_type null; Human = leader_observation; any other kind is neither', () => {
    expect(out.dc.overview.observations).toBe(5);
    expect(out.human.overview.observations).toBe(3);
  });

  it('per school: observations, distinct teachers observed, and each section pooled with its own n', () => {
    expect(row('dc', 'bk1')).toEqual({
      schoolId: 'bk1', emis: 'E-bk1', name: 'School bk1', region: 'B.K',
      observations: 3, teachersObserved: 2,
      sectionB: 70, sectionBN: 2, // (60 + 80) / 2 — d2's unassessed B is not scored
      sectionC: 70, sectionCN: 3, // (70 + 50 + 90) / 3
      sectionD: 73.3, sectionDN: 3, // (80 + 40 + 100) / 3
    });
    expect(row('human', 'sh1')).toEqual({
      schoolId: 'sh1', emis: 'E-sh1', name: 'School sh1', region: 'Sihala',
      observations: 2, teachersObserved: 1,
      sectionB: 90, sectionBN: 1, sectionC: 75, sectionCN: 2, sectionD: 65, sectionDN: 2,
    });
  });

  it('an observation with nothing scored is counted, and a section with n 0 is null — never a 0', () => {
    expect(row('dc', 'sh1')).toEqual({
      schoolId: 'sh1', emis: 'E-sh1', name: 'School sh1', region: 'Sihala',
      observations: 1, teachersObserved: 1,
      sectionB: null, sectionBN: 0, sectionC: null, sectionCN: 0, sectionD: null, sectionDN: 0,
    });
    expect(row('human', 'ur1')).toEqual({
      schoolId: 'ur1', emis: 'E-ur1', name: 'School ur1', region: 'Urban-I',
      observations: 0, teachersObserved: 0,
      sectionB: null, sectionBN: 0, sectionC: null, sectionCN: 0, sectionD: null, sectionDN: 0,
    });
  });

  it('a sector\'s section score is HER rule: the mean of its schools\' averages, each school once; n is still the observations scored', () => {
    // B.K DC: bk1 B {60, 80} → 70, bk2 B {40} → 40 ⇒ (70 + 40) / 2 = 55, not the pooled 180 / 3 = 60.
    // C: bk1 70, bk2 30 ⇒ 50. D: bk1 220 / 3 = 73.33…, bk2 20 ⇒ 46.7 (unrounded school averages).
    expect(card('dc', 'B.K')).toEqual({
      region: 'B.K', schools: 2, observations: 4, teachersObserved: 3,
      sectionB: 55, sectionBN: 3, sectionC: 50, sectionCN: 4, sectionD: 46.7, sectionDN: 4,
    });
    // A school with no score for a section is not in that section's mean (bk2 had no human observation).
    expect(card('human', 'B.K')).toEqual({
      region: 'B.K', schools: 2, observations: 1, teachersObserved: 1,
      sectionB: 70, sectionBN: 1, sectionC: 60, sectionCN: 1, sectionD: 50, sectionDN: 1,
    });
  });

  it('a sector whose schools have no score for a section reads null for it, never 0', () => {
    expect(card('dc', 'Sihala')).toEqual({
      region: 'Sihala', schools: 1, observations: 1, teachersObserved: 1,
      sectionB: null, sectionBN: 0, sectionC: null, sectionCN: 0, sectionD: null, sectionDN: 0,
    });
  });

  it('the overview: totals, distinct teachers, sectors active — and sections POOLED over the observations (her FICO breakdown)', () => {
    expect(out.dc.overview).toEqual({
      schools: 4, observations: 5, teachersObserved: 4, sectorsActive: 2,
      sectionB: 60, sectionBN: 3, sectionC: 60, sectionCN: 4, sectionD: 60, sectionDN: 4,
    });
    expect(out.human.overview).toEqual({
      schools: 4, observations: 3, teachersObserved: 2, sectorsActive: 2,
      sectionB: 80, sectionBN: 2, sectionC: 70, sectionCN: 3, sectionD: 60, sectionDN: 3,
    });
  });

  it('a teacher observed in both kinds counts once in each, and never twice within one', () => {
    // t1: 2 DC sessions + 1 human at bk1.
    expect(row('dc', 'bk1').teachersObserved).toBe(2);
    expect(row('human', 'bk1').teachersObserved).toBe(1);
  });

  it('test teachers, uncounted schools (inactive, test, no region, outside the six), unknown schools and other kinds are in no number', () => {
    expect(out.dc.schools.map((s) => s.schoolId)).toEqual(['bk1', 'bk2', 'sh1', 'ur1']);
    expect(out.human.schools.map((s) => s.schoolId)).toEqual(['bk1', 'bk2', 'sh1', 'ur1']);
    expect(JSON.stringify(out)).not.toMatch(/Durbeen|School off|School tst|School nor/);
    const withoutJunk = summarizeObservationsAnalytics({
      schools: fixture().schools,
      sessions: fixture().sessions.filter((s) => !s.id.startsWith('x')),
    });
    expect(withoutJunk).toEqual(out);
  });

  it('Σ school observations = region = overview, for both kinds', () => {
    for (const kind of ['dc', 'human']) {
      const sum = (xs) => xs.reduce((n, x) => n + x.observations, 0);
      expect(sum(out[kind].schools)).toBe(out[kind].overview.observations);
      expect(sum(out[kind].regions)).toBe(out[kind].overview.observations);
    }
  });

  it('a region filter scopes overview + schools; regions[] is unchanged; the overview\'s counts equal its card; sectors active is that one or none', () => {
    const COUNTS = ['schools', 'observations', 'teachersObserved', 'sectionBN', 'sectionCN', 'sectionDN'];
    const pick = (o) => Object.fromEntries(COUNTS.map((k) => [k, o[k]]));
    for (const b of SIX) {
      const f = summarizeObservationsAnalytics(fixture(), { region: b });
      for (const kind of ['dc', 'human']) {
        expect(f[kind].regions).toEqual(out[kind].regions);
        const c = out[kind].regions.find((r) => r.region === b);
        expect(pick(f[kind].overview)).toEqual(pick(c));
        expect(f[kind].overview.sectorsActive).toBe(c.observations > 0 ? 1 : 0);
        expect(f[kind].schools.every((s) => s.region === b)).toBe(true);
      }
    }
    // Hers too: with a sector chosen, the FICO breakdown stays pooled over its observations while the card
    // averages its schools — B.K DC: 60 on top, 55 on the card.
    const bk = summarizeObservationsAnalytics(fixture(), { region: 'B.K' });
    expect(bk.dc.overview.sectionB).toBe(60);
    expect(bk.dc.regions.find((r) => r.region === 'B.K').sectionB).toBe(55);
  });

  it('per school: emis as a string (or null), sorted by region order then name', () => {
    const o = summarizeObservationsAnalytics({
      schools: [
        school('z', 'Tarnol', { name: 'Alpha', emis: 707 }),
        school('y', 'B.K', { name: 'Zulu', emis: null }),
        school('x', 'b.k', { name: 'Bravo' }),
      ],
      sessions: [],
    });
    expect(o.dc.schools.map((s) => [s.schoolId, s.emis, s.region])).toEqual([['x', 'E-x', 'B.K'], ['y', null, 'B.K'], ['z', '707', 'Tarnol']]);
  });

  it('copes with no rows at all: counts 0, sections null', () => {
    for (const rows of [{}, undefined, { schools: [], sessions: [] }]) {
      const o = summarizeObservationsAnalytics(rows);
      for (const kind of ['dc', 'human']) {
        expect(o[kind].overview).toEqual({
          schools: 0, observations: 0, teachersObserved: 0, sectorsActive: 0,
          sectionB: null, sectionBN: 0, sectionC: null, sectionCN: 0, sectionD: null, sectionDN: 0,
        });
        expect(o[kind].schools).toEqual([]);
      }
    }
  });

  it('carries no teacher identity — counts and school names only', () => {
    const s = JSON.stringify(out);
    for (const t of ['t1', 't2', 't3', 't4', 't5', 'tx', 't8', 't9']) expect(s).not.toContain(`"${t}"`);
    expect(s).not.toMatch(/user_?id|teacherName|phone|"d1"|"h1"/i);
  });
});

describe('loadObservationsAnalyticsRows — two set-based reads, scores and sections from the shared memo', () => {
  const SESSIONS = [
    { id: 'c1', updated_at: '2026-10-02T10:00:00Z', user_id: 't1', school_id: 's1', is_test: false, observation_type: null },
    { id: 'c2', updated_at: '2026-10-03T10:00:00Z', user_id: 't3', school_id: 's1', is_test: false, observation_type: 'leader_observation' },
  ];
  const SCORES = {
    c1: { overall_marks: 60, overall_max_marks: 100 },
    c2: { overall_marks: 45, overall_max_marks: 90, overall_percentage: 50 },
  };
  // What the score read keeps of each session's domains: three fields per section, nothing else —
  // handed back as text columns <section>_<field>, as Postgres' #>> returns them (cols below).
  const DOMAINS = {
    c1: {
      lesson_plan_fidelity: { domain_score: 26, domain_max: 40, assessed: false },
      high_leverage_practices: { domain_score: 32, domain_max: 48, assessed: null },
      student_engagement: { domain_score: 21, domain_max: 28, assessed: null },
    },
    c2: {
      lesson_plan_fidelity: { domain_score: 30, domain_max: 40, assessed: true },
      high_leverage_practices: { domain_score: 24, domain_max: 48, assessed: null },
      student_engagement: { domain_score: null, domain_max: null, assessed: null },
    },
  };
  const SCHOOLS = [school('s1', 'B.K')];
  const text = (v) => (v === null || v === undefined ? null : String(v));
  const cols = (d) => Object.fromEntries(Object.entries(FICO_SECTIONS).flatMap(([k, key]) => [
    [`${k}_score`, text(d[key].domain_score)], [`${k}_max`, text(d[key].domain_max)], [`${k}_assessed`, text(d[key].assessed)],
  ]));

  function makeQuery(sessions = SESSIONS, { slowScores } = {}) {
    const calls = [];
    const query = jest.fn(async (sql, params) => {
      calls.push({ sql, params });
      if (/'scores'/.test(sql)) {
        if (slowScores) await slowScores;
        return { rows: params[0].map((id) => ({ id, updated_at: sessions.find((s) => s.id === id).updated_at, scores: SCORES[id], ...cols(DOMAINS[id]) })) };
      }
      if (/FROM schools/i.test(sql)) return { rows: SCHOOLS };
      if (/FROM coaching_sessions c/i.test(sql)) return { rows: sessions };
      throw new Error(`unexpected SQL: ${sql}`);
    });
    return { query, calls };
  }
  const kind = (c) => (/'scores'/.test(c.sql) ? 'scores' : /FROM schools/i.test(c.sql) ? 'schools' : 'sessions');
  const OCT = { from: '2026-10-01', to: '2026-10-13' };

  it('runs the schools read and the counted-sessions read, plus one score read for the sessions the memo lacks', async () => {
    const { query, calls } = makeQuery();
    const rows = await loadObservationsAnalyticsRows(query, OCT, { memo: SchoolsAnalytics.createScoreMemo() });
    expect(calls.map(kind).sort()).toEqual(['schools', 'scores', 'sessions']);
    for (const c of calls) expect(JSON.stringify(c.params || [])).not.toContain('"s1"');
    expect(rows.schools).toEqual(SCHOOLS);
    expect(rows.sessions).toEqual([
      { id: 'c1', school_id: 's1', user_id: 't1', is_test: false, observation_type: null, sections: { b: null, c: 66.7, d: 75 } },
      { id: 'c2', school_id: 's1', user_id: 't3', is_test: false, observation_type: 'leader_observation', sections: { b: 75, c: 50, d: null } },
    ]);
  });

  it('the schools read is light: no roster, no LP opens, no training, no visits', async () => {
    const { query, calls } = makeQuery();
    await loadObservationsAnalyticsRows(query, OCT, { memo: SchoolsAnalytics.createScoreMemo() });
    const sql = calls.find((c) => kind(c) === 'schools').sql;
    expect(sql).toMatch(/SELECT id, name, emis, region, is_active, is_probable_test\s+FROM schools\s*$/);
    expect(sql).not.toMatch(/users|niete_lp_opens|teacher_training_progress|observation_schedules|coaching_sessions/);
    expect(calls.find((c) => kind(c) === 'schools').params || []).toEqual([]);
  });

  it('counted sessions by the schools-analytics rule: DC completed, human terminal, window on created_at', async () => {
    const { query, calls } = makeQuery();
    await loadObservationsAnalyticsRows(query, OCT, { memo: SchoolsAnalytics.createScoreMemo() });
    const s = calls.find((c) => kind(c) === 'sessions');
    expect(s.sql).toMatch(/observation_type IS NULL AND c\.status = 'completed'/);
    expect(s.sql).toMatch(/observation_type = 'leader_observation' AND c\.status IN \('completed', 'observer_review_complete'\)/);
    expect(s.sql).toMatch(/c\.created_at >= \$1::timestamptz/);
    expect(s.params).toEqual(['2026-09-30T19:00:00.000Z', '2026-10-13T19:00:00.000Z']);
  });

  it('the score read opens analysis_data ONCE per row and reduces the three sections in SQL to nine text columns — never the whole domains object', async () => {
    const { query, calls } = makeQuery();
    await loadObservationsAnalyticsRows(query, OCT, { memo: SchoolsAnalytics.createScoreMemo() });
    const sql = calls.find((c) => kind(c) === 'scores').sql;
    expect(sql.match(/analysis_data/g)).toHaveLength(1);
    expect(sql).toMatch(/OFFSET 0/); // the detoasted value is computed once, below the projections that read it
    for (const key of Object.values(FICO_SECTIONS)) {
      for (const f of ['domain_score', 'domain_max', 'assessed']) expect(sql).toContain(`#>> '{domains,${key},${f}}'`);
    }
    for (const k of ['b', 'c', 'd']) for (const f of ['score', 'max', 'assessed']) expect(sql).toMatch(new RegExp(`AS ${k}_${f}\\b`));
    // No object is built per row: a jsonb object of nine fields cost +15% server time and twice the bytes on prod.
    expect(sql).not.toMatch(/jsonb_build_object|jsonb_build_array|row_to_json/);
    expect(sql).not.toMatch(/teacher_subject_knowledge|indicators/);
    expect(sql).not.toMatch(/->\s*'domains'/);
  });

  it('ONE memo for both routes: after the schools route read a session, the observations route reads no score at all', async () => {
    const memo = SchoolsAnalytics.createScoreMemo();
    const first = makeQuery();
    await SchoolsAnalytics.loadSchoolsAnalyticsRows(first.query, OCT, { memo });
    expect(first.calls.map(kind)).toContain('scores');
    const second = makeQuery();
    const rows = await loadObservationsAnalyticsRows(second.query, OCT, { memo });
    expect(second.calls.map(kind)).not.toContain('scores');
    expect(rows.sessions.map((s) => s.sections)).toEqual([{ b: null, c: 66.7, d: 75 }, { b: 75, c: 50, d: null }]);
  });

  it('and the other way round: the schools route then reads no score, and its answer is what it was', async () => {
    const memo = SchoolsAnalytics.createScoreMemo();
    await loadObservationsAnalyticsRows(makeQuery().query, OCT, { memo });
    const second = makeQuery();
    const rows = await SchoolsAnalytics.loadSchoolsAnalyticsRows(second.query, OCT, { memo });
    expect(second.calls.map(kind)).not.toContain('scores');
    // The schools loader's sessions keep their v6 shape exactly: no sections leak into /analytics/schools.
    expect(rows.sessions).toEqual([
      { id: 'c1', school_id: 's1', user_id: 't1', is_test: false, observation_type: null, pct: 60 },
      { id: 'c2', school_id: 's1', user_id: 't3', is_test: false, observation_type: 'leader_observation', pct: 50 },
    ]);
  });

  it('two routes cold at the same moment share ONE score read (no double heavy read)', async () => {
    const memo = SchoolsAnalytics.createScoreMemo();
    let release;
    const slowScores = new Promise((r) => { release = r; });
    const a = makeQuery(SESSIONS, { slowScores });
    const b = makeQuery(SESSIONS, { slowScores });
    const both = Promise.all([
      SchoolsAnalytics.loadSchoolsAnalyticsRows(a.query, OCT, { memo }),
      loadObservationsAnalyticsRows(b.query, OCT, { memo }),
    ]);
    await new Promise((r) => setImmediate(r));
    release();
    const [schoolsRows, obsRows] = await both;
    const scoreReads = [...a.calls, ...b.calls].filter((c) => kind(c) === 'scores');
    expect(scoreReads).toHaveLength(1);
    expect(scoreReads[0].params[0]).toEqual(['c1', 'c2']);
    expect(schoolsRows.sessions.map((s) => s.pct)).toEqual([60, 50]);
    expect(obsRows.sessions.map((s) => s.sections.c)).toEqual([66.7, 50]);
  });

  it('a changed row (new updated_at) is read again; an unchanged one is not', async () => {
    const memo = SchoolsAnalytics.createScoreMemo();
    await loadObservationsAnalyticsRows(makeQuery().query, { from: null, to: null }, { memo });
    const edited = [SESSIONS[0], { ...SESSIONS[1], updated_at: '2026-10-05T10:00:00Z' }];
    const again = makeQuery(edited);
    await loadObservationsAnalyticsRows(again.query, { from: null, to: null }, { memo });
    expect(again.calls.find((c) => kind(c) === 'scores').params[0]).toEqual(['c2']);
  });

  it('no sessions in the window: two reads, no score read', async () => {
    const { query, calls } = makeQuery([]);
    const rows = await loadObservationsAnalyticsRows(query, OCT, { memo: SchoolsAnalytics.createScoreMemo() });
    expect(calls).toHaveLength(2);
    expect(rows.sessions).toEqual([]);
  });
});
