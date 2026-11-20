'use strict';
/**
 * bd-zrdvmi.21 — ICT Feedback sheet, GB row 3: the app's lesson-plan reader sometimes shows "Can't show it here".
 * The server answered every file request for that teacher with 200 in about a second, so the failure was in the
 * phone, and the page threw the reason away. POST /api/portal/funnel/lp-viewer-failed logs lp_viewer.failed: WHICH
 * step failed (download, loading the reader, reading the file, drawing page 1), the HTTP status or the browser's
 * reason, the file's size and page 1's shape, how long it ran, and whether the phone said it was online.
 * The teacher comes from the SESSION, never the body; only known values pass. No names, no ids of plans.
 */
const http = require('http');
const express = require('express');

const USER = '60530046-7ac3-4ea3-a976-b43c37c23213';
let emitted;
beforeEach(() => {
  jest.resetModules();
  emitted = [];
  jest.doMock('../../dashboard/services/telemetry.service', () => ({ logEvent: (e, d) => emitted.push({ e, d }), flush() {}, isEnabled: () => true }));
});
let servers = [];
afterEach(async () => { await Promise.all(servers.map((s) => new Promise((r) => s.close(r)))); servers = []; });

async function app({ session = { id: 'sess-1', portalUserId: USER } } = {}) {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => { if (session) req.session = { ...session }; next(); });
  a.use('/api/portal', require('../../dashboard/routes/app-funnel.routes').createAppFunnelRouter({}));
  const srv = await new Promise((r) => { const s = a.listen(0, () => r(s)); });
  servers.push(srv);
  return srv;
}
const post = (srv, body) => new Promise((resolve, reject) => {
  const data = typeof body === 'string' ? body : JSON.stringify(body);
  const req = http.request({ host: '127.0.0.1', port: srv.address().port, path: '/api/portal/funnel/lp-viewer-failed', method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=UTF-8', 'Content-Length': Buffer.byteLength(data) } }, (res) => {
    let out = ''; res.on('data', (c) => { out += c; }); res.on('end', () => resolve({ status: res.statusCode, body: out }));
  });
  req.on('error', reject); req.write(data); req.end();
});
const good = {
  stage: 'draw', lane: 'g612', reason: 'unknown', status: null, errName: 'UnknownErrorException', sizeBytes: 791007, pages: 2,
  pageWidth: 390, pageHeight: 4469, elapsedMs: 41000, online: true, b: 'native',
};
const rows = () => emitted.filter((x) => x.e === 'lp_viewer.failed');

test('logged with the teacher from the session and only the known fields', async () => {
  const res = await post(await app(), { ...good, userId: 'someone-else', title: 'Urdu lesson 7', renderId: 'abc' });
  expect(res.status).toBe(204);
  expect(rows()).toHaveLength(1);
  const d = rows()[0].d;
  expect(d).toEqual(expect.objectContaining({
    userId: USER, feature: 'lesson_plan', stage: 'draw', lane: 'g612', reason: 'unknown', status: null, errName: 'UnknownErrorException',
    sizeBytes: 791007, pages: 2, pageWidth: 390, pageHeight: 4469, elapsedMs: 41000, online: true, browser: 'native',
  }));
  expect(JSON.stringify(d)).not.toMatch(/someone-else|Urdu lesson|"abc"/);
});

test('unknown values fall to safe ones; a bad body is 400; no session is 401', async () => {
  await post(await app(), { ...good, stage: 'hack', lane: '<x>', reason: 'drop', errName: 'Evil<script>', status: 99999, pages: -1, online: 'yes' });
  expect(rows()[0].d).toEqual(expect.objectContaining({
    stage: 'unknown', lane: 'unknown', reason: 'unknown', errName: 'unknown', status: null, pages: 0, online: null,
  }));
  expect((await post(await app(), 'not json')).status).toBe(400);
  expect((await post(await app({ session: null }), good)).status).toBe(401);
  expect(rows()).toHaveLength(1);
});

test('every stage the reader can fail at, and a download timeout with its status', async () => {
  const srv = await app();
  for (const stage of ['download', 'reader', 'read', 'draw']) await post(srv, { ...good, stage });
  await post(srv, { ...good, stage: 'download', reason: 'timeout', status: 504, errName: null });
  expect(rows().map((r) => r.d.stage)).toEqual(['download', 'reader', 'read', 'draw', 'download']);
  expect(rows()[4].d).toEqual(expect.objectContaining({ reason: 'timeout', status: 504, errName: null }));
});
