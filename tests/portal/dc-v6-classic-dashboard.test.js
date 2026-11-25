/**
 * Queue #282 / bd-ra8xu.64.2 — GET /api/portal/dashboard (the classic teacher dashboard) when her newest lesson is
 * scored on FICO17 v6. getOverall gives a v6 row "no V3 score" (points 0, max 0); the route then filled the max with
 * the old `|| 118`, so the payload read "0/118". A session with no V3 max has no marks: score and max are null (the
 * CoachingSession type's own rule, "never a stand-in zero"); a V3 session is unchanged.
 *
 * EXECUTES the route handler through the same per-table supabase harness as account-school-name.test.js.
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


const USER = { id: 'u-1', name: 'Ayesha Khan', phone_number: '92' + '000' + '0000000', role: 'teacher', country: 'PK', school_id: null, school_name: null };
const V6_SCORES = { overall_marks: 17, overall_max_marks: 28, overall_percentage: 60.7, counted: 7, rubric: 'fico17_v6' };

describe('queue #282 / bd-ra8xu.64.2: the classic dashboard\'s latest session', () => {
  it('a v6 lesson: no marks and no max (never 0/118), no V3 percentage', async () => {
    tableStates.users = { rows: [USER] };
    tableStates.coaching_sessions = { rows: [{ id: 'c-1', user_id: 'u-1', status: 'completed', created_at: '2026-11-24T06:00:00Z', analysis_data: { framework: 'fico17_v6', scores: V6_SCORES } }] };
    const { statusCode, payload } = await getDashboard('u-1');
    expect(statusCode).toBe(200);
    expect(payload.recentCoachingSession).toMatchObject({ id: 'c-1', score: null, overallScore: null, maxScore: null, percentage: null });
  });

  it('a V3 lesson keeps its marks, max and percentage', async () => {
    tableStates.users = { rows: [USER] };
    tableStates.coaching_sessions = { rows: [{ id: 'c-2', user_id: 'u-1', status: 'completed', created_at: '2026-11-20T06:00:00Z', analysis_data: { scores: { overall_marks: 74, overall_max_marks: 148, overall_percentage: 50 } } }] };
    const { payload } = await getDashboard('u-1');
    expect(payload.recentCoachingSession).toMatchObject({ score: 74, overallScore: 74, maxScore: 148, percentage: 50 });
  });
});
