/**
 * GET /api/portal/analytics/lp-engagement (schools analytics v7) — the LP Engagement tab, her
 * formula 1 to 1 (services/lp-engagement.service.js has the definitions).
 *
 * Same gate, window and region rules as /analytics/schools: requirePortalAuth →
 * requireAnalyticsViewer (the portal_analytics_only list: not on it 403, unreadable 500);
 * analyticsRange; the six ICT regions only, anything else a 400; plus ?band=primary|midhigh (her
 * Primary / Mid-High toggle; blank is Primary, anything else a 400). A ten-minute response cache
 * keyed from|to|region|band that sits behind the gate, its own so this tab never slows the others.
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
const ROUTE = '/analytics/lp-engagement';
const W1 = '2026-10-04';

const SCHOOLS = [
  { id: 's1', name: 'IMSG B.K 1', emis: '101', region: 'B.K', is_active: true, is_probable_test: false },
  { id: 's2', name: 'IMCG Sihala', emis: '202', region: 'Sihala', is_active: true, is_probable_test: false },
  // Outside the six regions / inactive: in no number.
  { id: 's3', name: 'No Region School', emis: '303', region: null, is_active: true, is_probable_test: false },
  { id: 's4', name: 'Durbeen', emis: null, region: 'Durbeen', is_active: true, is_probable_test: false },
  { id: 's6', name: 'Closed School', emis: '606', region: 'Tarnol', is_active: false, is_probable_test: false },
];
const TEACHERS = [
  { id: 'u1', school_id: 's1', bands: ['PRIMARY'] },
  { id: 'u2', school_id: 's1', bands: ['PRIMARY'] },
  { id: 'u3', school_id: 's2', bands: ['PRIMARY', 'HIGH'] },
  { id: 'u4', school_id: 's3', bands: ['PRIMARY'] },
  { id: 'u5', school_id: 's4', bands: ['MIDDLE'] },
];
let activity;

function poolRows(sql) {
  if (/information_schema\.columns/.test(sql)) return [{ column_name: 'teacher_level' }];
  if (/niete_lp_opens/.test(sql)) return activity;
  if (/FROM schools\b/.test(sql)) return SCHOOLS;
  if (/FROM users u/.test(sql)) return TEACHERS;
  return [];
}

beforeEach(() => {
  jest.resetModules();
  tableStates = {};
  queries = [];
  activity = [
    // u1: three Urdu plans in a week → 0.6 → On; u3: one → 0.2 → Off; u2 nothing → Off.
    { user_id: 'u1', week: W1, source: 'open', plan_kind: 'k5', plan_ref: 'grade_2_urdu_ch1_seg1' },
    { user_id: 'u1', week: W1, source: 'open', plan_kind: 'k5', plan_ref: 'grade_2_urdu_ch1_seg2' },
    { user_id: 'u1', week: W1, source: 'generated', grade: '2', subject: 'urdu', n: 1 },
    { user_id: 'u3', week: W1, source: 'open', plan_kind: 'k5', plan_ref: 'grade_4_math_ch1_seg1' },
    { user_id: 'u3', week: W1, source: 'open', plan_kind: 'g612', plan_ref: 'grade_9_physics.c01.p008-009' },
    { user_id: 'u3', week: W1, source: 'open', plan_kind: 'g612', plan_ref: 'grade_9_physics.c01.p010-012' },
    { user_id: 'u4', week: W1, source: 'generated', grade: '1', subject: 'english', n: 5 },
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
  it('answers a listed viewer with the contract keys', async () => {
    tableStates.app_settings = flag([VIEWER]);
    const { statusCode, payload } = await call('get', ROUTE, { userId: VIEWER, query: { from: '2026-10-04', to: '2026-10-13' } });
    expect(statusCode).toBe(200);
    expect(Object.keys(payload).sort()).toEqual([
      'band', 'byGrade', 'bySubject', 'lpOpensLoggedSince', 'overview', 'range', 'regions', 'schools',
      'sectorGrades', 'sectorSubjects', 'success',
    ]);
    expect(payload).toMatchObject({ success: true, band: 'primary', lpOpensLoggedSince: '2026-10-04', range: { from: '2026-10-04', to: '2026-10-13' } });
    expect(Object.keys(payload.overview).sort()).toEqual(['activeSectors', 'lpPct', 'lpRatio', 'moderate', 'offSchedule', 'onSchedule', 'teachers']);
    for (const r of payload.regions) {
      expect(Object.keys(r).sort()).toEqual(['lpPct', 'lpRatio', 'moderate', 'moderatePct', 'offPct', 'offSchedule', 'onPct', 'onSchedule', 'region', 'teachers']);
    }
    for (const s of payload.schools) expect(Object.keys(s).sort()).toEqual(['emis', 'lpPct', 'lpRatio', 'name', 'region', 'schoolId', 'status', 'teachers']);
    for (const r of payload.bySubject.rows) expect(Object.keys(r)).toEqual(expect.arrayContaining(['subject', 'name', 'lpPct', 'onPct', 'moderatePct', 'offPct']));
    for (const r of payload.byGrade.rows) expect(Object.keys(r)).toEqual(expect.arrayContaining(['grade', 'lpPct', 'onPct', 'moderatePct', 'offPct']));
  });

  it('Primary: her numbers over the six regions; schools outside them in no number', async () => {
    tableStates.app_settings = flag([VIEWER]);
    const { payload } = await call('get', ROUTE, { userId: VIEWER });
    expect(payload.regions.map((r) => r.region)).toEqual(['B.K', 'Sihala', 'Urban-I', 'Nilore', 'Urban-II', 'Tarnol']);
    // u1 0.6, u2 0, u3 0.2 over 3 Primary teachers (u4's school has no region)
    expect(payload.overview).toEqual({ teachers: 3, lpRatio: 0.2667, lpPct: 27, activeSectors: 2, onSchedule: 1, moderate: 0, offSchedule: 2 });
    expect(payload.schools.map((s) => [s.name, s.lpPct, s.status])).toEqual([['IMSG B.K 1', 30, 'off'], ['IMCG Sihala', 20, 'off']]);
    expect(JSON.stringify(payload)).not.toMatch(/unassigned|Durbeen|No Region School|Closed School/i);
  });

  it('band=midhigh: Mid/High teachers over 6-12 plans', async () => {
    tableStates.app_settings = flag([VIEWER]);
    const { statusCode, payload } = await call('get', ROUTE, { userId: VIEWER, query: { band: 'midhigh' } });
    expect(statusCode).toBe(200);
    expect(payload.band).toBe('midhigh');
    // u3 (HIGH, Sihala): two Physics plans → 0.4 → Moderate; u5's school is outside the six.
    expect(payload.overview).toEqual({ teachers: 1, lpRatio: 0.4, lpPct: 40, activeSectors: 1, onSchedule: 0, moderate: 1, offSchedule: 0 });
    expect(payload.byGrade.rows.map((r) => r.grade)).toEqual([6, 7, 8, 9, 10, 11, 12]);
    const lp = queries.find((q) => /niete_lp_opens/.test(q.sql));
    expect(lp.params).toEqual(['g612', 6, 12]);
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
  });

  it('the window reaches SQL as the Pakistan days\' UTC instants; a junk date is dropped', async () => {
    tableStates.app_settings = flag([VIEWER]);
    await call('get', ROUTE, { userId: VIEWER, query: { from: '2026-10-04', to: '2026-10-13' } });
    const lp = queries.find((q) => /niete_lp_opens/.test(q.sql));
    expect(lp.params).toEqual(['2026-10-03T19:00:00.000Z', '2026-10-13T19:00:00.000Z', 'k5', 1, 5]);

    queries.length = 0;
    const { payload } = await call('get', ROUTE, { userId: VIEWER, query: { from: "2026-10-01'; drop", to: 'yesterday' } });
    expect(payload.range).toEqual({ from: null, to: null });
    for (const q of queries) expect(JSON.stringify(q.params || [])).not.toContain('drop');
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
    expect(payload.overview).toHaveProperty('lpPct');
  });
});
