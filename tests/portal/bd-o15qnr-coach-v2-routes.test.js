/**
 * bd-o15qnr.3 — the coach app v2's read routes, /api/portal/coach/*.
 *
 * Dark behind app_settings.portal_coach_v2: off for this user → 404, the same as
 * a route that does not exist. The coach is ALWAYS the session user; inputs are
 * validated before any query (a malformed uuid would otherwise reach pg as a
 * cast error and answer 500).
 */

let settings;
let poolQuery;

function makeChain(table) {
  let key = null;
  const chain = {
    select: () => chain,
    eq: (_col, val) => { key = val; return chain; },
    order: () => chain,
    limit: () => chain,
    maybeSingle: async () => {
      if (table === 'app_settings') {
        return { data: Object.prototype.hasOwnProperty.call(settings, key) ? { value: settings[key] } : null, error: null };
      }
      return { data: null, error: null };
    },
  };
  chain.single = chain.maybeSingle;
  return chain;
}

function loadRoutes() {
  jest.resetModules();
  jest.doMock('../../dashboard/config/supabase', () => ({ from: (t) => makeChain(t), rpc: jest.fn() }));
  jest.doMock('../../dashboard/config/database', () => ({ query: (...a) => poolQuery(...a) }));
  jest.doMock('../../dashboard/services/portal-coaching.client', () => ({}));
  jest.doMock('../../dashboard/services/r2.service', () => ({
    generatePresignedUrl: jest.fn(), generatePresignedUrls: jest.fn(), isValidR2Url: jest.fn(),
  }));
  jest.doMock('bcryptjs', () => ({ hash: jest.fn(), compare: jest.fn(), genSalt: jest.fn() }), { virtual: true });
  jest.doMock('express-rate-limit', () => jest.fn(() => (_q, _s, n) => n()), { virtual: true });
  jest.doMock('@aws-sdk/client-s3', () => ({ S3Client: jest.fn(), GetObjectCommand: jest.fn() }), { virtual: true });
  return require('../../dashboard/routes/portal.routes');
}

function findRoute(router, method, path) {
  for (const layer of router.stack) {
    if (layer.route && layer.route.path === path && layer.route.methods[method]) return layer.route.stack.map((s) => s.handle);
  }
  throw new Error(`no ${method} ${path}`);
}

/** Run the route from its v2 gate onward (auth + leader role are the shared, tested middlewares). */
async function call(path, { params = {}, query = {}, userId = 'coach-1' } = {}) {
  const routes = loadRoutes();
  const stack = findRoute(routes, 'get', path);
  const gateAt = stack.findIndex((h) => h.name === 'requireCoachV2');
  if (gateAt < 0) throw new Error(`${path} has no requireCoachV2`);
  const req = { params, query, body: {}, session: { portalUserId: userId }, portalUser: { role: 'coach' } };
  let statusCode = 200;
  let payload = null;
  const res = { status(c) { statusCode = c; return this; }, json(b) { payload = b; return this; } };
  const errors = jest.spyOn(console, 'error').mockImplementation(() => {});
  try {
    for (const h of stack.slice(gateAt)) {
      let next = false;
      // eslint-disable-next-line no-await-in-loop
      await h(req, res, () => { next = true; });
      if (!next) break;
    }
  } finally {
    errors.mockRestore();
  }
  return { statusCode, payload };
}

const PATHS = [
  '/coach/home', '/coach/schedule', '/coach/team', '/coach/people',
  '/coach/school/:emis', '/coach/teacher/:teacherExtId', '/coach/visit/:id', '/coach/reports',
];

beforeEach(() => {
  settings = {};
  poolQuery = jest.fn(async () => ({ rows: [] }));
});
afterAll(() => jest.resetModules());

describe('every /coach route is behind portal_coach_v2', () => {
  test.each(PATHS)('%s: auth, leader role, then the v2 gate', (path) => {
    const stack = findRoute(loadRoutes(), 'get', path);
    expect(stack.map((h) => h.name).slice(0, 3)).toEqual(['requirePortalAuth', 'requireLeaderRole', 'requireCoachV2']);
  });

  test.each(PATHS)('%s answers 404 with the flag off, and never queries', async (path) => {
    const out = await call(path, { params: { emis: '110', teacherExtId: '923001110001', id: '00000000-0000-4000-8000-000000000000' } });
    expect(out.statusCode).toBe(404);
    expect(poolQuery).not.toHaveBeenCalled();
  });

  test('a pilot that names someone else: 404', async () => {
    settings.portal_coach_v2 = ['coach-2'];
    expect((await call('/coach/home')).statusCode).toBe(404);
  });
});

describe('with the flag on', () => {
  beforeEach(() => { settings.portal_coach_v2 = ['coach-1']; });

  test('home answers for the SESSION coach', async () => {
    const out = await call('/coach/home');
    expect(out.statusCode).toBe(200);
    expect(out.payload.success).toBe(true);
    expect(out.payload.home).toHaveProperty('counts');
    const schedCall = poolQuery.mock.calls.find(([sql]) => /FROM observation_schedules/.test(sql) && /leader_user_id = \$1/.test(sql));
    expect(schedCall[1][0]).toBe('coach-1');
  });

  test('people, schedule, team and reports answer', async () => {
    expect((await call('/coach/people')).payload).toMatchObject({ success: true, teachers: [], schools: [] });
    expect((await call('/coach/schedule')).payload).toMatchObject({ success: true, visits: [], overdue: [] });
    expect((await call('/coach/team')).payload).toMatchObject({ success: true, groups: [] });
    expect((await call('/coach/reports')).payload).toMatchObject({ success: true, waiting: [], inProgress: [] });
  });

  test('a coach filter that is not a uuid is refused before any query', async () => {
    const out = await call('/coach/team', { query: { coach: "x' OR 1=1" } });
    expect(out.statusCode).toBe(400);
    expect(poolQuery).not.toHaveBeenCalled();
  });

  test('a malformed date is refused', async () => {
    expect((await call('/coach/team', { query: { date: '6 Oct' } })).statusCode).toBe(400);
    expect((await call('/coach/schedule', { query: { from: '2026-13-01' } })).statusCode).toBe(400);
  });

  test('a visit id that is not a uuid: 404, no query', async () => {
    const out = await call('/coach/visit/:id', { params: { id: 'abc' } });
    expect(out.statusCode).toBe(404);
    expect(poolQuery).not.toHaveBeenCalled();
  });

  test('a visit, school or teacher that is not hers: 404', async () => {
    expect((await call('/coach/visit/:id', { params: { id: '00000000-0000-4000-8000-000000000000' } })).statusCode).toBe(404);
    expect((await call('/coach/school/:emis', { params: { emis: '110' } })).statusCode).toBe(404);
    expect((await call('/coach/teacher/:teacherExtId', { params: { teacherExtId: '923001110001' } })).statusCode).toBe(404);
  });

  test('a database failure answers 500 with a reason, not a crash', async () => {
    poolQuery = jest.fn(async () => { throw new Error('db down'); });
    const out = await call('/coach/people');
    expect(out.statusCode).toBe(500);
    expect(out.payload).toMatchObject({ success: false });
  });
});
