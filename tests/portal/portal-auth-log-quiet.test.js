/**
 * The portal's auth check logs only when it refuses, on one line.
 *
 * Every signed-in portal request used to write a fifteen-line debug object plus a success line. With fifty coaches
 * signing in at once, the host's log-rate cap dropped well over a thousand lines in seconds, so a real error in that
 * burst could be lost. A signed-in request now logs nothing; a refused one logs a single line.
 *
 * Real router handler (the first one on GET /me); Supabase and the other edges are mocked.
 */
let logSpy;

function authHandler() {
  const routes = require('../../dashboard/routes/portal.routes');
  const layer = routes.stack.find((l) => l.route && l.route.path === '/me' && l.route.methods.get);
  if (!layer) throw new Error('GET /me not found on the portal router');
  return layer.route.stack[0].handle;
}

function call(handler, session) {
  const req = {
    session, method: 'GET', path: '/me', ip: '127.0.0.1',
    headers: { cookie: session ? 'sid=x' : undefined },
    get: (h) => ({ 'User-Agent': 'jest', Origin: 'https://portal.example' })[h],
  };
  let statusCode = 200;
  let payload = null;
  const res = {
    status(code) { statusCode = code; return this; },
    json(b) { payload = b; return this; },
  };
  let advanced = false;
  handler(req, res, () => { advanced = true; });
  return { advanced, statusCode, payload };
}

beforeEach(() => {
  jest.resetModules();
  jest.doMock('../../dashboard/config/supabase', () => ({ from: jest.fn(), rpc: jest.fn().mockResolvedValue({ error: null }) }));
  const { installTrainingDelegation } = require('../fixtures/delegate-training-to-bot');
  installTrainingDelegation(() => require('../../dashboard/config/supabase').from);
  jest.doMock('../../dashboard/services/r2.service', () => ({
    generatePresignedUrl: jest.fn().mockResolvedValue(null),
    generatePresignedUrls: jest.fn().mockResolvedValue([]),
    isValidR2Url: jest.fn().mockReturnValue(true),
  }));
  jest.doMock('bcryptjs', () => ({ hash: jest.fn(), compare: jest.fn(), genSalt: jest.fn() }), { virtual: true });
  jest.doMock('express-rate-limit', () => jest.fn(() => (_req, _res, next) => next()), { virtual: true });
  jest.doMock('@aws-sdk/client-s3', () => ({ S3Client: jest.fn(), GetObjectCommand: jest.fn() }), { virtual: true });
  jest.doMock('../../dashboard/services/telemetry.service', () => ({ logEvent: jest.fn(), flush: jest.fn(), isEnabled: () => true }));
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => { logSpy.mockRestore(); jest.resetModules(); });

describe('requirePortalAuth: log only a refusal, on one line', () => {
  test('a signed-in request passes and writes nothing to the log', () => {
    const handler = authHandler();
    logSpy.mockClear();
    const out = call(handler, { id: 's-1', portalUserId: 'u-1' });
    expect(out.advanced).toBe(true);
    expect(logSpy).not.toHaveBeenCalled();
  });

  test('a request with no signed-in user is refused with 401 and one single-line log entry', () => {
    const handler = authHandler();
    logSpy.mockClear();
    const out = call(handler, { id: 's-2' });
    expect(out.advanced).toBe(false);
    expect(out.statusCode).toBe(401);
    expect(out.payload).toMatchObject({ success: false });
    expect(logSpy).toHaveBeenCalledTimes(1);
    const line = logSpy.mock.calls[0].map(String).join(' ');
    expect(logSpy.mock.calls[0]).toHaveLength(1);
    expect(line).not.toMatch(/\n/);
    expect(line).toMatch(/Portal Auth Failed/);
  });

  test('a request with no session object at all is refused the same way', () => {
    const handler = authHandler();
    logSpy.mockClear();
    const out = call(handler, undefined);
    expect(out.statusCode).toBe(401);
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0]).toHaveLength(1);
  });
});
