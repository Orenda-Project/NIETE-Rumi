'use strict';
/**
 * bd-1d6g8o — ICT IAB row 19: POST /api/portal/funnel/dc-upload-failed. When Submit fails, the page says which step,
 * which file (kind, position, size, type) and why (HTTP status or the browser's reason). The server logs it as
 * dc_upload.failed with the teacher from the SESSION — never from the body — and keeps only known fields.
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
const post = (srv, body, { type = 'text/plain;charset=UTF-8', ua = '' } = {}) => new Promise((resolve, reject) => {
  const data = typeof body === 'string' ? body : JSON.stringify(body);
  const req = http.request({ host: '127.0.0.1', port: srv.address().port, path: '/api/portal/funnel/dc-upload-failed', method: 'POST',
    headers: { 'Content-Type': type, 'Content-Length': Buffer.byteLength(data), ...(ua ? { 'User-Agent': ua } : {}) } }, (res) => {
    let out = ''; res.on('data', (c) => { out += c; }); res.on('end', () => resolve({ status: res.statusCode, body: out }));
  });
  req.on('error', reject); req.write(data); req.end();
});
const good = { stage: 'upload', kind: 'photo', item: 5, items: 5, status: null, reason: 'network', sizeBytes: 4123456, type: 'image/jpeg', elapsedMs: 34000, b: 'native' };
const rows = () => emitted.filter((x) => x.e === 'dc_upload.failed');

test('logged with the teacher from the session and only the known fields', async () => {
  const res = await post(await app(), { ...good, userId: 'someone-else', name: 'Wajiha', file: 'IMG_2026.jpg' });
  expect(res.status).toBe(204);
  expect(rows()).toHaveLength(1);
  const d = rows()[0].d;
  expect(d).toEqual(expect.objectContaining({
    userId: USER, stage: 'upload', kind: 'photo', item: 5, items: 5, status: null, reason: 'network',
    sizeBytes: 4123456, type: 'image/jpeg', elapsedMs: 34000, browser: 'native',
  }));
  expect(JSON.stringify(d)).not.toMatch(/someone-else|Wajiha|IMG_2026/);
});

test('the browser is classed from the request: WhatsApp\'s in-app browser', async () => {
  await post(await app(), { ...good, b: undefined }, { ua: 'Mozilla/5.0 (Linux; Android 13) WA4A/2.24' });
  expect(rows()[0].d.browser).toBe('whatsapp-iab');
});

test('unknown values are dropped to safe ones; a bad body is 400; no session is 401', async () => {
  await post(await app(), { ...good, stage: 'hack', kind: 'x', reason: '<script>', type: 'image/jpeg; drop table', status: 99999, item: -3 });
  expect(rows()[0].d).toEqual(expect.objectContaining({ stage: 'unknown', kind: 'unknown', reason: 'unknown', type: 'unknown', status: null, item: 0 }));
  expect((await post(await app(), 'not json')).status).toBe(400);
  expect((await post(await app({ session: null }), good)).status).toBe(401);
  expect(rows()).toHaveLength(1);
});

// bd-bmc9a0.1 — ICT IAB rows 28-29: what closes the gap between "the connection dropped" and "the phone refused the
// file". How much of the part left the phone, whether the phone said it was online, what was sent (an in-memory copy
// of a picked file, a slice of one, or the page's own Blob), and a failed READ of a picked file before any upload.
test('the read stage, the unreadable reason, sentBytes, online and sentAs are kept; bad values are dropped', async () => {
  const srv = await app();
  await post(srv, { ...good, stage: 'read', kind: 'audio', reason: 'unreadable', sentBytes: 0, online: true, sentAs: 'copy' });
  expect(rows()[0].d).toEqual(expect.objectContaining({ stage: 'read', reason: 'unreadable', sentBytes: 0, online: true, sentAs: 'copy' }));
  await post(srv, { ...good, sentBytes: 1048576, online: false, sentAs: 'blob' });
  expect(rows()[1].d).toEqual(expect.objectContaining({ sentBytes: 1048576, online: false, sentAs: 'blob' }));
  await post(srv, { ...good, sentBytes: 'lots', online: 'yes', sentAs: '<script>' });
  expect(rows()[2].d).toEqual(expect.objectContaining({ sentBytes: 0, online: null, sentAs: 'unknown' }));
});
