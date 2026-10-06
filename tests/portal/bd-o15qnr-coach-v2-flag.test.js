/**
 * bd-o15qnr.1 — the coach app v2 ships behind one app_settings row,
 * `portal_coach_v2`, with the same shape and fail-closed rule as portal_new_ui:
 *
 *   true (or "true")            → every user
 *   ["<user id>", …]            → only those users (a pilot)
 *   no row, anything else, a failed read, or no session → OFF
 *
 * /api/portal/config carries it to the browser as `features.coachV2`, answered
 * for the SESSION user. v2's Take observation runs on the existing
 * /leader/observe pipeline, so a coach with v2 can use those routes even
 * without portal_coach_observation: the gate is coach_observation OR coach_v2.
 */

const {
  isFlagEnabledForUser, isCoachObservationOn, PORTAL_COACH_V2_KEY,
} = require('../../dashboard/lib/feature-flags');

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

describe('portal_coach_v2 — the flag', () => {
  beforeEach(() => { settings = {}; });

  test('the key is portal_coach_v2', () => {
    expect(PORTAL_COACH_V2_KEY).toBe('portal_coach_v2');
  });

  test.each([
    ['true (everyone)', true, 'u1', true],
    ['a pilot list that includes her', ['u1'], 'u1', true],
    ['a pilot list that leaves her out', ['u2'], 'u1', false],
    ['false', false, 'u1', false],
    ['an object', { users: ['u1'] }, 'u1', false],
  ])('%s', async (_label, value, userId, expected) => {
    settings.portal_coach_v2 = value;
    expect(await isFlagEnabledForUser(settingsByKey(), PORTAL_COACH_V2_KEY, userId)).toBe(expected);
  });

  test('no row is OFF', async () => {
    expect(await isFlagEnabledForUser(settingsByKey(), PORTAL_COACH_V2_KEY, 'u1')).toBe(false);
  });
});

describe('isCoachObservationOn — the /leader/observe gate', () => {
  beforeEach(() => { settings = {}; });

  test('coach observation alone opens it (unchanged)', async () => {
    settings.portal_coach_observation = ['c1'];
    expect(await isCoachObservationOn(settingsByKey(), 'c1')).toBe(true);
  });

  test('coach v2 alone opens it — v2 Take observation runs on this pipeline', async () => {
    settings.portal_coach_v2 = ['c1'];
    expect(await isCoachObservationOn(settingsByKey(), 'c1')).toBe(true);
  });

  test('neither flag: closed', async () => {
    settings.portal_new_ui = true;
    expect(await isCoachObservationOn(settingsByKey(), 'c1')).toBe(false);
  });

  test('a pilot that names someone else: closed', async () => {
    settings.portal_coach_v2 = ['c2'];
    settings.portal_coach_observation = ['c3'];
    expect(await isCoachObservationOn(settingsByKey(), 'c1')).toBe(false);
  });

  test('no session user: closed even when both are on for everyone', async () => {
    settings.portal_coach_v2 = true;
    settings.portal_coach_observation = true;
    expect(await isCoachObservationOn(settingsByKey(), null)).toBe(false);
  });

  test('the /leader/observe routes use it (source)', () => {
    const src = require('fs').readFileSync(require.resolve('../../dashboard/routes/portal.routes'), 'utf8');
    const gate = src.slice(src.indexOf('async function requireCoachObservation'), src.indexOf('const coachObserve ='));
    expect(gate).toContain('isCoachObservationOn(');
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

async function getConfig({ userId = 'coach-1', sessionThrows = false } = {}) {
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

describe('GET /config — features.coachV2', () => {
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

  test('a pilot list: true for the coach it names, false for everyone else', async () => {
    settings.portal_coach_v2 = ['coach-1'];
    expect((await getConfig()).payload.features.coachV2).toBe(true);
    expect((await getConfig({ userId: 'coach-2' })).payload.features.coachV2).toBe(false);
  });

  test('logged out, it is false', async () => {
    settings.portal_coach_v2 = true;
    expect((await getConfig({ userId: null })).payload.features.coachV2).toBe(false);
  });

  test('absent, it is a real false', async () => {
    const { payload } = await getConfig();
    expect(payload.features).toHaveProperty('coachV2', false);
  });

  test('it reads its OWN key: portal_new_ui on does not turn it on', async () => {
    settings.portal_new_ui = true;
    const { payload } = await getConfig();
    expect(payload.features.coachV2).toBe(false);
    expect(payload.features.newUi).toBe(true);
  });

  test('the error fallback says coachV2: false', async () => {
    settings.portal_coach_v2 = true;
    const { statusCode, payload } = await getConfig({ sessionThrows: true });
    expect(statusCode).toBe(200);
    expect(payload.features).toMatchObject({ coachV2: false, newUi: false });
  });
});
