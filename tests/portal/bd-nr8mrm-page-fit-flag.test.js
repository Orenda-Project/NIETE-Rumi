/**
 * bd-nr8mrm.4 — FEAT-209 (Ramisha Riaz): the portal shows the Pages box only when assessment_page_fit is on.
 * Served as /api/portal/config features.assessmentPageFit. Same switch the bot's build reads: one app-wide row,
 * fail-closed (no row, false, anything else or a failed read = off). (Harness copied from bd-ma9jiy's test.)
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



describe('GET /config — features.assessmentPageFit (assessment_page_fit)', () => {
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

  test('the key', () => {
    expect(require('../../dashboard/lib/feature-flags').ASSESSMENT_PAGE_FIT_KEY).toBe('assessment_page_fit');
  });

  test('no row: false (no Pages box)', async () => {
    expect((await getConfig()).payload.features).toHaveProperty('assessmentPageFit', false);
  });

  test.each([[true, true], ['true', true], [false, false], [['hina'], false], ['yes', false]])('%p -> %p', async (v, on) => {
    settings.assessment_page_fit = v;
    expect((await getConfig()).payload.features.assessmentPageFit).toBe(on);
  });

  test('a broken config read is off', async () => {
    settings.assessment_page_fit = true;
    expect((await getConfig({ sessionThrows: true })).payload.features.assessmentPageFit).toBe(false);
  });
});
