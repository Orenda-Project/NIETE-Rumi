/**
 * Shared harness for the dashboard's /assessment/* proxy tests: loads the REAL portal router with only
 * its I/O edges stubbed (Supabase, the pg pool, R2, and axios — the bot is across the network), and
 * calls one route's handler stack the way Express would.
 */

const BOT = 'https://bot.test';

function findRoute(router, method, path) {
  for (const layer of router.stack) {
    if (layer.route && (layer.route.methods || {})[method] && layer.route.path === path) {
      return layer.route.stack.map((s) => s.handle);
    }
  }
  return null;
}

/**
 * Stub every edge and return handles to them. Call in beforeEach (after jest.resetModules()).
 * @param {{ appSettings?: Array<{key:string,value:any}>, dbRows?: Function|Array }} opts
 */
function setup({ appSettings = [], dbRows = [] } = {}) {
  process.env.MAIN_BOT_URL = BOT;
  process.env.INTERNAL_API_KEY = 'k';
  const state = { appSettings, dbRows };
  const chain = () => {
    const filters = {};
    const c = {};
    ['select', 'order', 'limit', 'insert', 'update', 'upsert'].forEach((m) => { c[m] = jest.fn(() => c); });
    ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'is', 'in'].forEach((m) => { c[m] = jest.fn((k, v) => { filters[k] = v; return c; }); });
    c.maybeSingle = jest.fn(async () => ({ data: state.appSettings.find((r) => r.key === filters.key) || null, error: null }));
    c.single = c.maybeSingle;
    c.then = (ok, ko) => Promise.resolve({ data: [], error: null }).then(ok, ko);
    return c;
  };
  const dbQuery = jest.fn(async (sql, params) => ({
    rows: typeof state.dbRows === 'function' ? state.dbRows(sql, params) : state.dbRows,
  }));
  jest.doMock('../../dashboard/config/supabase', () => ({ from: jest.fn(() => chain()), rpc: jest.fn().mockResolvedValue({ error: null }) }));
  jest.doMock('../../dashboard/config/database', () => ({ query: dbQuery, on: jest.fn() }));
  jest.doMock('../../dashboard/services/r2.service', () => ({
    generatePresignedUrl: jest.fn(), generatePresignedUrls: jest.fn().mockResolvedValue([]), isValidR2Url: jest.fn(),
  }));
  jest.doMock('dotenv', () => ({ config: () => ({ parsed: {} }) }), { virtual: true });
  jest.doMock('pg', () => ({ Pool: jest.fn(() => ({ query: jest.fn(), on: jest.fn() })) }), { virtual: true });
  jest.doMock('bcryptjs', () => ({ hash: jest.fn(), compare: jest.fn(), genSalt: jest.fn() }), { virtual: true });
  jest.doMock('express-rate-limit', () => jest.fn(() => (_q, _s, next) => next()), { virtual: true });
  jest.doMock('@aws-sdk/client-s3', () => ({ S3Client: jest.fn(), GetObjectCommand: jest.fn() }), { virtual: true });
  const axios = require('axios');
  axios.post.mockReset();
  return { axios, dbQuery, state };
}

async function invoke(method, path, { userId = 'teacher-1', body = {}, query = {}, params = {} } = {}) {
  const routes = require('../../dashboard/routes/portal.routes');
  const stack = findRoute(routes, method, path);
  if (!stack) throw new Error(`route ${method.toUpperCase()} ${path} not found`);
  const req = {
    session: { portalUserId: userId, id: 'sess-1' },
    params, body, query, method: method.toUpperCase(), path, ip: '127.0.0.1',
    headers: { host: 'portal.example.com' }, get: () => undefined, protocol: 'https',
  };
  let statusCode = 200; let payload = null;
  const res = { status(c) { statusCode = c; return this; }, json(b) { payload = b; return this; } };
  let advanced = true;
  for (const handler of stack) {
    if (!advanced) break;
    advanced = false;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => {
      const maybe = handler(req, res, () => { advanced = true; resolve(); });
      if (maybe && typeof maybe.then === 'function') maybe.then(() => resolve(), () => resolve());
      else if (!advanced) resolve();
    });
  }
  return { statusCode, payload };
}

module.exports = { BOT, setup, invoke };
