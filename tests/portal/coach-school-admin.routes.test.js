/**
 * The coach app's school and teacher admin routes (behind the coach v2 gate).
 * Each route only reads the request, names the coach from her SESSION, and hands
 * the coach-school-admin service the EMIS from the URL; the service does the
 * guarding (tests/portal/coach-school-admin.test.js). Here: the six routes
 * exist, sit behind the coach v2 gate, refuse a malformed EMIS before anything
 * runs, and return the service's status and body as they are.
 */

let Admin;

function findRoute(router, method, path) {
  for (const layer of router.stack) {
    if (!layer.route) continue;
    if ((layer.route.methods || {})[method] && layer.route.path === path) return layer.route.stack.map((s) => s.handle);
  }
  return null;
}

/** Runs ONLY the route's own handler (the last one); the gate in front is checked separately. */
async function invokeHandler(method, path, { params = {}, body = {}, query = {} } = {}) {
  const router = require('../../dashboard/routes/portal.routes');
  const stack = findRoute(router, method, path);
  if (!stack) throw new Error(`route ${method.toUpperCase()} ${path} not found`);
  const req = { session: { portalUserId: 'coach-me', id: 's1' }, params, body, query, headers: {}, ip: '127.0.0.1', get: () => undefined };
  let statusCode = 200;
  let payload = null;
  const res = { status(c) { statusCode = c; return this; }, json(b) { payload = b; return this; } };
  await stack[stack.length - 1](req, res, () => {});
  return { statusCode, payload, stack };
}

beforeEach(() => {
  jest.resetModules();
  jest.doMock('../../dashboard/config/supabase', () => ({ from: jest.fn(), rpc: jest.fn() }));
  jest.doMock('../../dashboard/services/r2.service', () => ({
    generatePresignedUrl: jest.fn(), generatePresignedUrls: jest.fn(), isValidR2Url: jest.fn(),
  }));
  jest.doMock('bcryptjs', () => ({ hash: jest.fn(), compare: jest.fn(), genSalt: jest.fn() }), { virtual: true });
  jest.doMock('express-rate-limit', () => jest.fn(() => (_req, _res, next) => next()), { virtual: true });
  jest.doMock('@aws-sdk/client-s3', () => ({ S3Client: jest.fn(), GetObjectCommand: jest.fn() }), { virtual: true });
  const answer = (data) => jest.fn().mockResolvedValue({ status: 200, data: { success: true, ...data } });
  Admin = {
    searchSchools: answer({ schools: [] }),
    addSchool: answer({ schoolName: 'IMSG G-6/2' }),
    removeSchool: answer({ schoolName: 'IMSG I-10/1' }),
    checkTeacher: answer({ outcome: 'new' }),
    addTeacher: jest.fn().mockResolvedValue({ status: 403, data: { success: false, reason: 'not_my_school' } }),
    removeTeachers: answer({ removed: [] }),
  };
  jest.doMock('../../dashboard/services/coach-school-admin.service', () => Admin);
});

afterEach(() => jest.resetModules());

const ROUTES = [
  ['get', '/coach/schools/search'],
  ['post', '/coach/schools'],
  ['post', '/coach/school/:emis/remove'],
  ['post', '/coach/school/:emis/teachers/check'],
  ['post', '/coach/school/:emis/teachers'],
  ['post', '/coach/school/:emis/teachers/remove'],
];

test.each(ROUTES)('%s %s sits behind the same gate as the other coach v2 routes', async (method, path) => {
  const router = require('../../dashboard/routes/portal.routes');
  const stack = findRoute(router, method, path);
  expect(stack).not.toBeNull();
  const people = findRoute(router, 'get', '/coach/people');
  // The gate (auth, leader role, coach v2) is the same three handlers, in order.
  expect(stack.slice(0, -1)).toEqual(people.slice(0, -1));
  expect(stack.length).toBe(people.length);
});

test('search: the typed term, her id from the session', async () => {
  const { statusCode } = await invokeHandler('get', '/coach/schools/search', { query: { q: 'imsg' } });
  expect(statusCode).toBe(200);
  expect(Admin.searchSchools).toHaveBeenCalledWith(expect.anything(), 'coach-me', 'imsg');
});

test('add a school: the picked key from the body', async () => {
  await invokeHandler('post', '/coach/schools', { body: { schoolExtId: 'niete:620', leaderUserId: 'someone-else' } });
  expect(Admin.addSchool).toHaveBeenCalledWith(expect.anything(), 'coach-me', 'niete:620');
});

test('remove a school / check / add / remove teachers: the EMIS from the URL, her id from the session', async () => {
  await invokeHandler('post', '/coach/school/:emis/remove', { params: { emis: '110' } });
  expect(Admin.removeSchool).toHaveBeenCalledWith(expect.any(Function), expect.anything(), 'coach-me', '110');

  await invokeHandler('post', '/coach/school/:emis/teachers/check', { params: { emis: '110' }, body: { phone: '03001110555' } });
  expect(Admin.checkTeacher).toHaveBeenCalledWith(expect.any(Function), expect.anything(), 'coach-me', '110', '03001110555');

  await invokeHandler('post', '/coach/school/:emis/teachers/remove', {
    params: { emis: '110' }, body: { teacherExtIds: ['923001110001'], reason: 'Transferred' },
  });
  expect(Admin.removeTeachers).toHaveBeenCalledWith(expect.any(Function), expect.anything(), 'coach-me', '110', ['923001110001'], 'Transferred');
});

test('the service\'s refusal comes back as it is', async () => {
  const { statusCode, payload } = await invokeHandler('post', '/coach/school/:emis/teachers', {
    params: { emis: '110' }, body: { phone: '03001110555', name: 'Nadia' },
  });
  expect(Admin.addTeacher).toHaveBeenCalledWith(expect.any(Function), expect.anything(), 'coach-me', '110', { phone: '03001110555', name: 'Nadia' });
  expect(statusCode).toBe(403);
  expect(payload).toEqual({ success: false, reason: 'not_my_school' });
});

test('a malformed EMIS is a 404 before anything runs', async () => {
  const { statusCode } = await invokeHandler('post', '/coach/school/:emis/remove', { params: { emis: '1 OR 1=1' } });
  expect(statusCode).toBe(404);
  expect(Admin.removeSchool).not.toHaveBeenCalled();
});
