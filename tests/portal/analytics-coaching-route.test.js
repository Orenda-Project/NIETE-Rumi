/**
 * GET /api/portal/analytics/coaching (bd-97x22y.1) — the schools-analytics v6 Coaching tab.
 *
 * Same gate, window and region rules as /analytics/schools (PLAN v6 §3): requirePortalAuth →
 * requireAnalyticsViewer (the portal_analytics_only list: not on it 403, unreadable 500);
 * analyticsRange; the six ICT regions only, anything else ("unassigned" included) a 400; a
 * ten-minute response cache keyed from|to|region that sits behind the gate. A separate endpoint
 * so the Coaching tab's cost never slows the other tabs.
 */

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
const ROUTE = '/analytics/coaching';

let visitRows;
const SCHOOLS = () => [
  { id: 's1', name: 'IMSG B.K 1', emis: '101', region: 'B.K', is_active: true, is_probable_test: false, coach_visits: visitRows.s1 },
  { id: 's2', name: 'IMCG Sihala', emis: '202', region: 'Sihala', is_active: true, is_probable_test: false, coach_visits: visitRows.s2 },
  { id: 's5', name: 'IMS B.K 2', emis: '105', region: 'B.K', is_active: true, is_probable_test: false, coach_visits: visitRows.s5 },
  // Outside the six regions / inactive: in no number (bd-s6qbts.4).
  { id: 's3', name: 'No Region School', emis: '303', region: null, is_active: true, is_probable_test: false, coach_visits: 6 },
  { id: 's4', name: 'Durbeen', emis: null, region: 'Durbeen', is_active: true, is_probable_test: false, coach_visits: 4 },
  { id: 's6', name: 'Closed School', emis: '606', region: 'Tarnol', is_active: false, is_probable_test: false, coach_visits: 8 },
];
const COACH_SCHOOLS = [
  { coach_id: 'k1', school_id: 's1', coach_name: 'Saima Jabeen' },
  { coach_id: 'k1', school_id: 's2', coach_name: 'Saima Jabeen' }, // two regions
  { coach_id: 'k2', school_id: 's5', coach_name: 'Abdul Malik' },
  { coach_id: 'k3', school_id: 's4', coach_name: 'Out Of Six' }, // only an out-of-six school
  { coach_id: 'k4', school_id: 's6', coach_name: 'Inactive Only' }, // only an inactive school
];

function poolRows(sql) {
  if (/FROM leader_schools/i.test(sql)) return COACH_SCHOOLS;
  if (/FROM schools sch/i.test(sql)) return SCHOOLS();
  return [];
}

beforeEach(() => {
  jest.resetModules();
  tableStates = {};
  queries = [];
  visitRows = { s1: 3, s2: 2, s5: 0 };
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

describe('GET /analytics/coaching — the gate', () => {
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

describe('GET /analytics/coaching — the answer', () => {
  it('answers a listed viewer with exactly the §3 contract keys', async () => {
    tableStates.app_settings = flag([VIEWER]);
    const { statusCode, payload } = await call('get', ROUTE, { userId: VIEWER, query: { from: '2026-10-01', to: '2026-10-13' } });
    expect(statusCode).toBe(200);
    expect(Object.keys(payload).sort()).toEqual(['overview', 'range', 'regions', 'schools', 'success']);
    expect(payload.success).toBe(true);
    expect(payload.range).toEqual({ from: '2026-10-01', to: '2026-10-13' });
    expect(Object.keys(payload.overview).sort()).toEqual(['coachVisits', 'coaches', 'schoolsVisited']);
    for (const r of payload.regions) expect(Object.keys(r).sort()).toEqual(['coachNames', 'coachVisits', 'coaches', 'region', 'schools', 'schoolsVisited']);
    for (const s of payload.schools) expect(Object.keys(s).sort()).toEqual(['coachVisits', 'emis', 'name', 'region', 'schoolId']);
  });

  it('six regions only; schools outside them (no region, Durbeen, inactive) are in no number', async () => {
    tableStates.app_settings = flag([VIEWER]);
    const { payload } = await call('get', ROUTE, { userId: VIEWER, query: { from: '2026-10-01', to: '2026-10-13' } });
    expect(payload.regions.map((r) => r.region)).toEqual(['B.K', 'Sihala', 'Urban-I', 'Nilore', 'Urban-II', 'Tarnol']);
    expect(payload.schools.map((s) => s.name)).toEqual(['IMS B.K 2', 'IMSG B.K 1', 'IMCG Sihala']);
    expect(JSON.stringify(payload)).not.toMatch(/unassigned|Durbeen|No Region School|Closed School/i);
    // k1 covers B.K and Sihala (in both cards, once overall); k2 is B.K; k3 and k4 only have
    // uncounted schools.
    expect(payload.overview).toEqual({ coaches: 2, coachVisits: 5, schoolsVisited: 2 });
    const card = (r) => payload.regions.find((x) => x.region === r);
    expect(card('B.K')).toEqual({ region: 'B.K', coaches: 2, coachVisits: 3, schoolsVisited: 1, schools: 2, coachNames: ['Abdul Malik', 'Saima Jabeen'] });
    expect(card('Sihala')).toEqual({ region: 'Sihala', coaches: 1, coachVisits: 2, schoolsVisited: 1, schools: 1, coachNames: ['Saima Jabeen'] });
    // Tarnol's only school is inactive: no school, no coach, no name.
    expect(card('Tarnol')).toEqual({ region: 'Tarnol', coaches: 0, coachVisits: 0, schoolsVisited: 0, schools: 0, coachNames: [] });
    expect(JSON.stringify(payload)).not.toMatch(/Out Of Six|Inactive Only/);
  });

  it('Σ school coachVisits = overview coachVisits', async () => {
    tableStates.app_settings = flag([VIEWER]);
    const { payload } = await call('get', ROUTE, { userId: VIEWER });
    expect(payload.schools.reduce((n, s) => n + s.coachVisits, 0)).toBe(payload.overview.coachVisits);
    expect(payload.regions.reduce((n, r) => n + r.coachVisits, 0)).toBe(payload.overview.coachVisits);
  });

  it('a region filter scopes the overview and the schools to that region card', async () => {
    tableStates.app_settings = flag([VIEWER]);
    const { statusCode, payload } = await call('get', ROUTE, { userId: VIEWER, query: { region: 'sihala' } });
    expect(statusCode).toBe(200);
    expect(payload.schools.map((s) => s.name)).toEqual(['IMCG Sihala']);
    const card = payload.regions.find((r) => r.region === 'Sihala');
    expect(payload.overview).toEqual({ coaches: card.coaches, coachVisits: card.coachVisits, schoolsVisited: card.schoolsVisited });
    expect(payload.regions).toHaveLength(6);
  });

  it('an unknown region, or unassigned, is a 400 and reads no data', async () => {
    tableStates.app_settings = flag([VIEWER]);
    for (const region of ['Lahore', 'unassigned', 'Unassigned']) {
      // eslint-disable-next-line no-await-in-loop
      const { statusCode, payload } = await call('get', ROUTE, { userId: VIEWER, query: { region } });
      expect(statusCode).toBe(400);
      expect(payload).toEqual({ success: false, error: 'Unknown region.' });
    }
    expect(queries).toHaveLength(0);
  });

  it('an empty window: zero visits and zero schools visited, never null; coaches are not window-dependent', async () => {
    tableStates.app_settings = flag([VIEWER]);
    visitRows = { s1: 0, s2: 0, s5: 0 };
    const { payload } = await call('get', ROUTE, { userId: VIEWER, query: { from: '2020-01-01', to: '2020-01-02' } });
    expect(payload.overview).toEqual({ coaches: 2, coachVisits: 0, schoolsVisited: 0 });
    for (const r of payload.regions) {
      expect(r.coachVisits).toBe(0);
      expect(r.schoolsVisited).toBe(0);
      expect(r.coaches).not.toBeNull();
    }
    for (const s of payload.schools) expect(s.coachVisits).toBe(0);
  });

  it('two set-based reads; the window reaches SQL as the Pakistan days, a junk date is dropped', async () => {
    tableStates.app_settings = flag([VIEWER]);
    await call('get', ROUTE, { userId: VIEWER, query: { from: '2026-10-01', to: '2026-10-13' } });
    expect(queries).toHaveLength(2);
    const visits = queries.find((q) => /observation_schedules/.test(q.sql));
    expect(visits.params).toEqual(['2026-10-01', '2026-10-13']);

    queries.length = 0;
    const { payload } = await call('get', ROUTE, { userId: VIEWER, query: { from: "2026-10-01'; drop", to: 'yesterday' } });
    expect(payload.range).toEqual({ from: null, to: null });
    for (const q of queries) expect(JSON.stringify(q.params || [])).not.toContain('drop');
  });

  it('carries no coach id and no teacher identity; coach names only in regions[].coachNames (v7)', async () => {
    tableStates.app_settings = flag([VIEWER]);
    const { payload } = await call('get', ROUTE, { userId: VIEWER });
    expect(JSON.stringify(payload)).not.toMatch(/"k\d"|coach_id|coachId|coach_name|user_id|userId|phone/);
    expect(JSON.stringify({ overview: payload.overview, schools: payload.schools })).not.toMatch(/Saima|Abdul/);
  });
});

describe('GET /analytics/coaching — the cache', () => {
  it('caches for ten minutes per from|to|region: a repeat asks the database nothing', async () => {
    tableStates.app_settings = flag([VIEWER]);
    const q = { from: '2026-10-01', to: '2026-10-13' };
    const first = await call('get', ROUTE, { userId: VIEWER, query: q });
    const n = queries.length;
    const again = await call('get', ROUTE, { userId: VIEWER, query: q });
    expect(queries.length).toBe(n);
    expect(again.payload).toEqual(first.payload);

    await call('get', ROUTE, { userId: VIEWER, query: { ...q, region: 'B.K' } });
    expect(queries.length).toBeGreaterThan(n);
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

  it('is its own cache: a cached schools answer does not answer the coaching tab', async () => {
    tableStates.app_settings = flag([VIEWER]);
    await call('get', '/analytics/schools', { userId: VIEWER });
    const n = queries.length;
    const { payload } = await call('get', ROUTE, { userId: VIEWER });
    expect(queries.length).toBeGreaterThan(n);
    expect(Object.keys(payload.overview).sort()).toEqual(['coachVisits', 'coaches', 'schoolsVisited']);
  });
});
