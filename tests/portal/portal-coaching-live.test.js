/**
 * Live moves (bd-v0toag.31): the portal relays /api/portal/coaching-live/* to the bot's live/* routes.
 * The user is always the session's, never the body's, and nothing reaches the bot without portal auth.
 */

// Not a suite about the sign-in account check: every session user reads as live (tests/fixtures/portal-auth-live.js).
require('../fixtures/portal-auth-live').installLivePortalAccounts();

let client;

function findRoute(router, method, path) {
  for (const layer of router.stack) {
    if (layer.route && layer.route.path === path && layer.route.methods[method]) return layer.route.stack.map((s) => s.handle);
  }
  throw new Error(`no ${method.toUpperCase()} ${path}`);
}

async function invoke(path, { userId = 'teacher-1', body = {} } = {}) {
  const routes = require('../../dashboard/routes/portal.routes');
  const stack = findRoute(routes, 'post', path);
  const req = {
    session: userId ? { portalUserId: userId, id: 'sess-1' } : null,
    params: {}, body, query: {}, method: 'POST', path, ip: '127.0.0.1', headers: {}, get: () => undefined,
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

const chain = (rows) => {
  const c = {
    select: () => c, eq: () => c, in: () => c, limit: () => c,
    maybeSingle: async () => ({ data: rows[0] || null, error: null }),
    single: async () => ({ data: rows[0] || null, error: null }),
    then: (r) => r({ data: rows, error: null }),
  };
  return c;
};

beforeEach(() => {
  jest.resetModules();
  const ok = { httpStatus: 200, body: { success: true, status: 'ok' } };
  client = {
    liveEligible: jest.fn().mockResolvedValue(ok), liveCard: jest.fn().mockResolvedValue(ok),
    liveKey: jest.fn().mockResolvedValue(ok), liveDetect: jest.fn().mockResolvedValue(ok),
    liveEnd: jest.fn().mockResolvedValue(ok), liveTaps: jest.fn().mockResolvedValue(ok),
    startSession: jest.fn().mockResolvedValue(ok),
  };
  jest.doMock('../../dashboard/services/portal-coaching.client', () => client);
  jest.doMock('../../dashboard/config/supabase', () => ({
    from: (t) => chain(t === 'app_settings' ? [{ key: 'portal_self_observation', value: true }] : []), rpc: jest.fn(),
  }));
  jest.doMock('../../dashboard/services/r2.service', () => ({
    generatePresignedUrl: jest.fn(), generatePresignedUrls: jest.fn(), isValidR2Url: jest.fn(),
  }));
  jest.doMock('bcryptjs', () => ({ hash: jest.fn(), compare: jest.fn(), genSalt: jest.fn() }), { virtual: true });
  jest.doMock('express-rate-limit', () => jest.fn(() => (_req, _res, next) => next()), { virtual: true });
  jest.doMock('@aws-sdk/client-s3', () => ({ S3Client: jest.fn(), GetObjectCommand: jest.fn() }), { virtual: true });
});

const ROUTES = [
  ['eligible', 'liveEligible', {}],
  ['card', 'liveCard', { lessonId: 'L1' }],
  ['key', 'liveKey', { liveId: 'live-1' }],
  ['detect', 'liveDetect', { liveId: 'live-1', lessonId: 'L1', window: 'w', unticked: [0] }],
  ['end', 'liveEnd', { liveId: 'live-1', drops: 0, bytesSent: 10 }],
  ['taps', 'liveTaps', { coachingSessionId: 'cs-1', taps: [] }],
];

test.each(ROUTES)('relay requires portal auth (%s)', async (name, fn, body) => {
  const out = await invoke(`/coaching-live/${name}`, { userId: null, body });
  expect(out.statusCode).toBe(401);
  expect(client[fn]).not.toHaveBeenCalled();
});

test.each(ROUTES)('%s relays for the SESSION user, not the body', async (name, fn, body) => {
  const out = await invoke(`/coaching-live/${name}`, { body: { ...body, userId: 'someone-else' } });
  expect(out.statusCode).toBe(200);
  expect(client[fn]).toHaveBeenCalledWith({ ...body, userId: 'teacher-1' });
});

test('coaching-upload/start forwards the live moves record', async () => {
  const liveMoves = { lessonId: 'L1', stamp: 's1', liveId: 'live-1', moves: [], taps: [], drops: 0, bytesSent: 0 };
  const out = await invoke('/coaching-upload/start', { body: { key: 'k', liveMoves } });
  expect(out.statusCode).toBe(200);
  expect(client.startSession).toHaveBeenCalledWith(expect.objectContaining({ userId: 'teacher-1', key: 'k', liveMoves }));
});
