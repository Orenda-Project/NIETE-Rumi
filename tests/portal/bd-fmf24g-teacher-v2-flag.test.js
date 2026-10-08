/**
 * bd-fmf24g.1 — the teacher app v2 ships behind one app_settings row,
 * `portal_teacher_v2`, with the same shape and fail-closed rule as portal_coach_v2:
 *
 *   true (or "true")            → every user
 *   ["<user id>", …]            → only those users (a pilot)
 *   no row, anything else, a failed read, or no session → OFF
 *
 * /api/portal/config carries it to the browser as `features.teacherV2`, answered
 * for the SESSION user. The portal shows it to teachers only (not the leader family).
 */

const { isFlagEnabledForUser, PORTAL_TEACHER_V2_KEY } = require('../../dashboard/lib/feature-flags');

/** app_settings rows by key; any other table answers nothing. */
let settings;

function settingsByKey() {
  return {
    from: () => {
      let key = null;
      const chain = {
        select: () => chain,
        eq: (_col, val) => { key = val; return chain; },
        maybeSingle: async () => ({
          data: Object.prototype.hasOwnProperty.call(settings, key) ? { value: settings[key] } : null,
          error: null,
        }),
      };
      return chain;
    },
  };
}

describe('portal_teacher_v2 — the flag', () => {
  beforeEach(() => { settings = {}; });

  test('the key is portal_teacher_v2', () => {
    expect(PORTAL_TEACHER_V2_KEY).toBe('portal_teacher_v2');
  });

  test.each([
    ['true (everyone)', true, 'u1', true],
    ['a pilot list that includes her', ['u1'], 'u1', true],
    ['a pilot list that leaves her out', ['u2'], 'u1', false],
    ['false', false, 'u1', false],
    ['an object', { users: ['u1'] }, 'u1', false],
  ])('%s', async (_label, value, userId, expected) => {
    settings.portal_teacher_v2 = value;
    expect(await isFlagEnabledForUser(settingsByKey(), PORTAL_TEACHER_V2_KEY, userId)).toBe(expected);
  });

  test('no row is OFF', async () => {
    expect(await isFlagEnabledForUser(settingsByKey(), PORTAL_TEACHER_V2_KEY, 'u1')).toBe(false);
  });
});

/* ── GET /config ────────────────────────────────────────────────────────── */

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

describe('GET /config — features.teacherV2', () => {
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

  test('a pilot list: true for the teacher it names, false for everyone else', async () => {
    settings.portal_teacher_v2 = ['teacher-1'];
    expect((await getConfig()).payload.features.teacherV2).toBe(true);
    expect((await getConfig({ userId: 'teacher-2' })).payload.features.teacherV2).toBe(false);
  });

  test('logged out, it is false', async () => {
    settings.portal_teacher_v2 = true;
    expect((await getConfig({ userId: null })).payload.features.teacherV2).toBe(false);
  });

  test('absent, it is a real false', async () => {
    const { payload } = await getConfig();
    expect(payload.features).toHaveProperty('teacherV2', false);
  });

  test('it reads its OWN key: portal_new_ui and portal_coach_v2 on do not turn it on', async () => {
    settings.portal_new_ui = true;
    settings.portal_coach_v2 = true;
    const { payload } = await getConfig();
    expect(payload.features.teacherV2).toBe(false);
    expect(payload.features.coachV2).toBe(true);
  });

  test('the error fallback says teacherV2: false', async () => {
    settings.portal_teacher_v2 = true;
    const { statusCode, payload } = await getConfig({ sessionThrows: true });
    expect(statusCode).toBe(200);
    expect(payload.features).toMatchObject({ teacherV2: false, coachV2: false });
  });
});
