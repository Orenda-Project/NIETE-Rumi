/**
 * bd-oe6r47 (queue #278) — upload-only recording on the coach portal: app_settings `portal_observe_upload_only` hides the
 * in-app web recorder on the observe recording step and the debrief recording step (coach app and principal app); the
 * coach records with the phone's own recorder and uploads the file. The operator, 25 Nov: "until we are completely
 * sure ... the recordings don't go away if you have bad internet ... we only give the upload recording button".
 *
 * bd-ih6cej (the operator 25 Nov ~17:20: "Actually on second thought, give both the options again. But advise whoever is
 * using to use their own recorders if their internet is not very good.") — OFF for all again: the in-app recorder is
 * back, with Upload recording and a weak-internet line beside it. The switch is now the usual fail-closed kind: no row,
 * a malformed value or a failed read = OFF; true = everyone upload-only; a list of users.id = upload-only for those.
 *
 * /api/portal/config carries it as `features.observeUploadOnly`; its error fallback says false.
 */
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

async function getConfig({ userId = 'hina', sessionThrows = false } = {}) {
  const routes = require('../../dashboard/routes/portal.routes');
  const stack = findRoute(routes, 'get', '/config');
  const req = { params: {}, body: {}, query: {}, method: 'GET', path: '/config', ip: '127.0.0.1', headers: {}, get: () => undefined };
  if (sessionThrows) Object.defineProperty(req, 'session', { get() { throw new Error('session store down'); } });
  else req.session = userId ? { portalUserId: userId, id: 's' } : {};
  let payload = null;
  let statusCode = 200;
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


const { PORTAL_OBSERVE_UPLOAD_ONLY_KEY, isObserveUploadOnlyFor } = require('../../dashboard/lib/feature-flags');

describe('portal_observe_upload_only — the key and its reader (fail-closed since bd-ih6cej)', () => {
  test('its own app_settings key', () => {
    expect(PORTAL_OBSERVE_UPLOAD_ONLY_KEY).toBe('portal_observe_upload_only');
  });

  const sb = (row, error = null) => ({ from: () => makeChainFor(row, error) });
  function makeChainFor(row, error) {
    const chain = { select: () => chain, eq: () => chain, order: () => chain, limit: () => chain,
      maybeSingle: async () => ({ data: row, error }) };
    chain.single = chain.maybeSingle;
    return chain;
  }

  test('no row, false, "off", an object or a number: OFF (the in-app recorder for everyone)', async () => {
    for (const row of [null, { value: false }, { value: 'off' }, { value: { a: 1 } }, { value: 7 }]) {
      // eslint-disable-next-line no-await-in-loop
      expect(await isObserveUploadOnlyFor(sb(row), 'u-' + Math.random())).toBe(false);
    }
  });

  test('true or "true": ON for everyone (upload-only)', async () => {
    for (const row of [{ value: true }, { value: 'true' }]) {
      // eslint-disable-next-line no-await-in-loop
      expect(await isObserveUploadOnlyFor(sb(row), 'u-' + Math.random())).toBe(true);
    }
  });

  test('a list: ON for the users it names, OFF for the rest', async () => {
    expect(await isObserveUploadOnlyFor(sb({ value: ['hina'] }), 'hina')).toBe(true);
    expect(await isObserveUploadOnlyFor(sb({ value: ['hina'] }), 'other')).toBe(false);
  });

  test('a failed read, or a client that throws: OFF', async () => {
    expect(await isObserveUploadOnlyFor(sb(null, { message: 'down' }), 'u-err')).toBe(false);
    expect(await isObserveUploadOnlyFor({ from: () => { throw new Error('boom'); } }, 'u-throw')).toBe(false);
  });
});

describe('GET /config — features.observeUploadOnly', () => {
  beforeEach(() => {
    jest.resetModules();
    settings = {};
    jest.doMock('../../dashboard/config/supabase', () => ({ from: (t) => makeChain(t), rpc: jest.fn() }));
    jest.doMock('../../dashboard/services/portal-coaching.client', () => ({}));
    jest.doMock('../../dashboard/services/r2.service', () => ({ generatePresignedUrl: jest.fn(), generatePresignedUrls: jest.fn(), isValidR2Url: jest.fn() }));
    jest.doMock('bcryptjs', () => ({ hash: jest.fn(), compare: jest.fn(), genSalt: jest.fn() }), { virtual: true });
    jest.doMock('express-rate-limit', () => jest.fn(() => (_q, _s, n) => n()), { virtual: true });
    jest.doMock('@aws-sdk/client-s3', () => ({ S3Client: jest.fn(), GetObjectCommand: jest.fn() }), { virtual: true });
  });
  afterEach(() => jest.resetModules());

  test('no row: false for a coach (the in-app recorder is back)', async () => {
    expect((await getConfig({ userId: 'hina' })).payload.features).toHaveProperty('observeUploadOnly', false);
  });

  test('true: true (upload-only for everyone)', async () => {
    settings.portal_observe_upload_only = true;
    expect((await getConfig({ userId: 'hina' })).payload.features.observeUploadOnly).toBe(true);
  });

  test('a list: true for the one it names, false for another', async () => {
    settings.portal_observe_upload_only = ['hina'];
    expect((await getConfig({ userId: 'hina' })).payload.features.observeUploadOnly).toBe(true);
    expect((await getConfig({ userId: 'other-coach' })).payload.features.observeUploadOnly).toBe(false);
  });

  test('the error fallback says observeUploadOnly: false', async () => {
    settings.portal_observe_upload_only = true;
    const { statusCode, payload } = await getConfig({ sessionThrows: true });
    expect(statusCode).toBe(200);
    expect(payload.features).toHaveProperty('observeUploadOnly', false);
  });
});
