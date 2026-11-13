/**
 * bd-mx822w — fixing a child's name from the portal's class page.
 *
 * Two hops, like every class route: the portal's POST /api/portal/classes/:classId/students/:studentId/name
 * proxies to the bot's POST /api/internal/classes/students/rename, which calls ClassService.renameStudent
 * (the rule: she teaches the class, the child is on it). The teacher id comes from the SESSION, never
 * the body.
 */

// Not a suite about the sign-in account check: every session user reads as live.
require('../fixtures/portal-auth-live').installLivePortalAccounts();

const { setup, invoke, BOT } = require('../dashboard/portal-proxy-harness');

describe('portal POST /classes/:classId/students/:studentId/name', () => {
  let axios;
  beforeEach(() => {
    jest.resetModules();
    ({ axios } = setup());
  });
  afterEach(() => jest.resetModules());

  const sentToBot = () => {
    const call = axios.post.mock.calls.find((c) => c[0] === `${BOT}/api/internal/classes/students/rename`);
    return call && call[1];
  };
  const saveName = (body = { name: 'Fatima Noor' }) => invoke('post', '/classes/:classId/students/:studentId/name', {
    params: { classId: 'c1', studentId: 's1' }, body,
  });

  test('asks the bot to rename for the SESSION teacher and answers the saved name', async () => {
    axios.post.mockResolvedValueOnce({ status: 200, data: { success: true, studentName: 'Fatima Noor' } });
    const { statusCode, payload } = await saveName({ name: 'Fatima Noor', userId: 'someone-else' });

    expect(statusCode).toBe(200);
    expect(payload).toEqual({ success: true, studentName: 'Fatima Noor' });
    expect(sentToBot()).toEqual({ userId: 'teacher-1', classId: 'c1', studentId: 's1', name: 'Fatima Noor' });
  });

  test('no name is a 400 and the bot is not asked', async () => {
    const { statusCode } = await saveName({});
    expect(statusCode).toBe(400);
    expect(sentToBot()).toBeUndefined();
  });

  test('not her class: 403; a refused name: 400; anything else: 502', async () => {
    axios.post.mockResolvedValueOnce({ status: 403, data: { success: false, error: 'not_assigned' } });
    expect((await saveName()).statusCode).toBe(403);
    axios.post.mockResolvedValueOnce({ status: 400, data: { success: false, error: 'name_too_long' } });
    expect((await saveName()).statusCode).toBe(400);
    axios.post.mockResolvedValueOnce({ status: 502, data: { success: false, error: 'update_failed' } });
    expect((await saveName()).statusCode).toBe(502);
  });

  test('the bot unreachable is a 502, not a crash', async () => {
    axios.post.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const { statusCode, payload } = await saveName();
    expect(statusCode).toBe(502);
    expect(payload.success).toBe(false);
  });
});

describe('bot POST /api/internal/classes/students/rename', () => {
  const KEY = 'shared-secret-key';
  let router;
  let renameStudent;

  function findRoute(r, path) {
    for (const layer of r.stack) {
      if (layer.route && layer.route.methods.post && layer.route.path === path) return layer.route.stack.map((s) => s.handle);
    }
    return null;
  }
  async function call(body, headers = { 'x-api-key': KEY }) {
    const stack = findRoute(router, '/classes/students/rename');
    if (!stack) throw new Error('route POST /classes/students/rename not found');
    const req = { headers, body, ip: '127.0.0.1', method: 'POST', path: '/classes/students/rename' };
    let statusCode = 200; let payload = null;
    const res = { status(c) { statusCode = c; return this; }, json(b) { payload = b; return this; } };
    let advanced = true;
    for (const h of stack) {
      if (!advanced) break;
      advanced = false;
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => {
        const m = h(req, res, () => { advanced = true; resolve(); });
        if (m && typeof m.then === 'function') m.then(() => resolve(), () => resolve());
        else if (!advanced) resolve();
      });
    }
    return { statusCode, payload };
  }

  beforeEach(() => {
    jest.resetModules();
    process.env.INTERNAL_API_KEY = KEY;
    renameStudent = jest.fn();
    jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
    jest.doMock('../../bot/shared/services/classes/class.service', () => ({ renameStudent }));
    router = require('../../bot/shared/routes/internal-api.routes');
  });
  afterEach(() => { delete process.env.INTERNAL_API_KEY; jest.resetModules(); });

  const body = { userId: 't1', classId: 'c1', studentId: 's1', name: 'Fatima Noor' };

  test('without the shared key: 401 and nothing renamed', async () => {
    expect((await call(body, {})).statusCode).toBe(401);
    expect(renameStudent).not.toHaveBeenCalled();
  });

  test('passes the teacher, class, child and name to the service and answers the saved name', async () => {
    renameStudent.mockResolvedValue({ renamed: true, studentName: 'Fatima Noor' });
    const { statusCode, payload } = await call(body);
    expect(statusCode).toBe(200);
    expect(payload).toEqual({ success: true, studentName: 'Fatima Noor' });
    expect(renameStudent).toHaveBeenCalledWith({ classId: 'c1', teacherUserId: 't1', studentId: 's1', name: 'Fatima Noor' });
  });

  test('missing input 400; not_assigned 403; not_enrolled 404; a refused name 400; a failed write 502', async () => {
    expect((await call({ userId: 't1', classId: 'c1' })).statusCode).toBe(400);
    renameStudent.mockResolvedValueOnce({ error: 'not_assigned' });
    expect((await call(body)).statusCode).toBe(403);
    renameStudent.mockResolvedValueOnce({ error: 'not_enrolled' });
    expect((await call(body)).statusCode).toBe(404);
    renameStudent.mockResolvedValueOnce({ error: 'missing_name' });
    expect((await call(body)).statusCode).toBe(400);
    renameStudent.mockResolvedValueOnce({ error: 'name_too_long' });
    expect((await call(body)).statusCode).toBe(400);
    renameStudent.mockResolvedValueOnce({ error: 'update_failed' });
    expect((await call(body)).statusCode).toBe(502);
  });
});
