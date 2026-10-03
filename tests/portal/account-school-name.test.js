/**
 * GET /api/portal/dashboard — the signed-in user's school name.
 *
 * The portal's My account page shows the user her own name and her school.
 * The name was already in the dashboard's user payload; the school was not.
 * It is added to that SAME payload (no new endpoint, table or column):
 *
 *   1. users.school_id → schools.name — the link every other school-scoped
 *      query here uses (the leader patch reads sch.name the same way);
 *   2. else the legacy users.school_name text;
 *   3. else null — the page then shows nothing in its place.
 *
 * A failed schools lookup must never fail the dashboard: the user is the one
 * critical read, everything else degrades.
 *
 * This EXECUTES the route handler (same per-table supabase harness as
 * tests/training/portal-training-vendors.test.js), so a field that is computed
 * but not returned, or a lookup that throws, fails here.
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

async function getDashboard(userId) {
  const routes = require('../../dashboard/routes/portal.routes');
  const stack = findRoute(routes, 'get', '/dashboard');
  if (!stack) throw new Error('GET /dashboard not found on the portal router');
  const req = {
    session: { portalUserId: userId, id: 'sess-1' },
    params: {}, query: {}, method: 'GET', path: '/dashboard', ip: '127.0.0.1', headers: {},
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

describe('GET /dashboard — user.schoolName for the My account page', () => {
  it('reads the school through users.school_id → schools.name', async () => {
    tableStates.users = { rows: [{ ...USER, school_id: 'sch-7', school_name: 'stale text' }] };
    tableStates.schools = { rows: [{ id: 'sch-7', name: 'IMSG (I-V) G-7/2' }, { id: 'sch-8', name: 'Other school' }] };

    const { statusCode, payload } = await getDashboard('u-1');

    expect(statusCode).toBe(200);
    expect(payload.user.schoolName).toBe('IMSG (I-V) G-7/2');
  });

  it('falls back to the legacy users.school_name when there is no school_id', async () => {
    tableStates.users = { rows: [{ ...USER, school_id: null, school_name: '  IMCB F-10/3 ' }] };

    const { payload } = await getDashboard('u-1');

    expect(payload.user.schoolName).toBe('IMCB F-10/3');
  });

  it('is null when neither is known — a coach across many schools, say', async () => {
    tableStates.users = { rows: [{ ...USER, role: 'coach', school_id: null, school_name: null }] };

    const { payload } = await getDashboard('u-1');

    expect(payload.user.schoolName).toBeNull();
  });

  it('never fails the dashboard when the schools lookup errors', async () => {
    tableStates.users = { rows: [{ ...USER, school_id: 'sch-7', school_name: null }] };
    tableStates.schools = { error: { message: 'boom' } };

    const { statusCode, payload } = await getDashboard('u-1');

    expect(statusCode).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.user.schoolName).toBeNull();
  });

  it('never fails the dashboard when the schools lookup throws', async () => {
    tableStates.users = { rows: [{ ...USER, school_id: 'sch-7', school_name: 'IMCB F-10/3' }] };
    tableStates.schools = { throws: new Error('socket hang up') };

    const { statusCode, payload } = await getDashboard('u-1');

    expect(statusCode).toBe(200);
    expect(payload.user.schoolName).toBe('IMCB F-10/3');
  });

  it('keeps the payload it already had (name, phone, role)', async () => {
    tableStates.users = { rows: [{ ...USER, school_id: null, school_name: null }] };

    const { payload } = await getDashboard('u-1');

    expect(payload.user).toMatchObject({ firstName: 'Ayesha Khan', phoneNumber: '923000000000', role: 'teacher' });
  });
});
