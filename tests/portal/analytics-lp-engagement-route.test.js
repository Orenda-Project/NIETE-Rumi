/**
 * GET /api/portal/analytics/lp-engagement (schools analytics v8) — the LP Engagement tab as Active / Non-Active
 * (services/lp-engagement.service.js has the definitions): the band's RDF teacher population from
 * lib/analytics-lists, Active = used at least one lesson plan in the period by the RDF's rule for the band.
 *
 * Same gate, window and region rules as /analytics/schools: requirePortalAuth →
 * requireAnalyticsViewer (the portal_analytics_only list: not on it 403, unreadable 500);
 * analyticsRange; the six ICT regions only, anything else a 400; plus ?band=primary|midhigh (the
 * Primary / Mid-High toggle; blank is Primary, anything else a 400). A ten-minute response cache
 * keyed from|to|region|band that sits behind the gate, its own so this tab never slows the others.
 */

// Not a suite about the sign-in account check: every session user reads as live (tests/fixtures/portal-auth-live.js).
require('../fixtures/portal-auth-live').installLivePortalAccounts();
const { REGION_REGISTRY_ROWS } = require('./helpers/region-registry-rows');

let tableStates;
let queries;

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
    return { data: rows()[0] || null, error: null };
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
  chain.then = (resolve, reject) => Promise.resolve().then(() => ({ data: rows(), error: null })).then(resolve, reject);
  return chain;
}

function findRoute(router, method, path) {
  for (const layer of router.stack) {
    if (layer.route && layer.route.path === path && layer.route.methods[method]) {
      return layer.route.stack.map((s) => s.handle);
    }
  }
  return null;
}

async function call(method, path, { userId, query = {} } = {}) {
  const routes = require('../../dashboard/routes/portal.routes');
  const stack = findRoute(routes, method, path);
  if (!stack) throw new Error(`${method.toUpperCase()} ${path} not found on the portal router`);
  const session = userId ? { portalUserId: userId, id: 'sess-1' } : {};
  const req = {
    session, params: {}, query, body: {}, method: method.toUpperCase(), path, ip: '127.0.0.1', headers: {},
    get: () => undefined,
  };
  let statusCode = 200;
  let payload = null;
  const res = {
    status(code) { statusCode = code; return this; },
    json(b) { payload = b; return this; },
  };
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

const VIEWER = 'aaaaaaaa-0000-4000-8000-000000000001';
const TEACHER = 'bbbbbbbb-0000-4000-8000-000000000002';
const flag = (value) => ({ rows: [{ key: 'portal_analytics_only', value }] });
const ROUTE = '/analytics/lp-engagement';
const W1 = '2026-10-04';

const SCHOOLS = [
  { id: 's1', name: 'IMSG B.K 1', emis: '101', region: 'B.K', is_active: true, is_probable_test: false },
  { id: 's2', name: 'IMCG Sihala', emis: '202', region: 'Sihala', is_active: true, is_probable_test: false },
  // Not on FDE's list: its teachers are their sector's "No school" line.
  { id: 's3', name: 'NIETE Support', emis: '1122', region: null, is_active: true, is_probable_test: false },
];
// The RDF populations, as analytics-lists hands them over (userId → the RDF's sector).
const LISTS = {
  fdeSchoolEmis: new Set(['101', '202']),
  primary: new Map([['u1', 'B.K'], ['u2', 'B.K'], ['u3', 'Sihala'], ['u4', 'Urban-I']]),
  midHigh: new Map([['u3', 'Sihala'], ['u5', 'Tarnol']]),
  coaches: [],
  asOf: { schools: '2026-10-19', teachers: '2026-08-04', coaches: '2026-08-04' },
  missing: { schools: false, teachers: false, coaches: false },
};
const TEACHERS = [
  { id: 'u1', school_id: 's1' }, { id: 'u2', school_id: 's1' }, { id: 'u3', school_id: 's2' },
  { id: 'u4', school_id: null }, { id: 'u5', school_id: 's3' },
];
// Today's roster with levels: the v7 rule the tab keeps when the lists are not loaded (sandbox).
const ROSTER = [
  { id: 'u1', school_id: 's1', bands: ['PRIMARY'] }, { id: 'u2', school_id: 's1', bands: ['PRIMARY'] },
  { id: 'u3', school_id: 's2', bands: ['PRIMARY', 'HIGH'] }, { id: 'u5', school_id: 's3', bands: ['MIDDLE'] },
];
let activity;
let loadAnalyticsLists;

function poolRows(sql) {
  if (/lesson_plans|niete_lp612/.test(sql)) return activity.filter((a) => (/lesson_plans/.test(sql) ? a.k5 : !a.k5));
  if (/FROM schools\b/.test(sql)) return SCHOOLS;
  if (/teacher_level/.test(sql)) return ROSTER;
  if (/FROM users\b/.test(sql)) return TEACHERS;
  return [];
}

beforeEach(() => {
  jest.resetModules();
  // bd-97daxo.3 — every analytics route reads the viewer's regions from the region registry.
  tableStates = { region_features: { rows: REGION_REGISTRY_ROWS } };
  queries = [];
  activity = [
    // Primary: u1 a WhatsApp plan, u3 an app open; u2 and u4 nothing.
    { user_id: 'u1', grade: '2', subject: 'urdu', ref: null, k5: true },
    { user_id: 'u3', grade: null, subject: null, ref: 'grade_4_math_ch1_seg1', k5: true },
    // Mid / High: u5 a 6-12 delivery; u3 nothing on Mid / High.
    { user_id: 'u5', grade: null, subject: null, ref: 'grade_9_physics.c01.p008-009', k5: false },
  ];
  loadAnalyticsLists = jest.fn(async () => LISTS);
  jest.doMock('../../dashboard/lib/analytics-lists', () => ({ ...jest.requireActual('../../dashboard/lib/analytics-lists'), loadAnalyticsLists }));
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
});

afterEach(() => jest.resetModules());

describe('GET /analytics/lp-engagement — the gate', () => {
  it('is mounted behind requirePortalAuth: signed out is 401 and touches no data', async () => {
    const { statusCode } = await call('get', ROUTE);
    expect(statusCode).toBe(401);
    expect(queries).toHaveLength(0);
  });

  it('403s a user not on the analytics list, and reads no data', async () => {
    tableStates.app_settings = flag([VIEWER]);
    const { statusCode, payload } = await call('get', ROUTE, { userId: TEACHER });
    expect(statusCode).toBe(403);
    expect(payload.success).toBe(false);
    expect(queries).toHaveLength(0);
  });

  it('403s when the flag row is absent or carries a broadcast value', async () => {
    for (const state of [undefined, flag(true), flag('teachers'), flag({})]) {
      tableStates.app_settings = state;
      // eslint-disable-next-line no-await-in-loop
      const { statusCode } = await call('get', ROUTE, { userId: VIEWER });
      expect(statusCode).toBe(403);
    }
    expect(queries).toHaveLength(0);
  });

  it('500s (and shows nothing) when the flag cannot be read', async () => {
    tableStates.app_settings = { error: { message: 'timeout' } };
    const { statusCode, payload } = await call('get', ROUTE, { userId: VIEWER });
    expect(statusCode).toBe(500);
    expect(payload.success).toBe(false);
    expect(payload.overview).toBeUndefined();
    expect(queries).toHaveLength(0);
  });

  it('the gate is checked even when the answer is cached', async () => {
    tableStates.app_settings = flag([VIEWER]);
    await call('get', ROUTE, { userId: VIEWER });
    const { statusCode } = await call('get', ROUTE, { userId: TEACHER });
    expect(statusCode).toBe(403);
  });
});

describe('GET /analytics/lp-engagement — the answer', () => {
  it('answers a listed viewer with the contract keys: Active / Non-Active, no schedule bands', async () => {
    tableStates.app_settings = flag([VIEWER]);
    const { statusCode, payload } = await call('get', ROUTE, { userId: VIEWER, query: { from: '2026-10-04', to: '2026-10-13' } });
    expect(statusCode).toBe(200);
    expect(Object.keys(payload).sort()).toEqual([
      'band', 'basis', 'byGrade', 'bySubject', 'overview', 'range', 'regions', 'schools',
      'sectorGrades', 'sectorSubjects', 'success',
    ]);
    expect(payload).toMatchObject({ success: true, band: 'primary', range: { from: '2026-10-04', to: '2026-10-13' } });
    expect(Object.keys(payload.overview).sort()).toEqual(['active', 'activePct', 'activeSectors', 'nonActive', 'teachers']);
    for (const r of payload.regions) expect(Object.keys(r).sort()).toEqual(['active', 'activePct', 'nonActive', 'region', 'teachers']);
    for (const s of payload.schools) expect(Object.keys(s).sort()).toEqual(['active', 'activePct', 'emis', 'name', 'noSchool', 'nonActive', 'region', 'schoolId', 'teachers']);
    // which rule each list follows, as on the other analytics answers
    expect(payload.basis).toMatchObject({ schools: 'fde', teachers: 'rdf' });
    for (const r of payload.bySubject.rows) expect(Object.keys(r).sort()).toEqual(['active', 'activePct', 'name', 'nonActive', 'subject', 'teachers']);
    for (const r of payload.byGrade.rows) expect(Object.keys(r).sort()).toEqual(['active', 'activePct', 'grade', 'nonActive', 'teachers']);
    expect(JSON.stringify(payload)).not.toMatch(/onSchedule|moderate|offSchedule|lpRatio|lpPct/);
  });

  it('Primary: the RDF Primary population from analytics-lists, Active = used a lesson plan', async () => {
    tableStates.app_settings = flag([VIEWER]);
    const { payload } = await call('get', ROUTE, { userId: VIEWER });
    expect(loadAnalyticsLists).toHaveBeenCalledWith(require('../../dashboard/config/supabase'), { query: expect.any(Function) });
    expect(payload.regions.map((r) => r.region)).toEqual(['B.K', 'Sihala', 'Urban-I', 'Nilore', 'Urban-II', 'Tarnol']);
    // u1 and u3 used a plan; u2 and u4 did not — 2 of 4.
    expect(payload.overview).toEqual({ teachers: 4, active: 2, nonActive: 2, activePct: 50, activeSectors: 2 });
    expect(payload.schools.map((s) => [s.region, s.name, s.active, s.nonActive])).toEqual([
      ['B.K', 'IMSG B.K 1', 1, 1], ['Sihala', 'IMCG Sihala', 1, 0], ['Urban-I', null, 0, 1],
    ]);
    expect(payload.schools[2].schoolId).toBe('no-school:Urban-I');
  });

  it('band=midhigh: the RDF Mid / High population over 6-12 traces', async () => {
    tableStates.app_settings = flag([VIEWER]);
    const { statusCode, payload } = await call('get', ROUTE, { userId: VIEWER, query: { band: 'midhigh' } });
    expect(statusCode).toBe(200);
    expect(payload.band).toBe('midhigh');
    // u5 (Tarnol, at a school off FDE's list) has a 6-12 delivery; u3 has no 6-12 trace.
    expect(payload.overview).toEqual({ teachers: 2, active: 1, nonActive: 1, activePct: 50, activeSectors: 1 });
    expect(payload.byGrade.rows.map((r) => r.grade)).toEqual([6, 7, 8, 9, 10, 11, 12]);
    expect(payload.schools.map((s) => [s.region, s.name])).toEqual([['Sihala', 'IMCG Sihala'], ['Tarnol', null]]);
    const a = queries.find((q) => /niete_lp612/.test(q.sql));
    expect(a.params[0].sort()).toEqual(['u3', 'u5']);
  });

  it('a region filter scopes the overview and the schools; the six cards stay', async () => {
    tableStates.app_settings = flag([VIEWER]);
    const { statusCode, payload } = await call('get', ROUTE, { userId: VIEWER, query: { region: 'sihala' } });
    expect(statusCode).toBe(200);
    expect(payload.schools.map((s) => s.name)).toEqual(['IMCG Sihala']);
    expect(payload.overview.teachers).toBe(1);
    expect(payload.regions).toHaveLength(6);
  });

  it('an unknown region or band is a 400 and reads no data', async () => {
    tableStates.app_settings = flag([VIEWER]);
    for (const region of ['Lahore', 'unassigned']) {
      // eslint-disable-next-line no-await-in-loop
      const { statusCode, payload } = await call('get', ROUTE, { userId: VIEWER, query: { region } });
      expect(statusCode).toBe(400);
      expect(payload).toEqual({ success: false, error: 'Unknown region.' });
    }
    for (const band of ['high', 'secondary']) {
      // eslint-disable-next-line no-await-in-loop
      const { statusCode, payload } = await call('get', ROUTE, { userId: VIEWER, query: { band } });
      expect(statusCode).toBe(400);
      expect(payload).toEqual({ success: false, error: 'Unknown band.' });
    }
    expect(queries).toHaveLength(0);
    expect(loadAnalyticsLists).not.toHaveBeenCalled();
  });

  it('the window reaches SQL as the Pakistan days\' UTC instants; a junk date is dropped', async () => {
    tableStates.app_settings = flag([VIEWER]);
    await call('get', ROUTE, { userId: VIEWER, query: { from: '2026-10-04', to: '2026-10-13' } });
    const a = queries.find((q) => /lesson_plans/.test(q.sql));
    expect(a.params.slice(1)).toEqual(['2026-10-03T19:00:00.000Z', '2026-10-13T19:00:00.000Z']);

    queries.length = 0;
    const { payload } = await call('get', ROUTE, { userId: VIEWER, query: { from: "2026-10-01'; drop", to: 'yesterday' } });
    expect(payload.range).toEqual({ from: null, to: null });
    for (const q of queries) expect(JSON.stringify(q.params || [])).not.toContain('drop');
  });

  it('the lists are not loaded (sandbox): the v7 roster and schools, never zeros', async () => {
    tableStates.app_settings = flag([VIEWER]);
    loadAnalyticsLists.mockResolvedValue({
      fdeSchoolEmis: null, primary: null, midHigh: null, coaches: null, asOf: {},
      missing: { schools: true, teachers: true, coaches: true },
    });
    const { statusCode, payload } = await call('get', ROUTE, { userId: VIEWER });
    expect(statusCode).toBe(200);
    // ROSTER: u1, u2 at s1 (B.K) and u3 at s2 (Sihala) are Primary; s3's region is not one of the six.
    expect(payload.overview).toEqual({ teachers: 3, active: 2, nonActive: 1, activePct: 66.7, activeSectors: 2 });
    expect(payload.basis).toMatchObject({ schools: 'all', teachers: 'roster' });
  });

  it('the cache is keyed by the lists too: lists arriving change the answer at once', async () => {
    tableStates.app_settings = flag([VIEWER]);
    const none = { fdeSchoolEmis: null, primary: null, midHigh: null, coaches: null, asOf: { schools: null, teachers: null, coaches: null }, missing: { schools: true, teachers: true, coaches: true } };
    loadAnalyticsLists.mockResolvedValueOnce(none);
    const before = await call('get', ROUTE, { userId: VIEWER });
    expect(before.payload.basis.teachers).toBe('roster');
    const after = await call('get', ROUTE, { userId: VIEWER });
    expect(after.payload.basis.teachers).toBe('rdf');
    expect(after.payload.overview.teachers).toBe(4);
  });

  it('the lists cannot be read: a 500, and nothing shown', async () => {
    tableStates.app_settings = flag([VIEWER]);
    loadAnalyticsLists.mockRejectedValueOnce(new Error('app_settings unreadable'));
    const { statusCode, payload } = await call('get', ROUTE, { userId: VIEWER });
    expect(statusCode).toBe(500);
    expect(payload).toEqual({ success: false, error: 'Failed to load LP engagement.' });
  });

  it('carries no teacher identity', async () => {
    tableStates.app_settings = flag([VIEWER]);
    const { payload } = await call('get', ROUTE, { userId: VIEWER });
    expect(JSON.stringify(payload)).not.toMatch(/"u\d"|user_id|userId|phone/);
  });
});

describe('GET /analytics/lp-engagement — the cache', () => {
  it('caches for ten minutes per from|to|region|band: a repeat asks the database nothing', async () => {
    tableStates.app_settings = flag([VIEWER]);
    const q = { from: '2026-10-04', to: '2026-10-13' };
    const first = await call('get', ROUTE, { userId: VIEWER, query: q });
    const n = queries.length;
    const again = await call('get', ROUTE, { userId: VIEWER, query: q });
    expect(queries.length).toBe(n);
    expect(again.payload).toEqual(first.payload);

    await call('get', ROUTE, { userId: VIEWER, query: { ...q, band: 'midhigh' } });
    expect(queries.length).toBeGreaterThan(n);
    const m = queries.length;
    await call('get', ROUTE, { userId: VIEWER, query: { ...q, region: 'B.K' } });
    expect(queries.length).toBeGreaterThan(m);
  });

  it('the cache does not outlive ten minutes', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    try {
      tableStates.app_settings = flag([VIEWER]);
      await call('get', ROUTE, { userId: VIEWER });
      const n = queries.length;
      jest.setSystemTime(Date.now() + 10 * 60 * 1000 + 1);
      await call('get', ROUTE, { userId: VIEWER });
      expect(queries.length).toBeGreaterThan(n);
    } finally {
      jest.useRealTimers();
    }
  });

  it('is its own cache: a cached schools answer does not answer the LP tab', async () => {
    tableStates.app_settings = flag([VIEWER]);
    await call('get', '/analytics/schools', { userId: VIEWER });
    const n = queries.length;
    const { payload } = await call('get', ROUTE, { userId: VIEWER });
    expect(queries.length).toBeGreaterThan(n);
    expect(payload.overview).toHaveProperty('activePct');
  });
});
