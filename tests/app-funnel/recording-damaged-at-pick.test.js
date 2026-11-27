'use strict';
/**
 * bd-8sr958 (queue #320) — the page found a picked recording damaged (an m4a with no moov) or empty. That is NOT a failed
 * upload: it is logged as recording.damaged_at_pick (kind, size, type, the recorder's signature, the teacher from the
 * SESSION) and never adds to dc_upload.failed.
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

async function app() {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => { req.session = { id: 'sess-1', portalUserId: USER }; next(); });
  a.use('/api/portal', require('../../dashboard/routes/app-funnel.routes').createAppFunnelRouter({}));
  const srv = await new Promise((r) => { const s = a.listen(0, () => r(s)); });
  servers.push(srv);
  return srv;
}
const post = (srv, body) => new Promise((resolve, reject) => {
  const data = JSON.stringify(body);
  const req = http.request({ host: '127.0.0.1', port: srv.address().port, path: '/api/portal/funnel/dc-upload-failed', method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=UTF-8', 'Content-Length': Buffer.byteLength(data) } }, (res) => {
    let out = ''; res.on('data', (c) => { out += c; }); res.on('end', () => resolve({ status: res.statusCode, body: out }));
  });
  req.on('error', reject); req.write(data); req.end();
});
const pick = { stage: 'pick', kind: 'audio', item: 1, items: 1, status: null, sizeBytes: 16000000, type: 'audio/mp4', elapsedMs: 0, b: 'native' };

test('a damaged pick is recording.damaged_at_pick, with the recorder signature, and is not a dc_upload.failed', async () => {
  const res = await post(await app(), { ...pick, reason: 'damaged', recorder: 'M4A mp42 free=3248', userId: 'someone-else', file: 'lesson.m4a' });
  expect(res.status).toBe(204);
  expect(emitted.filter((x) => x.e === 'dc_upload.failed')).toHaveLength(0);
  const rows = emitted.filter((x) => x.e === 'recording.damaged_at_pick');
  expect(rows).toHaveLength(1);
  expect(rows[0].d).toEqual(expect.objectContaining({ userId: USER, kind: 'damaged', sizeBytes: 16000000, type: 'audio/mp4', recorder: 'M4A mp42 free=3248' }));
  expect(JSON.stringify(rows[0].d)).not.toMatch(/someone-else|lesson\.m4a/);
});

test('an empty pick is logged the same way; a recorder that is not a plain signature is dropped', async () => {
  await post(await app(), { ...pick, sizeBytes: 0, reason: 'empty', recorder: '<script>alert(1)</script>' });
  const rows = emitted.filter((x) => x.e === 'recording.damaged_at_pick');
  expect(rows[0].d).toEqual(expect.objectContaining({ kind: 'empty', recorder: null }));
});

test('every other reason still logs dc_upload.failed, unchanged', async () => {
  await post(await app(), { ...pick, stage: 'upload', reason: 'network' });
  expect(emitted.filter((x) => x.e === 'dc_upload.failed')).toHaveLength(1);
  expect(emitted.filter((x) => x.e === 'recording.damaged_at_pick')).toHaveLength(0);
});
