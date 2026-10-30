/**
 * The app's Send feedback crosses two hops: the portal's /api/portal/feedback* (session user only) relays to the
 * bot's /api/internal/app-feedback/* (shared secret), which calls app-feedback.service. Neither hop adds logic;
 * this pins what each passes on, and that an id in the request body never stands in for the session's.
 */

const SERVICE = '../../bot/shared/services/feedback/app-feedback.service';

function invoke(router, path, { body = {}, key = 'secret', session, headers = {} } = {}) {
  const layer = router.stack.find((l) => l.route && l.route.path === path && l.route.methods.post);
  if (!layer) throw new Error(`no POST ${path}`);
  const handlers = layer.route.stack.map((s) => s.handle);
  const all = { ...(key ? { 'x-api-key': key } : {}), ...headers };
  const req = {
    body, headers: all, path, ip: '127.0.0.1', session,
    get: (h) => all[String(h).toLowerCase()],
  };
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      headersSent: false,
      status(c) { this.statusCode = c; return this; },
      json(payload) { this.headersSent = true; resolve({ status: this.statusCode, body: payload }); return this; },
    };
    const run = (i) => {
      if (i >= handlers.length) return resolve({ status: 404, body: null });
      return Promise.resolve(handlers[i](req, res, () => run(i + 1)));
    };
    run(0);
  });
}

describe('bot — /api/internal/app-feedback/*', () => {
  let router;
  let svc;
  const OLD = process.env.INTERNAL_API_KEY;

  beforeEach(() => {
    jest.resetModules();
    process.env.INTERNAL_API_KEY = 'secret';
    svc = {
      presignUpload: jest.fn().mockResolvedValue({ status: 'ok', key: 'k', uploadUrl: 'u', contentType: 'audio/webm' }),
      submitFeedback: jest.fn().mockResolvedValue({ status: 'ok', feedbackId: 'fb-1' }),
    };
    jest.doMock(SERVICE, () => svc);
    router = require('../../bot/shared/routes/internal-api.routes');
  });
  afterAll(() => { process.env.INTERNAL_API_KEY = OLD; });

  test('presign passes the four fields through', async () => {
    const out = await invoke(router, '/app-feedback/presign-upload', {
      body: { userId: 'u1', filename: 'v.webm', sizeBytes: 10, kind: 'feedback_audio', extra: 'x' },
    });
    expect(out).toMatchObject({ status: 200, body: { success: true, key: 'k' } });
    expect(svc.presignUpload).toHaveBeenCalledWith({ userId: 'u1', filename: 'v.webm', sizeBytes: 10, kind: 'feedback_audio' });
  });

  test('submit passes what she sent through, and a refusal is a 400 with its reason', async () => {
    const body = { userId: 'u1', topic: 'idea', text: 'hi', audioKey: 'a', photoKeys: ['p'], context: { surface: 'coach_more' } };
    expect(await invoke(router, '/app-feedback/submit', { body })).toMatchObject({ status: 200, body: { success: true, feedbackId: 'fb-1' } });
    expect(svc.submitFeedback).toHaveBeenCalledWith(body);

    svc.submitFeedback.mockResolvedValue({ status: 'invalid', reason: 'empty' });
    expect(await invoke(router, '/app-feedback/submit', { body: { userId: 'u1' } }))
      .toMatchObject({ status: 400, body: { success: false, reason: 'empty' } });
  });

  test('refuses a caller without the shared secret, and a body without a user', async () => {
    expect((await invoke(router, '/app-feedback/submit', { body: { userId: 'u1' }, key: 'nope' })).status).toBe(401);
    expect((await invoke(router, '/app-feedback/submit', { body: {} })).status).toBe(400);
    expect(svc.submitFeedback).not.toHaveBeenCalled();
  });
});

describe('portal — /api/portal/feedback*', () => {
  const CLIENT = '../../dashboard/services/app-feedback.client';
  let client;
  let routes;

  beforeEach(() => {
    jest.resetModules();
    client = {
      presignUpload: jest.fn().mockResolvedValue({ httpStatus: 200, body: { key: 'k', uploadUrl: 'u', contentType: 'image/png' } }),
      submitFeedback: jest.fn().mockResolvedValue({ httpStatus: 200, body: { success: true, feedbackId: 'fb-1' } }),
    };
    jest.doMock(CLIENT, () => client);
    routes = require('../../dashboard/routes/app-feedback.routes');
  });

  const signedIn = { portalUserId: 'session-user' };

  test('presign signs under the SESSION user, never a body userId', async () => {
    const router = routes.createAppFeedbackRouter({ requirePortalAuth: (_q, _s, next) => next() });
    const out = await invoke(router, '/feedback/presign', {
      session: signedIn, body: { userId: 'someone-else', filename: 's.png', sizeBytes: 5, kind: 'feedback_photo' },
    });
    expect(out.status).toBe(200);
    expect(client.presignUpload).toHaveBeenCalledWith({ userId: 'session-user', filename: 's.png', sizeBytes: 5, kind: 'feedback_photo' });
  });

  test('send passes her words, keys and the browser class read from the request itself', async () => {
    const router = routes.createAppFeedbackRouter({ requirePortalAuth: (_q, _s, next) => next() });
    const out = await invoke(router, '/feedback', {
      session: signedIn,
      headers: { 'user-agent': 'Mozilla/5.0 (Linux; Android 13; wv) WA4A/2.24.1' },
      body: {
        userId: 'someone-else', topic: 'problem', text: 'x', audioKey: 'a', photoKeys: ['p'],
        context: { surface: 'coach_more', appBuild: 1216, browser: 'native-lie' },
      },
    });
    expect(out).toMatchObject({ status: 200, body: { success: true, feedbackId: 'fb-1' } });
    expect(client.submitFeedback).toHaveBeenCalledWith({
      userId: 'session-user', topic: 'problem', text: 'x', audioKey: 'a', photoKeys: ['p'],
      context: { surface: 'coach_more', appBuild: 1216, browser: 'whatsapp-iab' },
    });
  });

  test('the Android app may say it is the app; nothing else it says about the browser is believed', async () => {
    const router = routes.createAppFeedbackRouter({ requirePortalAuth: (_q, _s, next) => next() });
    await invoke(router, '/feedback', {
      session: signedIn, headers: { 'user-agent': 'Mozilla/5.0 (Linux; Android 13; wv)' },
      body: { topic: 'idea', text: 'x', context: { native: true } },
    });
    expect(client.submitFeedback.mock.calls[0][0].context.browser).toBe('native');
  });

  test('signed out is refused by the auth gate before the bot is called', async () => {
    const router = routes.createAppFeedbackRouter({ requirePortalAuth: (_q, res) => res.status(401).json({ success: false }) });
    expect((await invoke(router, '/feedback', { body: { topic: 'idea', text: 'x' } })).status).toBe(401);
    expect(client.submitFeedback).not.toHaveBeenCalled();
  });

  test('the bot unreachable is a 502, never a success', async () => {
    client.submitFeedback.mockRejectedValue(new Error('ECONNREFUSED'));
    const router = routes.createAppFeedbackRouter({ requirePortalAuth: (_q, _s, next) => next() });
    expect(await invoke(router, '/feedback', { session: signedIn, body: { topic: 'idea', text: 'x' } }))
      .toMatchObject({ status: 502, body: { success: false } });
  });
});
