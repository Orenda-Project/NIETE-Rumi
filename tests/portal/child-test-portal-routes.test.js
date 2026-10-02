/**
 * bd-s1oo0.7 (L7) — /api/portal/leader/child-test/* : the coach app's child test.
 *
 * The portal holds no child-test logic. Pinned here:
 *   - 401 without a portal session, 403 for a non-leader, 404 with the flag off
 *     (`app_settings.portal_child_test`, true or a pilot list of user ids) —
 *     and in none of those cases is the bot called
 *   - IDENTITY: the userId sent to the bot is the session's, never a body field
 *   - a 4xx from the bot is relayed; unreachable / 5xx is a 502, never success
 *   - /api/portal/config reports features.childTest for the session user
 *
 * Mocked: the Supabase client and axios (the HTTP call to the bot) — the network
 * boundary. The routes and the relay client run for real.
 */

const COACH = '11111111-1111-4111-8111-111111111111';

let tableRows;
let axiosPost;

function makeChain(table) {
  const filters = {};
  const chain = {
    select: () => chain,
    eq: (c, v) => { filters[c] = v; return chain; },
    in: () => chain,
    order: () => chain,
    limit: () => chain,
    maybeSingle: async () => {
      const rows = (tableRows[table] || []).filter((r) => Object.entries(filters).every(([k, v]) => r[k] === v));
      return { data: rows[0] || null, error: null };
    },
  };
  chain.single = chain.maybeSingle;
  return chain;
}

function findRoute(router, method, path) {
  for (const layer of router.stack) {
    if (layer.route && layer.route.path === path && layer.route.methods[method]) {
      return layer.route.stack.map((s) => s.handle);
    }
  }
  throw new Error(`no ${method.toUpperCase()} ${path}`);
}

async function invoke(modPath, method, path, { userId = COACH, params = {}, body = {}, query = {} } = {}) {
  const routes = require(modPath);
  const stack = findRoute(routes, method, path);
  const req = {
    session: userId ? { portalUserId: userId, id: 'sess-1' } : null,
    params, body, query, method: method.toUpperCase(), path, ip: '127.0.0.1', headers: {}, get: () => undefined,
  };
  let statusCode = 200;
  let payload = null;
  const res = { status(c) { statusCode = c; return this; }, json(b) { payload = b; return this; } };
  for (const handler of stack) {
    let next = false;
    // eslint-disable-next-line no-await-in-loop
    await handler(req, res, () => { next = true; });
    if (!next) break;
  }
  return { statusCode, payload };
}

const ROUTES = '../../dashboard/routes/portal-child-test.routes';

beforeEach(() => {
  jest.resetModules();
  process.env.MAIN_BOT_URL = 'https://bot.example';
  process.env.INTERNAL_API_KEY = 'k';
  tableRows = {
    app_settings: [{ key: 'portal_child_test', value: true }],
    users: [{ id: COACH, role: 'aeo', first_name: 'A' }, { id: 'teacher-1', role: 'teacher' }],
  };
  axiosPost = jest.fn().mockResolvedValue({ status: 200, data: { success: true, status: 'ok', visits: [] } });
  jest.doMock('axios', () => ({ post: (...a) => axiosPost(...a) }));
  jest.doMock('../../dashboard/config/supabase', () => ({ from: (t) => makeChain(t), rpc: jest.fn() }));
});

describe('gates', () => {
  test('no portal session → 401 and the bot is not called', async () => {
    const out = await invoke(ROUTES, 'get', '/visits', { userId: null });
    expect(out.statusCode).toBe(401);
    expect(axiosPost).not.toHaveBeenCalled();
  });

  test('a teacher (not the leader family) → 403', async () => {
    const out = await invoke(ROUTES, 'get', '/visits', { userId: 'teacher-1' });
    expect(out.statusCode).toBe(403);
    expect(axiosPost).not.toHaveBeenCalled();
  });

  test('flag row missing → 404, the same answer as a route that does not exist', async () => {
    tableRows.app_settings = [];
    const out = await invoke(ROUTES, 'get', '/visits');
    expect(out.statusCode).toBe(404);
    expect(axiosPost).not.toHaveBeenCalled();
  });

  test('a pilot list without this coach → 404; with them → through', async () => {
    tableRows.app_settings = [{ key: 'portal_child_test', value: ['someone-else'] }];
    expect((await invoke(ROUTES, 'get', '/visits')).statusCode).toBe(404);
    jest.resetModules();
    jest.doMock('axios', () => ({ post: (...a) => axiosPost(...a) }));
    jest.doMock('../../dashboard/config/supabase', () => ({ from: (t) => makeChain(t), rpc: jest.fn() }));
    tableRows.app_settings = [{ key: 'portal_child_test', value: [COACH] }];
    expect((await invoke(ROUTES, 'get', '/visits')).statusCode).toBe(200);
  });
});

describe('relay', () => {
  test('visits relays with the SESSION user and the internal key', async () => {
    const out = await invoke(ROUTES, 'get', '/visits', { body: { userId: 'forged' } });
    expect(out.statusCode).toBe(200);
    expect(axiosPost).toHaveBeenCalledWith(
      'https://bot.example/api/internal/child-test/visits',
      { userId: COACH },
      expect.objectContaining({ headers: expect.objectContaining({ 'x-api-key': 'k' }) }),
    );
  });

  test('list passes the visit id from the query', async () => {
    await invoke(ROUTES, 'get', '/list', { query: { visitId: 'v1' } });
    expect(axiosPost.mock.calls[0][0]).toMatch(/\/child-test\/list$/);
    expect(axiosPost.mock.calls[0][1]).toEqual({ userId: COACH, visitId: 'v1' });
  });

  test('outcome forwards only its own fields, never a body userId', async () => {
    await invoke(ROUTES, 'post', '/outcome', { body: { userId: 'forged', visitId: 'v1', drawId: 'd1', outcome: 'absent', note: 'ill', extra: 1 } });
    expect(axiosPost.mock.calls[0][1]).toEqual({ userId: COACH, visitId: 'v1', drawId: 'd1', outcome: 'absent', note: 'ill' });
  });

  test('session routes take the session id from the path', async () => {
    await invoke(ROUTES, 'get', '/session/:id/card/:block', { params: { id: 's1', block: 'urdu' } });
    expect(axiosPost.mock.calls[0][1]).toEqual({ userId: COACH, sessionId: 's1', block: 'urdu' });
    await invoke(ROUTES, 'post', '/session/:id/presign', { params: { id: 's1' }, body: { block: 'maths', kind: 'photo', contentType: 'image/jpeg', sizeBytes: 9, sessionId: 'other' } });
    expect(axiosPost.mock.calls[1][1]).toEqual({ userId: COACH, sessionId: 's1', block: 'maths', kind: 'photo', contentType: 'image/jpeg', sizeBytes: 9 });
    await invoke(ROUTES, 'post', '/session/:id/media', { params: { id: 's1' }, body: { block: 'urdu', audioKey: 'k1', timing: { timedStartMs: 0 } } });
    expect(axiosPost.mock.calls[2][1]).toEqual({ userId: COACH, sessionId: 's1', block: 'urdu', audioKey: 'k1', timing: { timedStartMs: 0 } });
    await invoke(ROUTES, 'get', '/session/:id', { params: { id: 's1' } });
    expect(axiosPost.mock.calls[3][0]).toMatch(/\/child-test\/session$/);
    await invoke(ROUTES, 'post', '/session/:id/check', { params: { id: 's1' }, body: { block: 'urdu', coachMarks: { a: 1 } } });
    expect(axiosPost.mock.calls[4][1]).toEqual({ userId: COACH, sessionId: 's1', block: 'urdu', coachMarks: { a: 1 } });
  });

  test("a bot 4xx is relayed as the bot's answer", async () => {
    axiosPost.mockResolvedValueOnce({ status: 400, data: { success: false, status: 'invalid', reason: 'not_your_upload' } });
    const out = await invoke(ROUTES, 'post', '/session/:id/media', { params: { id: 's1' }, body: { block: 'urdu', audioKey: 'x' } });
    expect(out.statusCode).toBe(400);
    expect(out.payload).toMatchObject({ success: false, reason: 'not_your_upload' });
  });

  test('an unreachable bot is a 502, never success', async () => {
    axiosPost.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const out = await invoke(ROUTES, 'get', '/visits');
    expect(out.statusCode).toBe(502);
    expect(out.payload.success).toBe(false);
  });

  test('a bot 5xx is a 502', async () => {
    axiosPost.mockResolvedValueOnce({ status: 500, data: { success: false } });
    const out = await invoke(ROUTES, 'get', '/visits');
    expect(out.statusCode).toBe(502);
  });

  test('the bot unconfigured (no MAIN_BOT_URL) is a 502', async () => {
    delete process.env.MAIN_BOT_URL;
    const out = await invoke(ROUTES, 'get', '/visits');
    expect(out.statusCode).toBe(502);
    expect(axiosPost).not.toHaveBeenCalled();
  });
});

describe('mount and config', () => {
  test('dashboard/index.js mounts the router under /api/portal/leader/child-test with the portal stack', () => {
    const src = require('fs').readFileSync(require.resolve('../../dashboard/index.js'), 'utf8');
    expect(src).toMatch(/app\.use\('\/api\/portal\/leader\/child-test',\s*cors\(portalCorsOptions\),\s*portalAuthLimiter,\s*portalDataLimiter,\s*childTestRoutes\)/);
    expect(src).toMatch(/const childTestRoutes = require\('\.\/routes\/portal-child-test\.routes'\)/);
  });

  test('/config reports childTest for the session user', async () => {
    jest.doMock('../../dashboard/services/r2.service', () => ({
      generatePresignedUrl: jest.fn(), generatePresignedUrls: jest.fn(), isValidR2Url: jest.fn(),
    }));
    const on = await invoke('../../dashboard/routes/portal.routes', 'get', '/config');
    expect(on.payload.features.childTest).toBe(true);
    const off = await invoke('../../dashboard/routes/portal.routes', 'get', '/config', { userId: null });
    expect(off.payload.features.childTest).toBe(false);
  });
});
