'use strict';
/**
 * POST /api/portal/funnel/mic-check — the coach's microphone check, logged as sa_mic.check. A check that failed on an
 * iPhone left no trace (it runs only on the phone). The page says what the phone did; the server keeps only known
 * fields, takes the user from the SESSION, and classes the phone (ios / android) and its browser from the request.
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
  a.use((req, _res, next) => { if (session) req.session = { ...session }; next(); });
  a.use('/api/portal', require('../../dashboard/routes/app-funnel.routes').createAppFunnelRouter({}));
  const srv = await new Promise((r) => { const s = a.listen(0, () => r(s)); });
  servers.push(srv);
  return srv;
}
const post = (srv, body, { ua = '' } = {}) => new Promise((resolve, reject) => {
  const data = typeof body === 'string' ? body : JSON.stringify(body);
  const req = http.request({ host: '127.0.0.1', port: srv.address().port, path: '/api/portal/funnel/mic-check', method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=UTF-8', 'Content-Length': Buffer.byteLength(data), ...(ua ? { 'User-Agent': ua } : {}) } }, (res) => {
    let out = ''; res.on('data', (c) => { out += c; }); res.on('end', () => resolve({ status: res.statusCode, body: out }));
  });
  req.on('error', reject); req.write(data); req.end();
});
const CRIOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_6_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/155.0.8059.37 Mobile/15E148 Safari/604.1';
const probe = {
  phase: 'probe', iosMic: true, gum: 'ok', recorder: true, mimeType: 'audio/mp4', bytes: 31000, chunks: 1, peak: 0.0042,
  ctxStart: 'suspended', ctxEnd: 'running', play: 'blocked', playError: 'NotAllowedError',
  sampleRate: 48000, channelCount: 1, echoCancellation: true, autoGainControl: true, noiseSuppression: true,
};
const rows = () => emitted.filter((x) => x.e === 'sa_mic.check');

test('a probe is logged with the user from the session, the phone and browser from the request, and only known fields', async () => {
  const res = await post(await app(), { ...probe, userId: 'someone-else', deviceId: 'dev-123', name: 'Ali' }, { ua: CRIOS });
  expect(res.status).toBe(204);
  expect(rows()).toHaveLength(1);
  const d = rows()[0].d;
  expect(d).toEqual(expect.objectContaining({ ...probe, userId: USER, os: 'ios', osMajor: 26, engine: 'crios', browser: 'browser' }));
  expect(JSON.stringify(d)).not.toMatch(/someone-else|dev-123|Ali|Mozilla/);
});

test("the coach's answer is logged; WhatsApp's browser on an iPhone is named", async () => {
  await post(await app(), { phase: 'answer', iosMic: false, answer: 'again' }, { ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [WAiOS/2.25]' });
  expect(rows()[0].d).toEqual(expect.objectContaining({ phase: 'answer', answer: 'again', iosMic: false, os: 'ios', osMajor: 18, engine: 'whatsapp' }));
});

test('unknown values become safe ones; a bad body is 400; no session is 401', async () => {
  await post(await app(), { ...probe, phase: 'x', gum: '<script>alert(1)</script>', mimeType: 'audio/mp4; drop', play: 'boom', bytes: -5, peak: 9, sampleRate: 'loud' });
  expect(rows()[0].d).toEqual(expect.objectContaining({ phase: 'unknown', gum: 'unknown', mimeType: 'unknown', play: 'unknown', bytes: 0, peak: 1, sampleRate: null }));
  expect((await post(await app(), 'not json')).status).toBe(400);
  expect((await post(await app({ session: null }), probe)).status).toBe(401);
  expect(rows()).toHaveLength(1);
});
