/**
 * bd-97daxo.33 — Moawin's view split into areas, and its observers endpoint, on the real routes.
 *
 *   areas      a Moawin (Gilgit-Baltistan) viewer's every analytics answer buckets a school by its AREA (Gilgit /
 *              Baltistan, from schools.district through dashboard/config/gb-areas.json), and ?region= takes an area.
 *              Access stays on schools.region. "Area not set" shows only when a counted school is in it.
 *   observers  GET /api/portal/analytics/observers — who observed whom, FICO17 v6 — for a non-FDE view only.
 *   FDE        FDE's answers do not move, and FDE's reads never touch schools.district.
 *
 * The harness (supabase and pool stand-ins, fixtures, call/answer) is analytics-organization-scope.test.js's, copied
 * here with GB schools that carry a district and the observers' reads answered.
 */

// Not a suite about the sign-in account check: every session user reads as live (tests/fixtures/portal-auth-live.js).
require('../fixtures/portal-auth-live').installLivePortalAccounts();

process.env.FLAG_CACHE_TTL_MS = '0';

const fs = require('fs');
const path = require('path');

const FDE_VIEWER = 'aaaaaaaa-0000-4000-8000-000000000001';
const GB_VIEWER = 'dddddddd-0000-4000-8000-000000000004';
const LOST_VIEWER = 'eeeeeeee-0000-4000-8000-000000000005';
const TEACHER = 'bbbbbbbb-0000-4000-8000-000000000002';
const SIX = ['B.K', 'Sihala', 'Urban-I', 'Nilore', 'Urban-II', 'Tarnol'];
const GB = 'Gilgit-Baltistan';

/** region_features as V1.8.8 leaves it: the six under 'niete', GB under 'moawin', the 'niete' LP row not a region. */
const { REGION_REGISTRY_ROWS: REGISTRY } = require('./helpers/region-registry-rows');

// ── a supabase stand-in (the route tests' chain, plus a per-row read error for one app_settings key) ──
let tableStates;
let queries;
let lists; // what loadAnalyticsLists answers; null = the real loader (no list rows → every list missing)

function makeChain(tableName) {
  const state = tableStates[tableName] || {};
  const filters = {};
  const chain = {};
  const rows = () => {
    let r = state.rows || [];
    for (const [col, val] of Object.entries(filters)) r = r.filter((x) => x[col] === val);
    return r;
  };
  const one = () => {
    if (state.throws) throw state.throws;
    if (state.error) return { data: null, error: state.error };
    const row = rows()[0] || null;
    if (row && row.readError) return { data: null, error: row.readError };
    return { data: row, error: null };
  };
  chain.select = jest.fn(() => chain);
  ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'is'].forEach((m) => {
    chain[m] = jest.fn((col, val) => { filters[col] = val; return chain; });
  });
  chain.in = jest.fn(() => chain);
  chain.order = jest.fn(() => chain);
  chain.limit = jest.fn(() => chain);
  chain.maybeSingle = jest.fn(async () => one());
  chain.single = jest.fn(async () => one());
  chain.then = (resolve, reject) => Promise.resolve().then(() => {
    if (state.throws) throw state.throws;
    if (state.error) return { data: null, error: state.error };
    return { data: rows(), error: null };
  }).then(resolve, reject);
  return chain;
}

// ── the fixtures ─────────────────────────────────────────────────────────────

// One row per school carrying every column any of the five reads selects (each summariser reads its own).
const school = (id, name, emis, region, n = {}, extra = {}) => ({
  id, name, emis, region, is_active: true, is_probable_test: false,
  teachers: 0, lps_opened: 0, teachers_opened_lp: 0, training_modules: 0, teachers_trained: 0, coach_visits: 0,
  ...n, ...extra,
});
const FDE_SCHOOLS = [
  school('s1', 'IMSG B.K 1', '101', 'B.K', { teachers: 8, lps_opened: 5, teachers_opened_lp: 3, training_modules: 11, teachers_trained: 4, coach_visits: 3 }),
  school('s2', 'IMCG Sihala', '202', 'Sihala', { teachers: 2, lps_opened: 1, teachers_opened_lp: 1, training_modules: 3, teachers_trained: 1, coach_visits: 2 }),
  school('s3', 'No Region School', '303', null, { teachers: 31, lps_opened: 20, teachers_opened_lp: 9, training_modules: 40, teachers_trained: 12, coach_visits: 6 }),
  school('s4', 'Durbeen', null, 'Durbeen', { teachers: 11, lps_opened: 6, teachers_opened_lp: 2, training_modules: 7, teachers_trained: 3, coach_visits: 4 }),
];
const GB_SCHOOLS = [
  school('g1', 'GHS Gilgit', '9001', GB, { teachers: 5, lps_opened: 4, teachers_opened_lp: 2, training_modules: 6, teachers_trained: 2, coach_visits: 3 }),
  school('g2', 'GGHS Skardu', '9002', GB, { teachers: 3, lps_opened: 0, teachers_opened_lp: 0, training_modules: 1, teachers_trained: 1, coach_visits: 0 }),
];
// bd-97daxo.33: each GB school's district (schools.district); FDE's schools have none.
const DISTRICT = { g1: 'Gilgit', g2: 'Skardu' };

const session = (id, user_id, school_id, observation_type) => ({
  id, updated_at: '2026-10-02T00:00:00Z', user_id, school_id, is_test: false, observation_type,
});
const FDE_SESSIONS = [
  session('c1', 't1', 's1', null), session('c2', 't2', 's2', 'leader_observation'),
  session('c3', 't3', 's3', null), session('c4', 't4', 's4', 'leader_observation'),
  // a v8 population teacher's DC session
  session('c5', 'u1', 's1', null),
];
const GB_SESSIONS = [
  session('gc1', 'gt1', 'g1', null), session('gc2', 'gt2', 'g1', 'leader_observation'), session('gc3', 'gt3', 'g2', null),
];
const sect = (b, c, d) => ({
  b_score: String(b), b_max: '40', b_assessed: null,
  c_score: String(c), c_max: '48', c_assessed: null,
  d_score: String(d), d_max: '28', d_assessed: null,
});
const scoreRow = (id) => (id.startsWith('g')
  ? { id, updated_at: '2026-10-02T00:00:00Z', scores: { overall_marks: 40, overall_max_marks: 100 }, ...sect(10, 24, 7) }
  : { id, updated_at: '2026-10-02T00:00:00Z', scores: { overall_marks: 70, overall_max_marks: 100 }, ...sect(30, 36, 21) });

const FDE_COACH_SCHOOLS = [
  { coach_id: 'k1', school_id: 's1', coach_name: 'Saima Jabeen' },
  { coach_id: 'k1', school_id: 's2', coach_name: 'Saima Jabeen' },
  { coach_id: 'k3', school_id: 's4', coach_name: 'Out Of Six' },
];
const GB_COACH_SCHOOLS = [
  { coach_id: 'gk1', school_id: 'g1', coach_name: 'Gul Bano' },
  { coach_id: 'gk1', school_id: 'g2', coach_name: 'Gul Bano' },
];

const LEVELS = [
  { id: '1', name: 'Aspiring Teacher', order_index: 0 },
  { id: '2', name: 'Emerging Practitioner', order_index: 1 },
  { id: '3', name: 'Skilled Practitioner', order_index: 2 },
  { id: '4', name: 'Teacher Leader', order_index: 3 },
];
const CATALOGUE = [
  ...[1, 2, 3, 4, 5, 6, 7].map((n) => ({ partner: 'oxbridge', bit: n - 1, name: `SESSION#${n}` })),
  { partner: 'beaconhouse', bit: 1, name: 'English' },
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => ({ partner: 'isaps', bit: n - 1, name: `Module ${n}` })),
];
const mem = (user_id, extra = {}) => ({
  user_id, school_id: null, region: null, primary_cohort: false, mh_cohort: false, middle_band: false, high_band: false,
  cert_levels: null, active_levels: null, ox_mask: 0, ox_cert: false, ox_active: false, bh_mask: 0, bh_active: false,
  isaps_assigned: false, isaps_cert: false, isaps_mask: 0, isaps_active: false, ...extra,
});
const FDE_MEMBERS = [
  mem('p1', { primary_cohort: true, school_id: 's1', region: 'B.K', cert_levels: ['1', '2', '3', '4'] }),
  mem('p2', { primary_cohort: true, school_id: 's2', region: 'Sihala', cert_levels: ['1'], active_levels: ['2'] }),
  // on the programme, placed nowhere: FDE's noSector today, and it stays there
  mem('p3', { primary_cohort: true, school_id: 's3' }),
  mem('p4', { primary_cohort: true, region: 'ICT' }),
  mem('m1', {
    mh_cohort: true, middle_band: true, school_id: 's1', cert_levels: ['3', '4'], ox_mask: 127, ox_cert: true,
    ox_active: true, bh_mask: 2, bh_active: true, isaps_assigned: true, isaps_cert: true, isaps_mask: 511, isaps_active: true,
  }),
  mem('m2', { mh_cohort: true, high_band: true, school_id: 's2', ox_mask: 7, ox_active: true, isaps_assigned: true, isaps_active: true }),
];
const GB_MEMBERS = [
  mem('gm1', { primary_cohort: true, school_id: 'g1', region: GB, cert_levels: ['1'] }),
  // a GB teacher with no school on record: GB by her users.region alone
  mem('gm2', { primary_cohort: true, region: GB, active_levels: ['1'] }),
  // at a GB school with a stray users.region: the school decides
  mem('gm3', { mh_cohort: true, middle_band: true, school_id: 'g2', region: 'ict', ox_mask: 1, ox_active: true }),
];

// lp-engagement: today's roster with levels (v7), the population's schools (v8), and plan use in the window.
const FDE_ROSTER = [
  { id: 'u1', school_id: 's1', bands: ['PRIMARY'] }, { id: 'u2', school_id: 's1', bands: ['PRIMARY'] },
  { id: 'u3', school_id: 's2', bands: ['PRIMARY', 'HIGH'] }, { id: 'u5', school_id: 's3', bands: ['MIDDLE'] },
];
const GB_ROSTER = [
  { id: 'gt1', school_id: 'g1', bands: ['PRIMARY'] }, { id: 'gt2', school_id: 'g1', bands: ['PRIMARY'] },
  { id: 'gt3', school_id: 'g2', bands: ['MIDDLE'] },
];
const FDE_ACTIVITY = [
  { user_id: 'u1', grade: '2', subject: 'urdu', ref: null, k5: true },
  { user_id: 'u3', grade: null, subject: null, ref: 'grade_4_math_ch1_seg1', k5: true },
  { user_id: 'u5', grade: null, subject: null, ref: 'grade_9_physics.c01.p008-009', k5: false },
];
const GB_ACTIVITY = [
  { user_id: 'gt1', grade: '3', subject: 'english', ref: null, k5: true },
  { user_id: 'gt3', grade: null, subject: null, ref: 'grade_7_science.c01.p001', k5: false },
];

/** FDE's v8 lists (analytics-lists' answer on prod): FDE's schools and the RDF populations, six sectors only. */
const FDE_LISTS = () => ({
  fdeSchoolEmis: new Set(['101', '202']),
  primary: new Map([['p1', 'B.K'], ['p2', 'Sihala'], ['u1', 'B.K'], ['u2', 'B.K'], ['u3', 'Sihala'], ['u4', 'Urban-I']]),
  midHigh: new Map([['m1', 'B.K'], ['m2', 'Sihala'], ['u3', 'Sihala'], ['u5', 'Tarnol']]),
  sectorByUser: null,
  coaches: [{ name: 'Saima Jabeen', sector: 'B.K', userIds: [] }, { name: 'Abdul Malik', sector: 'Sihala', userIds: [] }],
  asOf: { schools: '2026-10-19', teachers: '2026-08-04', coaches: '2026-09-24' },
  missing: { schools: false, teachers: false, coaches: false },
});

let districtsMissing = false;
let districtOverride = null;
const districtOf = (id) => (districtOverride && id in districtOverride ? districtOverride[id] : (DISTRICT[id] || null));

// The observers' rows: finished human visits at the GB schools, one FMO → principal, one principal → teacher.
const OBSERVER_VISITS = [
  { id: 'ov1', user_id: 'gt2', school_id: 'g1', observed_role: 'teacher', observed_test: false, observer_user_id: 'gk1', observer_role: 'coach', observer_test: false, observer_name: 'Gul Bano', status: 'completed', framework: 'fico17_v6', created_at: '2026-10-05T05:00:00Z' },
  { id: 'ov2', user_id: 'gp1', school_id: 'g1', observed_role: 'principal', observed_test: false, observer_user_id: 'gk1', observer_role: 'coach', observer_test: false, observer_name: 'Gul Bano', status: 'observer_review_complete', framework: 'fico', created_at: '2026-10-06T05:00:00Z' },
  { id: 'ov3', user_id: 'gt3', school_id: 'g2', observed_role: 'teacher', observed_test: false, observer_user_id: 'gp2', observer_role: 'principal', observer_test: false, observer_name: null, status: 'completed', framework: 'hots', created_at: '2026-10-07T05:00:00Z' },
];
const OBSERVER_SCORES = {
  ov1: { id: 'ov1', scores: { rubric: 'fico17_v6', overall_percentage: 61.8 }, c_score: '13', c_max: '20', d_score: '3', d_max: '8', f_score: '12', f_max: '16' },
  ov2: { id: 'ov2', scores: { overall_marks: 80, overall_max_marks: 100 } },
  ov3: { id: 'ov3', scores: { overall_marks: 30, overall_max_marks: 48 } },
};

let data;
function fixtures({ fde = true, gb = true } = {}) {
  const pick = (a, b) => [...(fde ? a : []), ...(gb ? b : [])];
  return {
    schools: pick(FDE_SCHOOLS, GB_SCHOOLS),
    sessions: pick(FDE_SESSIONS, GB_SESSIONS),
    coachSchools: pick(FDE_COACH_SCHOOLS, GB_COACH_SCHOOLS),
    members: pick(FDE_MEMBERS, GB_MEMBERS),
    roster: pick(FDE_ROSTER, GB_ROSTER),
    activity: pick(FDE_ACTIVITY, GB_ACTIVITY),
  };
}

// The regions a read is narrowed to: its one parameter that is a list of region names (never ids).
const REGION_LIST = (params) => (params || []).find((p) => Array.isArray(p) && p.length && p.every((x) => typeof x === 'string' && !/^[a-z]+\d+$/.test(x) && !/^[0-9a-f-]{36}$/.test(x)));
const schoolRegion = (schoolId) => (data.schools.find((s) => s.id === schoolId) || {}).region;

// Answers every read of the five routes (each test file's poolRows, merged; order matters).
function poolRows(sql, params) {
  const only = REGION_LIST(params);
  if (/SELECT id, district/.test(sql)) {
    if (districtsMissing) { const e = new Error('column "district" does not exist'); e.code = '42703'; throw e; }
    return data.schools.filter((s) => only.includes(s.region)).map((s) => ({ ...s, district: districtOf(s.id) }));
  }
  if (/NULL::text AS district/.test(sql)) return data.schools.filter((s) => only.includes(s.region)).map((s) => ({ ...s, district: null }));
  if (/observer_role/.test(sql)) return OBSERVER_VISITS.filter((v) => only.includes(schoolRegion(v.school_id)));
  if (/AS principals/.test(sql)) return data.schools.filter((s) => only.includes(s.region)).map((s) => ({ school_id: s.id, teachers: s.teachers, principals: 1 }));
  if (/analysis_data #> '\{\}'::text\[\] AS a/.test(sql) && /v6_teacher/.test(sql)) return params[0].map((id) => OBSERVER_SCORES[id] || { id, scores: null });
  if (only && /FROM coaching_sessions c\s+JOIN users u/i.test(sql)) return data.sessions.filter((s) => only.includes(schoolRegion(s.school_id)));
  if (only && /FROM schools/i.test(sql) && !/FROM coaching_sessions/i.test(sql)) return data.schools.filter((s) => only.includes(s.region));
  if (/'scores'/.test(sql)) return params[0].filter((id) => data.sessions.some((s) => s.id === id)).map(scoreRow);
  if (/member_facts/.test(sql)) return data.members;
  if (/'oxbridge' AS partner/.test(sql)) return CATALOGUE;
  if (/FROM training_levels/.test(sql)) return LEVELS;
  if (/lps_used/.test(sql)) {
    // v8 /analytics/schools: one row per population teacher
    const ids = params[params.length - 1];
    return ids.map((id) => ({ user_id: id, school_id: (data.roster.find((r) => r.id === id) || {}).school_id || null, lps_used: data.activity.filter((a) => a.user_id === id).length, training_modules: 1 }));
  }
  if (/lesson_plans|niete_lp612/.test(sql)) return data.activity.filter((a) => (/lesson_plans/.test(sql) ? a.k5 : !a.k5));
  if (/FROM leader_schools/i.test(sql)) return data.coachSchools;
  if (/FROM coaching_sessions/i.test(sql)) return data.sessions;
  if (/FROM schools/i.test(sql)) return data.schools;
  if (/teacher_level/.test(sql)) return data.roster;
  if (/FROM users\b/.test(sql)) return data.roster.map(({ id, school_id }) => ({ id, school_id }));
  return [];
}

function settings({ viewers = [FDE_VIEWER, GB_VIEWER, LOST_VIEWER], orgs = { [GB_VIEWER]: 'moawin', [LOST_VIEWER]: 'nowhere' } } = {}) {
  const rows = [{ key: 'portal_analytics_only', value: viewers }];
  if (orgs !== undefined) rows.push({ key: 'portal_analytics_organizations', value: orgs });
  return { rows };
}

/** A fresh module graph (empty caches, registry and lists): one per answer compared. */
function fresh({ fde = true, gb = true, withLists = false, registry = { rows: REGISTRY }, appSettings = settings(), noDistricts = false, districts = null } = {}) {
  jest.resetModules();
  districtsMissing = noDistricts;
  districtOverride = districts;
  data = fixtures({ fde, gb });
  lists = withLists ? FDE_LISTS() : null;
  tableStates = { region_features: registry, app_settings: appSettings };
  queries = [];
  if (lists) {
    jest.doMock('../../dashboard/lib/analytics-lists', () => ({
      ...jest.requireActual('../../dashboard/lib/analytics-lists'),
      loadAnalyticsLists: jest.fn(async () => lists),
    }));
  } else {
    // the real loader: no list rows in app_settings → every list missing (the v7 rule)
    jest.dontMock('../../dashboard/lib/analytics-lists');
  }
  jest.doMock('../../dashboard/config/supabase', () => ({
    from: jest.fn((tbl) => makeChain(tbl)),
    rpc: jest.fn().mockResolvedValue({ error: null }),
  }));
  jest.doMock('../../dashboard/config/database', () => ({
    query: jest.fn(async (sql, params) => { queries.push({ sql, params }); return { rows: poolRows(sql, params) }; }),
  }));
  jest.doMock('../../dashboard/services/r2.service', () => ({
    generatePresignedUrl: jest.fn().mockResolvedValue(null),
    generatePresignedUrls: jest.fn().mockResolvedValue([]),
    isValidR2Url: jest.fn().mockReturnValue(true),
  }));
  jest.doMock('bcryptjs', () => ({ hash: jest.fn(), compare: jest.fn().mockResolvedValue(true), genSalt: jest.fn() }), { virtual: true });
  jest.doMock('express-rate-limit', () => jest.fn(() => (_req, _res, next) => next()), { virtual: true });
  jest.doMock('@aws-sdk/client-s3', () => ({ S3Client: jest.fn(), GetObjectCommand: jest.fn() }), { virtual: true });
}

function findRoute(router, method, p) {
  for (const layer of router.stack) {
    if (layer.route && layer.route.path === p && layer.route.methods[method]) return layer.route.stack.map((s) => s.handle);
  }
  return null;
}

async function call(p, { userId, query = {} } = {}) {
  const routes = require('../../dashboard/routes/portal.routes');
  const stack = findRoute(routes, 'get', p);
  if (!stack) throw new Error(`GET ${p} not found on the portal router`);
  const req = {
    session: userId ? { portalUserId: userId, id: 'sess-1' } : {}, params: {}, query, body: {}, method: 'GET', path: p,
    ip: '127.0.0.1', headers: {}, get: () => undefined,
  };
  let statusCode = 200;
  let payload = null;
  const res = { status(c) { statusCode = c; return this; }, json(b) { payload = b; return this; } };
  for (const handler of stack) {
    let advanced = false;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => {
      const maybe = handler(req, res, () => { advanced = true; resolve(); });
      if (maybe && typeof maybe.then === 'function') maybe.then(resolve, resolve);
      else if (!advanced) resolve();
    });
    if (!advanced) break;
  }
  return { statusCode, payload };
}

/** One answer from a fresh process. computedAt (training-levels' snapshot time) is a clock, not data. */
async function answer(p, query, viewer, opts) {
  fresh(opts);
  const out = await call(p, { userId: viewer, query });
  if (out.payload && out.payload.computedAt) out.payload.computedAt = '<time>';
  return out;
}

// Every endpoint, every view it has (band tabs, a window).
const WINDOW = { from: '2026-10-01', to: '2026-10-13' };
const ENDPOINTS = [
  ['/analytics/schools', WINDOW],
  ['/analytics/coaching', WINDOW],
  ['/analytics/observations', WINDOW],
  ['/analytics/training-levels', { band: 'primary' }],
  ['/analytics/training-levels', { band: 'midhigh' }],
  ['/analytics/training-levels', { band: 'all' }],
  ['/analytics/lp-engagement', { ...WINDOW, band: 'primary' }],
  ['/analytics/lp-engagement', { ...WINDOW, band: 'midhigh' }],
];
const GB_NAMES = /GHS Gilgit|GGHS Skardu|Gul Bano|Gilgit-Baltistan/;
const FDE_NAMES = /IMSG|IMCG|Saima|Abdul Malik|Durbeen|No Region School|B\.K|Sihala|Urban-I|Nilore|Tarnol/;

afterEach(() => jest.resetModules());

const regionsOf = (payload) => (payload.regions || payload.human?.regions || []).map((r) => r.region);
const strip = (o) => JSON.parse(JSON.stringify(o));

describe('FDE: nothing moves', () => {
  it('every FDE answer is the same with or without GB districts, and no FDE read names schools.district', async () => {
    for (const [p, query] of ENDPOINTS) {
      // eslint-disable-next-line no-await-in-loop
      const a = await answer(p, query, FDE_VIEWER);
      expect(queries.some((q) => /district/.test(q.sql))).toBe(false);
      // eslint-disable-next-line no-await-in-loop
      const b = await answer(p, query, FDE_VIEWER, { noDistricts: true });
      expect([p, a.statusCode]).toEqual([p, 200]);
      expect(strip(b.payload)).toEqual(strip(a.payload));
      expect(regionsOf(a.payload)).toEqual(SIX);
    }
  });

  it('FDE\'s scope answer keeps its exact shape (no areas key)', async () => {
    const { payload } = await answer('/analytics/scope', {}, FDE_VIEWER);
    expect(payload).toEqual({ success: true, organization: 'niete', regions: SIX });
  });

  it('the observers endpoint is not FDE\'s: 404, nothing read', async () => {
    const { statusCode, payload } = await answer('/analytics/observers', WINDOW, FDE_VIEWER);
    expect(statusCode).toBe(404);
    expect(payload.success).toBe(false);
    expect(queries).toHaveLength(0);
  });
});

describe('Moawin: areas', () => {
  it('scope names the areas', async () => {
    const { payload } = await answer('/analytics/scope', {}, GB_VIEWER);
    expect(payload).toEqual({ success: true, organization: 'moawin', regions: [GB], areas: ['Gilgit', 'Baltistan'], areaDistricts: { Gilgit: ['Gilgit', 'Diamer', 'Astore', 'Ghizer', 'Darel'], Baltistan: ['Skardu', 'Shigar', 'Ghanche', 'Kharmang'] } });
  });

  it('every endpoint answers Gilgit and Baltistan, never the ICT sectors or the one GB card', async () => {
    for (const [p, query] of ENDPOINTS) {
      // eslint-disable-next-line no-await-in-loop
      const { statusCode, payload } = await answer(p, query, GB_VIEWER);
      expect([p, statusCode]).toEqual([p, 200]);
      expect([p, regionsOf(payload)]).toEqual([p, ['Gilgit', 'Baltistan']]);
      expect(JSON.stringify(payload)).not.toMatch(FDE_NAMES);
    }
  });

  it('schools: each school in its district\'s area; the areas add up to the whole', async () => {
    const { payload } = await answer('/analytics/schools', WINDOW, GB_VIEWER);
    expect(payload.schools.map((s) => [s.name, s.region])).toEqual([['GHS Gilgit', 'Gilgit'], ['GGHS Skardu', 'Baltistan']]);
    const [gil, bal] = payload.regions;
    expect(gil).toMatchObject({ schools: 1, teachers: 5 });
    expect(bal).toMatchObject({ schools: 1, teachers: 3 });
    expect(payload.overview).toMatchObject({ schools: 2, teachers: 8 });
  });

  it('?region= takes an area (any case); the region\'s own name is the whole region; another region is a 400', async () => {
    for (const [p, query] of ENDPOINTS) {
      // eslint-disable-next-line no-await-in-loop
      const bal = await answer(p, { ...query, region: 'baltistan' }, GB_VIEWER);
      expect([p, bal.statusCode]).toEqual([p, 200]);
      // eslint-disable-next-line no-await-in-loop
      const whole = await answer(p, { ...query, region: GB }, GB_VIEWER);
      // eslint-disable-next-line no-await-in-loop
      const all = await answer(p, query, GB_VIEWER);
      expect([p, strip(whole.payload)]).toEqual([p, strip(all.payload)]);
      // eslint-disable-next-line no-await-in-loop
      const ict = await answer(p, { ...query, region: 'Sihala' }, GB_VIEWER);
      expect([p, ict.statusCode]).toEqual([p, 400]);
    }
    const { payload } = await answer('/analytics/schools', { ...WINDOW, region: 'Baltistan' }, GB_VIEWER);
    expect(payload.schools.map((s) => s.name)).toEqual(['GGHS Skardu']);
    expect(payload.overview).toMatchObject({ schools: 1, teachers: 3 });
  });

  it('a GB school with no district (or one the file does not list) is under Area not set, so nothing is lost', async () => {
    const { payload } = await answer('/analytics/schools', WINDOW, GB_VIEWER, { districts: { g2: 'Hunza' } });
    expect(regionsOf(payload)).toEqual(['Gilgit', 'Baltistan', 'Area not set']);
    expect(payload.schools.find((s) => s.name === 'GGHS Skardu').region).toBe('Area not set');
    expect(payload.overview.schools).toBe(2);
  });

  it('before the migration (no district column) the view still answers, every school under Area not set', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const { statusCode, payload } = await answer('/analytics/schools', WINDOW, GB_VIEWER, { noDistricts: true });
    warn.mockRestore();
    expect(statusCode).toBe(200);
    expect(payload.overview.schools).toBe(2);
    expect(payload.schools.every((s) => s.region === 'Area not set')).toBe(true);
  });

  it('training: a GB member with no school is still GB\'s (No school), exactly as before areas', async () => {
    const { payload } = await answer('/analytics/training-levels', { band: 'primary' }, GB_VIEWER);
    const total = payload.overview.teachers;
    const placed = payload.regions.reduce((a, r) => a + r.teachers, 0) + payload.noSector.teachers;
    expect(total).toBe(placed);
    expect(payload.noSector.teachers).toBeGreaterThan(0);
  });
});

describe('Moawin: observers', () => {
  it('who observed whom, by area; FMOs named, principals by role, no teacher', async () => {
    const { statusCode, payload } = await answer('/analytics/observers', WINDOW, GB_VIEWER);
    expect(statusCode).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.overview).toMatchObject({ observations: 3, byObserver: { principal: 1, fmo: 2, other: 0 }, principalsObserved: 1, teachersObserved: 2 });
    expect(payload.overview.v6).toMatchObject({ avg: 61.8, n: 1 });
    expect(payload.overview.v3).toEqual({ avg: 80, n: 1 });
    expect(payload.overview.hots).toBe(1);
    expect(regionsOf(payload)).toEqual(['Gilgit', 'Baltistan']);
    expect(payload.regions.map((r) => r.observations)).toEqual([2, 1]);
    const g1 = payload.schools.find((s) => s.name === 'GHS Gilgit');
    expect(g1.visits.map((v) => [v.observer, v.observerName, v.observed, v.rubric])).toEqual([
      ['fmo', 'Gul Bano', 'teacher', 'v6'], ['fmo', 'Gul Bano', 'principal', 'v3'],
    ]);
    expect(JSON.stringify(payload)).not.toMatch(/gt2|gt3|gp1|gp2|gk1/);
    expect(JSON.stringify(payload)).not.toMatch(FDE_NAMES);
  });

  it('?region= an area scopes it; another region is a 400', async () => {
    const bal = await answer('/analytics/observers', { ...WINDOW, region: 'Baltistan' }, GB_VIEWER);
    expect(bal.payload.overview.observations).toBe(1);
    expect(bal.payload.schools.map((s) => s.name)).toEqual(['GGHS Skardu']);
    const ict = await answer('/analytics/observers', { ...WINDOW, region: 'Sihala' }, GB_VIEWER);
    expect(ict.statusCode).toBe(400);
  });

  it('every read is narrowed to Gilgit-Baltistan', async () => {
    await answer('/analytics/observers', WINDOW, GB_VIEWER);
    const narrowed = queries.filter((q) => !/v6_teacher/.test(q.sql));
    expect(narrowed.length).toBeGreaterThan(0);
    for (const q of narrowed) expect(REGION_LIST(q.params)).toEqual([GB]);
  });
});
