/**
 * POST /login for an account that is portal-activated but has no password saved.
 *
 * Production had 3,373 users with portal_activated = true and portal_password_hash NULL.
 * The login found them, then handed the NULL hash to bcrypt.compare, which throws
 * "Illegal arguments: string, object" — the catch turned that into a bare 500, so every
 * one of those teachers saw "Something went wrong" whatever password she typed, and the
 * only trace was a console line that never reached Axiom.
 *
 * She has no password to check, so the answer is a 4xx that tells her to set one through
 * Forgot password, and an event so the next account in this state is visible in logs.
 */
let supabaseFrom;
let tableStates;
let bcryptCompare;
let logEvent;

function makeChain(tableName) {
  const state = tableStates[tableName] || {};
  const record = { filters: {} };
  const chain = {};
  const rowsFor = () => {
    let rows = state.rows || [];
    for (const [col, val] of Object.entries(record.filters)) rows = rows.filter((r) => r[col] === val);
    return rows;
  };
  chain.select = jest.fn(() => chain);
  chain.update = jest.fn(() => chain);
  chain.eq = jest.fn((col, val) => { record.filters[col] = val; return chain; });
  chain.maybeSingle = jest.fn(async () => ({ data: rowsFor()[0] || null, error: null }));
  chain.then = (resolve, reject) => Promise.resolve({ data: null, error: null }).then(resolve, reject);
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

async function postLogin(body) {
  const routes = require('../../dashboard/routes/portal.routes');
  const stack = findRoute(routes, 'post', '/login');
  if (!stack) throw new Error('POST /login not found on the portal router');
  const session = { regenerate: (cb) => cb(null) };
  const req = { body, session, params: {}, query: {}, method: 'POST', path: '/login', ip: '127.0.0.1', headers: {}, get: () => undefined };
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
  return { statusCode, payload };
}

const PHONE = '923000000000';

beforeEach(() => {
  jest.resetModules();
  tableStates = {};
  supabaseFrom = jest.fn((tbl) => makeChain(tbl));
  jest.doMock('../../dashboard/config/supabase', () => ({
    from: supabaseFrom,
    rpc: jest.fn().mockResolvedValue({ error: null }),
  }));
  const { installTrainingDelegation } = require('../fixtures/delegate-training-to-bot');
  installTrainingDelegation(() => supabaseFrom);
  jest.doMock('../../dashboard/services/r2.service', () => ({
    generatePresignedUrl: jest.fn().mockResolvedValue(null),
    generatePresignedUrls: jest.fn().mockResolvedValue([]),
    isValidR2Url: jest.fn().mockReturnValue(true),
  }));
  // Same contract as bcryptjs: a non-string hash is "Illegal arguments", a rejection.
  bcryptCompare = jest.fn(async (plain, hash) => {
    if (typeof hash !== 'string') throw new Error(`Illegal arguments: ${typeof plain}, ${typeof hash}`);
    return hash === `hash:${plain}`;
  });
  jest.doMock('bcryptjs', () => ({ hash: jest.fn(), compare: bcryptCompare, genSalt: jest.fn() }), { virtual: true });
  jest.doMock('express-rate-limit', () => jest.fn(() => (_req, _res, next) => next()), { virtual: true });
  jest.doMock('@aws-sdk/client-s3', () => ({ S3Client: jest.fn(), GetObjectCommand: jest.fn() }), { virtual: true });
  logEvent = jest.fn();
  jest.doMock('../../dashboard/services/telemetry.service', () => ({ logEvent, flush: jest.fn(), isEnabled: () => true }));
});

afterEach(() => jest.resetModules());

const user = (over) => ({ id: 'u-1', name: 'QA 6', phone_number: PHONE, role: 'teacher', portal_activated: true, ...over });

describe('POST /login — activated account with no password saved', () => {
  it('answers 4xx with a set-your-password message, not 500', async () => {
    tableStates.users = { rows: [user({ portal_password_hash: null })] };
    const { statusCode, payload } = await postLogin({ phoneNumber: '03000000000', password: 'whatever1' });
    expect(statusCode).toBe(403);
    expect(payload.success).toBe(false);
    expect(payload.code).toBe('PASSWORD_NOT_SET');
    expect(payload.error).toMatch(/Forgot password/i);
  });

  it('never hands a NULL hash to bcrypt', async () => {
    tableStates.users = { rows: [user({ portal_password_hash: null })] };
    await postLogin({ phoneNumber: '03000000000', password: 'whatever1' });
    expect(bcryptCompare).not.toHaveBeenCalled();
  });

  it('emits portal.login.no_password so it shows up in Axiom', async () => {
    tableStates.users = { rows: [user({ portal_password_hash: null })] };
    await postLogin({ phoneNumber: '03000000000', password: 'whatever1' });
    expect(logEvent).toHaveBeenCalledWith('portal.login.no_password', expect.objectContaining({ userId: 'u-1' }));
  });
});

describe('POST /login — unchanged paths', () => {
  it('right password: 200', async () => {
    tableStates.users = { rows: [user({ portal_password_hash: 'hash:secret12' })] };
    const { statusCode, payload } = await postLogin({ phoneNumber: '03000000000', password: 'secret12' });
    expect(statusCode).toBe(200);
    expect(payload.success).toBe(true);
  });

  it('wrong password: 401', async () => {
    tableStates.users = { rows: [user({ portal_password_hash: 'hash:secret12' })] };
    const { statusCode } = await postLogin({ phoneNumber: '03000000000', password: 'nope1234' });
    expect(statusCode).toBe(401);
  });

  it('no account: 404', async () => {
    tableStates.users = { rows: [] };
    const { statusCode } = await postLogin({ phoneNumber: '03000000000', password: 'nope1234' });
    expect(statusCode).toBe(404);
  });

  it('an unexpected throw is still a 500 and is logged as portal.login.failed', async () => {
    tableStates.users = { rows: [user({ portal_password_hash: 'hash:secret12' })] };
    bcryptCompare.mockImplementationOnce(async () => { throw new Error('boom'); });
    const { statusCode } = await postLogin({ phoneNumber: '03000000000', password: 'secret12' });
    expect(statusCode).toBe(500);
    expect(logEvent).toHaveBeenCalledWith('portal.login.failed', expect.objectContaining({ err: 'boom' }));
  });
});
