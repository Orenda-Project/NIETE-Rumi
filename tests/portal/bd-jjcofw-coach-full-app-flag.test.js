/**
 * bd-jjcofw — the per-user FULL coach app: app_settings `portal_coach_full_app` opens the coach app v2's Schedule and
 * Observe (scheduling, visits, recording) for the users it lists. Same shape and fail-closed rule as the other per-user
 * keys (dashboard/lib/feature-flags.js isFlagEnabledForUser): a list of users.id = those users, true = everyone, no row,
 * anything else, a failed read or no session = OFF.
 *
 * /api/portal/config carries it as `features.coachFullApp`, answered for the SESSION user, and only with the coach app
 * v2 on for her (like schoolCard): the pages it opens live inside v2. Its error fallback says false.
 */

const { PORTAL_COACH_FULL_APP_KEY } = require('../../dashboard/lib/feature-flags');

describe('portal_coach_full_app — the key', () => {
  test('its own app_settings key', () => {
    expect(PORTAL_COACH_FULL_APP_KEY).toBe('portal_coach_full_app');
  });
});

/* ── GET /config ────────────────────────────────────────────────────────── */

/** app_settings rows by key; any other table answers nothing. */
let settings;

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
    // A session store that fails mid-request — the route's catch must still answer.
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

describe('GET /config — features.coachFullApp', () => {
  test('a list: true for the coach it names (with coach v2 on), false for another coach', async () => {
    settings.portal_coach_v2 = true;
    settings.portal_coach_full_app = ['rifat'];
    expect((await getConfig({ userId: 'rifat' })).payload.features.coachFullApp).toBe(true);
    expect((await getConfig({ userId: 'other-coach' })).payload.features.coachFullApp).toBe(false);
  });

  test('coach v2 off for her: false, even when listed', async () => {
    settings.portal_coach_v2 = ['someone-else'];
    settings.portal_coach_full_app = ['rifat'];
    expect((await getConfig({ userId: 'rifat' })).payload.features.coachFullApp).toBe(false);
  });

  test('absent: false, a real boolean next to the other features', async () => {
    settings.portal_coach_v2 = true;
    const { payload } = await getConfig({ userId: 'rifat' });
    expect(payload.features).toHaveProperty('coachFullApp', false);
    expect(payload.features.coachV2).toBe(true);
  });

  test('an object, a number or an empty list is OFF', async () => {
    settings.portal_coach_v2 = true;
    for (const v of [{ rifat: true }, 1, []]) {
      settings.portal_coach_full_app = v;
      // eslint-disable-next-line no-await-in-loop
      expect((await getConfig({ userId: 'rifat' })).payload.features.coachFullApp).toBe(false);
    }
  });

  test('logged out: false', async () => {
    settings.portal_coach_v2 = true;
    settings.portal_coach_full_app = true;
    expect((await getConfig({ userId: null })).payload.features.coachFullApp).toBe(false);
  });

  test('it reads its OWN key: the School card or coach observation being on does not turn it on', async () => {
    settings.portal_coach_v2 = true;
    settings.portal_coach_school_card = true;
    settings.portal_coach_observation = true;
    const { payload } = await getConfig({ userId: 'rifat' });
    expect(payload.features.coachFullApp).toBe(false);
    expect(payload.features.schoolCard).toBe(true);
  });

  test('the error fallback says coachFullApp: false', async () => {
    settings.portal_coach_v2 = true;
    settings.portal_coach_full_app = true;
    const { statusCode, payload } = await getConfig({ sessionThrows: true });
    expect(statusCode).toBe(200);
    expect(payload.features).toHaveProperty('coachFullApp', false);
  });
});
