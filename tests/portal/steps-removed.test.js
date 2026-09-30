/**
 * Operator, 2026-09-30: STEPS is removed from the portal — Analytics is where
 * this data lives — and the Attendance page is absorbed into the Analytics
 * Attendance tab, whose window follows the page's: blank is ALL TIME, the same
 * as every other part of Analytics (the standalone page defaulted to 30 days).
 */

let queries;

function findRoute(router, method, path) {
  for (const layer of router.stack) {
    if (layer.route && (layer.route.methods || {})[method] && layer.route.path === path) {
      return layer.route.stack.map((s) => s.handle);
    }
  }
  return null;
}

async function invoke(path, { userId, query = {} }) {
  const routes = require('../../dashboard/routes/portal.routes');
  const stack = findRoute(routes, 'get', path);
  if (!stack) throw new Error(`Route GET ${path} not found`);
  const req = { session: { portalUserId: userId, id: 's1' }, params: {}, query, method: 'GET', path, ip: '127.0.0.1', headers: {}, get: () => undefined };
  let payload = null; let statusCode = 200;
  const res = { status(c) { statusCode = c; return this; }, json(b) { payload = b; return this; } };
  let advanced = true;
  for (const handler of stack) {
    if (!advanced) break;
    advanced = false;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => {
      const maybe = handler(req, res, () => { advanced = true; resolve(); });
      if (maybe && typeof maybe.then === 'function') maybe.then(() => resolve(), () => resolve());
      else if (advanced === false) resolve();
    });
  }
  return { statusCode, payload };
}

beforeEach(() => {
  jest.resetModules();
  queries = [];
  jest.doMock('../../dashboard/config/database', () => ({
    query: jest.fn(async (sql, params) => { queries.push({ sql, params }); return { rows: [] }; }),
  }));
  jest.doMock('../../dashboard/config/supabase', () => ({ from: jest.fn(), rpc: jest.fn() }));
  jest.doMock('bcryptjs', () => ({ hash: jest.fn(), compare: jest.fn(), genSalt: jest.fn() }), { virtual: true });
  jest.doMock('express-rate-limit', () => jest.fn(() => (_req, _res, next) => next()), { virtual: true });
  jest.doMock('@aws-sdk/client-s3', () => ({ S3Client: jest.fn(), GetObjectCommand: jest.fn() }), { virtual: true });
});

afterEach(() => jest.resetModules());

test('GET /leader/steps is gone', () => {
  const routes = require('../../dashboard/routes/portal.routes');
  expect(findRoute(routes, 'get', '/leader/steps')).toBeNull();
});

test('the STEPS grid builder is gone; the shared observation-scoring helpers stay', () => {
  const svc = require('../../dashboard/services/steps-grid.service');
  expect(svc.buildStepsGrid).toBeUndefined();
  expect(typeof svc.pooledPct).toBe('function');
  expect(typeof svc.isHumanObservation).toBe('function');
});

test('attendance with no window is all time, like the rest of Analytics', async () => {
  const { statusCode, payload } = await invoke('/my-attendance', { userId: 'u1' });
  expect(statusCode).toBe(200);
  const att = queries.filter((q) => /attendance_sessions|teacher_attendance_records/.test(q.sql));
  expect(att).toHaveLength(2);
  for (const q of att) expect(q.params).toEqual([['u1'], null, null]);
  expect(payload.from).toBeNull();
  expect(payload.to).toBeNull();
});

test('attendance still honours a window, ends open when one is missing', async () => {
  await invoke('/my-attendance', { userId: 'u1', query: { from: '2026-09-01' } });
  const att = queries.filter((q) => /attendance_sessions|teacher_attendance_records/.test(q.sql));
  for (const q of att) expect(q.params).toEqual([['u1'], '2026-09-01', null]);
});
