'use strict';
/**
 * bd-snkn32.51 (queue #134 A) — "Make my own" is one page (/portal/teacher/lessons/own) whose question is in the query,
 * so page_view saw only "opened the form" and "left it". Each question screen now reports {k:'step'}: entered / left,
 * which step, the band, grade and subject code. Codes only; anything off the lists is dropped. Real Express.
 */
const http = require('http');
const express = require('express');

const ENV = { ...process.env };
const USER = '60530046-7ac3-4ea3-a976-b43c37c23213';
const NOW = Date.parse('2026-10-13T10:00:00Z');
let emitted;
beforeEach(() => {
  jest.resetModules();
  emitted = [];
  jest.doMock('../../dashboard/services/telemetry.service', () => ({ logEvent: (e, d) => emitted.push({ e, d }), flush() {}, isEnabled: () => true }));
  process.env = { ...ENV, INTERNAL_API_KEY: 'test-internal-key' };
  jest.useFakeTimers({ doNotFake: ['setImmediate', 'setTimeout', 'nextTick'] }).setSystemTime(new Date(NOW));
});
afterEach(() => jest.useRealTimers());
afterAll(() => { process.env = ENV; });

let servers = [];
afterEach(async () => { await Promise.all(servers.map((s) => new Promise((r) => s.close(r)))); servers = []; });

/** `session` = what the cookie would have restored (or null for no session at all). */
async function app({ session = { id: 'sess-1', portalUserId: USER }, limiter } = {}) {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => { if (session) req.session = { ...session }; next(); });
  a.use('/api/portal', require('../../dashboard/routes/app-funnel.routes').createAppFunnelRouter({ limiter }));
  const srv = await new Promise((r) => { const s = a.listen(0, () => r(s)); });
  servers.push(srv);
  return srv;
}
const post = (srv, body, { type = 'text/plain;charset=UTF-8', path = '/api/portal/funnel/events', headers = {} } = {}) => new Promise((resolve, reject) => {
  const data = typeof body === 'string' ? body : JSON.stringify(body);
  const req = http.request({ host: '127.0.0.1', port: srv.address().port, path, method: 'POST', headers: { 'Content-Type': type, 'Content-Length': Buffer.byteLength(data), ...headers } }, (res) => {
    let out = ''; res.on('data', (c) => { out += c; }); res.on('end', () => resolve({ status: res.statusCode, body: out }));
  });
  req.on('error', reject); req.write(data); req.end();
});
const rows = () => emitted.filter((x) => x.e.startsWith('app_funnel.'));
const batch = (ev, extra = {}) => ({ v: 1, b: 'android-iab', ev, ...extra });
const JID = 'j_0123456789abcdef';
const steps = () => emitted.filter((x) => x.e === 'own_form.step').map((x) => x.d);
const OWN = '/portal/teacher/lessons/own';

test('a step entered and left → two own_form.step rows with the session user, step, band, grade, subject', async () => {
  const res = await post(await app(), batch([
    { k: 'step', r: `${OWN}?grade=7&subject=science&step=size`, s: 'size', ph: 'enter', g: 7, sub: 'science', bd: 'g612' },
    { k: 'step', r: OWN, s: 'size', ph: 'leave', g: 7, sub: 'science', bd: 'g612', d: 4200, why: 'nav' },
  ]));
  expect(res.status).toBe(204);
  expect(steps()).toEqual([
    expect.objectContaining({ userId: USER, route: OWN, feature: 'lesson_plan', step: 'size', phase: 'enter', grade: 7, subject: 'science', band: 'g612' }),
    expect.objectContaining({ step: 'size', phase: 'leave', dwellMs: 4200, how: 'nav' }),
  ]);
  expect(steps()[0].dwellMs).toBeUndefined();
});

test('a step off the list, a bad phase, or another page: dropped', async () => {
  await post(await app(), batch([
    { k: 'step', r: OWN, s: 'drop table', ph: 'enter', g: 7, sub: 'science', bd: 'g612' },
    { k: 'step', r: OWN, s: 'size', ph: 'maybe', g: 7, sub: 'science', bd: 'g612' },
    { k: 'step', r: '/portal/teacher', s: 'size', ph: 'enter', g: 7, sub: 'science', bd: 'g612' },
  ]));
  expect(steps()).toEqual([]);
});

test('an odd grade, subject or band is logged as null, never as the text sent', async () => {
  await post(await app(), batch([{ k: 'step', r: OWN, s: 'pages', ph: 'enter', g: 99, sub: 'Ali Khan 0300', bd: 'x' }]));
  expect(steps()).toEqual([expect.objectContaining({ step: 'pages', grade: null, subject: null, band: null })]);
});

test('step rows do not become page views', async () => {
  await post(await app(), batch([{ k: 'step', r: OWN, s: 'check', ph: 'enter', g: 3, sub: 'urdu', bd: 'k5' }]));
  expect(emitted.filter((x) => x.e.startsWith('app_funnel.'))).toEqual([]);
});
