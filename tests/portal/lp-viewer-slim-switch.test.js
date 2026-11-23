'use strict';
/**
 * portal_lp_viewer_slim: the plan screen's slim layout (one row of Observe, Answer key and Download over the plan; Quiz
 * this lesson and Send on WhatsApp after it; no dock). Per user: true, a list of users.id, or "teachers". It rides with
 * the teacher app (portal_teacher_v2). Fail closed: no row, a malformed value, a failed read, no user → off, which is
 * today's viewer.
 *
 *   dashboard/lib/lp-app-switches.js  PORTAL_LP_VIEWER_SLIM_KEY, isLpViewerSlimOn(supabase, userId)
 *   GET /api/portal/config            features.lpViewerSlim (false in the error fallback)
 */
process.env.FLAG_CACHE_TTL_MS = '0';

let settings = {};
let roles = {};

function makeChain(table) {
  let key = null;
  const chain = {
    select: () => chain,
    eq: (_col, val) => { key = val; return chain; },
    order: () => chain,
    limit: () => chain,
    maybeSingle: async () => {
      if (table === 'app_settings') {
        return { data: Object.prototype.hasOwnProperty.call(settings, key) ? { value: settings[key] } : null, error: null };
      }
      if (table === 'users' && Object.prototype.hasOwnProperty.call(roles, key)) return { data: { role: roles[key] }, error: null };
      return { data: null, error: null };
    },
  };
  chain.single = chain.maybeSingle;
  return chain;
}

function findRoute(router, method, path) {
  for (const layer of router.stack) {
    if (layer.route && layer.route.path === path && layer.route.methods[method]) return layer.route.stack.map((s) => s.handle);
  }
  throw new Error(`no ${method} ${path}`);
}

async function getConfig({ userId = 'teacher-1', sessionThrows = false } = {}) {
  const routes = require('../../dashboard/routes/portal.routes');
  const stack = findRoute(routes, 'get', '/config');
  const req = {
    params: {}, body: {}, query: {}, method: 'GET', path: '/config', ip: '127.0.0.1', headers: {}, get: () => undefined,
  };
  if (sessionThrows) {
    Object.defineProperty(req, 'session', { get() { throw new Error('session store down'); } });
  } else {
    req.session = userId ? { portalUserId: userId, id: 's' } : {};
  }
  let statusCode = 200;
  let payload = null;
  const res = { status(c) { statusCode = c; return this; }, json(b) { payload = b; return this; } };
  const errors = jest.spyOn(console, 'error').mockImplementation(() => {});
  try {
    for (const h of stack) {
      let next = false;
      // eslint-disable-next-line no-await-in-loop
      await h(req, res, () => { next = true; });
      if (!next) break;
    }
  } finally {
    errors.mockRestore();
  }
  return { statusCode, payload };
}




describe('isLpViewerSlimOn', () => {
  let S;
  const client = (settings, { fail = false } = {}) => ({
    from: () => {
      let key = null;
      const chain = {
        select: () => chain,
        eq: (_c, v) => { key = v; return chain; },
        maybeSingle: async () => (fail ? { data: null, error: { message: 'down' } }
          : { data: Object.prototype.hasOwnProperty.call(settings, key) ? { value: settings[key] } : null, error: null }),
      };
      return chain;
    },
  });
  beforeAll(() => { jest.resetModules(); S = require('../../dashboard/lib/lp-app-switches'); });

  test('the key', () => { expect(S.PORTAL_LP_VIEWER_SLIM_KEY).toBe('portal_lp_viewer_slim'); });

  test('on: true or a list naming her', async () => {
    expect(await S.isLpViewerSlimOn(client({ portal_lp_viewer_slim: true }), 't-1')).toBe(true);
    expect(await S.isLpViewerSlimOn(client({ portal_lp_viewer_slim: ['t-1'] }), 't-1')).toBe(true);
  });

  test('off: missing row, a list without her, malformed, failed read, no user', async () => {
    expect(await S.isLpViewerSlimOn(client({}), 't-1')).toBe(false);
    expect(await S.isLpViewerSlimOn(client({ portal_lp_viewer_slim: ['t-2'] }), 't-1')).toBe(false);
    for (const v of [false, 'yes', 1, { on: true }, '[bad', null]) {
      // eslint-disable-next-line no-await-in-loop
      expect(await S.isLpViewerSlimOn(client({ portal_lp_viewer_slim: v }), 't-1')).toBe(false);
    }
    expect(await S.isLpViewerSlimOn(client({ portal_lp_viewer_slim: true }, { fail: true }), 't-1')).toBe(false);
    expect(await S.isLpViewerSlimOn(client({ portal_lp_viewer_slim: true }), null)).toBe(false);
  });
});

describe('GET /config features.lpViewerSlim', () => {
  beforeEach(() => {
    jest.resetModules();
    settings = {};
    roles = {};
    jest.doMock('../../dashboard/config/supabase', () => ({ from: (t) => makeChain(t), rpc: jest.fn() }));
    jest.doMock('../../dashboard/services/portal-coaching.client', () => ({}));
    jest.doMock('../../dashboard/services/r2.service', () => ({
      generatePresignedUrl: jest.fn(), generatePresignedUrls: jest.fn(), isValidR2Url: jest.fn(),
    }));
    jest.doMock('bcryptjs', () => ({ hash: jest.fn(), compare: jest.fn(), genSalt: jest.fn() }), { virtual: true });
    jest.doMock('express-rate-limit', () => jest.fn(() => (_q, _s, n) => n()), { virtual: true });
    jest.doMock('@aws-sdk/client-s3', () => ({ S3Client: jest.fn(), GetObjectCommand: jest.fn() }), { virtual: true });
  });
  afterEach(() => jest.resetModules());

  const feats = async (opts) => (await getConfig(opts)).payload.features;

  test('absent → a real false', async () => {
    settings.portal_teacher_v2 = true;
    expect((await feats()).lpViewerSlim).toBe(false);
  });

  test('on for her with the teacher app; off without the teacher app or for another teacher', async () => {
    settings.portal_lp_viewer_slim = ['teacher-1'];
    expect((await feats()).lpViewerSlim).toBe(false);
    settings.portal_teacher_v2 = true;
    expect((await feats()).lpViewerSlim).toBe(true);
    expect((await feats({ userId: 'teacher-2' })).lpViewerSlim).toBe(false);
  });

  test('the error fallback says false', async () => {
    settings.portal_teacher_v2 = true;
    settings.portal_lp_viewer_slim = true;
    expect((await feats({ sessionThrows: true })).lpViewerSlim).toBe(false);
  });
});
