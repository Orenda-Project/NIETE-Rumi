/**
 * GET /api/portal/analytics/observations (bd-97x22y.5) — the schools-analytics v7 Observations tab:
 * her Human / Digital Coach FICO section breakdown (PLAN v7 "Observations").
 *
 * Same gate, window and region rules as /analytics/schools and /analytics/coaching:
 * requirePortalAuth → requireAnalyticsViewer (the portal_analytics_only list: not on it 403,
 * unreadable 500); analyticsRange; the six ICT regions only, anything else a 400; its own
 * ten-minute response cache keyed from|to|region, behind the gate. Its own endpoint so the
 * /analytics/schools answer (and its cost) stays exactly as it was.
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
const ROUTE = '/analytics/observations';

const SCHOOLS = [
  { id: 's1', name: 'IMSG B.K 1', emis: '101', region: 'B.K', is_active: true, is_probable_test: false },
  { id: 's2', name: 'IMCG Sihala', emis: '202', region: 'Sihala', is_active: true, is_probable_test: false },
  // Outside the six regions / inactive: in no number (bd-s6qbts.4).
  { id: 's3', name: 'No Region School', emis: '303', region: null, is_active: true, is_probable_test: false },
  { id: 's6', name: 'Closed School', emis: '606', region: 'Tarnol', is_active: false, is_probable_test: false },
];
let sessionRows;
const sect = (lpf, hlp, se, assessed = null) => ({
  lesson_plan_fidelity: { domain_score: lpf[0], domain_max: lpf[1], assessed },
  high_leverage_practices: { domain_score: hlp[0], domain_max: hlp[1], assessed: null },
  student_engagement: { domain_score: se[0], domain_max: se[1], assessed: null },
});
const DOMAINS = {
  c1: sect([30, 40], [36, 48], [21, 28], true), // B 75, C 75, D 75
  c2: sect([26, 40], [24, 48], [14, 28], false), // B not assessed; C 50, D 50
  c3: sect([20, 40], [48, 48], [28, 28]), // B 50, C 100, D 100
  c4: sect([40, 40], [0, 48], [0, 28]), // in a no-region school: in no number
};

// The score read's section columns, as Postgres' #>> hands them back (text).
const text = (v) => (v === null || v === undefined ? null : String(v));
const cols = (d) => Object.fromEntries([['b', 'lesson_plan_fidelity'], ['c', 'high_leverage_practices'], ['d', 'student_engagement']]
  .flatMap(([k, key]) => [[`${k}_score`, text(d[key].domain_score)], [`${k}_max`, text(d[key].domain_max)], [`${k}_assessed`, text(d[key].assessed)]]));

function poolRows(sql, params) {
  if (/'scores'/.test(sql)) {
    return params[0].map((id) => ({ id, updated_at: '2026-10-02T00:00:00Z', scores: { overall_marks: 70, overall_max_marks: 100 }, ...cols(DOMAINS[id]) }));
  }
  if (/FROM schools/i.test(sql)) return SCHOOLS;
  if (/FROM coaching_sessions c/i.test(sql)) return sessionRows;
  return [];
}

beforeEach(() => {
  jest.resetModules();
  tableStates = {};
  queries = [];
  sessionRows = [
    { id: 'c1', updated_at: '2026-10-02T00:00:00Z', user_id: 't1', school_id: 's1', is_test: false, observation_type: null },
    { id: 'c2', updated_at: '2026-10-02T00:00:00Z', user_id: 't1', school_id: 's1', is_test: false, observation_type: null },
    { id: 'c3', updated_at: '2026-10-02T00:00:00Z', user_id: 't2', school_id: 's2', is_test: false, observation_type: 'leader_observation' },
    { id: 'c4', updated_at: '2026-10-02T00:00:00Z', user_id: 't3', school_id: 's3', is_test: false, observation_type: null },
  ];
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

const KIND_KEYS = ['overview', 'regions', 'schools'];
const SECTION_KEYS = ['sectionB', 'sectionBN', 'sectionC', 'sectionCN', 'sectionD', 'sectionDN'];

describe('GET /analytics/observations — the gate', () => {
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

  it('500s (and shows nothing) when the flag cannot be read', async () => {
    tableStates.app_settings = { error: { message: 'timeout' } };
    const { statusCode, payload } = await call('get', ROUTE, { userId: VIEWER });
    expect(statusCode).toBe(500);
    expect(payload.success).toBe(false);
    expect(payload.dc).toBeUndefined();
    expect(queries).toHaveLength(0);
  });

  it('the gate is checked even when the answer is cached', async () => {
    tableStates.app_settings = flag([VIEWER]);
    await call('get', ROUTE, { userId: VIEWER });
    const { statusCode } = await call('get', ROUTE, { userId: TEACHER });
    expect(statusCode).toBe(403);
  });
});

describe('GET /analytics/observations — the answer', () => {
  it('answers a listed viewer with exactly the v7 contract keys', async () => {
    tableStates.app_settings = flag([VIEWER]);
    const { statusCode, payload } = await call('get', ROUTE, { userId: VIEWER, query: { from: '2026-10-01', to: '2026-10-13' } });
    expect(statusCode).toBe(200);
    expect(Object.keys(payload).sort()).toEqual(['dc', 'human', 'range', 'success']);
    expect(payload.success).toBe(true);
    expect(payload.range).toEqual({ from: '2026-10-01', to: '2026-10-13' });
    for (const kind of ['dc', 'human']) {
      expect(Object.keys(payload[kind]).sort()).toEqual(KIND_KEYS);
      expect(Object.keys(payload[kind].overview).sort()).toEqual(['observations', 'schools', 'sectorsActive', 'teachersObserved', ...SECTION_KEYS].sort());
      for (const r of payload[kind].regions) expect(Object.keys(r).sort()).toEqual(['observations', 'region', 'schools', 'teachersObserved', ...SECTION_KEYS].sort());
      for (const s of payload[kind].schools) expect(Object.keys(s).sort()).toEqual(['emis', 'name', 'observations', 'region', 'schoolId', 'teachersObserved', ...SECTION_KEYS].sort());
    }
  });

  it('B/C/D per kind from the session domains: B not assessed is not scored; uncounted schools are in no number', async () => {
    tableStates.app_settings = flag([VIEWER]);
    const { payload } = await call('get', ROUTE, { userId: VIEWER });
    expect(payload.dc.overview).toEqual({
      schools: 2, observations: 2, teachersObserved: 1, sectorsActive: 1,
      sectionB: 75, sectionBN: 1, sectionC: 62.5, sectionCN: 2, sectionD: 62.5, sectionDN: 2,
    });
    expect(payload.human.overview).toEqual({
      schools: 2, observations: 1, teachersObserved: 1, sectorsActive: 1,
      sectionB: 50, sectionBN: 1, sectionC: 100, sectionCN: 1, sectionD: 100, sectionDN: 1,
    });
    expect(payload.dc.regions.map((r) => r.region)).toEqual(['B.K', 'Sihala', 'Urban-I', 'Nilore', 'Urban-II', 'Tarnol']);
    expect(payload.dc.schools.map((s) => s.name)).toEqual(['IMSG B.K 1', 'IMCG Sihala']);
    expect(JSON.stringify(payload)).not.toMatch(/unassigned|No Region School|Closed School/i);
  });

  it('a region filter scopes each kind\'s overview and schools to that region card', async () => {
    tableStates.app_settings = flag([VIEWER]);
    const { statusCode, payload } = await call('get', ROUTE, { userId: VIEWER, query: { region: 'sihala' } });
    expect(statusCode).toBe(200);
    for (const kind of ['dc', 'human']) {
      expect(payload[kind].schools.map((s) => s.name)).toEqual(['IMCG Sihala']);
      const { region, ...card } = payload[kind].regions.find((r) => r.region === 'Sihala');
      const { sectorsActive, ...ov } = payload[kind].overview;
      expect(ov).toEqual(card);
      expect(payload[kind].regions).toHaveLength(6);
    }
  });

  it('an unknown region, or unassigned, is a 400 and reads no data', async () => {
    tableStates.app_settings = flag([VIEWER]);
    for (const region of ['Lahore', 'unassigned']) {
      // eslint-disable-next-line no-await-in-loop
      const { statusCode, payload } = await call('get', ROUTE, { userId: VIEWER, query: { region } });
      expect(statusCode).toBe(400);
      expect(payload).toEqual({ success: false, error: 'Unknown region.' });
    }
    expect(queries).toHaveLength(0);
  });

  it('two set-based reads plus one score read; the window reaches SQL as UTC instants; a junk date is dropped', async () => {
    tableStates.app_settings = flag([VIEWER]);
    await call('get', ROUTE, { userId: VIEWER, query: { from: '2026-10-01', to: '2026-10-13' } });
    expect(queries).toHaveLength(3);
    const sessions = queries.find((q) => /FROM coaching_sessions c/.test(q.sql) && !/'scores'/.test(q.sql));
    expect(sessions.params).toEqual(['2026-09-30T19:00:00.000Z', '2026-10-13T19:00:00.000Z']);

    queries.length = 0;
    const { payload } = await call('get', ROUTE, { userId: VIEWER, query: { from: "2026-10-01'; drop", to: 'yesterday' } });
    expect(payload.range).toEqual({ from: null, to: null });
    for (const q of queries) expect(JSON.stringify(q.params || [])).not.toContain('drop');
  });

  it('carries no teacher identity', async () => {
    tableStates.app_settings = flag([VIEWER]);
    const { payload } = await call('get', ROUTE, { userId: VIEWER });
    expect(JSON.stringify(payload)).not.toMatch(/"t\d"|user_id|userId|phone|teacherName/);
  });
});

describe('GET /analytics/observations — the cache and the shared score memo', () => {
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

  it('is its own cache — but after /analytics/schools read the sessions, it reads no score again (one memo)', async () => {
    tableStates.app_settings = flag([VIEWER]);
    await call('get', '/analytics/schools', { userId: VIEWER });
    const scoreReads = () => queries.filter((q) => /'scores'/.test(q.sql)).length;
    expect(scoreReads()).toBe(1);
    const n = queries.length;
    const { payload } = await call('get', ROUTE, { userId: VIEWER });
    expect(queries.length).toBeGreaterThan(n); // its own reads: the answer was not the schools one
    expect(scoreReads()).toBe(1); // …but no second heavy read
    expect(payload.dc.overview.sectionC).toBe(62.5);
  });

  it('/analytics/schools answers exactly as before: no section field leaks into it', async () => {
    tableStates.app_settings = flag([VIEWER]);
    await call('get', ROUTE, { userId: VIEWER });
    const { payload } = await call('get', '/analytics/schools', { userId: VIEWER });
    expect(JSON.stringify(payload)).not.toMatch(/section|domains|teachersObserved|sectorsActive/);
    expect(Object.keys(payload.overview).sort()).toEqual([
      'avgFico', 'avgHitl', 'dcObservations', 'ficoN', 'hitlN', 'humanObservations', 'lpsOpened', 'schools',
      'teachers', 'teachersOpenedLp', 'teachersTrained', 'teachersWithDc', 'trainingModules',
    ]);
  });
});
