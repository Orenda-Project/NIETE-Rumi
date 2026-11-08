/**
 * bd-snkn32 — "Make my own" lesson plan ships behind app_settings `portal_lp_make_own` (lib/feature-flags
 * PORTAL_LP_MAKE_OWN_KEY), carried to the browser by /api/portal/config as `features.lpMakeOwn`. It rides with the
 * teacher app: on only when portal_teacher_v2 is on for her too. Absent, logged out, or a failed read → false.
 */
process.env.FLAG_CACHE_TTL_MS = '0';

const { PORTAL_LP_MAKE_OWN_KEY } = require('../../dashboard/lib/feature-flags');

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


describe('GET /config — features.lpMakeOwn', () => {
  beforeEach(() => {
    jest.resetModules();
    settings = {};
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

  test('the key is portal_lp_make_own', () => {
    expect(PORTAL_LP_MAKE_OWN_KEY).toBe('portal_lp_make_own');
  });

  test('absent, it is a real false', async () => {
    settings.portal_teacher_v2 = true;
    expect((await getConfig()).payload.features).toHaveProperty('lpMakeOwn', false);
  });

  test('on with the teacher app: true for the teacher a pilot names, false for others', async () => {
    settings.portal_teacher_v2 = true;
    settings.portal_lp_make_own = ['teacher-1'];
    expect((await getConfig()).payload.features.lpMakeOwn).toBe(true);
    expect((await getConfig({ userId: 'teacher-2' })).payload.features.lpMakeOwn).toBe(false);
  });

  test('rides with the teacher app: teacher app off, it is off', async () => {
    settings.portal_lp_make_own = true;
    expect((await getConfig()).payload.features.lpMakeOwn).toBe(false);
  });

  test('logged out, it is false', async () => {
    settings.portal_teacher_v2 = true;
    settings.portal_lp_make_own = true;
    expect((await getConfig({ userId: null })).payload.features.lpMakeOwn).toBe(false);
  });

  test('the error fallback says lpMakeOwn: false', async () => {
    settings.portal_teacher_v2 = true;
    settings.portal_lp_make_own = true;
    const { payload } = await getConfig({ sessionThrows: true });
    expect(payload.features).toMatchObject({ lpMakeOwn: false });
  });
});
