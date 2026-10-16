/**
 * bd-x7aprz.3 — the portal signs a teacher in with a code sent to her WhatsApp, and no step asks
 * whether her portal was "activated".
 *
 * Production, 2026-10-16: 170 teachers finished the registration form, never used the 7-day setup
 * link, and were then told "No account found" by BOTH the login and Forgot password, because both
 * looked only at portal_activated. 3,075 more were activated with no password. The number she
 * messages the bot from is the identity: any registered adult can get a code on WhatsApp and is in.
 *
 *   POST /request-code   registered adult -> code stored + sent through the bot, 200
 *                        unknown / not registered / deleted -> 404 REGISTER_ON_WHATSAPP, nothing sent
 *   POST /verify-code    right code -> a new session; the code is spent; 5 wrong codes void it
 *   POST /login          a password hash is enough (no activation gate)
 *   /request-reset, /verify-reset-code   the same eligibility (set a password without "activation")
 *
 * Real router handlers; Supabase is an in-memory users table; the bot's send endpoint is axios.
 */
let tableStates;
let axios;
let logEvent;

function makeChain(tableName) {
  const state = tableStates[tableName] || (tableStates[tableName] = { rows: [] });
  const filters = [];
  let patch = null;
  const rowsFor = () => state.rows.filter((r) => filters.every((f) => f(r)));
  const chain = {};
  chain.select = jest.fn(() => chain);
  chain.update = jest.fn((p) => { patch = p; return chain; });
  chain.eq = jest.fn((col, val) => { filters.push((r) => r[col] === val); return chain; });
  chain.is = jest.fn((col, val) => { filters.push((r) => (r[col] === undefined ? null : r[col]) === val); return chain; });
  const settle = () => {
    const rows = rowsFor();
    if (patch) { rows.forEach((r) => Object.assign(r, patch)); return { data: rows, error: null }; }
    return { data: rows, error: null };
  };
  chain.maybeSingle = jest.fn(async () => { const { data } = settle(); return { data: data[0] || null, error: null }; });
  chain.single = jest.fn(async () => {
    const { data } = settle();
    return data[0] ? { data: data[0], error: null } : { data: null, error: { code: 'PGRST116', message: 'no rows' } };
  });
  chain.then = (resolve, reject) => Promise.resolve(settle()).then(resolve, reject);
  return chain;
}

function findRoute(router, method, path) {
  for (const layer of router.stack) {
    if (layer.route && layer.route.path === path && layer.route.methods[method]) {
      return layer.route.stack.map((s) => s.handle);
    }
  }
  return null;
}

async function call(path, body, session = {}) {
  const routes = require('../../dashboard/routes/portal.routes');
  const stack = findRoute(routes, 'post', path);
  if (!stack) throw new Error(`POST ${path} not found on the portal router`);
  session.regenerate = session.regenerate || ((cb) => cb(null));
  const req = { body, session, params: {}, query: {}, method: 'POST', path, ip: '127.0.0.1', headers: {}, get: () => undefined };
  let statusCode = 200;
  let payload = null;
  const res = {
    status(code) { statusCode = code; return this; },
    json(b) { payload = b; return this; },
  };
  for (const handler of stack) {
    let advanced = false;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => {
      const maybe = handler(req, res, () => { advanced = true; resolve(); });
      if (maybe && typeof maybe.then === 'function') maybe.then(resolve, resolve);
      else if (!advanced) resolve();
    });
    if (!advanced) break;
  }
  return { statusCode, payload, session };
}

// Digits built from parts: the public repo holds no phone-shaped literal (tests/setup/phone-shaped-fixtures).
const PHONE = ['92', '300', '0000001'].join('');
const TYPED = '0300 0000001';
const ENV = { ...process.env };

beforeEach(() => {
  jest.resetModules();
  process.env = { ...ENV, MAIN_BOT_URL: 'https://bot.example', INTERNAL_API_KEY: 'k' };
  tableStates = { users: { rows: [] } };
  jest.doMock('../../dashboard/config/supabase', () => ({
    from: jest.fn((tbl) => makeChain(tbl)),
    rpc: jest.fn().mockResolvedValue({ error: null }),
  }));
  const { installTrainingDelegation } = require('../fixtures/delegate-training-to-bot');
  installTrainingDelegation(() => require('../../dashboard/config/supabase').from);
  jest.doMock('../../dashboard/services/r2.service', () => ({
    generatePresignedUrl: jest.fn().mockResolvedValue(null),
    generatePresignedUrls: jest.fn().mockResolvedValue([]),
    isValidR2Url: jest.fn().mockReturnValue(true),
  }));
  jest.doMock('bcryptjs', () => ({
    hash: jest.fn(async (p) => `hash:${p}`),
    compare: jest.fn(async (plain, hash) => {
      if (typeof hash !== 'string') throw new Error('Illegal arguments');
      return hash === `hash:${plain}`;
    }),
    genSalt: jest.fn(),
  }), { virtual: true });
  jest.doMock('express-rate-limit', () => jest.fn(() => (_req, _res, next) => next()), { virtual: true });
  jest.doMock('@aws-sdk/client-s3', () => ({ S3Client: jest.fn(), GetObjectCommand: jest.fn() }), { virtual: true });
  logEvent = jest.fn();
  jest.doMock('../../dashboard/services/telemetry.service', () => ({ logEvent, flush: jest.fn(), isEnabled: () => true }));
  axios = require('axios');
  axios.post.mockReset();
  axios.post.mockResolvedValue({ data: { success: true }, status: 200 });
});

afterEach(() => { jest.resetModules(); });
afterAll(() => { process.env = ENV; });

const row = (over) => ({
  id: 'u-1', name: 'Ayesha Khan', phone_number: PHONE, role: 'teacher', preferred_language: 'ur',
  registration_completed: false, registration_state: 'unregistered', portal_activated: false,
  portal_password_hash: null, password_reset_code: null, password_reset_expires_at: null, deleted_at: null,
  ...over,
});
const theRow = () => tableStates.users.rows[0];
const sentCode = () => axios.post.mock.calls.find(([url]) => /send-password-reset/.test(url));

describe('POST /request-code — who gets a code on WhatsApp', () => {
  it('a registered adult who was never "activated" gets a code: stored, sent through the bot, 200', async () => {
    tableStates.users.rows = [row()];
    const { statusCode, payload } = await call('/request-code', { phoneNumber: TYPED });
    expect(statusCode).toBe(200);
    expect(payload.success).toBe(true);
    expect(theRow().password_reset_code).toMatch(/^\d{6}$/);
    const sent = sentCode();
    expect(sent).toBeDefined();
    expect(sent[1]).toEqual(expect.objectContaining({ phoneNumber: PHONE, code: theRow().password_reset_code, language: 'ur' }));
  });

  it('registered by the form (flag true, no name yet on the payload) also gets one', async () => {
    tableStates.users.rows = [row({ name: null, registration_completed: true })];
    const { statusCode } = await call('/request-code', { phoneNumber: TYPED });
    expect(statusCode).toBe(200);
  });

  it.each([
    ['an unknown number', []],
    ['a number that messaged but never registered', [row({ name: null })]],
    ['a deleted account', [row({ deleted_at: '2026-09-01T00:00:00Z' })]],
  ])('%s: 404 REGISTER_ON_WHATSAPP and nothing is sent', async (_label, rows) => {
    tableStates.users.rows = rows;
    const { statusCode, payload } = await call('/request-code', { phoneNumber: TYPED });
    expect(statusCode).toBe(404);
    expect(payload.code).toBe('REGISTER_ON_WHATSAPP');
    expect(sentCode()).toBeUndefined();
  });

  it('an account name never gets a code (it has no WhatsApp): 400', async () => {
    const { statusCode } = await call('/request-code', { phoneNumber: 'fde-analytics' });
    expect(statusCode).toBe(400);
    expect(sentCode()).toBeUndefined();
  });

  it('a second ask inside a minute is refused as CODE_ALREADY_SENT (the first code still works)', async () => {
    tableStates.users.rows = [row()];
    await call('/request-code', { phoneNumber: TYPED });
    const first = theRow().password_reset_code;
    const { statusCode, payload } = await call('/request-code', { phoneNumber: TYPED });
    expect(statusCode).toBe(429);
    expect(payload.code).toBe('CODE_ALREADY_SENT');
    expect(theRow().password_reset_code).toBe(first);
  });
});

describe('POST /verify-code — the code is the sign-in', () => {
  const withCode = (over) => row({ password_reset_code: '123456', password_reset_expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(), ...over });

  it('the right code opens a NEW session for her and is spent', async () => {
    tableStates.users.rows = [withCode()];
    let regenerated = false;
    const session = { regenerate: (cb) => { regenerated = true; cb(null); } };
    const { statusCode, payload } = await call('/verify-code', { phoneNumber: TYPED, code: '123456' }, session);
    expect(statusCode).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.user).toEqual(expect.objectContaining({ firstName: 'Ayesha Khan', role: 'teacher' }));
    expect(regenerated).toBe(true);
    expect(session.portalUserId).toBe('u-1');
    expect(session.isPortalAuth).toBe(true);
    expect(theRow().password_reset_code).toBeNull();
    // spent: the same code a second time is refused
    const again = await call('/verify-code', { phoneNumber: TYPED, code: '123456' }, {});
    expect(again.statusCode).toBe(400);
  });

  it('a wrong code is a 400 and opens nothing', async () => {
    tableStates.users.rows = [withCode()];
    const { statusCode, session } = await call('/verify-code', { phoneNumber: TYPED, code: '654321' }, {});
    expect(statusCode).toBe(400);
    expect(session.portalUserId).toBeUndefined();
  });

  it('an expired code is a 400', async () => {
    tableStates.users.rows = [withCode({ password_reset_expires_at: new Date(Date.now() - 1000).toISOString() })];
    const { statusCode } = await call('/verify-code', { phoneNumber: TYPED, code: '123456' }, {});
    expect(statusCode).toBe(400);
  });

  it('five wrong codes void it: the right code on the sixth try no longer works', async () => {
    tableStates.users.rows = [withCode()];
    for (let i = 0; i < 5; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await call('/verify-code', { phoneNumber: TYPED, code: String(100000 + i) }, {});
    }
    const { statusCode, session } = await call('/verify-code', { phoneNumber: TYPED, code: '123456' }, {});
    expect(statusCode).toBe(400);
    expect(session.portalUserId).toBeUndefined();
    expect(theRow().password_reset_code).toBeNull();
  });

  it('a code for an account that is no longer registered opens nothing', async () => {
    tableStates.users.rows = [withCode({ deleted_at: '2026-10-01T00:00:00Z' })];
    const { statusCode } = await call('/verify-code', { phoneNumber: TYPED, code: '123456' }, {});
    expect(statusCode).toBe(400);
  });
});

describe('POST /login — a password is optional, and activation is not a gate', () => {
  it('a password hash on a never-"activated" account signs in', async () => {
    tableStates.users.rows = [row({ portal_password_hash: 'hash:secret12', portal_activated: false })];
    const { statusCode, payload } = await call('/login', { phoneNumber: TYPED, password: 'secret12' });
    expect(statusCode).toBe(200);
    expect(payload.success).toBe(true);
  });

  it('registered with no password: 403 PASSWORD_NOT_SET (the page offers the code)', async () => {
    tableStates.users.rows = [row({ portal_activated: false })];
    const { statusCode, payload } = await call('/login', { phoneNumber: TYPED, password: 'whatever1' });
    expect(statusCode).toBe(403);
    expect(payload.code).toBe('PASSWORD_NOT_SET');
  });

  it.each([
    ['unknown', []],
    ['not registered, no password', [row({ name: null })]],
  ])('%s: 404 REGISTER_ON_WHATSAPP', async (_l, rows) => {
    tableStates.users.rows = rows;
    const { statusCode, payload } = await call('/login', { phoneNumber: TYPED, password: 'whatever1' });
    expect(statusCode).toBe(404);
    expect(payload.code).toBe('REGISTER_ON_WHATSAPP');
  });
});

describe('Forgot password serves the same people (no activation gate)', () => {
  it('/request-reset: a registered adult who was never activated gets a code', async () => {
    tableStates.users.rows = [row()];
    const { statusCode } = await call('/request-reset', { phoneNumber: TYPED });
    expect(statusCode).toBe(200);
    expect(sentCode()).toBeDefined();
  });

  it('/verify-reset-code: her right code is accepted although portal_activated is false', async () => {
    tableStates.users.rows = [row({ password_reset_code: '123456', password_reset_expires_at: new Date(Date.now() + 60000).toISOString() })];
    const { statusCode, session } = await call('/verify-reset-code', { phoneNumber: TYPED, code: '123456' }, {});
    expect(statusCode).toBe(200);
    expect(session.resetUserId).toBe('u-1');
  });

  it('/request-reset for an unknown number: 404 REGISTER_ON_WHATSAPP', async () => {
    const { statusCode, payload } = await call('/request-reset', { phoneNumber: TYPED });
    expect(statusCode).toBe(404);
    expect(payload.code).toBe('REGISTER_ON_WHATSAPP');
  });
});
