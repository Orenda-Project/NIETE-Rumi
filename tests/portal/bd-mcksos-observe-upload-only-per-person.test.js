/**
 * bd-mcksos (queue #279) — a PER-PERSON override on top of the upload-only switch (bd-oe6r47 / bd-ih6cej). The operator,
 * 25 Nov: "the upload only functionality should be behind a person only flag as well".
 *
 *   portal_observe_upload_only      the global: true = upload-only for every coach and principal; a users.id list = those
 *                                   people; no row = nobody (the in-app recorder). Unchanged.
 *   portal_observe_upload_only_on   LIST-ONLY: these people are upload-only even with the global off.
 *   portal_observe_upload_only_off  LIST-ONLY: these people keep the in-app recorder even with the global on.
 *
 * Per-person beats global. A person on BOTH lists is upload-only (the protective answer). The per-person rows are read
 * like portal_role_switch: true, "true", "teachers", an object or bad JSON names nobody, so they can never flip everyone.
 * A per-person row that cannot be read names nobody, so a DB blip leaves everyone on the global. No rows at all is
 * today: the in-app recorder for everyone.
 */
let settings;
let failing;

function makeChain(table) {
  let key = null;
  const chain = {
    select: () => chain,
    eq: (_col, val) => { key = val; return chain; },
    order: () => chain,
    limit: () => chain,
    maybeSingle: async () => {
      if (table === 'app_settings') {
        if (failing.has(key)) return { data: null, error: { message: `read failed: ${key}` } };
        return { data: Object.prototype.hasOwnProperty.call(settings, key) ? { value: settings[key] } : null, error: null };
      }
      return { data: null, error: null };
    },
  };
  chain.single = chain.maybeSingle;
  return chain;
}

/** A fresh client per call, so the flag cache (keyed by client) never carries a row from one case into the next. */
const client = () => ({ from: (t) => makeChain(t) });

const GLOBAL = 'portal_observe_upload_only';
const ON = 'portal_observe_upload_only_on';
const OFF = 'portal_observe_upload_only_off';

describe('the per-person keys', () => {
  const flags = require('../../dashboard/lib/feature-flags');

  test('two app_settings keys beside the global one', () => {
    expect(flags.PORTAL_OBSERVE_UPLOAD_ONLY_KEY).toBe(GLOBAL);
    expect(flags.PORTAL_OBSERVE_UPLOAD_ONLY_ON_KEY).toBe(ON);
    expect(flags.PORTAL_OBSERVE_UPLOAD_ONLY_OFF_KEY).toBe(OFF);
  });
});

describe('isObserveUploadOnlyFor — per-person beats global', () => {
  const { isObserveUploadOnlyFor } = require('../../dashboard/lib/feature-flags');
  const ask = (userId) => isObserveUploadOnlyFor(client(), userId);

  beforeEach(() => { settings = {}; failing = new Set(); });

  test('no rows at all: the in-app recorder for everyone (today, unchanged)', async () => {
    expect(await ask('hina')).toBe(false);
    expect(await ask('operator')).toBe(false);
  });

  test('global true, nobody listed: upload-only for everyone (unchanged)', async () => {
    settings[GLOBAL] = true;
    expect(await ask('hina')).toBe(true);
    expect(await ask('operator')).toBe(true);
  });

  test('(a) global true + the off list names the operator: the operator keeps the in-app recorder, the rest are upload-only', async () => {
    settings[GLOBAL] = true;
    settings[OFF] = ['operator', 'rifat-coach'];
    expect(await ask('operator')).toBe(false);
    expect(await ask('rifat-coach')).toBe(false);
    expect(await ask('hina')).toBe(true);
  });

  test('(a) the off list beats the global pilot list too', async () => {
    settings[GLOBAL] = ['hina', 'operator'];
    settings[OFF] = ['operator'];
    expect(await ask('operator')).toBe(false);
    expect(await ask('hina')).toBe(true);
  });

  test('(b) global off (no row) + the on list names Hina: Hina is upload-only, the rest keep the in-app recorder', async () => {
    settings[ON] = ['hina'];
    expect(await ask('hina')).toBe(true);
    expect(await ask('other-coach')).toBe(false);
  });

  test('(b) global false + the on list: the on list still wins', async () => {
    settings[GLOBAL] = false;
    settings[ON] = ['hina'];
    expect(await ask('hina')).toBe(true);
    expect(await ask('other-coach')).toBe(false);
  });

  test('a person on both lists is upload-only (the protective answer)', async () => {
    settings[ON] = ['hina'];
    settings[OFF] = ['hina'];
    expect(await ask('hina')).toBe(true);
    settings[GLOBAL] = true;
    expect(await ask('hina')).toBe(true);
  });

  test('the per-person rows are list-only: true, "true", "teachers" or an object names nobody', async () => {
    for (const broadcast of [true, 'true', 'teachers', { hina: true }, 7]) {
      settings = { [ON]: broadcast };
      // eslint-disable-next-line no-await-in-loop
      expect(await ask('hina')).toBe(false);
      settings = { [GLOBAL]: true, [OFF]: broadcast };
      // eslint-disable-next-line no-await-in-loop
      expect(await ask('hina')).toBe(true);
    }
  });

  test('a per-person row that cannot be read names nobody: everyone stays on the global', async () => {
    failing = new Set([ON, OFF]);
    expect(await ask('hina')).toBe(false);
    settings[GLOBAL] = true;
    expect(await ask('hina')).toBe(true);
  });

  test('a global that cannot be read is off, and the on list still forces the people it names', async () => {
    failing = new Set([GLOBAL]);
    settings[ON] = ['hina'];
    expect(await ask('hina')).toBe(true);
    expect(await ask('other-coach')).toBe(false);
  });

  test('no signed-in user, or a client that throws: off, never a throw', async () => {
    settings = { [GLOBAL]: true, [ON]: ['hina'] };
    expect(await ask(null)).toBe(false);
    expect(await isObserveUploadOnlyFor({ from: () => { throw new Error('boom'); } }, 'hina')).toBe(false);
  });
});

/* ── GET /config carries the answer as features.observeUploadOnly (one boolean, as before) ── */

function findRoute(router, method, path) {
  for (const layer of router.stack) {
    if (layer.route && layer.route.path === path && layer.route.methods[method]) return layer.route.stack.map((s) => s.handle);
  }
  throw new Error(`no ${method} ${path}`);
}

async function getConfig(userId) {
  const routes = require('../../dashboard/routes/portal.routes');
  const stack = findRoute(routes, 'get', '/config');
  const req = { params: {}, body: {}, query: {}, method: 'GET', path: '/config', ip: '127.0.0.1', headers: {}, get: () => undefined,
    session: { portalUserId: userId, id: 's' } };
  let payload = null;
  const res = { status() { return this; }, json(b) { payload = b; return this; } };
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
  return payload.features.observeUploadOnly;
}

describe('GET /config — features.observeUploadOnly follows the per-person rows', () => {
  beforeEach(() => {
    jest.resetModules();
    settings = {};
    failing = new Set();
    jest.doMock('../../dashboard/config/supabase', () => ({ from: (t) => makeChain(t), rpc: jest.fn() }));
    jest.doMock('../../dashboard/services/portal-coaching.client', () => ({}));
    jest.doMock('../../dashboard/services/r2.service', () => ({ generatePresignedUrl: jest.fn(), generatePresignedUrls: jest.fn(), isValidR2Url: jest.fn() }));
    jest.doMock('bcryptjs', () => ({ hash: jest.fn(), compare: jest.fn(), genSalt: jest.fn() }), { virtual: true });
    jest.doMock('express-rate-limit', () => jest.fn(() => (_q, _s, n) => n()), { virtual: true });
    jest.doMock('@aws-sdk/client-s3', () => ({ S3Client: jest.fn(), GetObjectCommand: jest.fn() }), { virtual: true });
  });
  afterEach(() => jest.resetModules());

  test('global true + off list: false for the listed tester, true for a coach', async () => {
    settings[GLOBAL] = true;
    settings[OFF] = ['operator'];
    expect(await getConfig('operator')).toBe(false);
    expect(await getConfig('hina')).toBe(true);
  });

  test('no global + on list: true for the listed coach, false for another', async () => {
    settings[ON] = ['hina'];
    expect(await getConfig('hina')).toBe(true);
    expect(await getConfig('other-coach')).toBe(false);
  });
});
