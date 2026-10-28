'use strict';
/**
 * bd-5gyspy.8 — a bot answer that arrives after the portal has already answered must not take the portal down.
 *
 * NIETE prod, 28 Oct 04:01:35Z and 04:03:32Z: POST /coaching-session/:id/reflection waited on the bot for 30 s, the
 * DB-context middleware answered 504 (`middleware/rbac/database-context.js`, REQUEST_TIMEOUT_MS), the bot's answer came
 * back ~1.5 s later, and relayToBot wrote it onto the finished response. Express throws ERR_HTTP_HEADERS_SENT there,
 * relayToBot's catch wrote its 502 onto it again, that second throw was unhandled, and the cluster worker exited with
 * code 1, dropping every other request in flight on it. Two workers on 28 Oct, ten on 27 Oct.
 *
 * The route runs as mounted (auth, the switch, the handler) with the bot client mocked; `res` throws as Express does
 * once a response has gone out.
 */

let client;

function findRoute(router, method, path) {
  for (const layer of router.stack) {
    if (layer.route && layer.route.path === path && layer.route.methods[method]) return layer.route.stack.map((s) => s.handle);
  }
  throw new Error(`no ${method.toUpperCase()} ${path}`);
}

/** A response that behaves as Express's does: a second write after the first throws ERR_HTTP_HEADERS_SENT. */
function expressLikeRes() {
  const res = {
    headersSent: false,
    statusCode: 200,
    sent: [],
    status(c) {
      if (this.headersSent) { const e = new Error('Cannot set headers after they are sent to the client'); e.code = 'ERR_HTTP_HEADERS_SENT'; throw e; }
      this.statusCode = c;
      return this;
    },
    json(b) {
      if (this.headersSent) { const e = new Error('Cannot set headers after they are sent to the client'); e.code = 'ERR_HTTP_HEADERS_SENT'; throw e; }
      this.sent.push({ status: this.statusCode, body: b });
      this.headersSent = true;
      return this;
    },
  };
  return res;
}

async function invoke(method, path, res, { params = {}, body = {} } = {}) {
  const routes = require('../../dashboard/routes/portal.routes');
  const stack = findRoute(routes, method, path);
  const req = {
    session: { portalUserId: 'teacher-1', id: 'sess-1' },
    params, body, query: {}, method: method.toUpperCase(), path, ip: '127.0.0.1', headers: {}, get: () => undefined,
  };
  for (const handler of stack) {
    let next = false;
    // eslint-disable-next-line no-await-in-loop
    await handler(req, res, () => { next = true; });
    if (!next) break;
  }
}

const chain = () => {
  const c = {
    select: () => c, eq: () => c, in: () => c, order: () => c, limit: () => c,
    // the one read on this route: app_settings.portal_self_observation (the feature's switch), on
    maybeSingle: async () => ({ data: { key: 'portal_self_observation', value: true }, error: null }),
    then: (ok, ko) => Promise.resolve({ data: [{ key: 'portal_self_observation', value: true }], error: null }).then(ok, ko),
  };
  c.single = c.maybeSingle;
  return c;
};

beforeEach(() => {
  jest.resetModules();
  client = { submitReflection: jest.fn() };
  jest.doMock('../../dashboard/services/portal-coaching.client', () => client);
  jest.doMock('../../dashboard/config/supabase', () => ({ from: () => chain(), rpc: jest.fn() }));
  jest.doMock('../../dashboard/services/r2.service', () => ({
    generatePresignedUrl: jest.fn().mockResolvedValue('https://r2.example/signed.ogg'),
    generatePresignedUrls: jest.fn().mockResolvedValue([]),
    isValidR2Url: jest.fn().mockReturnValue(true),
  }));
  jest.doMock('bcryptjs', () => ({ hash: jest.fn(), compare: jest.fn(), genSalt: jest.fn() }));
  jest.doMock('express-rate-limit', () => jest.fn(() => (_req, _res, next) => next()));
});
afterEach(() => jest.resetModules());

describe('the mocks match the real modules', () => {
  it('every function the client mock provides is exported by the real portal-coaching.client', () => {
    const real = jest.requireActual('../../dashboard/services/portal-coaching.client');
    for (const k of Object.keys(client)) expect(typeof real[k]).toBe('function');
  });
});

describe('POST /coaching-session/:id/reflection — the bot answers after the portal already has (bd-5gyspy.8)', () => {
  const PATH = '/coaching-session/:id/reflection';

  it('an answer in time is relayed as before', async () => {
    client.submitReflection.mockResolvedValue({ httpStatus: 200, body: { done: false, acknowledgement: 'ok' } });
    const res = expressLikeRes();
    await invoke('post', PATH, res, { params: { id: 'cs-1' }, body: { answer: 'x' } });
    expect(res.sent).toEqual([{ status: 200, body: { done: false, acknowledgement: 'ok' } }]);
  });

  it('a late answer (the 30 s 504 already sent) is dropped: no throw, and the 504 is the only response', async () => {
    const res = expressLikeRes();
    client.submitReflection.mockImplementation(async () => {
      res.status(504).json({ error: 'Request timeout' }); // the DB-context middleware, while the bot is still working
      return { httpStatus: 200, body: { done: true, acknowledgement: 'thanks', acknowledgementAudioUrl: 'https://r2.example/closer.ogg' } };
    });
    await expect(invoke('post', PATH, res, { params: { id: 'cs-1' }, body: { answer: 'x' } })).resolves.toBeUndefined();
    expect(res.sent).toEqual([{ status: 504, body: { error: 'Request timeout' } }]);
  });

  it('a bot failure after the 504 is dropped too (the catch never writes a second response)', async () => {
    const res = expressLikeRes();
    client.submitReflection.mockImplementation(async () => {
      res.status(504).json({ error: 'Request timeout' });
      throw new Error('socket hang up');
    });
    await expect(invoke('post', PATH, res, { params: { id: 'cs-1' }, body: { answer: 'x' } })).resolves.toBeUndefined();
    expect(res.sent).toEqual([{ status: 504, body: { error: 'Request timeout' } }]);
  });

  it('a bot failure in time is still a 502, never success', async () => {
    client.submitReflection.mockRejectedValue(new Error('socket hang up'));
    const res = expressLikeRes();
    await invoke('post', PATH, res, { params: { id: 'cs-1' }, body: { answer: 'x' } });
    expect(res.sent).toEqual([{ status: 502, body: { success: false, error: 'Could not reach the coaching service. Please try again.' } }]);
  });
});
