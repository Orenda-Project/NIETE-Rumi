'use strict';
/**
 * bd-sex15q.49: a static portal chunk must never wait on a database connection.
 *
 * `app.use(setDatabaseContext)` (dashboard/index.js) runs before the portal's `express.static(portal-frontend/dist)`, and the
 * middleware checked a client out of the pool for EVERY request, assets included, holding it until the response finished.
 * On NIETE staging, 29 Oct 06:12Z, one phone on Slow 3G opening This week fetched ~30 lazy chunks in parallel: the portal
 * pool reached 18 connections against the session pooler's 15 and the chunks and /coachip/home answered 500
 * (EMAXCONNSESSION), so the coach saw "This could not be loaded" or a blank page.
 *
 * The real middleware and the real express.static run here; only the network boundary (the pool) is replaced, and it
 * refuses every connect the way the pooler did.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const express = require('../../dashboard/node_modules/express');

const POOLER_FULL = Object.assign(new Error('(EMAXCONNSESSION) max clients reached in session mode - max clients are limited to pool_size: 15'), { code: 'XX000' });

describe('bd-sex15q.49: the portal serves its static chunks without a database connection', () => {
  let setDatabaseContext;
  let connect;
  let server;
  let base;
  let dist;

  beforeAll(() => {
    dist = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-dist-'));
    fs.mkdirSync(path.join(dist, 'assets'));
    fs.writeFileSync(path.join(dist, 'assets', 'ThisWeek-abc123.js'), 'export default 1;');
  });
  afterAll(() => fs.rmSync(dist, { recursive: true, force: true }));

  beforeEach(async () => {
    jest.resetModules();
    connect = jest.fn(async () => { throw POOLER_FULL; });
    jest.doMock('../../dashboard/config/database', () => ({ connect }));
    ({ setDatabaseContext } = require('../../dashboard/middleware/rbac/database-context'));
    const app = express();
    app.use((req, res, next) => { req.session = { userId: 'u-1' }; next(); }); // a signed-in coach
    app.use(setDatabaseContext); // the order dashboard/index.js has
    app.get('/api/portal/me', (req, res) => res.json({ ok: true }));
    app.use(express.static(dist));
    app.use((err, req, res, next) => res.status(500).json({ error: String(err.message) })); // eslint-disable-line no-unused-vars
    server = http.createServer(app);
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  afterEach(async () => {
    await new Promise((r) => server.close(r));
    jest.dontMock('../../dashboard/config/database');
  });

  const get = (p, method = 'GET') => new Promise((resolve, reject) => {
    const req = http.request(base + p, { method }, (res) => { let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => resolve({ status: res.statusCode, body: b })); });
    req.on('error', reject); req.end();
  });

  test('GET /assets/<chunk>.js answers 200 while the pooler is full, and asks the pool for nothing', async () => {
    const r = await get('/assets/ThisWeek-abc123.js');
    expect(r.status).toBe(200);
    expect(r.body).toBe('export default 1;');
    expect(connect).not.toHaveBeenCalled();
  });

  test('HEAD /assets/<chunk>.js asks the pool for nothing either', async () => {
    const r = await get('/assets/ThisWeek-abc123.js', 'HEAD');
    expect(r.status).toBe(200);
    expect(connect).not.toHaveBeenCalled();
  });

  test('an API route still takes its RLS client (unchanged): the full pooler is still a 500 there', async () => {
    const r = await get('/api/portal/me');
    expect(connect).toHaveBeenCalledTimes(1);
    expect(r.status).toBe(500);
  });

  test('only GET/HEAD under /assets/ skip: a POST to /assets/ and a lookalike path still take a client', async () => {
    await get('/assets/ThisWeek-abc123.js', 'POST');
    await get('/assetsX/ThisWeek-abc123.js');
    expect(connect).toHaveBeenCalledTimes(2);
  });
});
