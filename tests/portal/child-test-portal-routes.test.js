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

async function invoke(modPath, method, path, { userId = COACH, params = {}, body = {}, query = {}, headers = {} } = {}) {
  const routes = require(modPath);
  const stack = findRoute(routes, method, path);
  const req = {
    session: userId ? { portalUserId: userId, id: 'sess-1' } : null,
    params, body, query, method: method.toUpperCase(), path, ip: '127.0.0.1', headers, get: (h) => headers[String(h).toLowerCase()],
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
    await invoke(ROUTES, 'post', '/session/:id/media', { params: { id: 's1' }, body: { block: 'maths', audioKey: 'k1', timing: { timedStartMs: 0 }, photoDeclined: true } });
    expect(axiosPost.mock.calls[2][1]).toEqual({ userId: COACH, sessionId: 's1', block: 'maths', audioKey: 'k1', timing: { timedStartMs: 0 }, photoDeclined: true });
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
    // portal.routes.js loads dashboard-only packages that CI's root install does not have
    // (CI: "Cannot find module 'bcryptjs'"); stub them the way the other portal route tests do.
    jest.doMock('bcryptjs', () => ({ hash: jest.fn(), compare: jest.fn(), genSalt: jest.fn() }), { virtual: true });
    jest.doMock('express-rate-limit', () => jest.fn(() => (_req, _res, next) => next()), { virtual: true });
    jest.doMock('../../dashboard/services/r2.service', () => ({
      generatePresignedUrl: jest.fn(), generatePresignedUrls: jest.fn(), isValidR2Url: jest.fn(),
    }));
    const on = await invoke('../../dashboard/routes/portal.routes', 'get', '/config');
    expect(on.payload.features.childTest).toBe(true);
    const off = await invoke('../../dashboard/routes/portal.routes', 'get', '/config', { userId: null });
    expect(off.payload.features.childTest).toBe(false);
  });
});

describe('the Learning assessment (sa/*): its own switch, the same relay', () => {
  test('portal_child_test_sa missing → 404 on every sa route, even with the child test on', async () => {
    for (const [m, p] of [['get', '/sa/schools'], ['get', '/sa/list'], ['post', '/sa/outcome']]) {
      // eslint-disable-next-line no-await-in-loop
      expect((await invoke(ROUTES, m, p)).statusCode).toBe(404);
    }
    expect(axiosPost).not.toHaveBeenCalled();
  });

  test('on for this coach → schools, list and outcome relay with the SESSION user and only their fields', async () => {
    tableRows.app_settings.push({ key: 'portal_child_test_sa', value: [COACH] });
    expect((await invoke(ROUTES, 'get', '/sa/schools', { body: { userId: 'forged' } })).statusCode).toBe(200);
    expect(axiosPost).toHaveBeenLastCalledWith('https://bot.example/api/internal/child-test/sa/schools', { userId: COACH }, expect.anything());
    await invoke(ROUTES, 'get', '/sa/list', { query: { schoolId: 's1', visitId: 'v1', userId: 'forged', x: 1 } });
    expect(axiosPost).toHaveBeenLastCalledWith('https://bot.example/api/internal/child-test/sa/list', { userId: COACH, schoolId: 's1', visitId: 'v1' }, expect.anything());
    await invoke(ROUTES, 'post', '/sa/outcome', { body: { schoolId: 's1', drawId: 'd1', outcome: 'present', clientSessionId: 'c1', block: 'B2', userId: 'forged' } });
    expect(axiosPost).toHaveBeenLastCalledWith('https://bot.example/api/internal/child-test/sa/outcome',
      { userId: COACH, schoolId: 's1', drawId: 'd1', outcome: 'present', clientSessionId: 'c1', block: 'B2' }, expect.anything());
    // the coach's re-pick of a resumed child's part (sa_resume_repick) reaches the bot
    await invoke(ROUTES, 'post', '/sa/outcome', { body: { schoolId: 's1', drawId: 'd1', outcome: 'present', clientSessionId: 'c1', block: 'B1', repick: true } });
    expect(axiosPost).toHaveBeenLastCalledWith('https://bot.example/api/internal/child-test/sa/outcome',
      { userId: COACH, schoolId: 's1', drawId: 'd1', outcome: 'present', clientSessionId: 'c1', block: 'B1', repick: true }, expect.anything());
    // Add a child (sa_add_child): only its fields reach the bot, with the SESSION user
    await invoke(ROUTES, 'post', '/sa/child', { body: { schoolId: 's1', grade: 3, firstName: 'Zara', section: 'B', clientChildId: 'k1', userId: 'forged', extra: 1 } });
    expect(axiosPost).toHaveBeenLastCalledWith('https://bot.example/api/internal/child-test/sa/child',
      { userId: COACH, schoolId: 's1', grade: 3, firstName: 'Zara', section: 'B', clientChildId: 'k1' }, expect.anything());
    // every grade (sa_all_grades): the grade the coach named reaches the bot with the list and the outcome
    await invoke(ROUTES, 'get', '/sa/list', { query: { schoolId: 's1', grade: '4' } });
    expect(axiosPost).toHaveBeenLastCalledWith('https://bot.example/api/internal/child-test/sa/list', { userId: COACH, schoolId: 's1', grade: '4' }, expect.anything());
    await invoke(ROUTES, 'post', '/sa/outcome', { body: { schoolId: 's1', drawId: 'd1', outcome: 'absent', grade: 4 } });
    expect(axiosPost).toHaveBeenLastCalledWith('https://bot.example/api/internal/child-test/sa/outcome',
      { userId: COACH, schoolId: 's1', drawId: 'd1', outcome: 'absent', grade: 4 }, expect.anything());
  });

  test('a teacher is 403 even with the switch on for everyone', async () => {
    tableRows.app_settings.push({ key: 'portal_child_test_sa', value: true });
    expect((await invoke(ROUTES, 'get', '/sa/schools', { userId: 'teacher-1' })).statusCode).toBe(403);
    expect(axiosPost).not.toHaveBeenCalled();
  });

  test('/config reports childTestSa for the session user, off when logged out', async () => {
    tableRows.app_settings.push({ key: 'portal_child_test_sa', value: [COACH] });
    jest.doMock('bcryptjs', () => ({ hash: jest.fn(), compare: jest.fn(), genSalt: jest.fn() }), { virtual: true });
    jest.doMock('express-rate-limit', () => jest.fn(() => (_req, _res, next) => next()), { virtual: true });
    jest.doMock('../../dashboard/services/r2.service', () => ({
      generatePresignedUrl: jest.fn(), generatePresignedUrls: jest.fn(), isValidR2Url: jest.fn(),
    }));
    const on = await invoke('../../dashboard/routes/portal.routes', 'get', '/config');
    expect(on.payload.features.childTestSa).toBe(true);
    const off = await invoke('../../dashboard/routes/portal.routes', 'get', '/config', { userId: null });
    expect(off.payload.features.childTestSa).toBe(false);
  });
});

describe('the Learning assessment\'s page switches (sa/switches)', () => {
  test('behind portal_child_test_sa: 404 when off, and the bot is never asked', async () => {
    tableRows.app_settings.push({ key: 'sa_handback_v2', value: true });
    expect((await invoke(ROUTES, 'get', '/sa/switches')).statusCode).toBe(404);
    expect(axiosPost).not.toHaveBeenCalled();
  });

  test('each switch is off unless its row names this coach (true or a pilot list)', async () => {
    tableRows.app_settings.push(
      { key: 'portal_child_test_sa', value: [COACH] },
      { key: 'sa_handback_v2', value: true },
      { key: 'sa_mic_required', value: [COACH] },
      { key: 'sa_coach_picks_block', value: ['someone-else'] },
      { key: 'sa_voice_gate_v2', value: [COACH] },
      { key: 'sa_ur_fit', value: [COACH] },
    );
    const out = await invoke(ROUTES, 'get', '/sa/switches');
    expect(out.statusCode).toBe(200);
    expect(out.payload).toEqual({
      success: true,
      switches: { handbackV2: true, micRequired: true, coachPicksBlock: false, rdfForm: false, resultsView: false, rdfW3Forms: false, voiceGateV2: true, urFit: true, exampleDashboard: false, realDashboard: false, reviewPage: false, resumeRepick: false, allGrades: false, addChild: false },
    });
    expect(axiosPost).not.toHaveBeenCalled();
  });

  describe('the example dashboard (synthetic data): sandbox only', () => {
    const prevEnv = process.env.RAILWAY_ENVIRONMENT_NAME;
    afterEach(() => {
      if (prevEnv === undefined) delete process.env.RAILWAY_ENVIRONMENT_NAME;
      else process.env.RAILWAY_ENVIRONMENT_NAME = prevEnv;
    });
    const on = () => tableRows.app_settings.push(
      { key: 'portal_child_test_sa', value: true },
      { key: 'sa_example_dashboard', value: true },
    );

    test('on the sandbox host its row turns it on', async () => {
      process.env.RAILWAY_ENVIRONMENT_NAME = 'sandbox';
      on();
      expect((await invoke(ROUTES, 'get', '/sa/switches')).payload.switches.exampleDashboard).toBe(true);
    });

    test.each([['production'], ['staging'], [undefined]])('with a %s config it is off, even when its row is on', async (envName) => {
      if (envName === undefined) delete process.env.RAILWAY_ENVIRONMENT_NAME;
      else process.env.RAILWAY_ENVIRONMENT_NAME = envName;
      on();
      expect((await invoke(ROUTES, 'get', '/sa/switches')).payload.switches.exampleDashboard).toBe(false);
    });

    test('on the sandbox host without its row it is off', async () => {
      process.env.RAILWAY_ENVIRONMENT_NAME = 'sandbox';
      tableRows.app_settings.push({ key: 'portal_child_test_sa', value: true });
      expect((await invoke(ROUTES, 'get', '/sa/switches')).payload.switches.exampleDashboard).toBe(false);
    });
  });
});

describe("the Learning assessment's sink (sa/session/:id/*)", () => {
  const SID = '55555555-5555-4555-8555-555555555555';
  const BOT = 'https://bot.example/api/internal/child-test/';

  test('off → 404 and nothing relayed', async () => {
    expect((await invoke(ROUTES, 'post', '/sa/session/:id/batch', { params: { id: SID } })).statusCode).toBe(404);
    expect(axiosPost).not.toHaveBeenCalled();
  });

  test('on → battery, batch, presign, register and status relay the session id from the path and only their fields', async () => {
    tableRows.app_settings.push({ key: 'portal_child_test_sa', value: true });
    const params = { id: SID };
    await invoke(ROUTES, 'get', '/sa/session/:id/battery', { params, query: { lang: 'en', full: 'true', sessionId: 'forged' } });
    expect(axiosPost).toHaveBeenLastCalledWith(`${BOT}sa/battery`, { userId: COACH, sessionId: SID, lang: 'en', full: 'true' }, expect.anything());
    const events = [{ seq: 0, type: 'tap' }];
    await invoke(ROUTES, 'post', '/sa/session/:id/batch', { params, body: { seqFrom: 0, seqTo: 0, events, results: [], lang: 'ur', device: { ua: 'x' }, userId: 'forged', sessionId: 'forged' } });
    expect(axiosPost).toHaveBeenLastCalledWith(`${BOT}sa/batch`, { userId: COACH, sessionId: SID, seqFrom: 0, seqTo: 0, events, results: [], lang: 'ur', device: { ua: 'x' } }, expect.anything());
    await invoke(ROUTES, 'post', '/sa/session/:id/presign', { params, body: { taskId: 'ur.story_comp', itemId: 'q2', mime: 'audio/webm', bytes: 10, x: 1 } });
    expect(axiosPost).toHaveBeenLastCalledWith(`${BOT}sa/presign`, { userId: COACH, sessionId: SID, taskId: 'ur.story_comp', itemId: 'q2', mime: 'audio/webm', bytes: 10 }, expect.anything());
    await invoke(ROUTES, 'post', '/sa/session/:id/register', { params, body: { taskId: 'ur.story_comp', itemId: 'q2', key: 'k', durationMs: 3 } });
    expect(axiosPost).toHaveBeenLastCalledWith(`${BOT}sa/register`, { userId: COACH, sessionId: SID, taskId: 'ur.story_comp', itemId: 'q2', key: 'k' }, expect.anything());
    await invoke(ROUTES, 'get', '/sa/session/:id/status', { params });
    expect(axiosPost).toHaveBeenLastCalledWith(`${BOT}sa/status`, { userId: COACH, sessionId: SID }, expect.anything());
  });
});

describe("a session's results page (sa/session/:id/results): its own switch, sa_results_view", () => {
  const SID = '55555555-5555-4555-8555-555555555555';
  const BOT = 'https://bot.example/api/internal/child-test/';

  test('sa_results_view off (row missing) → 404 and nothing relayed, even with the Learning assessment on', async () => {
    tableRows.app_settings.push({ key: 'portal_child_test_sa', value: true });
    const out = await invoke(ROUTES, 'get', '/sa/session/:id/results', { params: { id: SID } });
    expect(out.statusCode).toBe(404);
    expect(axiosPost).not.toHaveBeenCalled();
  });

  test('on, with the Learning assessment off → 404', async () => {
    tableRows.app_settings.push({ key: 'sa_results_view', value: true });
    expect((await invoke(ROUTES, 'get', '/sa/session/:id/results', { params: { id: SID } })).statusCode).toBe(404);
    expect(axiosPost).not.toHaveBeenCalled();
  });

  test('on for this coach → relays the session id from the path with the SESSION user only', async () => {
    tableRows.app_settings.push({ key: 'portal_child_test_sa', value: true }, { key: 'sa_results_view', value: [COACH] });
    axiosPost.mockResolvedValueOnce({ status: 200, data: { success: true, status: 'ok', session: { id: SID }, tasks: [] } });
    const out = await invoke(ROUTES, 'get', '/sa/session/:id/results', { params: { id: SID }, query: { userId: 'forged', sessionId: 'forged' } });
    expect(out.statusCode).toBe(200);
    expect(out.payload.tasks).toEqual([]);
    expect(axiosPost).toHaveBeenLastCalledWith(`${BOT}sa/results`, { userId: COACH, sessionId: SID }, expect.anything());
  });

  test("another coach's session: the bot's 404 is relayed", async () => {
    tableRows.app_settings.push({ key: 'portal_child_test_sa', value: true }, { key: 'sa_results_view', value: true });
    axiosPost.mockResolvedValueOnce({ status: 404, data: { success: false, status: 'not_found' } });
    expect((await invoke(ROUTES, 'get', '/sa/session/:id/results', { params: { id: SID } })).statusCode).toBe(404);
  });

  test('a request that says asAdmin is ignored: only the SESSION user on sa_results_admins makes it so', async () => {
    tableRows.app_settings.push({ key: 'portal_child_test_sa', value: true }, { key: 'sa_results_view', value: true });
    await invoke(ROUTES, 'get', '/sa/session/:id/results', { params: { id: SID }, query: { asAdmin: 'true' }, body: { asAdmin: true } });
    expect(axiosPost).toHaveBeenLastCalledWith(`${BOT}sa/results`, { userId: COACH, sessionId: SID }, expect.anything());
    tableRows.app_settings.push({ key: 'sa_results_admins', value: ['someone-else'] });
    await invoke(ROUTES, 'get', '/sa/session/:id/results', { params: { id: SID } });
    expect(axiosPost).toHaveBeenLastCalledWith(`${BOT}sa/results`, { userId: COACH, sessionId: SID }, expect.anything());
  });

  test('the session user on sa_results_admins → asAdmin: true is relayed', async () => {
    tableRows.app_settings.push({ key: 'portal_child_test_sa', value: true }, { key: 'sa_results_view', value: true },
      { key: 'sa_results_admins', value: [COACH] });
    await invoke(ROUTES, 'get', '/sa/session/:id/results', { params: { id: SID } });
    expect(axiosPost).toHaveBeenLastCalledWith(`${BOT}sa/results`, { userId: COACH, sessionId: SID, asAdmin: true }, expect.anything());
  });

  test('the switch key is exported from the shared flags', () => {
    expect(require('../../dashboard/lib/feature-flags').SA_RESULTS_VIEW_KEY).toBe('sa_results_view');
    expect(require('../../dashboard/lib/feature-flags').SA_RESULTS_ADMINS_KEY).toBe('sa_results_admins');
  });
});

describe('another phone: the coach mints a link; the linked phone syncs without a sign-in', () => {
  const SID = '55555555-5555-4555-8555-555555555555';
  const BOT = 'https://bot.example/api/internal/child-test/';

  test('minting is the coach-only sa gates, relayed with the session user', async () => {
    tableRows.app_settings.push({ key: 'portal_child_test_sa', value: [COACH] });
    await invoke(ROUTES, 'post', '/sa/session/:id/link', { params: { id: SID } });
    expect(axiosPost).toHaveBeenLastCalledWith(`${BOT}sa/link-mint`, { userId: COACH, sessionId: SID }, expect.anything());
    expect((await invoke(ROUTES, 'post', '/sa/session/:id/link', { params: { id: SID }, userId: null })).statusCode).toBe(401);
  });

  test("a linked call: the bot names the coach, the coach's switch is checked, then the op relays with the token only", async () => {
    tableRows.app_settings.push({ key: 'portal_child_test_sa', value: [COACH] });
    axiosPost
      .mockResolvedValueOnce({ status: 200, data: { success: true, status: 'ok', coachUserId: COACH, sessionId: SID } })
      .mockResolvedValueOnce({ status: 200, data: { success: true, status: 'ok', ackedTo: 3 } });
    const body = { seqFrom: 0, seqTo: 3, events: [], results: [], userId: 'forged' };
    const out = await invoke(ROUTES, 'post', '/sa/link/:token/session/:id/:op', { userId: null, params: { token: 'tok', id: SID, op: 'batch' }, body });
    expect(out.statusCode).toBe(200);
    expect(out.payload.ackedTo).toBe(3);
    expect(axiosPost.mock.calls[0].slice(0, 2)).toEqual([`${BOT}sa/via-link`, { token: 'tok', op: 'whois', sessionId: SID }]);
    expect(axiosPost.mock.calls[1].slice(0, 2)).toEqual([`${BOT}sa/via-link`, { token: 'tok', op: 'batch', sessionId: SID, seqFrom: 0, seqTo: 3, events: [], results: [] }]);
  });

  test("a linked call carries the phone's own id (X-SA-Phone) to the bot on the check and on the op", async () => {
    tableRows.app_settings.push({ key: 'portal_child_test_sa', value: [COACH] });
    axiosPost
      .mockResolvedValueOnce({ status: 200, data: { success: true, status: 'ok', coachUserId: COACH, sessionId: SID } })
      .mockResolvedValueOnce({ status: 200, data: { success: true, status: 'ok', ackedTo: 0 } });
    const phone = 'a1b2c3d4e5f60718293a4b5c';
    const body = { seqFrom: 0, seqTo: 0, events: [], results: [], phone: 'forged-in-body' };
    const out = await invoke(ROUTES, 'post', '/sa/link/:token/session/:id/:op', { userId: null, params: { token: 'tok', id: SID, op: 'batch' }, body, headers: { 'x-sa-phone': phone } });
    expect(out.statusCode).toBe(200);
    expect(axiosPost.mock.calls[0][1]).toEqual({ token: 'tok', op: 'whois', sessionId: SID, phone });
    expect(axiosPost.mock.calls[1][1]).toEqual({ token: 'tok', op: 'batch', sessionId: SID, phone, seqFrom: 0, seqTo: 0, events: [], results: [] });
  });

  test("a bad token, an unknown op, or a coach whose switch is off is 404 and nothing is relayed", async () => {
    axiosPost.mockResolvedValueOnce({ status: 404, data: { success: false, status: 'not_found' } });
    expect((await invoke(ROUTES, 'post', '/sa/link/:token/session/:id/:op', { userId: null, params: { token: 'bad', id: SID, op: 'batch' } })).statusCode).toBe(404);
    expect((await invoke(ROUTES, 'post', '/sa/link/:token/session/:id/:op', { userId: null, params: { token: 'tok', id: SID, op: 'outcome' } })).statusCode).toBe(404);
    axiosPost.mockResolvedValueOnce({ status: 200, data: { success: true, status: 'ok', coachUserId: COACH, sessionId: SID } });
    expect((await invoke(ROUTES, 'post', '/sa/link/:token/session/:id/:op', { userId: null, params: { token: 'tok', id: SID, op: 'batch' } })).statusCode).toBe(404);
    expect(axiosPost).toHaveBeenCalledTimes(2);
  });
});

describe('the results dashboard on real sessions (sa/sessions): its own switch, sa_real_dashboard', () => {
  const BOT = 'https://bot.example/api/internal/child-test/';
  const prevEnv = process.env.RAILWAY_ENVIRONMENT_NAME;
  afterEach(() => {
    if (prevEnv === undefined) delete process.env.RAILWAY_ENVIRONMENT_NAME;
    else process.env.RAILWAY_ENVIRONMENT_NAME = prevEnv;
  });

  test('sa_real_dashboard off (row missing) → 404 and nothing relayed, even with the Learning assessment on', async () => {
    tableRows.app_settings.push({ key: 'portal_child_test_sa', value: true });
    expect((await invoke(ROUTES, 'get', '/sa/sessions')).statusCode).toBe(404);
    expect(axiosPost).not.toHaveBeenCalled();
  });

  test('on, with the Learning assessment off → 404', async () => {
    tableRows.app_settings.push({ key: 'sa_real_dashboard', value: true });
    expect((await invoke(ROUTES, 'get', '/sa/sessions')).statusCode).toBe(404);
    expect(axiosPost).not.toHaveBeenCalled();
  });

  test('on for this coach → relays the SESSION user only; a request that says asAdmin or another user is ignored', async () => {
    tableRows.app_settings.push({ key: 'portal_child_test_sa', value: true }, { key: 'sa_real_dashboard', value: [COACH] });
    axiosPost.mockResolvedValueOnce({ status: 200, data: { success: true, status: 'ok', sessions: [] } });
    const out = await invoke(ROUTES, 'get', '/sa/sessions', { query: { userId: 'forged', asAdmin: 'true' } });
    expect(out.statusCode).toBe(200);
    expect(out.payload.sessions).toEqual([]);
    expect(axiosPost).toHaveBeenLastCalledWith(`${BOT}sa/sessions`, { userId: COACH }, expect.anything());
  });

  test('the session user on sa_results_admins → asAdmin: true is relayed (every coach\'s sessions)', async () => {
    tableRows.app_settings.push({ key: 'portal_child_test_sa', value: true }, { key: 'sa_real_dashboard', value: true },
      { key: 'sa_results_admins', value: [COACH] });
    await invoke(ROUTES, 'get', '/sa/sessions');
    expect(axiosPost).toHaveBeenLastCalledWith(`${BOT}sa/sessions`, { userId: COACH, asAdmin: true }, expect.anything());
  });

  test.each([['sandbox'], ['production']])('the page switch follows its row on a %s host (not sandbox-only: real rows of that tier)', async (envName) => {
    process.env.RAILWAY_ENVIRONMENT_NAME = envName;
    tableRows.app_settings.push({ key: 'portal_child_test_sa', value: true }, { key: 'sa_real_dashboard', value: [COACH] });
    expect((await invoke(ROUTES, 'get', '/sa/switches')).payload.switches.realDashboard).toBe(true);
  });

  test('the switch key is exported from the shared flags', () => {
    expect(require('../../dashboard/lib/feature-flags').SA_REAL_DASHBOARD_KEY).toBe('sa_real_dashboard');
  });
});

describe('the visit review (sa/session/:id/review): its own switch, sa_review_page', () => {
  const SID = '55555555-5555-4555-8555-555555555555';
  const BOT = 'https://bot.example/api/internal/child-test/';
  const on = (...extra) => tableRows.app_settings.push({ key: 'portal_child_test_sa', value: true }, { key: 'sa_review_page', value: [COACH] }, ...extra);

  test('sa_review_page off → 404 on the read and the mark, nothing relayed', async () => {
    tableRows.app_settings.push({ key: 'portal_child_test_sa', value: true });
    expect((await invoke(ROUTES, 'get', '/sa/session/:id/review', { params: { id: SID } })).statusCode).toBe(404);
    expect((await invoke(ROUTES, 'post', '/sa/session/:id/review/mark', { params: { id: SID }, body: { taskId: 'ur.words4', itemKey: '1', mark: 'wrong' } })).statusCode).toBe(404);
    expect(axiosPost).not.toHaveBeenCalled();
  });

  test('on: the read relays the session id from the path and the SESSION user only', async () => {
    on();
    await invoke(ROUTES, 'get', '/sa/session/:id/review', { params: { id: SID }, query: { userId: 'forged', asAdmin: 'true' } });
    expect(axiosPost).toHaveBeenLastCalledWith(`${BOT}sa/review`, { userId: COACH, sessionId: SID }, expect.anything());
  });

  test('on: the mark relays only its fields; a body asAdmin or userId is ignored', async () => {
    on();
    await invoke(ROUTES, 'post', '/sa/session/:id/review/mark', {
      params: { id: SID }, body: { taskId: 'ur.words4', itemKey: '2', mark: 'unclear', note: 'n', asAdmin: true, userId: 'forged', reviewedBy: 'x' },
    });
    expect(axiosPost).toHaveBeenLastCalledWith(`${BOT}sa/review-mark`, { userId: COACH, sessionId: SID, taskId: 'ur.words4', itemKey: '2', mark: 'unclear', note: 'n' }, expect.anything());
  });

  test('the session user on sa_results_admins → asAdmin: true on both', async () => {
    on({ key: 'sa_results_admins', value: [COACH] });
    await invoke(ROUTES, 'get', '/sa/session/:id/review', { params: { id: SID } });
    expect(axiosPost).toHaveBeenLastCalledWith(`${BOT}sa/review`, { userId: COACH, sessionId: SID, asAdmin: true }, expect.anything());
    await invoke(ROUTES, 'post', '/sa/session/:id/review/mark', { params: { id: SID }, body: { taskId: 'ur.words4', itemKey: '2', mark: 'correct' } });
    expect(axiosPost).toHaveBeenLastCalledWith(`${BOT}sa/review-mark`, { userId: COACH, sessionId: SID, taskId: 'ur.words4', itemKey: '2', mark: 'correct', asAdmin: true }, expect.anything());
  });

  test('the page switch and the key', async () => {
    on();
    expect((await invoke(ROUTES, 'get', '/sa/switches')).payload.switches.reviewPage).toBe(true);
    expect(require('../../dashboard/lib/feature-flags').SA_REVIEW_PAGE_KEY).toBe('sa_review_page');
  });
});
