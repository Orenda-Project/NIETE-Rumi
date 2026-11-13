/**
 * bd-ra8xu.40 — the portal's Submit of an FDE (obs612) form rides the draft save's own path: POST
 * /api/portal/leader/observe/:id/draft { edits, submit: true } → the dashboard's PortalCoachingClient →
 * POST /api/internal/coaching/observe/draft/save → portal-observe.service saveDraft({ …, submit: true }).
 *
 * A FICO save ({ edits } alone) is passed on exactly as before: no `submit` key anywhere on its way. A refused Submit
 * (status 'invalid', reason 'obs612_incomplete', with the missing items and field errors) is a 400 the portal reads.
 */

describe('bot internal API: /coaching/observe/draft/save', () => {
  const SERVICE = '../../bot/shared/services/observe/portal-observe.service';
  let router;
  let svc;
  const OLD = process.env.INTERNAL_API_KEY;

  function invoke(path, body) {
    const layer = router.stack.find((l) => l.route && l.route.path === path && l.route.methods.post);
    const handlers = layer.route.stack.map((s) => s.handle);
    const req = { body, headers: { 'x-api-key': 'secret' }, path, ip: '127.0.0.1' };
    return new Promise((resolve) => {
      const res = {
        statusCode: 200,
        status(c) { this.statusCode = c; return this; },
        json(payload) { resolve({ status: this.statusCode, body: payload }); return this; },
      };
      const run = (i) => (i >= handlers.length ? resolve({ status: 404 }) : handlers[i](req, res, () => run(i + 1)));
      run(0);
    });
  }

  beforeEach(() => {
    jest.resetModules();
    process.env.INTERNAL_API_KEY = 'secret';
    svc = { saveDraft: jest.fn().mockResolvedValue({ status: 'ok' }) };
    jest.doMock(SERVICE, () => svc);
    router = require('../../bot/shared/routes/internal-api.routes');
  });
  afterAll(() => { process.env.INTERNAL_API_KEY = OLD; });

  test('submit: true is passed on', async () => {
    await invoke('/coaching/observe/draft/save', { userId: 'c1', coachingSessionId: 'cs-1', edits: { env_1: 'yes' }, submit: true });
    expect(svc.saveDraft).toHaveBeenCalledWith({ userId: 'c1', coachingSessionId: 'cs-1', edits: { env_1: 'yes' }, submit: true });
  });

  test.each([[undefined], [false], ['true'], [1]])('submit %p is not a Submit: the FICO call, unchanged', async (submit) => {
    await invoke('/coaching/observe/draft/save', { userId: 'c1', coachingSessionId: 'cs-1', edits: { r_C1: '2' }, submit });
    expect(svc.saveDraft).toHaveBeenCalledWith({ userId: 'c1', coachingSessionId: 'cs-1', edits: { r_C1: '2' } });
    expect(Object.keys(svc.saveDraft.mock.calls[0][0])).toEqual(['userId', 'coachingSessionId', 'edits']);
  });

  test('a refused Submit is a 400 carrying the missing items and the field errors', async () => {
    svc.saveDraft.mockResolvedValue({ status: 'invalid', reason: 'obs612_incomplete', missing: ['env_2'], errors: { env_2: 'item' } });
    const out = await invoke('/coaching/observe/draft/save', { userId: 'c1', coachingSessionId: 'cs-1', edits: {}, submit: true });
    expect(out).toEqual({
      status: 400,
      body: { success: false, status: 'invalid', reason: 'obs612_incomplete', missing: ['env_2'], errors: { env_2: 'item' } },
    });
  });
});

describe('dashboard client: saveObservationDraft', () => {
  let axios;
  beforeEach(() => {
    jest.resetModules();
    process.env.MAIN_BOT_URL = 'https://bot.example';
    process.env.INTERNAL_API_KEY = 'secret';
    axios = { post: jest.fn().mockResolvedValue({ status: 200, data: { status: 'ok' } }) };
    jest.doMock('axios', () => axios);
  });

  test('posts submit only when it is a Submit; a FICO save posts { userId, coachingSessionId, edits } as before', async () => {
    const Client = require('../../dashboard/services/portal-coaching.client');
    await Client.saveObservationDraft({ userId: 'c1', coachingSessionId: 'cs-1', edits: { r_C1: '2' } });
    expect(axios.post.mock.calls[0][1]).toEqual({ userId: 'c1', coachingSessionId: 'cs-1', edits: { r_C1: '2' } });
    expect(Object.keys(axios.post.mock.calls[0][1])).toEqual(['userId', 'coachingSessionId', 'edits']);
    await Client.saveObservationDraft({ userId: 'c1', coachingSessionId: 'cs-1', edits: { env_1: 'yes' }, submit: true });
    expect(axios.post.mock.calls[1][0]).toBe('https://bot.example/api/internal/coaching/observe/draft/save');
    expect(axios.post.mock.calls[1][1]).toEqual({ userId: 'c1', coachingSessionId: 'cs-1', edits: { env_1: 'yes' }, submit: true });
  });
});

describe('dashboard route: POST /leader/observe/:id/draft', () => {
  let client;
  const rows = {
    app_settings: [{ key: 'portal_coach_observation', value: ['coach-1'] }],
    users: [{ id: 'coach-1', role: 'coach' }],
  };
  function chain(table) {
    const tests = [];
    const run = () => (rows[table] || []).filter((r) => tests.every((t) => t(r)));
    const c = {
      select: () => c, in: () => c, order: () => c, limit: () => c,
      eq: (k, v) => { tests.push((r) => r[k] === v); return c; },
      maybeSingle: async () => ({ data: run()[0] || null, error: null }),
      single: async () => ({ data: run()[0] || null, error: null }),
      then: (res, rej) => Promise.resolve({ data: run(), error: null }).then(res, rej),
    };
    return c;
  }
  async function post(body) {
    const routes = require('../../dashboard/routes/portal.routes');
    const layer = routes.stack.find((l) => l.route && l.route.path === '/leader/observe/:id/draft' && l.route.methods.post);
    const stack = layer.route.stack.map((s) => s.handle);
    const req = {
      session: { portalUserId: 'coach-1', id: 's' }, params: { id: 'cs-1' }, body, query: {},
      method: 'POST', path: '/leader/observe/cs-1/draft', ip: '127.0.0.1', headers: {}, get: () => undefined,
    };
    let statusCode = 200;
    let payload = null;
    const res = { status(c) { statusCode = c; return this; }, json(b) { payload = b; return this; } };
    for (const h of stack) {
      let next = false;
      // eslint-disable-next-line no-await-in-loop
      await h(req, res, () => { next = true; });
      if (!next) break;
    }
    return { statusCode, payload };
  }

  beforeEach(() => {
    jest.resetModules();
    client = { saveObservationDraft: jest.fn().mockResolvedValue({ httpStatus: 200, body: { success: true, status: 'ok' } }) };
    jest.doMock('../../dashboard/services/portal-coaching.client', () => client);
    jest.doMock('../../dashboard/config/supabase', () => ({ from: (t) => chain(t), rpc: jest.fn() }));
    jest.doMock('../../dashboard/services/r2.service', () => ({
      generatePresignedUrl: jest.fn().mockResolvedValue(null), generatePresignedUrls: jest.fn().mockResolvedValue([]), isValidR2Url: jest.fn(() => true),
    }));
    jest.doMock('bcryptjs', () => ({ hash: jest.fn(), compare: jest.fn(), genSalt: jest.fn() }), { virtual: true });
    jest.doMock('express-rate-limit', () => jest.fn(() => (_req, _res, next) => next()), { virtual: true });
    jest.doMock('@aws-sdk/client-s3', () => ({ S3Client: jest.fn(), GetObjectCommand: jest.fn() }), { virtual: true });
  });
  afterEach(() => jest.resetModules());

  test('{ edits, submit: true } reaches the client as a Submit, for the SESSION coach', async () => {
    await post({ edits: { env_1: 'yes' }, submit: true, userId: 'someone-else' });
    expect(client.saveObservationDraft).toHaveBeenCalledWith({ userId: 'coach-1', coachingSessionId: 'cs-1', edits: { env_1: 'yes' }, submit: true });
  });

  test('{ edits } alone is the FICO save, unchanged', async () => {
    await post({ edits: { r_C1: '2' } });
    expect(client.saveObservationDraft).toHaveBeenCalledWith({ userId: 'coach-1', coachingSessionId: 'cs-1', edits: { r_C1: '2' } });
    expect(Object.keys(client.saveObservationDraft.mock.calls[0][0])).toEqual(['userId', 'coachingSessionId', 'edits']);
  });

  test('the bot\'s 400 (an incomplete form) is relayed with its errors', async () => {
    const body = { success: false, status: 'invalid', reason: 'obs612_incomplete', missing: ['env_2'], errors: { env_2: 'item' } };
    client.saveObservationDraft.mockResolvedValue({ httpStatus: 400, body });
    expect(await post({ edits: {}, submit: true })).toEqual({ statusCode: 400, payload: body });
  });
});
