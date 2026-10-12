/**
 * The invite link for an account that is portal-activated but has no password saved.
 *
 * 3,350 production accounts were flagged portal_activated = true with portal_password_hash
 * NULL by the July 2026 migration. /validate-token and /setup refused them as "already
 * activated, please log in", and the login has nothing to check a password against — so the
 * set-up link, the one door meant for "you have no password yet", was shut to exactly the
 * teachers who needed it (bd-kkpg4t).
 *
 * "Already set up" means a password exists, not that the flag is on.
 */
let supabaseFrom;
let tableStates;
let bcryptCompare;
let logEvent;
let updates;

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
  chain.update = jest.fn((patch) => { updates.push({ table: tableName, patch }); return chain; });
  chain.eq = jest.fn((col, val) => { record.filters[col] = val; return chain; });
  chain.single = jest.fn(async () => { const row = rowsFor()[0]; return row ? { data: row, error: null } : { data: null, error: { message: 'not found' } }; });
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

async function post(path, body) {
  const routes = require('../../dashboard/routes/portal.routes');
  const stack = findRoute(routes, 'post', path);
  if (!stack) throw new Error(`POST ${path} not found on the portal router`);
  const session = { regenerate: (cb) => cb(null) };
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
  return { statusCode, payload };
}

const PHONE = '923000000000';

beforeEach(() => {
  jest.resetModules();
  tableStates = {};
  updates = [];
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
  jest.doMock('bcryptjs', () => ({ hash: jest.fn(async (p) => `hash:${p}`), compare: bcryptCompare, genSalt: jest.fn() }), { virtual: true });
  jest.doMock('express-rate-limit', () => jest.fn(() => (_req, _res, next) => next()), { virtual: true });
  jest.doMock('@aws-sdk/client-s3', () => ({ S3Client: jest.fn(), GetObjectCommand: jest.fn() }), { virtual: true });
  logEvent = jest.fn();
  jest.doMock('../../dashboard/services/telemetry.service', () => ({ logEvent, flush: jest.fn(), isEnabled: () => true }));
});

afterEach(() => jest.resetModules());

const TOKEN = '11111111-2222-4333-8444-555555555555';
const FUTURE = new Date(Date.now() + 86400000).toISOString();
const user = (over) => ({
  id: 'u-1', name: 'QA 6', phone_number: PHONE, role: 'teacher',
  portal_invite_token: TOKEN, portal_invite_expires_at: FUTURE, ...over,
});
const hashWrites = () => updates.filter((u) => u.table === 'users' && 'portal_password_hash' in u.patch);

describe('activated account with NO password — the invite link lets her set one', () => {
  beforeEach(() => { tableStates.users = { rows: [user({ portal_activated: true, portal_password_hash: null })] }; });

  it('POST /validate-token accepts the link', async () => {
    const { statusCode, payload } = await post('/validate-token', { token: TOKEN });
    expect(statusCode).toBe(200);
    expect(payload.success).toBe(true);
  });

  it('POST /setup saves the password and logs her in', async () => {
    const { statusCode, payload } = await post('/setup', { token: TOKEN, password: 'newpass12' });
    expect(statusCode).toBe(200);
    expect(payload.success).toBe(true);
    expect(hashWrites()).toHaveLength(1);
    expect(hashWrites()[0].patch).toMatchObject({
      portal_password_hash: 'hash:newpass12', portal_activated: true, portal_invite_token: null,
    });
  });
});

describe('account that already HAS a password — unchanged, link still refused', () => {
  beforeEach(() => { tableStates.users = { rows: [user({ portal_activated: true, portal_password_hash: 'hash:old12345' })] }; });

  it('POST /validate-token says log in instead', async () => {
    const { statusCode, payload } = await post('/validate-token', { token: TOKEN });
    expect(statusCode).toBe(400);
    expect(payload.redirectToLogin).toBe(true);
  });

  it('POST /setup refuses and does not overwrite the password', async () => {
    const { statusCode } = await post('/setup', { token: TOKEN, password: 'newpass12' });
    expect(statusCode).toBe(400);
    expect(hashWrites()).toHaveLength(0);
  });
});

describe('never-activated account — unchanged, setup works', () => {
  it('POST /setup saves the password', async () => {
    tableStates.users = { rows: [user({ portal_activated: false, portal_password_hash: null })] };
    const { statusCode } = await post('/setup', { token: TOKEN, password: 'newpass12' });
    expect(statusCode).toBe(200);
    expect(hashWrites()).toHaveLength(1);
  });
});
