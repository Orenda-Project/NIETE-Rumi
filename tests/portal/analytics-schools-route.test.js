/**
 * Analytics-only accounts (FDE / AEO): the access gate, GET /analytics/schools, and the
 * `analyticsOnly` flag on the user payload the portal routes by.
 *
 * Who may see school-wise analytics is ONE app_settings row, portal_analytics_only, whose
 * value is a JSON array of users.id. Only an explicit list counts: a broadcast value
 * (true, "teachers") would turn every account into analytics-only — locking teachers out of
 * their own portal and showing every teacher every school — so it reads as nobody.
 */

let tableStates;
let supabaseFrom;
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
  chain.update = jest.fn(() => chain);
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

async function call(method, path, { userId, query = {}, body = {} } = {}) {
  const routes = require('../../dashboard/routes/portal.routes');
  const stack = findRoute(routes, method, path);
  if (!stack) throw new Error(`${method.toUpperCase()} ${path} not found on the portal router`);
  const session = userId ? { portalUserId: userId, id: 'sess-1' } : {};
  session.regenerate = (cb) => cb();
  const req = {
    session, params: {}, query, body, method: method.toUpperCase(), path, ip: '127.0.0.1', headers: {},
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
  return { statusCode, payload, session };
}

const VIEWER = 'aaaaaaaa-0000-4000-8000-000000000001';
const TEACHER = 'bbbbbbbb-0000-4000-8000-000000000002';
const flag = (value) => ({ rows: [{ key: 'portal_analytics_only', value }] });

function poolRows(sql, params) {
  if (/FROM schools/i.test(sql)) {
    return [
      { id: 's1', name: 'IMSG B.K 1', emis: '101', region: 'B.K', is_active: true, is_probable_test: false },
      { id: 's2', name: 'IMCG Sihala', emis: '202', region: 'Sihala', is_active: true, is_probable_test: false },
    ];
  }
  if (/lesson_plans/i.test(sql)) {
    return [
      { school_id: 's1', is_test: false, teachers: 8, lp_teachers: 4 },
      { school_id: 's2', is_test: false, teachers: 2, lp_teachers: 1 },
    ];
  }
  if (/'scores'/.test(sql)) {
    return params[0].map((id) => ({ id, updated_at: '2026-10-02T00:00:00Z', scores: { overall_marks: 70, overall_max_marks: 100 } }));
  }
  if (/FROM coaching_sessions/i.test(sql)) {
    return [
      { id: 'c1', updated_at: '2026-10-02T00:00:00Z', user_id: 't1', school_id: 's1', is_test: false, observation_type: null },
      { id: 'c2', updated_at: '2026-10-02T00:00:00Z', user_id: 't2', school_id: 's2', is_test: false, observation_type: 'leader_observation' },
    ];
  }
  return [];
}

beforeEach(() => {
  jest.resetModules();
  tableStates = {};
  queries = [];
  supabaseFrom = jest.fn((tbl) => makeChain(tbl));
  jest.doMock('../../dashboard/config/supabase', () => ({
    from: supabaseFrom,
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

describe('readUserListFlag / isAnalyticsOnlyUser (dashboard/lib/feature-flags)', () => {
  const ff = () => require('../../dashboard/lib/feature-flags');
  const sb = () => require('../../dashboard/config/supabase');

  it('names the key once', () => {
    expect(ff().PORTAL_ANALYTICS_ONLY_KEY).toBe('portal_analytics_only');
  });

  it('a listed id is analytics-only; an unlisted one is not', async () => {
    tableStates.app_settings = flag([VIEWER, 'cccccccc-0000-4000-8000-000000000003']);
    expect(await ff().isAnalyticsOnlyUser(sb(), VIEWER)).toBe(true);
    expect(await ff().isAnalyticsOnlyUser(sb(), TEACHER)).toBe(false);
    expect(await ff().isAnalyticsOnlyUser(sb(), null)).toBe(false);
  });

  it('accepts the list stored as a JSON string', async () => {
    tableStates.app_settings = flag(JSON.stringify([VIEWER]));
    expect(await ff().isAnalyticsOnlyUser(sb(), VIEWER)).toBe(true);
  });

  it('a broadcast or malformed value is NOBODY, never everybody', async () => {
    for (const value of [true, 'true', 'teachers', { [VIEWER]: true }, 1, 'not json', [1, 2], []]) {
      tableStates.app_settings = flag(value);
      // eslint-disable-next-line no-await-in-loop
      expect(await ff().isAnalyticsOnlyUser(sb(), VIEWER)).toBe(false);
      // eslint-disable-next-line no-await-in-loop
      expect(await ff().readUserListFlag(sb(), 'portal_analytics_only')).toEqual([]);
    }
  });

  it('an absent row is nobody', async () => {
    expect(await ff().isAnalyticsOnlyUser(sb(), VIEWER)).toBe(false);
  });

  it('a failed read throws from readUserListFlag and is false (fail-closed) from isAnalyticsOnlyUser', async () => {
    tableStates.app_settings = { error: { message: 'boom' } };
    await expect(ff().readUserListFlag(sb(), 'portal_analytics_only')).rejects.toThrow(/boom/);
    expect(await ff().isAnalyticsOnlyUser(sb(), VIEWER)).toBe(false);
    tableStates.app_settings = { throws: new Error('socket') };
    expect(await ff().isAnalyticsOnlyUser(sb(), VIEWER)).toBe(false);
  });
});

describe('makeRequireAnalyticsViewer (dashboard/lib/analytics-viewer)', () => {
  const makeRequireAnalyticsViewer = (deps) => require('../../dashboard/lib/analytics-viewer').makeRequireAnalyticsViewer(deps);
  const res = () => ({ statusCode: null, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } });

  it('lets a listed user through without responding', async () => {
    const mw = makeRequireAnalyticsViewer({ getViewerIds: async () => [VIEWER] });
    const r = res(); const next = jest.fn();
    await mw({ session: { portalUserId: VIEWER } }, r, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(r.statusCode).toBeNull();
  });

  it('403s an unlisted user, an empty list and a missing session user', async () => {
    for (const [ids, uid] of [[[VIEWER], TEACHER], [[], VIEWER], [[VIEWER], undefined]]) {
      const mw = makeRequireAnalyticsViewer({ getViewerIds: async () => ids });
      const r = res(); const next = jest.fn();
      // eslint-disable-next-line no-await-in-loop
      await mw({ session: { portalUserId: uid } }, r, next);
      expect(next).not.toHaveBeenCalled();
      expect(r.statusCode).toBe(403);
      expect(r.body.success).toBe(false);
    }
  });

  it('a failed flag read denies with 500 (try again), never lets anyone through', async () => {
    const mw = makeRequireAnalyticsViewer({ getViewerIds: async () => { throw new Error('db down'); } });
    const r = res(); const next = jest.fn();
    await mw({ session: { portalUserId: VIEWER } }, r, next);
    expect(next).not.toHaveBeenCalled();
    expect(r.statusCode).toBe(500);
  });
});

describe('GET /analytics/schools', () => {
  it('is mounted behind requirePortalAuth: signed out is 401 and touches no data', async () => {
    const { statusCode } = await call('get', '/analytics/schools');
    expect(statusCode).toBe(401);
    expect(queries).toHaveLength(0);
  });

  it('403s every user not in the flag — teacher, principal, coach, unregistered alike', async () => {
    tableStates.app_settings = flag([VIEWER]);
    const { statusCode, payload } = await call('get', '/analytics/schools', { userId: TEACHER });
    expect(statusCode).toBe(403);
    expect(payload.success).toBe(false);
    expect(queries).toHaveLength(0);
  });

  it('403s when the flag row is absent or carries a broadcast value', async () => {
    for (const state of [undefined, flag(true), flag('teachers'), flag({})]) {
      tableStates.app_settings = state;
      // eslint-disable-next-line no-await-in-loop
      const { statusCode } = await call('get', '/analytics/schools', { userId: VIEWER });
      expect(statusCode).toBe(403);
    }
    expect(queries).toHaveLength(0);
  });

  it('500s (and shows nothing) when the flag cannot be read', async () => {
    tableStates.app_settings = { error: { message: 'timeout' } };
    const { statusCode, payload } = await call('get', '/analytics/schools', { userId: VIEWER });
    expect(statusCode).toBe(500);
    expect(payload.overview).toBeUndefined();
  });

  it('answers a listed viewer with the contract shape and nothing teacher-level', async () => {
    tableStates.app_settings = flag([VIEWER]);
    const { statusCode, payload } = await call('get', '/analytics/schools', {
      userId: VIEWER, query: { from: '2026-10-01', to: '2026-10-13' },
    });
    expect(statusCode).toBe(200);
    expect(Object.keys(payload).sort()).toEqual(['overview', 'range', 'regions', 'schools', 'success']);
    expect(payload.success).toBe(true);
    expect(payload.range).toEqual({ from: '2026-10-01', to: '2026-10-13' });
    expect(payload.regions).toHaveLength(7);
    expect(payload.overview).toMatchObject({ schools: 2, teachers: 10, dcSessions: 1, humanObservations: 1, avgFico: 70, avgHitl: 70 });
    expect(JSON.stringify(payload)).not.toMatch(/"t1"|"t2"|user_id|userId|teacherName|phone/);
    expect(queries.length).toBeLessThanOrEqual(4);
  });

  it('a region filter scopes the overview to that region card', async () => {
    tableStates.app_settings = flag([VIEWER]);
    const { payload } = await call('get', '/analytics/schools', { userId: VIEWER, query: { region: 'sihala' } });
    expect(payload.schools.map((s) => s.name)).toEqual(['IMCG Sihala']);
    const { region, ...card } = payload.regions.find((r) => r.region === 'Sihala');
    expect(payload.overview).toEqual(card);
  });

  it('an unknown region is a 400, not an empty page', async () => {
    tableStates.app_settings = flag([VIEWER]);
    const { statusCode, payload } = await call('get', '/analytics/schools', { userId: VIEWER, query: { region: 'Lahore' } });
    expect(statusCode).toBe(400);
    expect(payload.success).toBe(false);
    expect(queries).toHaveLength(0);
  });

  it('a junk date is dropped (all time), never passed to SQL', async () => {
    tableStates.app_settings = flag([VIEWER]);
    const { payload } = await call('get', '/analytics/schools', { userId: VIEWER, query: { from: "2026-10-01'; drop", to: 'yesterday' } });
    expect(payload.range).toEqual({ from: null, to: null });
    for (const q of queries) expect(JSON.stringify(q.params || [])).not.toContain('drop');
  });

  it('caches for ten minutes per from|to|region: a repeat asks the database nothing', async () => {
    tableStates.app_settings = flag([VIEWER]);
    const q = { from: '2026-10-01', to: '2026-10-13' };
    const first = await call('get', '/analytics/schools', { userId: VIEWER, query: q });
    const n = queries.length;
    const again = await call('get', '/analytics/schools', { userId: VIEWER, query: q });
    expect(queries.length).toBe(n);
    expect(again.payload).toEqual(first.payload);

    await call('get', '/analytics/schools', { userId: VIEWER, query: { ...q, region: 'B.K' } });
    expect(queries.length).toBeGreaterThan(n);
  });

  it('the cache does not outlive ten minutes', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    try {
      tableStates.app_settings = flag([VIEWER]);
      await call('get', '/analytics/schools', { userId: VIEWER });
      const n = queries.length;
      jest.setSystemTime(Date.now() + 10 * 60 * 1000 + 1);
      await call('get', '/analytics/schools', { userId: VIEWER });
      expect(queries.length).toBeGreaterThan(n);
    } finally {
      jest.useRealTimers();
    }
  });

  it('the gate is checked even when the answer is cached', async () => {
    tableStates.app_settings = flag([VIEWER]);
    await call('get', '/analytics/schools', { userId: VIEWER });
    const { statusCode } = await call('get', '/analytics/schools', { userId: TEACHER });
    expect(statusCode).toBe(403);
  });
});

describe('analyticsOnly on the user payload', () => {
  const USER = { id: VIEWER, name: 'FDE Analytics', phone_number: '923001112223', role: 'unregistered', country: 'PK', school_id: null };

  it('/me says true for a listed account', async () => {
    tableStates.users = { rows: [USER] };
    tableStates.app_settings = flag([VIEWER]);
    const { statusCode, payload } = await call('get', '/me', { userId: VIEWER });
    expect(statusCode).toBe(200);
    expect(payload.user.analyticsOnly).toBe(true);
  });

  it('/me says false for everyone else, and when the flag is unreadable', async () => {
    tableStates.users = { rows: [{ ...USER, id: TEACHER, role: 'teacher' }] };
    tableStates.app_settings = flag([VIEWER]);
    expect((await call('get', '/me', { userId: TEACHER })).payload.user.analyticsOnly).toBe(false);
    tableStates.users = { rows: [USER] };
    tableStates.app_settings = { error: { message: 'boom' } };
    expect((await call('get', '/me', { userId: VIEWER })).payload.user.analyticsOnly).toBe(false);
  });

  it('/login carries it, so the client routes without a second call', async () => {
    tableStates.users = { rows: [{ ...USER, portal_activated: true, portal_password_hash: 'h' }] };
    tableStates.app_settings = flag([VIEWER]);
    const { statusCode, payload } = await call('post', '/login', { body: { phoneNumber: '03001112223', password: 'secret123' } });
    expect(statusCode).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.user.analyticsOnly).toBe(true);
  });

  it('/login says false for an ordinary account', async () => {
    tableStates.users = { rows: [{ ...USER, id: TEACHER, role: 'teacher', portal_activated: true, portal_password_hash: 'h' }] };
    tableStates.app_settings = flag([VIEWER]);
    const { payload } = await call('post', '/login', { body: { phoneNumber: '03001112223', password: 'secret123' } });
    expect(payload.user.analyticsOnly).toBe(false);
  });
});

describe('publicUserPayload carries analyticsOnly as a plain boolean', () => {
  const publicUserPayload = (...a) => require('../../dashboard/lib/leader-role').publicUserPayload(...a);
  it('defaults to false and is true only when asked', () => {
    expect(publicUserPayload({ name: 'A' }).analyticsOnly).toBe(false);
    expect(publicUserPayload({ name: 'A' }, { analyticsOnly: true }).analyticsOnly).toBe(true);
    expect(publicUserPayload({ name: 'A' }, { analyticsOnly: 'yes' }).analyticsOnly).toBe(false);
    expect(publicUserPayload({ name: 'A' }, { includeContact: true, analyticsOnly: true })).toMatchObject({ analyticsOnly: true, phoneNumber: undefined });
  });
});
