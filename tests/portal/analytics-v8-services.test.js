/**
 * Schools analytics v8 (FDE feedback 2026-10-19), the services half: what the three lists change on each tab.
 *
 *   - dashboard/lib/analytics-lists.js — FDE's school list, the RDF teacher populations and the RDF coach roster,
 *     read from app_settings, resolved against live rows, cached, and FAIL-CLOSED: a missing list is null + a
 *     loud log, and the consumer keeps the v7 rule rather than showing zeros.
 *   - /analytics/schools: school base = FDE's list; teachers = the RDF populations by the RDF's sector, with a
 *     sector's school-less teachers on a "No school" row; "Lesson plans used" = the RDF's lp_use.
 *   - /analytics/coaching: coaches = the RDF roster (count, names, sectors); visits unchanged, on FDE schools.
 *   - /analytics/observations: FDE school base; sessions of the RDF populations, school-less ones on "No school".
 */

const Lists = require('../../dashboard/lib/analytics-lists');
const Schools = require('../../dashboard/services/schools-analytics.service');
const Coaching = require('../../dashboard/services/coaching-analytics.service');
const Observations = require('../../dashboard/services/observations-analytics.service');

const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const STORED = {
  schools: { asOf: '2026-10-19', emis: ['101', '102', '201', '999'] },
  teachers: {
    asOf: '2026-10-19',
    primary: { 'B.K': [U(1), U(2), U(3)], Sihala: [U(4), U(9)], Nowhere: [U(8)] },
    midHigh: { 'B.K': [U(5)], Sihala: [U(6), U(7)] },
  },
  coaches: {
    asOf: '2026-09-24',
    coaches: [
      { name: 'Saima Jabeen', sector: 'B.K', userIds: [U(50)] },
      { name: 'Mubasher Irfan', sector: 'Nilore', userIds: [U(51), U(52)] },
      { name: '  Abdul   Malik ', sector: 'Sihala', userIds: [] },
    ],
  },
};

const LIVE_USERS = new Map([
  [U(1), { role: 'teacher', teacher_level: ['PRIMARY'] }],
  [U(2), { role: 'teacher', teacher_level: ['PRIMARY', 'MIDDLE'] }],
  [U(3), { role: 'coach', teacher_level: ['PRIMARY'] }], // no longer a teacher: out
  [U(4), { role: 'teacher', teacher_level: ['PRIMARY'] }],
  [U(5), { role: 'teacher', teacher_level: ['HIGH'] }],
  [U(6), { role: 'teacher', teacher_level: ['MIDDLE'], deleted_at: '2026-10-01' }], // 6-12 drops deleted
  [U(7), { role: 'teacher', teacher_level: ['MIDDLE'] }],
  // U(9) gone from users: out
  [U(50), { role: 'coach' }],
  [U(51), { role: 'coach' }],
]);
const LIVE = { schoolEmis: new Set(['101', '102', '201', '301']), users: LIVE_USERS };

// ── /analytics/schools ───────────────────────────────────────────────────────

const LISTS = Lists.resolveLists(STORED, LIVE);
const school = (id, emis, region, extra = {}) => ({ id, name: `School ${id}`, emis, region, is_active: true, is_probable_test: false, ...extra });
const SCHOOL_ROWS = [
  school('s1', '101', 'B.K'),
  school('s2', '102', 'B.K'),
  school('s3', '201', 'Sihala'),
  school('s4', '301', 'Sihala'), // not on FDE's list: no row, no count
];

describe('summarizeSchoolsAnalytics v8 — FDE schools, RDF teachers, lesson plans used', () => {
  const rows = {
    schools: SCHOOL_ROWS,
    teachers: [
      { user_id: U(1), school_id: 's1', lps_used: 10, training_modules: 2 },
      { user_id: U(2), school_id: null, lps_used: 4, training_modules: 0 }, // no school → B.K "No school"
      { user_id: U(4), school_id: 's4', lps_used: 3, training_modules: 1 }, // off-list school → Sihala "No school"
      { user_id: U(5), school_id: 's3', lps_used: 1, training_modules: 0 }, // school in Sihala, RDF says B.K → B.K "No school"
      { user_id: U(7), school_id: 's3', lps_used: 0, training_modules: 5 },
      { user_id: U(99), school_id: 's1', lps_used: 50, training_modules: 9 }, // not in the population: in nothing
    ],
    sessions: [
      { id: 'c1', school_id: 's1', user_id: U(1), is_test: false, observation_type: null, pct: 60 },
      { id: 'c2', school_id: null, user_id: U(2), is_test: false, observation_type: 'leader_observation', pct: 80 },
      { id: 'c3', school_id: 's1', user_id: U(99), is_test: false, observation_type: null, pct: 10 },
    ],
  };
  const out = Schools.summarizeSchoolsAnalytics(rows, { lists: LISTS });

  it('school base = FDE list: 3 schools, the off-list one is nowhere', () => {
    expect(out.overview.schools).toBe(3);
    expect(out.schools.filter((s) => !s.noSchool).map((s) => s.schoolId)).toEqual(['s1', 's2', 's3']);
    expect(out.regions.find((r) => r.region === 'Sihala').schools).toBe(1);
  });

  it('teachers = the RDF populations by the RDF sector; sectors sum to the total', () => {
    expect(out.overview.teachers).toBe(5);
    const by = Object.fromEntries(out.regions.map((r) => [r.region, r.teachers]));
    expect(by['B.K']).toBe(3);
    expect(by.Sihala).toBe(2);
  });

  it('a school-less, off-list or other-sector teacher is on her RDF sector\'s "No school" row', () => {
    const bk = out.schools.find((s) => s.noSchool && s.region === 'B.K');
    const sih = out.schools.find((s) => s.noSchool && s.region === 'Sihala');
    expect(bk).toMatchObject({ schoolId: 'no-school:B.K', emis: null, name: null, teachers: 2, lpsUsed: 5, teachersUsedLp: 2, humanObservations: 1 });
    expect(sih).toMatchObject({ schoolId: 'no-school:Sihala', teachers: 1, lpsUsed: 3 });
    // the "No school" row is no school
    expect(out.regions.find((r) => r.region === 'B.K').schools).toBe(2);
    // rows sum to the overview
    expect(out.schools.reduce((n, s) => n + s.teachers, 0)).toBe(out.overview.teachers);
  });

  it('"Lesson plans used" (lpsUsed, old key lpsOpened kept) and "x of N"; activity of non-population teachers is in nothing', () => {
    expect(out.overview.lpsUsed).toBe(18);
    expect(out.overview.lpsOpened).toBe(18);
    expect(out.overview.teachersUsedLp).toBe(4);
    expect(out.overview.trainingModules).toBe(8);
    expect(out.overview.teachersTrained).toBe(3);
    expect(out.overview.dcObservations).toBe(1);
    expect(out.overview.avgFico).toBe(60);
  });

  it('a region filter scopes overview and schools (No-school row included)', () => {
    const f = Schools.summarizeSchoolsAnalytics(rows, { lists: LISTS, region: 'Sihala' });
    expect(f.overview.teachers).toBe(2);
    expect(f.schools.map((s) => s.schoolId)).toEqual(['s3', 'no-school:Sihala']);
  });

  it('teacher lists missing → the v7 roster, at FDE schools only (schools list still applies)', () => {
    const v7rows = { schools: SCHOOL_ROWS.map((s) => ({ ...s, teachers: 4, lps_opened: 2, teachers_opened_lp: 1 })), sessions: [] };
    const half = { ...LISTS, primary: null, midHigh: null, missing: { ...LISTS.missing, teachers: true } };
    const f = Schools.summarizeSchoolsAnalytics(v7rows, { lists: half });
    expect(f.overview.schools).toBe(3);
    expect(f.overview.teachers).toBe(12);
    expect(f.overview.lpsOpened).toBe(6);
    expect(f.schools.some((s) => s.noSchool)).toBe(false);
  });
});

describe('loadSchoolsAnalyticsRows v8 — the per-teacher read is the RDF lp_use', () => {
  it('reads lesson_plans + k5 opens for the population; app rows/opens only on a teacher-day with no WhatsApp row', async () => {
    const sql = [];
    const query = async (q, p) => { sql.push({ q, p }); return { rows: [] }; };
    await Schools.loadSchoolsAnalyticsRows(query, { from: '2026-08-01', to: '2026-10-19' }, { lists: LISTS, memo: Schools.createScoreMemo() });
    const t = sql.find((s) => /FROM lesson_plans/.test(s.q));
    expect(t).toBeTruthy();
    expect(t.q).toMatch(/niete_lp_opens/);
    expect(t.q).toMatch(/plan_kind = 'k5'/);
    expect(t.q).toMatch(/'\{v8,surface\}'/);
    expect(t.q).toMatch(/NOT EXISTS/);
    expect(t.q).toMatch(/teacher_training_progress/);
    // the population is one uuid[] parameter, never inlined
    const ids = t.p.find((x) => Array.isArray(x));
    expect(ids.sort()).toEqual([U(1), U(2), U(4), U(5), U(7)]);
    expect(t.q).not.toMatch(new RegExp(U(1)));
    // sessions are read whether or not the teacher has a school (a school-less teacher counts in her sector)
    const sess = sql.find((s) => /FROM coaching_sessions/.test(s.q));
    expect(sess.q).not.toMatch(/school_id IS NOT NULL/);
  });
});

// ── /analytics/coaching ──────────────────────────────────────────────────────

describe('summarizeCoachingAnalytics v8 — the RDF coach roster', () => {
  const rows = {
    schools: [
      { ...school('s1', '101', 'B.K'), coach_visits: 3 },
      { ...school('s3', '201', 'Sihala'), coach_visits: 2 },
      { ...school('s4', '301', 'Sihala'), coach_visits: 7 }, // off-list
    ],
    coachSchools: [
      { coach_id: 'k1', school_id: 's1', coach_name: 'Amena Ahmed' }, // not on the roster: not a coach here
      { coach_id: 'k2', school_id: 's3', coach_name: 'Saaim' },
    ],
  };
  const out = Coaching.summarizeCoachingAnalytics(rows, { lists: LISTS });

  it('coaches = roster entries per the roster\'s sector, names A to Z', () => {
    expect(out.overview.coaches).toBe(3);
    const by = Object.fromEntries(out.regions.map((r) => [r.region, r]));
    expect(by['B.K'].coachNames).toEqual(['Saima Jabeen']);
    expect(by.Nilore.coachNames).toEqual(['Mubasher Irfan']);
    expect(by.Sihala.coachNames).toEqual(['Abdul Malik']);
    expect(by.Sihala.coaches).toBe(1);
  });

  it('visits unchanged but only at FDE schools', () => {
    expect(out.overview.coachVisits).toBe(5);
    expect(out.regions.find((r) => r.region === 'Sihala').schools).toBe(1);
  });

  it('a region filter scopes the overview count to that sector\'s roster', () => {
    expect(Coaching.summarizeCoachingAnalytics(rows, { lists: LISTS, region: 'Nilore' }).overview.coaches).toBe(1);
  });

  it('roster missing → the v7 leader_schools coaches', () => {
    const f = Coaching.summarizeCoachingAnalytics(rows, { lists: { ...LISTS, coaches: null, missing: { ...LISTS.missing, coaches: true } } });
    expect(f.overview.coaches).toBe(2);
  });
});

// ── /analytics/observations ──────────────────────────────────────────────────

describe('summarizeObservationsAnalytics v8 — FDE schools, RDF teachers', () => {
  const s = (id, schoolId, userId, type = null) => ({ id, school_id: schoolId, user_id: userId, is_test: false, observation_type: type, sections: { b: 50, c: 60, d: 70 } });
  const rows = {
    schools: SCHOOL_ROWS,
    sessions: [
      s('c1', 's1', U(1)),
      s('c2', null, U(2)), // no school → B.K No school
      s('c3', 's4', U(4)), // off-list school → Sihala No school
      s('c4', 's1', U(99)), // not in the population
      s('c5', 's3', U(7), 'leader_observation'),
    ],
  };
  const out = Observations.summarizeObservationsAnalytics(rows, { lists: LISTS });

  it('counts only population teachers; school-less ones on their sector\'s No-school row', () => {
    expect(out.dc.overview.observations).toBe(3);
    expect(out.dc.overview.teachersObserved).toBe(3);
    expect(out.dc.overview.schools).toBe(3);
    const ns = out.dc.schools.filter((x) => x.noSchool).map((x) => [x.region, x.observations]);
    expect(ns).toEqual([['B.K', 1], ['Sihala', 1]]);
    expect(out.human.overview.observations).toBe(1);
    expect(out.dc.regions.find((r) => r.region === 'Sihala').schools).toBe(1);
  });
});
