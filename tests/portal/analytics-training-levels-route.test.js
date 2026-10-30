/**
 * GET /api/portal/analytics/training-levels (bd-97x22y.4) — the v7 Trainings tab, her levels 1 to 1.
 *
 * Same gate and regions as /analytics/schools: requirePortalAuth → requireAnalyticsViewer (the
 * portal_analytics_only list: not on it 403, unreadable 500, checked on every request even when the
 * answer is cached); the six ICT regions only, anything else a 400; ?band=primary|midhigh (her two tabs;
 * also all), anything else a 400. All time, as hers: no window. The answer is summarised per request from
 * an in-memory snapshot of the states read, refreshed at most every 30 minutes and never waited on once
 * there is one (services/training-levels-analytics.service.js).
 */

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
const ROUTE = '/analytics/training-levels';

const LEVELS = [
  { id: '1', name: 'Aspiring Teacher', order_index: 0 },
  { id: '2', name: 'Emerging Practitioner', order_index: 1 },
  { id: '3', name: 'Skilled Practitioner', order_index: 2 },
  { id: '4', name: 'Teacher Leader', order_index: 3 },
];
const SCHOOLS = [
  { id: 's1', name: 'IMSG B.K 1', emis: '101', region: 'B.K', is_active: true, is_probable_test: false },
  { id: 's2', name: 'IMCG Sihala', emis: '202', region: 'Sihala', is_active: true, is_probable_test: false },
  { id: 's3', name: 'No Region School', emis: '303', region: null, is_active: true, is_probable_test: false },
  { id: 's4', name: 'Durbeen', emis: null, region: 'Durbeen', is_active: true, is_probable_test: false },
];
/** One programme member of the members read (the RDF population), with her facts. */
const mem = (user_id, extra = {}) => ({
  user_id, school_id: null, primary_cohort: false, mh_cohort: false, middle_band: false, high_band: false,
  cert_levels: null, active_levels: null, ox_mask: 0, ox_cert: false, ox_active: false, bh_mask: 0, bh_active: false,
  isaps_assigned: false, isaps_cert: false, isaps_mask: 0, isaps_active: false, ...extra,
});
let MEMBERS;
let LISTS;

const CATALOGUE = [
  ...[1, 2, 3, 4, 5, 6, 7].map((n) => ({ partner: 'oxbridge', bit: n - 1, name: `SESSION#${n}` })),
  { partner: 'beaconhouse', bit: 1, name: 'English' },
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => ({ partner: 'isaps', bit: n - 1, name: `Module ${n}` })),
];

function poolRows(sql) {
  if (/member_facts/.test(sql)) return MEMBERS;
  if (/'oxbridge' AS partner/.test(sql)) return CATALOGUE;
  if (/FROM training_levels/.test(sql)) return LEVELS;
  if (/FROM schools/.test(sql)) return SCHOOLS;
  return [];
}

beforeEach(() => {
  jest.resetModules();
  // bd-97daxo.3 — every analytics route reads the viewer's regions from the region registry.
  tableStates = { region_features: { rows: REGION_REGISTRY_ROWS } };
  queries = [];
  MEMBERS = [
    mem('p1', { primary_cohort: true, school_id: 's1', cert_levels: ['1', '2', '3', '4'] }),
    mem('p2', { primary_cohort: true, school_id: 's2', cert_levels: ['1'], active_levels: ['2'] }),
    // on the programme, no allocation sector, at a school off FDE's list
    mem('p3', { primary_cohort: true, school_id: 's3' }),
    mem('m1', {
      mh_cohort: true, middle_band: true, school_id: 's1', cert_levels: ['3', '4'], ox_mask: 127, ox_cert: true,
      ox_active: true, bh_mask: 2, bh_active: true, isaps_assigned: true, isaps_cert: true, isaps_mask: 511, isaps_active: true,
    }),
    mem('m2', { mh_cohort: true, high_band: true, school_id: 's2', ox_mask: 7, ox_active: true, isaps_assigned: true, isaps_active: true }),
  ];
  LISTS = {
    fdeSchoolEmis: new Set(['101', '202']),
    primary: new Map([['p1', 'B.K'], ['p2', 'Sihala']]),
    midHigh: new Map([['m1', 'B.K'], ['m2', 'Sihala']]),
    coaches: [],
    asOf: { schools: '2026-10-19', teachers: '2026-08-04', coaches: '2026-09-24' },
    missing: { schools: false, teachers: false, coaches: false },
  };
  jest.doMock('../../dashboard/lib/analytics-lists', () => ({
    ...jest.requireActual('../../dashboard/lib/analytics-lists'),
    loadAnalyticsLists: jest.fn(async () => LISTS),
  }));
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

afterEach(() => {
  jest.useRealTimers();
  jest.resetModules();
});

describe('GET /analytics/training-levels — the gate', () => {
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

  it('the gate is checked even when the snapshot is warm', async () => {
    tableStates.app_settings = flag([VIEWER]);
    await call('get', ROUTE, { userId: VIEWER });
    const { statusCode, payload } = await call('get', ROUTE, { userId: TEACHER });
    expect(statusCode).toBe(403);
    expect(payload.overview).toBeUndefined();
  });
});

describe('GET /analytics/training-levels — the answer', () => {
  it('answers a listed viewer with the contract keys, Primary by default', async () => {
    tableStates.app_settings = flag([VIEWER]);
    const { statusCode, payload } = await call('get', ROUTE, { userId: VIEWER });
    expect(statusCode).toBe(200);
    expect(Object.keys(payload).sort()).toEqual(['band', 'computedAt', 'noSector', 'overview', 'regions', 'schools', 'success']);
    expect(payload.success).toBe(true);
    expect(payload.band).toBe('primary');
    expect(new Date(payload.computedAt).toISOString()).toBe(payload.computedAt);
    expect(Object.keys(payload.overview).sort()).toEqual(['levels', 'passedAll', 'teachers']);
    for (const l of payload.overview.levels) {
      expect(Object.keys(l).sort()).toEqual(['inProgress', 'levelId', 'levelOrder', 'name', 'notStarted', 'passed', 'pctPassed', 'teachers']);
    }
    for (const r of payload.regions) expect(Object.keys(r).sort()).toEqual(['levels', 'passedAll', 'region', 'teachers']);
    for (const s of payload.schools) {
      expect(Object.keys(s).sort()).toEqual(['emis', 'levels', 'name', 'noSchool', 'passedAll', 'region', 'schoolId', 'teachers']);
      for (const l of s.levels) expect(Object.keys(l).sort()).toEqual(['levelOrder', 'passed', 'pctPassed', 'teachers']);
    }
  });

  it('Primary: the RDF primary-programme population, Passed = certificate, % passed of the whole population', async () => {
    tableStates.app_settings = flag([VIEWER]);
    const { payload } = await call('get', ROUTE, { userId: VIEWER, query: { band: 'primary' } });
    expect(payload.overview.levels.map((l) => [l.name, l.passed, l.inProgress, l.notStarted, l.teachers, l.pctPassed])).toEqual([
      ['Aspiring Teacher', 2, 0, 1, 3, 66.7],
      ['Emerging Practitioner', 1, 1, 1, 3, 33.3],
      ['Skilled Practitioner', 1, 0, 2, 3, 33.3],
      ['Teacher Leader', 1, 0, 2, 3, 33.3],
    ]);
    expect(payload.overview).toMatchObject({ passedAll: 1, teachers: 3 });
    // the member with no allocation sector is the noSector block, so the parts still sum to the whole
    expect(payload.noSector).toMatchObject({ teachers: 1, passedAll: 0 });
  });

  it('Mid/High: Skilled Practitioner and Teacher Leader only, over MIDDLE or HIGH teachers', async () => {
    tableStates.app_settings = flag([VIEWER]);
    const { statusCode, payload } = await call('get', ROUTE, { userId: VIEWER, query: { band: 'midhigh' } });
    expect(statusCode).toBe(200);
    expect(payload.band).toBe('midhigh');
    expect(payload.overview.levels.map((l) => [l.name, l.passed, l.inProgress, l.notStarted, l.teachers])).toEqual([
      ['Skilled Practitioner', 1, 0, 1, 2],
      ['Teacher Leader', 1, 0, 1, 2],
    ]);
    expect(payload.overview.partners.isaps).toMatchObject({ passed: 1, inProgress: 1, notStarted: 0, teachers: 2 });
  });

  it('Mid/High carries her partner panels: Oxbridge (sessions) and Beaconhouse (levels), and passed all = all four', async () => {
    tableStates.app_settings = flag([VIEWER]);
    const { payload } = await call('get', ROUTE, { userId: VIEWER, query: { band: 'midhigh' } });
    expect(Object.keys(payload.overview).sort()).toEqual(['levels', 'partners', 'passedAll', 'teachers']);
    const { oxbridge, beaconhouse } = payload.overview.partners;
    expect(Object.keys(oxbridge).sort()).toEqual(['completedAll', 'inProgress', 'notStarted', 'passed', 'pctPassed', 'sessions', 'teachers']);
    expect(Object.keys(beaconhouse).sort()).toEqual(['inProgress', 'levels', 'notStarted', 'passed', 'pctPassed', 'teachers']);
    // m1 holds every certificate; m2 has three sessions and I-SAPS activity
    expect(oxbridge).toMatchObject({ passed: 1, inProgress: 1, notStarted: 0, teachers: 2 });
    expect(oxbridge.sessions).toHaveLength(7);
    expect(beaconhouse).toMatchObject({ passed: 1, inProgress: 0, notStarted: 1, teachers: 2 });
    expect(payload.overview).toMatchObject({ passedAll: 1, teachers: 2 });
    // I-SAPS (operator, 2026-10-19): a fourth panel, laid out like Oxbridge, not part of passed all
    expect(Object.keys(payload.overview.partners.isaps).sort())
      .toEqual(['completedAll', 'inProgress', 'modules', 'notStarted', 'passed', 'pctPassed', 'teachers']);
    for (const r of payload.regions) expect(Object.keys(r.partners).sort()).toEqual(['beaconhouse', 'isaps', 'oxbridge']);
  });

  it("six sectors from the RDF allocation (the lists), schools from FDE's list only", async () => {
    tableStates.app_settings = flag([VIEWER]);
    const { payload } = await call('get', ROUTE, { userId: VIEWER });
    expect(payload.regions.map((r) => r.region)).toEqual(['B.K', 'Sihala', 'Urban-I', 'Nilore', 'Urban-II', 'Tarnol']);
    expect(payload.regions.map((r) => r.teachers)).toEqual([1, 1, 0, 0, 0, 0]);
    expect(payload.schools.map((s) => s.name)).toEqual(['IMSG B.K 1', 'IMCG Sihala']);
    expect(JSON.stringify(payload)).not.toMatch(/unassigned|Durbeen|No Region School/i);
  });

  it('a region filter scopes the overview and the schools to that region', async () => {
    tableStates.app_settings = flag([VIEWER]);
    const { statusCode, payload } = await call('get', ROUTE, { userId: VIEWER, query: { region: 'sihala' } });
    expect(statusCode).toBe(200);
    expect(payload.schools.map((s) => s.name)).toEqual(['IMCG Sihala']);
    const card = payload.regions.find((r) => r.region === 'Sihala');
    expect(payload.overview.teachers).toBe(card.teachers);
    expect(payload.overview.levels.map(({ name, ...l }) => l)).toEqual(card.levels);
    expect(payload.regions).toHaveLength(6);
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

  it('an unknown band is a 400 and reads no data', async () => {
    tableStates.app_settings = flag([VIEWER]);
    for (const band of ['secondary', "primary'; drop"]) {
      // eslint-disable-next-line no-await-in-loop
      const { statusCode, payload } = await call('get', ROUTE, { userId: VIEWER, query: { band } });
      expect(statusCode).toBe(400);
      expect(payload).toEqual({ success: false, error: 'Unknown band.' });
    }
    expect(queries).toHaveLength(0);
  });

  it('reads the shared lists with the dashboard\'s pg query (two reads, not PostgREST chunks)', async () => {
    tableStates.app_settings = flag([VIEWER]);
    await call('get', ROUTE, { userId: VIEWER });
    const { loadAnalyticsLists } = require('../../dashboard/lib/analytics-lists');
    expect(loadAnalyticsLists).toHaveBeenCalledTimes(1);
    expect(loadAnalyticsLists.mock.calls[0][1]).toEqual({ query: expect.any(Function) });
  });

  it('all time: a window in the address is ignored, and nothing from the request reaches SQL', async () => {
    tableStates.app_settings = flag([VIEWER]);
    await call('get', ROUTE, { userId: VIEWER, query: { from: '2026-10-01', to: '2026-10-13', band: 'midhigh', region: 'B.K' } });
    expect(queries).toHaveLength(4);
    for (const q of queries) expect(q.params === undefined || q.params.length === 0).toBe(true);
  });

  it('carries no teacher identity', async () => {
    tableStates.app_settings = flag([VIEWER]);
    const { payload } = await call('get', ROUTE, { userId: VIEWER });
    expect(JSON.stringify(payload)).not.toMatch(/user_id|userId|phone|teacher_level/);
  });
});

describe('GET /analytics/training-levels — the snapshot', () => {
  it('one computation serves every band and region: a second request asks the database nothing', async () => {
    tableStates.app_settings = flag([VIEWER]);
    const first = await call('get', ROUTE, { userId: VIEWER });
    const n = queries.length;
    expect(n).toBe(4);
    const mh = await call('get', ROUTE, { userId: VIEWER, query: { band: 'midhigh', region: 'B.K' } });
    const again = await call('get', ROUTE, { userId: VIEWER });
    expect(queries.length).toBe(n);
    expect(again.payload).toEqual(first.payload);
    expect(mh.payload.computedAt).toBe(first.payload.computedAt);
  });

  it('concurrent first requests share one computation', async () => {
    tableStates.app_settings = flag([VIEWER]);
    await Promise.all([
      call('get', ROUTE, { userId: VIEWER }),
      call('get', ROUTE, { userId: VIEWER, query: { band: 'midhigh' } }),
      call('get', ROUTE, { userId: VIEWER, query: { region: 'Sihala' } }),
    ]);
    expect(queries.filter((q) => /member_facts/.test(q.sql))).toHaveLength(1);
  });

  it('after 30 minutes the old snapshot answers at once while one refresh runs; the next answer is the new one', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    tableStates.app_settings = flag([VIEWER]);
    const first = await call('get', ROUTE, { userId: VIEWER });
    jest.setSystemTime(Date.now() + 30 * 60 * 1000 + 1);
    MEMBERS = MEMBERS.concat([{ ...MEMBERS[0], user_id: 'p9', cert_levels: ['1'] }]);
    const stale = await call('get', ROUTE, { userId: VIEWER });
    expect(stale.payload.computedAt).toBe(first.payload.computedAt);
    expect(stale.payload.overview.levels[0].passed).toBe(2);
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    const fresh = await call('get', ROUTE, { userId: VIEWER });
    expect(fresh.payload.computedAt).not.toBe(first.payload.computedAt);
    expect(fresh.payload.overview.levels[0].passed).toBe(3);
    expect(queries.filter((q) => /member_facts/.test(q.sql))).toHaveLength(2);
  });

  it('is its own read: a warm schools answer does not answer the Trainings tab', async () => {
    tableStates.app_settings = flag([VIEWER]);
    await call('get', '/analytics/schools', { userId: VIEWER });
    const n = queries.length;
    const { payload } = await call('get', ROUTE, { userId: VIEWER });
    expect(queries.length).toBeGreaterThan(n);
    expect(payload.overview.levels).toHaveLength(4);
  });

  it('a failed first computation is a 500 with no numbers', async () => {
    tableStates.app_settings = flag([VIEWER]);
    const db = require('../../dashboard/config/database');
    db.query.mockImplementation(async () => { throw new Error('canceling statement due to statement timeout'); });
    const { statusCode, payload } = await call('get', ROUTE, { userId: VIEWER });
    expect(statusCode).toBe(500);
    expect(payload).toEqual({ success: false, error: 'Failed to load training analytics.' });
  });
});
