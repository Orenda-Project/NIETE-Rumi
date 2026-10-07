'use strict';
/**
 * The phone test page for WhatsApp's in-app browser.
 *
 * A web page inside WhatsApp's browser can only do what WhatsApp lets it: the
 * microphone turned out to work (a real phone, 2026-10-07), but whether the
 * camera, the gallery and the file picker open for a page is WhatsApp's own
 * choice, written down nowhere. This page asks, on a real phone, and every file
 * it gets is sent to the portal so we see it arrive on the server too.
 *
 *   GET  /iab/<token>            the test page, for a token signed for the probe
 *   POST /api/iab-probe/upload   one file; logged (size, type, fingerprint) and thrown away
 *   POST /api/iab-probe/result   the page's own finding for one check
 *
 * Only a token signed with the portal-link key for the probe opens the page or
 * accepts a file, so it is not an open upload endpoint; and the token, being
 * the credential, never reaches the request log.
 *
 * Real Express over HTTP; the telemetry sink is the stand-in.
 */
const http = require('http');
const express = require('express');

const SINK_PATH = '../../dashboard/services/telemetry.service';
let emitted;
const ENV = { ...process.env };
beforeEach(() => {
  jest.resetModules();
  emitted = [];
  jest.doMock(SINK_PATH, () => ({ logEvent: (event, data) => emitted.push({ event, data }), flush: () => {}, isEnabled: () => true }));
  process.env = { ...ENV, INTERNAL_API_KEY: 'test-internal-key' };
  delete process.env.WEB_TRAINING_TOKEN_SECRET;
});
afterAll(() => { process.env = ENV; });

const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const token = (area) => require('../../bot/shared/services/portal-link-token').signPortalLink(USER, area);

let servers = [];
afterEach(async () => {
  await Promise.all(servers.map((s) => new Promise((r) => s.close(r))));
  servers = [];
});

async function app(opts = {}) {
  const a = express();
  // index.js mounts the probe BEFORE its global body parsers (like the web quiz edge), so a
  // file is read as bytes by the probe itself; the parsers that follow must not matter.
  a.use(require('../../dashboard/routes/iab-probe.routes').createIabProbeRouter(opts));
  a.use(express.json());
  a.use((_req, res) => res.status(418).send('fell through'));
  const srv = await new Promise((r) => { const s = a.listen(0, () => r(s)); });
  servers.push(srv);
  return srv;
}

function send(srv, method, path, { body = null, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: srv.address().port, method, path,
      headers: { ...(body ? { 'content-length': Buffer.byteLength(body) } : {}), ...headers } }, (res) => {
      let out = '';
      res.on('data', (c) => { out += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: out }));
    });
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });
}

describe('GET /iab/<token>', () => {
  test('a probe token gets the test page, with every way of attaching a file', async () => {
    const srv = await app();
    const t = token('probe');

    const res = await send(srv, 'GET', `/iab/${t}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.headers['cache-control']).toMatch(/no-store/);
    expect(res.body).toMatch(/<input[^>]*type="file"[^>]*accept="image\/\*"[^>]*capture="environment"/);
    expect(res.body).toMatch(/<input[^>]*type="file"[^>]*accept="image\/\*"[^>]*multiple/);
    expect(res.body).toMatch(/<input[^>]*type="file"[^>]*accept="audio\/\*"/);
    expect(res.body).toContain('getUserMedia');
    expect(res.body).toContain(JSON.stringify(t));
    expect(emitted).toContainEqual({ event: 'iab_probe.open', data: expect.objectContaining({ userId: USER }) });
  });

  test.each([
    ['a training link', () => token('training')],
    ['a lesson-plans link', () => token('lessons')],
    ['a forged one', () => `${token('probe').split('.')[0]}.AAAAAAAAAAAAAAAAAAAAAA`],
    ['anything else', () => 'nope'],
  ])('%s gets the link-expired page', async (_l, make) => {
    const srv = await app();
    const res = await send(srv, 'GET', `/iab/${make()}`);
    expect(res.status).toBe(404);
    expect(res.body).toContain('This test link has expired');
    expect(res.body).not.toContain('type="file"');
  });

  test('a probe token is not a portal area: /t opens nothing with it', async () => {
    jest.doMock('../../dashboard/services/telemetry.service', () => ({ logEvent: () => {}, flush: () => {}, isEnabled: () => true }));
    const issued = [];
    const a = express();
    a.use((req, _res, next) => {
      const make = (d) => Object.assign({ regenerate(cb) { req.session = make({}); issued.push(req.session); cb(null); }, save(cb) { cb(null); } }, d);
      req.session = make({});
      next();
    });
    a.use(require('../../dashboard/routes/portal-link.routes').createPortalLinkRouter({ findUser: async (id) => ({ id, name: 'x' }) }));
    const srv = await new Promise((r) => { const s = a.listen(0, () => r(s)); });
    servers.push(srv);

    const res = await send(srv, 'GET', `/t/${token('probe')}`);

    expect(res.status).toBe(200);
    expect(issued).toHaveLength(0);
  });
});

describe('POST /api/iab-probe/upload', () => {
  const photo = Buffer.alloc(1234, 7);

  test('a file with a probe token is received, logged and not kept', async () => {
    const srv = await app();
    const res = await send(srv, 'POST', '/api/iab-probe/upload?kind=camera', {
      body: photo, headers: { 'x-probe-token': token('probe'), 'content-type': 'image/jpeg', 'x-requested-with': 'com.whatsapp' },
    });

    expect(res.status).toBe(200);
    const json = JSON.parse(res.body);
    expect(json).toMatchObject({ ok: true, bytes: 1234, type: 'image/jpeg' });
    expect(json.sha).toMatch(/^[0-9a-f]{16}$/);
    expect(emitted).toContainEqual({ event: 'iab_probe.upload', data: expect.objectContaining({
      userId: USER, kind: 'camera', bytes: 1234, type: 'image/jpeg', sha: json.sha, xrw: 'com.whatsapp',
    }) });
  });

  test.each([
    ['no token', {}],
    ['a training token', { 'x-probe-token': token('training') }],
  ])('%s: 401, nothing received', async (_l, headers) => {
    const srv = await app();
    const res = await send(srv, 'POST', '/api/iab-probe/upload?kind=file', { body: photo, headers: { 'content-type': 'image/jpeg', ...headers } });
    expect(res.status).toBe(401);
    expect(emitted.filter((e) => e.event === 'iab_probe.upload')).toEqual([]);
  });

  test('an unknown kind or an empty file: 400', async () => {
    const srv = await app();
    const h = { 'x-probe-token': token('probe'), 'content-type': 'image/jpeg' };
    expect((await send(srv, 'POST', '/api/iab-probe/upload?kind=video', { body: photo, headers: h })).status).toBe(400);
    expect((await send(srv, 'POST', '/api/iab-probe/upload?kind=file', { headers: h })).status).toBe(400);
  });

  test('a file over the cap: 413, as JSON', async () => {
    const srv = await app({ maxBytes: 1000 });
    const res = await send(srv, 'POST', '/api/iab-probe/upload?kind=file', {
      body: photo, headers: { 'x-probe-token': token('probe'), 'content-type': 'application/octet-stream' },
    });
    expect(res.status).toBe(413);
    expect(JSON.parse(res.body)).toMatchObject({ ok: false, error: 'too_large' });
  });

  test('a file typed as JSON is still received as the bytes it is', async () => {
    const srv = await app();
    const res = await send(srv, 'POST', '/api/iab-probe/upload?kind=file', {
      body: '{"a":1}', headers: { 'x-probe-token': token('probe'), 'content-type': 'application/json' },
    });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({ bytes: 7 });
  });
});

describe('POST /api/iab-probe/result', () => {
  test('the page\'s finding for a check is logged, trimmed', async () => {
    const srv = await app();
    const res = await send(srv, 'POST', '/api/iab-probe/result', {
      body: JSON.stringify({ check: 'mic', outcome: 'denied', detail: `NotAllowedError ${'x'.repeat(500)}` }),
      headers: { 'x-probe-token': token('probe'), 'content-type': 'application/json' },
    });
    expect(res.status).toBe(204);
    const row = emitted.find((e) => e.event === 'iab_probe.result');
    expect(row.data).toMatchObject({ userId: USER, check: 'mic', outcome: 'denied' });
    expect(row.data.detail.length).toBeLessThanOrEqual(200);
  });

  test('an unknown check or outcome, or no token, is refused', async () => {
    const srv = await app();
    const h = { 'x-probe-token': token('probe'), 'content-type': 'application/json' };
    expect((await send(srv, 'POST', '/api/iab-probe/result', { body: JSON.stringify({ check: 'nope', outcome: 'ok' }), headers: h })).status).toBe(400);
    expect((await send(srv, 'POST', '/api/iab-probe/result', { body: JSON.stringify({ check: 'mic', outcome: 'great' }), headers: h })).status).toBe(400);
    expect((await send(srv, 'POST', '/api/iab-probe/result', { body: JSON.stringify({ check: 'mic', outcome: 'ok' }), headers: { 'content-type': 'application/json' } })).status).toBe(401);
  });
});

test('the request log shows /iab/:token, never the token', async () => {
  const lines = [];
  jest.spyOn(console, 'log').mockImplementation((...a) => { lines.push(a.join(' ')); });
  const { latencyLogger } = require('../../dashboard/middleware/latency-logger');
  const t = token('probe');
  const finish = [];
  await new Promise((resolve) => latencyLogger(
    { path: `/iab/${t}`, originalUrl: `/iab/${t}`, method: 'GET', get: () => 'jest' },
    { statusCode: 200, on: (e, cb) => { if (e === 'finish') finish.push(cb); } },
    () => { finish.forEach((cb) => cb()); resolve(); },
  ));
  console.log.mockRestore();
  expect(emitted.find((e) => e.event === 'http.request.completed').data.path).toBe('/iab/:token');
  expect(lines.join('\n')).not.toContain(t);
});
