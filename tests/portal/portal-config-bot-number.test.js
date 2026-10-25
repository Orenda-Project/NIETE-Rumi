/**
 * GET /api/portal/config carries THIS deployment's bot number as `bot`.
 *
 * The portal is one build served by every tier. Its WhatsApp chat buttons used a number baked into the bundle, so
 * the sandbox and staging portals sent testers to the production bot. The server already knows its own tier's bot
 * (WHATSAPP_BOT_NUMBER, else REFERRAL_BOT_NUMBER — the same rule the sign-in routes use for their chat links), so
 * /config hands it to the browser at runtime: digits only, or null when neither is set (the portal then shows no
 * chat button). Read signed out too — the landing page has no session.
 *
 * The real router is mounted; only supabase (and the libraries the route file loads but this route never calls)
 * are mocked.
 */

// Made-up numbers, built from parts so the public repo holds no phone-shaped literal.
const BOT = ['92', '000', '0000001'].join('');
const REFERRAL = ['92', '000', '0000002'].join('');

function makeChain() {
  const chain = {
    select: () => chain, eq: () => chain, order: () => chain, limit: () => chain, in: () => chain,
    maybeSingle: async () => ({ data: null, error: null }),
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

async function getConfig({ userId = null } = {}) {
  const routes = require('../../dashboard/routes/portal.routes');
  const stack = findRoute(routes, 'get', '/config');
  const req = {
    session: userId ? { portalUserId: userId, id: 's' } : {},
    params: {}, body: {}, query: {}, method: 'GET', path: '/config', ip: '127.0.0.1', headers: {}, get: () => undefined,
  };
  let statusCode = 200;
  let payload = null;
  const res = { status(c) { statusCode = c; return this; }, json(b) { payload = b; return this; } };
  for (const h of stack) {
    let next = false;
    // eslint-disable-next-line no-await-in-loop
    await h(req, res, () => { next = true; });
    if (!next) break;
  }
  return { statusCode, payload };
}

const saved = {};
let supabaseFrom;

beforeEach(() => {
  jest.resetModules();
  for (const k of ['WHATSAPP_BOT_NUMBER', 'REFERRAL_BOT_NUMBER']) { saved[k] = process.env[k]; delete process.env[k]; }
  supabaseFrom = jest.fn(() => makeChain());
  jest.doMock('../../dashboard/config/supabase', () => ({ from: (t) => supabaseFrom(t), rpc: jest.fn() }));
  jest.doMock('../../dashboard/services/r2.service', () => ({
    generatePresignedUrl: jest.fn(), generatePresignedUrls: jest.fn(), isValidR2Url: jest.fn(),
  }));
  jest.doMock('bcryptjs', () => ({ hash: jest.fn(), compare: jest.fn(), genSalt: jest.fn() }), { virtual: true });
  jest.doMock('express-rate-limit', () => jest.fn(() => (_q, _s, n) => n()), { virtual: true });
  jest.doMock('@aws-sdk/client-s3', () => ({ S3Client: jest.fn(), GetObjectCommand: jest.fn() }), { virtual: true });
});

afterEach(() => {
  for (const k of Object.keys(saved)) {
    if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
  }
  jest.resetModules();
});

describe('GET /config → bot (this tier\'s WhatsApp number)', () => {
  test('WHATSAPP_BOT_NUMBER set → that number, digits only', async () => {
    process.env.WHATSAPP_BOT_NUMBER = `+${BOT.slice(0, 2)} ${BOT.slice(2, 5)} ${BOT.slice(5)}`;
    process.env.REFERRAL_BOT_NUMBER = REFERRAL;
    const { statusCode, payload } = await getConfig();
    expect(statusCode).toBe(200);
    expect(payload.bot).toBe(BOT);
  });

  test('only REFERRAL_BOT_NUMBER set → that number', async () => {
    process.env.REFERRAL_BOT_NUMBER = REFERRAL;
    const { payload } = await getConfig();
    expect(payload.bot).toBe(REFERRAL);
  });

  test('neither set → null (the portal shows no chat button)', async () => {
    const { payload } = await getConfig();
    expect(payload).toHaveProperty('bot', null);
  });

  test('a value too short to be a number → null', async () => {
    process.env.WHATSAPP_BOT_NUMBER = '12345';
    const { payload } = await getConfig();
    expect(payload).toHaveProperty('bot', null);
  });

  test('answered for a signed-in user too, and the feature flags are still there', async () => {
    process.env.WHATSAPP_BOT_NUMBER = BOT;
    const { payload } = await getConfig({ userId: 'teacher-1' });
    expect(payload.bot).toBe(BOT);
    expect(payload.success).toBe(true);
    expect(payload.features).toEqual(expect.objectContaining({ assessmentGenerator: expect.any(Boolean) }));
  });

  test('the flag reads failing (the fail-closed answer) still carries the bot number', async () => {
    process.env.WHATSAPP_BOT_NUMBER = BOT;
    supabaseFrom = jest.fn(() => { throw new Error('db down'); });
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const { payload } = await getConfig({ userId: 'teacher-1' });
    errSpy.mockRestore();
    expect(payload.bot).toBe(BOT);
    expect(payload.features.newUi).toBe(false);
  });
});
