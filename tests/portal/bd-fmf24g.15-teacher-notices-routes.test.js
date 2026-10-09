/**
 * bd-fmf24g.15 — the three routes behind the teacher app's strip, banner and Home card
 * (services/teacher-notices.service.js has the rules; these hold the HTTP to them):
 *
 *   GET  /api/portal/me/notices                  her items
 *   POST /api/portal/me/notices/:id/seen         she closed the banner (the X, or went to Home from it)
 *   POST /api/portal/me/notices/:id/opened       she opened it
 *
 * Signed out is 401; portal_teacher_v2 off is 404 and nothing is asked; the teacher is always the session's
 * user; a malformed id is 400 and a missing one 404; a database error is 502, never an empty list.
 */
const TEACHER = '6f1c2a7e-0b8d-4c55-9a51-2d7f0e3b9c10';
const ID = '11111111-1111-4111-8111-111111111111';

function findRoute(router, method, path) {
  for (const layer of router.stack) {
    if (layer.route && (layer.route.methods || {})[method] && layer.route.path === path) {
      return layer.route.stack.map((s) => s.handle);
    }
  }
  return null;
}

async function invoke(method, path, { userId = TEACHER, query = {}, params = {}, body = {} } = {}) {
  const router = require('../../dashboard/routes/portal-teacher-notices.routes');
  const stack = findRoute(router, method, path);
  if (!stack) throw new Error(`Route ${method.toUpperCase()} ${path} not found`);
  const req = { session: userId ? { portalUserId: userId } : null, query, params, body, method: method.toUpperCase(), path, headers: {}, get: () => undefined };
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

const ROUTES = [
  ['get', '/me/notices'],
  ['post', '/me/notices/:id/seen'],
  ['post', '/me/notices/:id/opened'],
];

let svc; let flagOn; let pool;
beforeEach(() => {
  jest.resetModules();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  flagOn = true;
  pool = { query: jest.fn() };
  svc = {
    listNotices: jest.fn(async () => ({ items: [{ id: `paper:${ID}`, state: 'ready' }] })),
    markSeen: jest.fn(async () => ({ ok: true })),
    markOpened: jest.fn(async () => ({ ok: true })),
  };
  jest.doMock('../../dashboard/services/teacher-notices.service', () => svc);
  jest.doMock('../../dashboard/config/database', () => pool);
  jest.doMock('../../dashboard/config/supabase', () => ({}));
  jest.doMock('../../dashboard/lib/feature-flags', () => ({
    PORTAL_TEACHER_V2_KEY: 'portal_teacher_v2',
    isFlagEnabledForUser: jest.fn(async (_s, key) => key === 'portal_teacher_v2' && flagOn),
  }));
});
afterEach(() => { jest.restoreAllMocks(); });

const asked = () => Object.values(svc).some((fn) => fn.mock.calls.length > 0);
const ARGS = { params: { id: `paper:${ID}` } };

test.each(ROUTES)('%s %s signed out: 401, nothing asked', async (m, p) => {
  const { statusCode } = await invoke(m, p, { ...ARGS, userId: null });
  expect(statusCode).toBe(401);
  expect(asked()).toBe(false);
});

test.each(ROUTES)('%s %s with portal_teacher_v2 off: 404, nothing asked', async (m, p) => {
  flagOn = false;
  const { statusCode } = await invoke(m, p, ARGS);
  expect(statusCode).toBe(404);
  expect(asked()).toBe(false);
});

test('GET lists the session teacher\'s items, whatever the request says', async () => {
  const r = await invoke('get', '/me/notices', { query: { userId: 'someone-else' } });
  expect(r.statusCode).toBe(200);
  expect(svc.listNotices).toHaveBeenCalledWith(expect.any(Function), TEACHER);
  expect(r.payload).toEqual({ success: true, items: [{ id: `paper:${ID}`, state: 'ready' }], now: expect.any(String) });
});

test('GET: a database failure is 502, never an empty list', async () => {
  svc.listNotices.mockRejectedValue(new Error('connection reset'));
  const r = await invoke('get', '/me/notices');
  expect(r.statusCode).toBe(502);
  expect(r.payload).toEqual({ success: false, error: expect.any(String) });
});

test.each([['seen', 'markSeen'], ['opened', 'markOpened']])('POST %s marks the session teacher\'s item', async (what, fn) => {
  const r = await invoke('post', `/me/notices/:id/${what}`, { ...ARGS, body: { userId: 'someone-else' } });
  expect(r.statusCode).toBe(200);
  expect(r.payload).toEqual({ success: true });
  expect(svc[fn]).toHaveBeenCalledWith(expect.any(Function), TEACHER, `paper:${ID}`);
});

test.each([['seen', 'markSeen'], ['opened', 'markOpened']])('POST %s: a malformed id is 400, a missing one 404, a failure 502', async (what, fn) => {
  svc[fn].mockResolvedValueOnce({ ok: false, code: 'BAD_ID' });
  expect((await invoke('post', `/me/notices/:id/${what}`, { params: { id: 'nope' } })).statusCode).toBe(400);
  svc[fn].mockResolvedValueOnce({ ok: false, code: 'NOT_FOUND' });
  expect((await invoke('post', `/me/notices/:id/${what}`, ARGS)).statusCode).toBe(404);
  svc[fn].mockRejectedValueOnce(new Error('down'));
  expect((await invoke('post', `/me/notices/:id/${what}`, ARGS)).statusCode).toBe(502);
});

test('the routes are mounted once, beside the other teacher modules', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '../../dashboard/index.js'), 'utf8');
  expect(src.match(/portal-teacher-notices\.routes/g)).toHaveLength(1);
});
