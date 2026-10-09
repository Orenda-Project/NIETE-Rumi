/**
 * bd-fxk3t8 — GET /me: who is signed in, without the dashboard's counts.
 *
 * Every page asks who she is before it can draw (AuthProvider). That question was
 * GET /dashboard — her user AND four count queries — measured at 0.9–1.2 s on sandbox,
 * twice the time of a plain read. /me answers the same user, the same shape, and nothing
 * else; /dashboard is unchanged for the pages that show the counts.
 */
let supabaseFrom;
let tableStates;

function makeChain(tableName) {
  const state = tableStates[tableName] || {};
  const record = { filters: {} };
  const chain = {};
  const rowsFor = () => {
    let rows = typeof state.rows === 'function' ? state.rows(record.filters) : (state.rows || []);
    for (const [col, val] of Object.entries(record.filters)) {
      if (val && typeof val === 'object' && Array.isArray(val.in)) rows = rows.filter((r) => val.in.includes(r[col]));
      else rows = rows.filter((r) => r[col] === val);
    }
    return rows;
  };
  const one = () => {
    if (state.throws) throw state.throws;
    if (state.error) return { data: null, error: state.error };
    return { data: rowsFor()[0] || null, error: null };
  };
  const many = () => {
    if (state.throws) throw state.throws;
    if (state.error) return { data: null, error: state.error };
    return { data: rowsFor(), error: null, count: rowsFor().length };
  };
  chain.select = jest.fn(() => chain);
  ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'is'].forEach((m) => {
    chain[m] = jest.fn((col, val) => { record.filters[col] = val; return chain; });
  });
  chain.in = jest.fn((col, vals) => { record.filters[col] = { in: vals }; return chain; });
  chain.not = jest.fn(() => chain);
  chain.order = jest.fn(() => chain);
  chain.limit = jest.fn(() => chain);
  chain.maybeSingle = jest.fn(async () => one());
  chain.single = jest.fn(async () => one());
  chain.then = (resolve, reject) => Promise.resolve().then(many).then(resolve, reject);
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

async function call(path, userId) {
  const routes = require('../../dashboard/routes/portal.routes');
  const stack = findRoute(routes, 'get', path);
  if (!stack) throw new Error(`GET ${path} not found on the portal router`);
  const req = {
    session: userId ? { portalUserId: userId, id: 'sess-1', portalScope: 'training' } : {},
    params: {}, query: {}, method: 'GET', path, ip: '127.0.0.1', headers: {},
    get: () => undefined,
  };
  let statusCode = 200;
  let payload = null;
  const res = {
    status(code) { statusCode = code; return this; },
    json(body) { payload = body; return this; },
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

const USER = { id: 'u-1', name: 'Ayesha Khan', phone_number: '923000000000', role: 'teacher', country: 'PK' };

beforeEach(() => {
  jest.resetModules();
  tableStates = {};
  supabaseFrom = jest.fn((tbl) => makeChain(tbl));
  jest.doMock('../../dashboard/config/supabase', () => ({
    from: supabaseFrom,
    rpc: jest.fn().mockResolvedValue({ error: null }),
  }));
  const { installTrainingDelegation } = require('../fixtures/delegate-training-to-bot');
  installTrainingDelegation(() => supabaseFrom);
  jest.doMock('../../dashboard/services/r2.service', () => ({
    generatePresignedUrl: jest.fn().mockResolvedValue(null),
    generatePresignedUrls: jest.fn().mockResolvedValue([]),
    isValidR2Url: jest.fn().mockReturnValue(true),
  }));
  jest.doMock('bcryptjs', () => ({ hash: jest.fn(), compare: jest.fn(), genSalt: jest.fn() }), { virtual: true });
  jest.doMock('express-rate-limit', () => jest.fn(() => (_req, _res, next) => next()), { virtual: true });
  jest.doMock('@aws-sdk/client-s3', () => ({ S3Client: jest.fn(), GetObjectCommand: jest.fn() }), { virtual: true });
});

afterEach(() => jest.resetModules());


describe('GET /me', () => {
  it('is exactly the user /dashboard returns — same fields, school name', async () => {
    tableStates.users = { rows: [{ ...USER, school_id: 'sch-7' }] };
    tableStates.schools = { rows: [{ id: 'sch-7', name: 'IMSG (I-V) G-7/2' }] };
    const me = await call('/me', 'u-1');
    const dash = await call('/dashboard', 'u-1');
    expect(me.statusCode).toBe(200);
    expect(me.payload.success).toBe(true);
    expect(me.payload.user).toEqual(dash.payload.user);
    expect(me.payload.user.schoolName).toBe('IMSG (I-V) G-7/2');
  });

  it('reads no counts — only the user and her school', async () => {
    tableStates.users = { rows: [{ ...USER, school_id: 'sch-7' }] };
    tableStates.schools = { rows: [{ id: 'sch-7', name: 'X' }] };
    await call('/me', 'u-1');
    const tables = supabaseFrom.mock.calls.map((c) => c[0]);
    expect([...new Set(tables)].sort()).toEqual(['schools', 'users']);
  });

  it('signed out: 401, like every protected route', async () => {
    const { statusCode, payload } = await call('/me', null);
    expect(statusCode).toBe(401);
    expect(payload.success).toBe(false);
  });

  it('an unreadable user is a 500, never a half user', async () => {
    tableStates.users = { error: { message: 'boom' } };
    const { statusCode } = await call('/me', 'u-1');
    expect(statusCode).toBe(500);
  });
});
