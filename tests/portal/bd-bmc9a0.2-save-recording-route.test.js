/**
 * bd-bmc9a0.2 — ICT IAB row 31: "Save recording" sends the lesson exactly as Submit does, plus one flag,
 * saveForLater, that marks the DC observation as saved to come back to. The portal route forwards it to the bot
 * only as a real boolean true; anything else is dropped (the recording still starts, as a plain Submit).
 * Harness: the same as portal-coaching-upload.test.js (the bot client is mocked; identity is the session's).
 */

// Not a suite about the sign-in account check: every session user reads as live (tests/fixtures/portal-auth-live.js).
require('../fixtures/portal-auth-live').installLivePortalAccounts();

let tableRows;
let client;

function makeChain(table) {
  const filters = {};
  const chain = {
    select: () => chain,
    eq: (c, v) => { filters[c] = v; return chain; },
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

async function invoke(method, path, { userId = 'teacher-1', params = {}, body = {} } = {}) {
  const routes = require('../../dashboard/routes/portal.routes');
  const stack = findRoute(routes, method, path);
  const req = {
    session: userId ? { portalUserId: userId, id: 'sess-1' } : null,
    params, body, query: {}, method: method.toUpperCase(), path, ip: '127.0.0.1', headers: {}, get: () => undefined,
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


beforeEach(() => {
  jest.resetModules();
  // These tests cover the routes with the feature ON (bd-3bvfj gates them;
  // the OFF behaviour is pinned in portal-self-observation-flag.test.js).
  tableRows = { app_settings: [{ key: 'portal_self_observation', value: true }] };
  client = {
    presignUpload: jest.fn().mockResolvedValue({ httpStatus: 200, body: { success: true, status: 'ok', key: 'k', uploadUrl: 'u' } }),
    startSession: jest.fn().mockResolvedValue({ httpStatus: 200, body: { success: true, status: 'ok', coachingSessionId: 'cs-1' } }),
    submitReflection: jest.fn().mockResolvedValue({ httpStatus: 200, body: { success: true, status: 'ok', done: true, acknowledgement: 'Thank you.' } }),
  };
  jest.doMock('../../dashboard/services/portal-coaching.client', () => client);
  jest.doMock('../../dashboard/config/supabase', () => ({ from: (t) => makeChain(t), rpc: jest.fn() }));
  jest.doMock('../../dashboard/services/r2.service', () => ({
    generatePresignedUrl: jest.fn().mockResolvedValue(null),
    generatePresignedUrls: jest.fn().mockResolvedValue([]),
    isValidR2Url: jest.fn().mockReturnValue(true),
  }));
  jest.doMock('bcryptjs', () => ({ hash: jest.fn(), compare: jest.fn(), genSalt: jest.fn() }), { virtual: true });
  jest.doMock('express-rate-limit', () => jest.fn(() => (_req, _res, next) => next()), { virtual: true });
  jest.doMock('@aws-sdk/client-s3', () => ({ S3Client: jest.fn(), GetObjectCommand: jest.fn() }), { virtual: true });
});
afterEach(() => jest.resetModules());

describe('POST /coaching-upload/start — saveForLater (bd-bmc9a0.2)', () => {
  it('forwards saveForLater:true to the bot with the session user', async () => {
    const { statusCode } = await invoke('post', '/coaching-upload/start', { body: { key: 'k', saveForLater: true, userId: 'x' } });
    expect(statusCode).toBe(200);
    expect(client.startSession).toHaveBeenCalledWith(expect.objectContaining({ userId: 'teacher-1', key: 'k', saveForLater: true }));
  });

  it('anything but a real true is not forwarded (a plain Submit)', async () => {
    for (const v of ['true', 1, 'yes', false, null, {}]) {
      client.startSession.mockClear();
      const { statusCode } = await invoke('post', '/coaching-upload/start', { body: { key: 'k', saveForLater: v } });
      expect(statusCode).toBe(200);
      expect(client.startSession.mock.calls[0][0].saveForLater).toBeUndefined();
    }
  });

  it('Submit is unchanged: no saveForLater key at all', async () => {
    await invoke('post', '/coaching-upload/start', { body: { key: 'k' } });
    expect('saveForLater' in client.startSession.mock.calls[0][0]).toBe(false);
  });
});
