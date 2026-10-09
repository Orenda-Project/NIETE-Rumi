/**
 * The Analytics page takes a date window, on both profiles (operator,
 * 2026-09-30): ?from=&to= narrows every part of the page — observations,
 * attendance, remarks and the lesson-plan / exam counts. Blank means all time,
 * which is what the page showed before.
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
  const req = {
    session: { portalUserId: userId, id: 's1' }, params: {}, query,
    method: 'GET', path, ip: '127.0.0.1', headers: {}, get: () => undefined,
  };
  let statusCode = 200; let payload = null;
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


let currentUser;
let patchCalls;

beforeEach(() => {
  jest.resetModules();
  queries = [];
  patchCalls = [];
  currentUser = { id: 'p1', role: 'principal', school_id: 'school-A' };
  jest.doMock('../../dashboard/config/database', () => ({
    query: jest.fn(async (sql, params) => {
      queries.push({ sql, params });
      if (/lesson_plans/.test(sql) && /assessment_papers/.test(sql)) return { rows: [{ lesson_plans: 0, exams: 0 }] };
      return { rows: [] };
    }),
  }));
  jest.doMock('../../dashboard/config/supabase', () => {
    const chain = {};
    ['select', 'eq', 'update', 'in'].forEach((m) => { chain[m] = () => chain; });
    chain.single = async () => ({ data: currentUser, error: null });
    chain.maybeSingle = chain.single;
    return { from: () => chain, rpc: jest.fn() };
  });
  jest.doMock('../../dashboard/services/leader-patch.service', () => {
    const real = jest.requireActual('../../dashboard/services/leader-patch.service');
    return {
      ...real,
      // The roster of the school the SESSION user belongs to, and only that one.
      getPatchTeachers: jest.fn(async (_q, userId, opts) => {
        patchCalls.push({ userId, role: opts && opts.role });
        return [{ rumiUserId: 'tA1', name: 'Ayesha', schoolName: 'School A', onRumi: true, isPrincipal: false }];
      }),
    };
  });
  jest.doMock('bcryptjs', () => ({ hash: jest.fn(), compare: jest.fn(), genSalt: jest.fn() }), { virtual: true });
  jest.doMock('express-rate-limit', () => jest.fn(() => (_req, _res, next) => next()), { virtual: true });
  jest.doMock('@aws-sdk/client-s3', () => ({ S3Client: jest.fn(), GetObjectCommand: jest.fn() }), { virtual: true });
});

afterEach(() => jest.resetModules());

/**
 * Principal Analytics: a principal sees the analytics of every teacher in HER OWN school, never another's,
 * and a teacher never gets the school scope. The school is read from the signed-in user on the server;
 * no request parameter can change it. (The roster resolver itself, patchSqlFor, is pinned in the leader-patch tests.)
 */
describe('school analytics scope', () => {
  it('a principal: the roster is resolved from the session user, with her role', async () => {
    const { statusCode, payload } = await invoke('/leader/school-analytics', { userId: 'p1' });
    expect(statusCode).toBe(200);
    expect(patchCalls).toEqual([{ userId: 'p1', role: 'principal' }]);
    expect(payload.school.name).toBe('School A');
  });

  it.each([
    ['schoolId', 'school-B'], ['school_id', 'school-B'], ['school', 'school-B'], ['userId', 'p2'],
  ])('a principal cannot pick another school with ?%s=', async (key, value) => {
    const { statusCode } = await invoke('/leader/school-analytics', { userId: 'p1', query: { [key]: value } });
    expect(statusCode).toBe(200);
    expect(patchCalls).toEqual([{ userId: 'p1', role: 'principal' }]);
    for (const q of queries) expect(JSON.stringify(q.params)).not.toContain(value);
  });

  it("a teacher outside her school is a 404, never someone else's numbers", async () => {
    const { statusCode, payload } = await invoke('/leader/school-analytics', { userId: 'p1', query: { teacherId: 'tB9' } });
    expect(statusCode).toBe(404);
    expect(payload.success).toBe(false);
    expect(queries).toHaveLength(0);
  });

  it('a teacher in her school narrows every query to that one teacher', async () => {
    const { statusCode, payload } = await invoke('/leader/school-analytics', { userId: 'p1', query: { teacherId: 'tA1' } });
    expect(statusCode).toBe(200);
    expect(payload.focusTeacher).toEqual({ id: 'tA1', name: 'Ayesha' });
    for (const q of queries) expect(q.params[0]).toEqual(['tA1']);
  });

  it.each(['/leader/school-analytics', '/leader/teachers'])('a teacher gets %s as 403 and no school data', async (path) => {
    currentUser = { id: 't1', role: 'teacher', school_id: 'school-A' };
    const { statusCode } = await invoke(path, { userId: 't1', query: { teacherId: 'tA1' } });
    expect(statusCode).toBe(403);
    expect(patchCalls).toHaveLength(0);
    expect(queries).toHaveLength(0);
  });

  it.each(['coach', 'aeo', 'supervisor', 'school_leader'])('a %s gets 403 from school analytics (many schools, no single one)', async (role) => {
    currentUser = { id: 'x1', role, school_id: 'school-A' };
    const { statusCode } = await invoke('/leader/school-analytics', { userId: 'x1' });
    expect(statusCode).toBe(403);
    expect(patchCalls).toHaveLength(0);
  });
});
