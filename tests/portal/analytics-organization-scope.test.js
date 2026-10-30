/**
 * bd-97daxo.3 — an analytics account sees only the regions its organization owns.
 *
 * Gilgit-Baltistan (GB) joins NIETE as a region owned by Moawin, not FDE. FDE's analytics accounts must keep
 * seeing exactly what they see today (the six ICT sectors, same numbers, same order) and GB data must never reach
 * an FDE number; a GB analytics account sees only Gilgit-Baltistan.
 *
 *   viewer → organization   app_settings portal_analytics_organizations, a JSON OBJECT {"<users.id>": "<org>"}.
 *                           Absent from it (or no row) = 'niete', so no FDE account needs a row. A failed or
 *                           malformed read is a 500, never a default.
 *   organization → regions  the region registry (bot/shared/services/region-registry.js, region_features rows),
 *                           read per request (cached 5 min). Unreadable = 500 (fail closed); none = an empty answer.
 *   FDE's lists             analytics_fde_schools / analytics_rdf_* are FDE's populations: never applied to
 *                           another organization, whose view keeps the v7 rule.
 *
 * The fixtures are the ones the five route tests use (analytics-*-route.test.js), plus a GB block: two GB schools,
 * GB teachers with sessions, coach visits, training-programme members and lesson-plan activity.
 */
process.env.FLAG_CACHE_TTL_MS = '0';

const fs = require('fs');
const path = require('path');

const FDE_VIEWER = 'aaaaaaaa-0000-4000-8000-000000000001';
const GB_VIEWER = 'dddddddd-0000-4000-8000-000000000004';
const LOST_VIEWER = 'eeeeeeee-0000-4000-8000-000000000005';
const TEACHER = 'bbbbbbbb-0000-4000-8000-000000000002';
const SIX = ['B.K', 'Sihala', 'Urban-I', 'Nilore', 'Urban-II', 'Tarnol'];
const GB = 'Gilgit-Baltistan';

/** region_features as V1.8.5 leaves it: the six under 'niete', GB under 'moawin', the 'niete' LP row not a region. */
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

// Answers every read of the five routes (each test file's poolRows, merged; order matters).
function poolRows(sql, params) {
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
function fresh({ fde = true, gb = true, withLists = false, registry = { rows: REGISTRY }, appSettings = settings() } = {}) {
  jest.resetModules();
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

// ─────────────────────────────────────────────────────────────────────────────

describe('viewer → organization: app_settings portal_analytics_organizations', () => {
  const ff = () => require('../../dashboard/lib/feature-flags');
  const sb = () => require('../../dashboard/config/supabase');

  it('names the key once', () => {
    fresh();
    expect(ff().PORTAL_ANALYTICS_ORGANIZATIONS_KEY).toBe('portal_analytics_organizations');
  });

  it('readUserMapFlag: no row is an empty map; an object (or its JSON string) is that map', async () => {
    fresh({ appSettings: { rows: [] } });
    expect(await ff().readUserMapFlag(sb(), 'portal_analytics_organizations')).toEqual({});
    fresh({ appSettings: { rows: [{ key: 'portal_analytics_organizations', value: { [GB_VIEWER]: 'moawin' } }] } });
    expect(await ff().readUserMapFlag(sb(), 'portal_analytics_organizations')).toEqual({ [GB_VIEWER]: 'moawin' });
    fresh({ appSettings: { rows: [{ key: 'portal_analytics_organizations', value: JSON.stringify({ [GB_VIEWER]: 'moawin' }) }] } });
    expect(await ff().readUserMapFlag(sb(), 'portal_analytics_organizations')).toEqual({ [GB_VIEWER]: 'moawin' });
  });

  it('readUserMapFlag: a failed read or a malformed value THROWS — never an empty map that would make everyone FDE', async () => {
    fresh({ appSettings: { error: { message: 'boom' } } });
    await expect(ff().readUserMapFlag(sb(), 'portal_analytics_organizations')).rejects.toThrow(/boom/);
    for (const value of [[GB_VIEWER], true, 'moawin', 7, 'not json', '[1]']) {
      fresh({ appSettings: { rows: [{ key: 'portal_analytics_organizations', value }] } });
      // eslint-disable-next-line no-await-in-loop
      await expect(ff().readUserMapFlag(sb(), 'portal_analytics_organizations')).rejects.toThrow(/malformed/);
    }
  });

  describe('makeRequireAnalyticsViewer attaches req.analyticsOrganization', () => {
    const make = (deps) => require('../../dashboard/lib/analytics-viewer').makeRequireAnalyticsViewer(deps);
    const res = () => ({ statusCode: null, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } });
    const run = async (mw, userId) => {
      const req = { session: { portalUserId: userId } };
      const r = res();
      const next = jest.fn();
      await mw(req, r, next);
      return { req, r, next };
    };

    it("absent from the map is 'niete' (every FDE account, unchanged); mapped is that organization", async () => {
      const mw = make({ getViewerIds: async () => [FDE_VIEWER, GB_VIEWER], getViewerOrganizations: async () => ({ [GB_VIEWER]: ' Moawin ' }) });
      const fde = await run(mw, FDE_VIEWER);
      expect(fde.next).toHaveBeenCalledTimes(1);
      expect(fde.req.analyticsOrganization).toBe('niete');
      const gb = await run(mw, GB_VIEWER);
      expect(gb.next).toHaveBeenCalledTimes(1);
      expect(gb.req.analyticsOrganization).toBe('moawin');
    });

    it('the map unreadable (or malformed) is a 500 and never calls next', async () => {
      const mw = make({ getViewerIds: async () => [FDE_VIEWER], getViewerOrganizations: async () => { throw new Error('malformed'); } });
      const { r, next, req } = await run(mw, FDE_VIEWER);
      expect(next).not.toHaveBeenCalled();
      expect(r.statusCode).toBe(500);
      expect(req.analyticsOrganization).toBeUndefined();
    });

    it("a mapped value that is not a non-empty string is a 500, not 'niete'", async () => {
      for (const v of ['', '   ', 7, null, ['moawin']]) {
        const mw = make({ getViewerIds: async () => [GB_VIEWER], getViewerOrganizations: async () => ({ [GB_VIEWER]: v }) });
        // eslint-disable-next-line no-await-in-loop
        const { r, next } = await run(mw, GB_VIEWER);
        expect(next).not.toHaveBeenCalled();
        expect(r.statusCode).toBe(500);
      }
    });

    it('a user not on the list is 403 before the map is read', async () => {
      const getViewerOrganizations = jest.fn(async () => ({}));
      const mw = make({ getViewerIds: async () => [FDE_VIEWER], getViewerOrganizations });
      const { r, next } = await run(mw, TEACHER);
      expect(next).not.toHaveBeenCalled();
      expect(r.statusCode).toBe(403);
      expect(getViewerOrganizations).not.toHaveBeenCalled();
    });
  });

  it('on the routes: the map unreadable is a 500 with nothing shown, for every analytics endpoint', async () => {
    for (const [p, query] of ENDPOINTS) {
      const appSettings = { rows: [
        { key: 'portal_analytics_only', value: [FDE_VIEWER] },
        { key: 'portal_analytics_organizations', readError: { message: 'timeout' } },
      ] };
      // eslint-disable-next-line no-await-in-loop
      const { statusCode, payload } = await answer(p, query, FDE_VIEWER, { appSettings });
      expect([p, statusCode]).toEqual([p, 500]);
      expect(payload.success).toBe(false);
      expect(payload.regions).toBeUndefined();
      expect(queries).toHaveLength(0);
    }
  });
});

describe('LEAK: an FDE account answers exactly the same with GB data in the database', () => {
  for (const withLists of [false, true]) {
    for (const [p, query] of ENDPOINTS) {
      it(`${p} ${JSON.stringify(query)} — ${withLists ? 'v8 (FDE lists loaded)' : 'v7 (no lists)'}`, async () => {
        const without = await answer(p, query, FDE_VIEWER, { gb: false, withLists });
        const withGb = await answer(p, query, FDE_VIEWER, { gb: true, withLists });
        expect(without.statusCode).toBe(200);
        expect(withGb.statusCode).toBe(200);
        expect(withGb.payload).toEqual(without.payload);
        expect(JSON.stringify(withGb.payload)).not.toMatch(GB_NAMES);
        const regions = withGb.payload.regions || withGb.payload.dc.regions;
        expect(regions.map((r) => r.region)).toEqual(SIX);
      });
    }
  }

  it('the six regions, in order, also with ?region=all and for an account mapped to niete explicitly', async () => {
    const appSettings = settings({ orgs: { [FDE_VIEWER]: 'niete', [GB_VIEWER]: 'moawin' } });
    const explicit = await answer('/analytics/schools', WINDOW, FDE_VIEWER, { appSettings });
    const absent = await answer('/analytics/schools', { ...WINDOW, region: 'all' }, FDE_VIEWER);
    expect(explicit.payload).toEqual(absent.payload);
    expect(absent.payload.regions.map((r) => r.region)).toEqual(SIX);
  });
});

describe('a GB (Moawin) account sees only Gilgit-Baltistan', () => {
  for (const [p, query] of ENDPOINTS) {
    it(`${p} ${JSON.stringify(query)}: GB only, counted from GB rows only, FDE's lists never applied`, async () => {
      const all = await answer(p, query, GB_VIEWER, { withLists: true });
      expect(all.statusCode).toBe(200);
      const regions = all.payload.regions || all.payload.dc.regions;
      expect(regions.map((r) => r.region)).toEqual([GB]);
      expect(JSON.stringify(all.payload)).not.toMatch(FDE_NAMES);
      // Counted from GB rows only: the same answer with every FDE row gone, and with FDE's lists unloaded.
      const gbOnly = await answer(p, query, GB_VIEWER, { fde: false, withLists: true });
      expect(all.payload).toEqual(gbOnly.payload);
      const noLists = await answer(p, query, GB_VIEWER, { withLists: false });
      expect(all.payload).toEqual(noLists.payload);
      if (all.payload.basis) expect(all.payload.basis).toMatchObject({ schools: 'all', teachers: 'roster', coaches: 'leader_schools' });
    });
  }

  it('/analytics/schools: the GB numbers', async () => {
    const { payload } = await answer('/analytics/schools', WINDOW, GB_VIEWER);
    expect(payload.schools.map((s) => s.name)).toEqual(['GGHS Skardu', 'GHS Gilgit']);
    expect(payload.overview).toMatchObject({
      schools: 2, teachers: 8, lpsOpened: 4, teachersOpenedLp: 2, trainingModules: 7, teachersTrained: 3,
      dcObservations: 2, teachersWithDc: 2, humanObservations: 1, avgFico: 40, ficoN: 2, avgHitl: 40, hitlN: 1,
    });
    const { region, ...card } = payload.regions[0];
    expect(payload.overview).toEqual(card);
  });

  it('/analytics/coaching: its coach, its visits', async () => {
    const { payload } = await answer('/analytics/coaching', WINDOW, GB_VIEWER);
    expect(payload.overview).toEqual({ coaches: 1, coachVisits: 3, schoolsVisited: 1 });
    expect(payload.regions).toEqual([{ region: GB, coaches: 1, coachVisits: 3, schoolsVisited: 1, schools: 2, coachNames: ['Gul Bano'] }]);
  });

  it('/analytics/training-levels: GB members (by school, else by users.region); FDE\'s unplaced members are not GB\'s', async () => {
    const { payload } = await answer('/analytics/training-levels', { band: 'primary' }, GB_VIEWER);
    // gm1 at a GB school; gm2 has no school but users.region GB (noSector of GB's view). p3/p4 are FDE's.
    expect(payload.overview.teachers).toBe(2);
    expect(payload.regions[0]).toMatchObject({ region: GB, teachers: 1 });
    expect(payload.noSector.teachers).toBe(1);
    expect(payload.schools.map((s) => s.name)).toEqual(['GHS Gilgit']);
  });

  it('/analytics/lp-engagement: the GB roster of the band, Active from its own plan use', async () => {
    const primary = await answer('/analytics/lp-engagement', { ...WINDOW, band: 'primary' }, GB_VIEWER);
    expect(primary.payload.overview).toEqual({ teachers: 2, active: 1, nonActive: 1, activePct: 50, activeSectors: 1 });
    const midhigh = await answer('/analytics/lp-engagement', { ...WINDOW, band: 'midhigh' }, GB_VIEWER);
    expect(midhigh.payload.overview).toEqual({ teachers: 1, active: 1, nonActive: 0, activePct: 100, activeSectors: 1 });
  });

  it('/analytics/observations: GB sessions only', async () => {
    const { payload } = await answer('/analytics/observations', WINDOW, GB_VIEWER);
    for (const kind of ['dc', 'human']) expect(payload[kind].regions.map((r) => r.region)).toEqual([GB]);
    expect(payload.dc.schools.map((s) => s.name)).toEqual(['GGHS Skardu', 'GHS Gilgit']);
    expect(payload.dc.overview).toMatchObject({ schools: 2, observations: 2, teachersObserved: 2, sectorsActive: 1 });
    expect(payload.human.overview).toMatchObject({ observations: 1, teachersObserved: 1 });
  });
});

describe('?region= is validated against the viewer\'s own regions', () => {
  it('GB asking for an FDE sector is a 400, and FDE asking for GB is a 400 — no data read', async () => {
    for (const [p] of ENDPOINTS) {
      // eslint-disable-next-line no-await-in-loop
      const gb = await answer(p, { region: 'Sihala' }, GB_VIEWER);
      expect([p, gb.statusCode, gb.payload]).toEqual([p, 400, { success: false, error: 'Unknown region.' }]);
      expect(queries).toHaveLength(0);
      // eslint-disable-next-line no-await-in-loop
      const fde = await answer(p, { region: 'gilgit-baltistan' }, FDE_VIEWER);
      expect([p, fde.statusCode]).toEqual([p, 400]);
      expect(queries).toHaveLength(0);
    }
  });

  it('GB asking for its own region, in any case, is that region', async () => {
    const { statusCode, payload } = await answer('/analytics/schools', { ...WINDOW, region: ' GILGIT-BALTISTAN ' }, GB_VIEWER);
    expect(statusCode).toBe(200);
    const { region, ...card } = payload.regions[0];
    expect(payload.overview).toEqual(card);
  });
});

describe('the registry decides, and it fails closed', () => {
  it('registry unreadable → 500 and nothing shown, for every endpoint and every viewer', async () => {
    for (const registry of [{ error: { message: 'pool exhausted' } }, { throws: new Error('socket hang up') }]) {
      for (const [p, query] of ENDPOINTS) {
        for (const viewer of [FDE_VIEWER, GB_VIEWER]) {
          // eslint-disable-next-line no-await-in-loop
          const { statusCode, payload } = await answer(p, query, viewer, { registry });
          expect([p, statusCode]).toEqual([p, 500]);
          expect(payload.success).toBe(false);
          expect(JSON.stringify(payload)).not.toMatch(/regions|overview/);
        }
      }
    }
  });

  it('an organization that owns no region gets an empty answer, never every region', async () => {
    for (const [p, query] of ENDPOINTS) {
      // eslint-disable-next-line no-await-in-loop
      const { statusCode, payload } = await answer(p, query, LOST_VIEWER, { withLists: true });
      expect([p, statusCode]).toEqual([p, 200]);
      const regions = payload.regions || payload.dc.regions;
      expect(regions).toEqual([]);
      expect(JSON.stringify(payload)).not.toMatch(GB_NAMES);
      expect(JSON.stringify(payload)).not.toMatch(FDE_NAMES);
    }
  });

  it('the cached answer is per organization: an FDE answer is never served to a GB account (and back)', async () => {
    for (const [p, query] of ENDPOINTS) {
      fresh();
      // eslint-disable-next-line no-await-in-loop
      const fde = await call(p, { userId: FDE_VIEWER, query });
      // eslint-disable-next-line no-await-in-loop
      const gb = await call(p, { userId: GB_VIEWER, query });
      // eslint-disable-next-line no-await-in-loop
      const fdeAgain = await call(p, { userId: FDE_VIEWER, query });
      expect((gb.payload.regions || gb.payload.dc.regions).map((r) => r.region)).toEqual([GB]);
      expect((fdeAgain.payload.regions || fdeAgain.payload.dc.regions).map((r) => r.region)).toEqual(SIX);
      expect(fdeAgain.payload).toEqual(fde.payload);
    }
  });
});

describe('one list of FDE\'s six sectors', () => {
  it('every dashboard copy IS dashboard/lib/analytics-lists SECTORS (the one V1.8.5 seeds for niete — tests/region)', () => {
    jest.resetModules();
    const { SECTORS } = require('../../dashboard/lib/analytics-lists');
    expect([...SECTORS]).toEqual(SIX);
    expect(require('../../dashboard/services/schools-analytics.service').REGION_BUCKETS).toBe(SECTORS);
    expect(require('../../dashboard/lib/insights/constants').SECTORS).toBe(SECTORS);
    expect(require('../../scripts/load-analytics-lists').SECTORS).toBe(SECTORS);
  });

  it('the Python organization fixer names the same six (it cannot import them)', () => {
    const py = fs.readFileSync(path.join(__dirname, '../../scripts/lib/set_organization.py'), 'utf8');
    const m = py.match(/^SIX = \(([^)]*)\)/m);
    expect(m).not.toBeNull();
    const six = [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
    expect(six.sort()).toEqual([...SIX].sort());
  });
});

describe('the BigQuery attendance export stays FDE-only', () => {
  const load = () => {
    jest.resetModules();
    jest.doMock('dotenv', () => ({ config: () => ({}) }), { virtual: true });
    jest.doMock('../../bot/shared/config/supabase', () => ({ from: jest.fn(), rpc: jest.fn() }), { virtual: true });
    jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: () => {} }), { virtual: true });
    return require('../../bot/workers/attendance-bigquery-export.worker');
  };

  it('drops a Gilgit-Baltistan teacher (any spelling) and keeps B.K → Barakahu', () => {
    const { aggregatePresence } = load();
    const day = '2026-10-28';
    const row = (teacher_id, region) => ({
      id: `r-${teacher_id}`, teacher_id, school_id: null, date: day, status: 'present', leave_type: null,
      teacher: { id: teacher_id, phone_number: `92300${teacher_id}`, school_id: null, region },
    });
    const out = aggregatePresence([
      row('1', 'B.K'), row('2', 'Gilgit-Baltistan'), row('3', 'gilgit-baltistan'), row('4', ' Gilgit-Baltistan '), row('5', 'Nilore'),
    ], day);
    expect(out.rows.map((r) => [r.teacher_id, r.sector])).toEqual([['1', 'Barakahu'], ['5', 'Nilore']]);
    expect(out.droppedCount).toBe(3);
  });
});
