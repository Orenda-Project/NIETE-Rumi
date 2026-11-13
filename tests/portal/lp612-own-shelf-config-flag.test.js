/**
 * bd-snkn32.42 — the "Made by a teacher" shelf ships behind app_settings `portal_lp_own_shelf`, read like
 * portal_lp_make_own (true / "teachers" / a list of users.id, riding with the teacher app), carried by /config as
 * features.lpOwnShelf. The human check before listing is open to the staff named on the LIST-ONLY key
 * `portal_lp_own_reviewers` (read like portal_role_switch), carried as features.lpOwnReviewer.
 */
process.env.FLAG_CACHE_TTL_MS = '0';

const { PORTAL_LP_OWN_SHELF_KEY, PORTAL_LP_OWN_REVIEWERS_KEY } = require('../../dashboard/lib/feature-flags');

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


describe('GET /config — features.lpOwnShelf and lpOwnReviewer', () => {
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

  test('the keys', () => {
    expect(PORTAL_LP_OWN_SHELF_KEY).toBe('portal_lp_own_shelf');
    expect(PORTAL_LP_OWN_REVIEWERS_KEY).toBe('portal_lp_own_reviewers');
  });

  test('absent: both a real false', async () => {
    settings.portal_teacher_v2 = true;
    const f = (await getConfig()).payload.features;
    expect(f).toHaveProperty('lpOwnShelf', false);
    expect(f).toHaveProperty('lpOwnReviewer', false);
  });

  test('the shelf: on for the teacher a pilot names, with the teacher app; off without it', async () => {
    settings.portal_teacher_v2 = true;
    settings.portal_lp_own_shelf = ['teacher-1'];
    expect((await getConfig()).payload.features.lpOwnShelf).toBe(true);
    expect((await getConfig({ userId: 'teacher-2' })).payload.features.lpOwnShelf).toBe(false);
    delete settings.portal_teacher_v2;
    settings.portal_lp_own_shelf = true;
    expect((await getConfig()).payload.features.lpOwnShelf).toBe(false);
  });

  test('the reviewer: only a listed id; true or "teachers" is nobody', async () => {
    settings.portal_lp_own_reviewers = ['teacher-1'];
    expect((await getConfig()).payload.features.lpOwnReviewer).toBe(true);
    expect((await getConfig({ userId: 'teacher-2' })).payload.features.lpOwnReviewer).toBe(false);
    settings.portal_lp_own_reviewers = true;
    expect((await getConfig()).payload.features.lpOwnReviewer).toBe(false);
    settings.portal_lp_own_reviewers = 'teachers';
    expect((await getConfig()).payload.features.lpOwnReviewer).toBe(false);
  });

  test('logged out, and the error fallback: both false', async () => {
    settings.portal_teacher_v2 = true;
    settings.portal_lp_own_shelf = true;
    expect((await getConfig({ userId: null })).payload.features).toMatchObject({ lpOwnShelf: false, lpOwnReviewer: false });
    expect((await getConfig({ sessionThrows: true })).payload.features).toMatchObject({ lpOwnShelf: false, lpOwnReviewer: false });
  });
});
