/**
 * bd-5rz1v.12 — the portal's new UI is designed screen by screen behind one
 * app_settings row, `portal_new_ui`, with the same shape and fail-closed rule as
 * portal_self_observation (dashboard/lib/feature-flags.js):
 *
 *   true (or "true")            → every user
 *   ["<user id>", …]            → only those users (a pilot)
 *   no row, anything else, a failed read, or no session → OFF
 *
 * /api/portal/config carries it to the browser as `features.newUi`, answered for
 * the SESSION user, and its error fallback says false.
 */

const { isFlagEnabledForUser, PORTAL_NEW_UI_KEY } = require('../../dashboard/lib/feature-flags');

function settingsClient(value, { error = null, throws = false } = {}) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            if (throws) throw new Error('db down');
            return { data: value === undefined ? null : { value }, error };
          },
        }),
      }),
    }),
  };
}

describe('portal_new_ui — the flag', () => {
  test('the key is portal_new_ui', () => {
    expect(PORTAL_NEW_UI_KEY).toBe('portal_new_ui');
  });

  test.each([
    ['true (everyone)', true, 'u1', true],
    ['"true" as a string', 'true', 'u1', true],
    ['a pilot list that includes her', ['u1', 'u2'], 'u1', true],
    ['a pilot list as a JSON string', '["u1"]', 'u1', true],
    ['a pilot list that leaves her out', ['u2'], 'u1', false],
    ['false', false, 'u1', false],
    ['an empty list', [], 'u1', false],
    ['a number', 1, 'u1', false],
    ['an object', { users: ['u1'] }, 'u1', false],
  ])('%s', async (_label, value, userId, expected) => {
    expect(await isFlagEnabledForUser(settingsClient(value), PORTAL_NEW_UI_KEY, userId)).toBe(expected);
  });

  test('no row is OFF', async () => {
    expect(await isFlagEnabledForUser(settingsClient(undefined), PORTAL_NEW_UI_KEY, 'u1')).toBe(false);
  });

  test('a failed read is OFF', async () => {
    expect(await isFlagEnabledForUser(settingsClient(true, { error: { message: 'x' } }), PORTAL_NEW_UI_KEY, 'u1')).toBe(false);
    expect(await isFlagEnabledForUser(settingsClient(true, { throws: true }), PORTAL_NEW_UI_KEY, 'u1')).toBe(false);
  });

  test('no session user is OFF, even when the flag is on for everyone', async () => {
    expect(await isFlagEnabledForUser(settingsClient(true), PORTAL_NEW_UI_KEY, null)).toBe(false);
    expect(await isFlagEnabledForUser(settingsClient(['u1']), PORTAL_NEW_UI_KEY, undefined)).toBe(false);
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

describe('GET /config — features.newUi', () => {
  test('a pilot list: true for a user it names, false for everyone else', async () => {
    settings.portal_new_ui = ['teacher-1'];
    expect((await getConfig()).payload.features.newUi).toBe(true);
    expect((await getConfig({ userId: 'teacher-2' })).payload.features.newUi).toBe(false);
  });

  test('true is everyone who is signed in', async () => {
    settings.portal_new_ui = true;
    expect((await getConfig({ userId: 'anyone' })).payload.features.newUi).toBe(true);
  });

  test('logged out, it is false', async () => {
    settings.portal_new_ui = true;
    expect((await getConfig({ userId: null })).payload.features.newUi).toBe(false);
  });

  test('absent, it is false — and it is a real boolean, not a missing field', async () => {
    const { payload } = await getConfig();
    expect(payload.features).toHaveProperty('newUi', false);
  });

  test('it reads its OWN key: another flag being on does not turn it on', async () => {
    settings.portal_self_observation = true;
    settings.portal_coach_observation = true;
    const { payload } = await getConfig();
    expect(payload.features.newUi).toBe(false);
    expect(payload.features.selfObservation).toBe(true);
  });

  test('the error fallback says newUi: false, next to the other features', async () => {
    settings.portal_new_ui = true;
    const { statusCode, payload } = await getConfig({ sessionThrows: true });
    expect(statusCode).toBe(200);
    expect(payload.features).toMatchObject({
      newUi: false, selfObservation: false, coachObservation: false, assessmentGenerator: false,
    });
  });

  test('the existing fields are unchanged in shape', async () => {
    const { payload } = await getConfig();
    expect(Object.keys(payload.features).sort()).toEqual([
      'assessmentEditing', 'assessmentGenerator', 'assessmentGeneratorMessage', 'coachObservation', 'coachV2', 'newUi', 'selfObservation',
    ]);
  });
});
