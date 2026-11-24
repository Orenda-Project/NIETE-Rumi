'use strict';
/**
 * bd-chz35n.25 (3) — time spent on the coaching report page (/cr), behind report_delivery_fixes.time_on_page (OFF).
 *
 * Off: the page is byte for byte today's (no script) and POST /cr/:token/time answers 404 and logs nothing.
 * On: the page carries a small script that sends the seconds it was in view when she leaves or hides it
 * (sendBeacon), and POST /cr/:token/time logs coaching.report_page.time { sessionId, userId, screen, ms }.
 * Real Express over HTTP; loader and switch injected.
 */
const http = require('http');
const express = require('express');

const ENV = { ...process.env };
const S = '0b6f3c7e-2a41-4d8e-9a55-3f1c2d4e5f60';
const U = '60530046-7ac3-4ea3-a976-b43c37c23213';
let emitted;

const VIEW = {
  language: 'en',
  session: {
    id: S, created_at: '2026-10-19T05:30:00Z',
    analysis_data: { subject: 'Maths', topic: 'Adding tens' },
    prioritized_action: { thing_to_try: { text: 'In pairs, students solve Q1.' } },
  },
  firstName: 'Sadia', trend: [],
};

beforeEach(() => {
  jest.resetModules();
  emitted = [];
  jest.doMock('express-rate-limit', () => jest.fn(() => (_req, _res, next) => next()), { virtual: true });
  jest.doMock('../../dashboard/services/telemetry.service', () => ({ logEvent: (e, d) => emitted.push({ e, d }), flush() {}, isEnabled: () => true }));
  process.env = { ...ENV, INTERNAL_API_KEY: 'k1', SUPABASE_URL: 'https://abc.supabase.co' };
});
afterAll(() => { process.env = ENV; });

let servers = [];
afterEach(async () => { await Promise.all(servers.map((s) => new Promise((r) => s.close(r)))); servers = []; });

async function app(sw) {
  const a = express();
  a.use(require('../../dashboard/routes/coaching-report.routes').createCoachingReportRouter({
    load: async () => VIEW,
    groupOf: async () => null,
    ...(sw === undefined ? {} : { deliverySwitch: async () => sw }),
  }));
  a.use((_q, res) => res.status(418).send('fell through'));
  const srv = await new Promise((r) => { const s = a.listen(0, () => r(s)); });
  servers.push(srv);
  return srv;
}
const ask = (srv, method, path, body) => new Promise((resolve, reject) => {
  const req = http.request({ host: '127.0.0.1', port: srv.address().port, path, method,
    headers: body ? { 'content-type': 'application/x-www-form-urlencoded' } : {} }, (res) => {
    let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => resolve({ status: res.statusCode, body: b }));
  });
  req.on('error', reject);
  if (body) req.write(body);
  req.end();
});
const tok = () => require('../../bot/shared/services/coaching/report-link-token').signReportLink({ sessionId: S, userId: U });
const OFF = { linkTemplate: null, tipWording: false, timeOnPage: false };
const ON = { ...OFF, timeOnPage: true };

test('switch off: the page has no timing script, and is the same as with no switch row at all', async () => {
  const off = await ask(await app(OFF), 'GET', `/cr/${tok()}`);
  expect(off.status).toBe(200);
  expect(off.body).not.toContain('sendBeacon');
  const failing = await ask(await app(), 'GET', `/cr/${tok()}`); // the real reader, no db reachable → off
  expect(failing.body).toBe(off.body);
});

test('switch off: POST /time is 404 and logs nothing', async () => {
  const res = await ask(await app(OFF), 'POST', `/cr/${tok()}/time`, 'ms=5000&screen=card');
  expect(res.status).toBe(404);
  expect(emitted.filter((x) => x.e === 'coaching.report_page.time')).toEqual([]);
});

test.each([['card', ''], ['detail', '/detail']])('switch on: the %s page carries the timing script for its own screen', async (screen, suffix) => {
  const res = await ask(await app(ON), 'GET', `/cr/${tok()}${suffix}`);
  expect(res.status).toBe(200);
  expect(res.body).toContain('sendBeacon');
  expect(res.body).toContain(`/cr/${tok()}/time`);
  expect(res.body).toContain(`"${screen}"`);
  expect(res.body.indexOf('sendBeacon')).toBeLessThan(res.body.indexOf('</body>'));
});

test('switch on: POST /time logs the time on page for that report', async () => {
  const res = await ask(await app(ON), 'POST', `/cr/${tok()}/time`, 'ms=42500&screen=detail');
  expect(res.status).toBe(204);
  expect(emitted).toContainEqual({ e: 'coaching.report_page.time', d: { sessionId: S, userId: U, screen: 'detail', ms: 42500 } });
});

test.each([
  ['ms=-5&screen=card', 0], ['ms=99999999999&screen=card', 3 * 60 * 60 * 1000], ['ms=1200.7&screen=weird', 1201],
])('switch on: %s is clamped and the screen kept to card|detail', async (body, ms) => {
  await ask(await app(ON), 'POST', `/cr/${tok()}/time`, body);
  const ev = emitted.find((x) => x.e === 'coaching.report_page.time');
  expect(ev.d.ms).toBe(ms);
  expect(['card', 'detail']).toContain(ev.d.screen);
});

test('switch on: no number → 204, nothing logged; a bad token → 404', async () => {
  const srv = await app(ON);
  expect((await ask(srv, 'POST', `/cr/${tok()}/time`, 'ms=abc')).status).toBe(204);
  expect(emitted.filter((x) => x.e === 'coaching.report_page.time')).toEqual([]);
  expect((await ask(srv, 'POST', '/cr/not-a-token/time', 'ms=10')).status).toBe(404);
});
