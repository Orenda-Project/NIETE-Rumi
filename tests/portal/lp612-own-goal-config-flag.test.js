/**
 * bd-snkn32.56 (queue #134 E) — "Start from a learning goal or topic" ships behind the LIST-ONLY app_settings key
 * `portal_lp_own_goal_start` (a JSON list of users.id; true / "teachers" is nobody while it is tested with a few
 * teachers), riding with Make my own on. /config carries it as features.lpOwnGoalStart.
 */
process.env.FLAG_CACHE_TTL_MS = '0';

const { PORTAL_LP_OWN_GOAL_START_KEY } = require('../../dashboard/lib/feature-flags');

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


describe('GET /config — features.lpOwnGoalStart', () => {
  beforeEach(() => {
    jest.resetModules();
    settings = { portal_teacher_v2: true, portal_lp_make_own: true };
    jest.doMock('../../bot/shared/services/lp-own-gb', () => ({ isGbTeacher: async () => false }));
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

  test('the key', () => {
    expect(PORTAL_LP_OWN_GOAL_START_KEY).toBe('portal_lp_own_goal_start');
  });

  test('absent: a real false', async () => {
    expect((await getConfig()).payload.features).toHaveProperty('lpOwnGoalStart', false);
  });

  test('on only for a listed id; true or "teachers" is nobody', async () => {
    settings.portal_lp_own_goal_start = ['teacher-1'];
    expect((await getConfig()).payload.features.lpOwnGoalStart).toBe(true);
    expect((await getConfig({ userId: 'teacher-2' })).payload.features.lpOwnGoalStart).toBe(false);
    settings.portal_lp_own_goal_start = true;
    expect((await getConfig()).payload.features.lpOwnGoalStart).toBe(false);
    settings.portal_lp_own_goal_start = 'teachers';
    expect((await getConfig()).payload.features.lpOwnGoalStart).toBe(false);
  });

  test('listed, but Make my own off for her: off', async () => {
    settings.portal_lp_own_goal_start = ['teacher-1'];
    delete settings.portal_lp_make_own;
    expect((await getConfig()).payload.features.lpOwnGoalStart).toBe(false);
  });

  test('logged out, and the error fallback: false', async () => {
    settings.portal_lp_own_goal_start = ['teacher-1'];
    expect((await getConfig({ userId: null })).payload.features.lpOwnGoalStart).toBe(false);
    expect((await getConfig({ sessionThrows: true })).payload.features.lpOwnGoalStart).toBe(false);
  });
});
