/**
 * bd-r2uzg1.21.4 — a principal whose account names no school (users.school_id NULL).
 *
 * Her patch is her own school (leader-patch PRINCIPAL_PATCH_SQL joins on users.school_id), so with no school every
 * leader page read zeros: My Patch "Teachers 0", "On NIETE 0/0", Teachers "No teachers yet", Analytics "Teachers 0".
 * Nothing said why, or what to do. The three leader reads now say so in the answer itself (`noSchool: true`), from
 * the signed-in user's own row, so the pages can show "No school linked yet" and the way forward instead of zeros.
 *
 * Only a PRINCIPAL with no school is "no school". A coach's patch comes from her school assignments, never from
 * users.school_id, so a coach with an empty school_id is not "no school". Nothing in the request can set it.
 */

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
  const res = {
    status(c) { statusCode = c; return this; },
    json(b) { payload = b; return this; },
    set() { return this; },
  };
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
let patch;

beforeEach(() => {
  jest.resetModules();
  currentUser = { id: 'p1', role: 'principal', school_id: null };
  patch = [];
  jest.doMock('../../dashboard/config/database', () => ({
    query: jest.fn(async (sql) => {
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
    return { ...real, getPatchTeachers: jest.fn(async () => patch) };
  });
  jest.doMock('bcryptjs', () => ({ hash: jest.fn(), compare: jest.fn(), genSalt: jest.fn() }), { virtual: true });
  jest.doMock('express-rate-limit', () => jest.fn(() => (_req, _res, next) => next()), { virtual: true });
  jest.doMock('@aws-sdk/client-s3', () => ({ S3Client: jest.fn(), GetObjectCommand: jest.fn() }), { virtual: true });
});

afterEach(() => jest.resetModules());

const LEADER_READS = ['/leader/overview', '/leader/teachers', '/leader/school-analytics'];

describe('a principal with no school linked', () => {
  it.each(LEADER_READS)('%s answers 200 with noSchool: true', async (path) => {
    const { statusCode, payload } = await invoke(path, { userId: 'p1' });
    expect(statusCode).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.noSchool).toBe(true);
  });

  it('My Patch keeps its shape (an older page still draws), with nothing counted', async () => {
    const { payload } = await invoke('/leader/overview', { userId: 'p1' });
    expect(payload.overview).toMatchObject({ totalTeachers: 0, onRumi: 0, focus: [] });
  });

  it('Analytics keeps its shape (school, teachers, analytics), with nothing counted', async () => {
    const { payload } = await invoke('/leader/school-analytics', { userId: 'p1' });
    expect(payload.school).toMatchObject({ totalTeachers: 0, onRumi: 0 });
    expect(payload.teachers).toEqual([]);
  });

  it('a blank school_id ("") is no school too', async () => {
    currentUser = { id: 'p1', role: ' Principal ', school_id: '' };
    const { payload } = await invoke('/leader/overview', { userId: 'p1' });
    expect(payload.noSchool).toBe(true);
  });
});

describe('everyone else: noSchool is false', () => {
  it.each(LEADER_READS)('a principal WITH a school: %s says noSchool: false', async (path) => {
    currentUser = { id: 'p2', role: 'principal', school_id: 'school-A' };
    patch = [{ rumiUserId: 't1', name: 'Teacher One', schoolName: 'School A', onRumi: true, isPrincipal: false }];
    const { statusCode, payload } = await invoke(path, { userId: 'p2' });
    expect(statusCode).toBe(200);
    expect(payload.noSchool).toBe(false);
  });

  it('a principal whose school has no teachers yet is not "no school" (her school is linked)', async () => {
    currentUser = { id: 'p3', role: 'principal', school_id: 'school-B' };
    patch = [];
    const { payload } = await invoke('/leader/teachers', { userId: 'p3' });
    expect(payload.noSchool).toBe(false);
  });

  it.each(['/leader/overview', '/leader/teachers'])('a coach with no users.school_id: %s says noSchool: false (her patch is her assignments)', async (path) => {
    currentUser = { id: 'c1', role: 'coach', school_id: null };
    const { payload } = await invoke(path, { userId: 'c1' });
    expect(payload.noSchool).toBe(false);
  });

  it('the request cannot claim it: ?noSchool=1 and ?school_id= change nothing', async () => {
    currentUser = { id: 'p2', role: 'principal', school_id: 'school-A' };
    const { payload } = await invoke('/leader/overview', { userId: 'p2', query: { noSchool: '1', school_id: '' } });
    expect(payload.noSchool).toBe(false);
  });
});

describe('principalWithoutSchool (lib/leader-role)', () => {
  const { principalWithoutSchool } = require('../../dashboard/lib/leader-role');
  it.each([
    [{ role: 'principal', school_id: null }, true],
    [{ role: 'principal' }, true],
    [{ role: 'PRINCIPAL', school_id: '' }, true],
    [{ role: 'principal', school_id: 'school-A' }, false],
    [{ role: 'coach', school_id: null }, false],
    [{ role: 'teacher', school_id: null }, false],
    [null, false],
    [undefined, false],
  ])('%j → %s', (user, want) => {
    expect(principalWithoutSchool(user)).toBe(want);
  });
});
