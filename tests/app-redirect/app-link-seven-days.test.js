'use strict';
/**
 * bd-zrdvmi.28 — the one-tap app link lasts 7 days, not 24 hours (operator, 19 Nov: "Links last 7 days").
 * Prod, 14 days: 6% of taps in school hours hit an expired link, 10% on weekday evenings, 12-15% at weekends.
 * An expired link still lands on the page with the "Get a new link" button, never a dead end.
 * Real Express over HTTP; the session is a plain stand-in.
 */
const http = require('http');
const express = require('express');

const ENV = { ...process.env };
const USER = '60530046-7ac3-4ea3-a976-b43c37c23213';
const T0 = Date.parse('2026-11-19T18:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

beforeEach(() => {
  jest.resetModules();
  jest.doMock('../../dashboard/services/telemetry.service', () => ({ logEvent() {}, flush() {}, isEnabled: () => true }));
  process.env = {
    ...ENV, INTERNAL_API_KEY: 'test-internal-key', SUPABASE_URL: 'https://abcdefgh.supabase.co', WHATSAPP_BOT_NUMBER: '923001234567',
  };
  jest.useFakeTimers({ doNotFake: ['setImmediate', 'setTimeout', 'nextTick'] }).setSystemTime(new Date(T0));
});
afterEach(() => jest.useRealTimers());
afterAll(() => { process.env = ENV; });

let servers = [];
afterEach(async () => { await Promise.all(servers.map((s) => new Promise((r) => s.close(r)))); servers = []; });

async function app() {
  const a = express();
  a.use((req, _res, next) => { req.session = { regenerate(cb) { cb(); }, save(cb) { cb(); } }; next(); });
  a.use(require('../../dashboard/routes/app-login.routes').createAppLoginRouter({
    findUser: async (id) => (id === USER ? { id: USER, name: 'Ayesha' } : null),
    isTeacherV2: async () => true,
  }));
  const srv = await new Promise((r) => { const s = a.listen(0, () => r(s)); });
  servers.push(srv);
  return srv;
}
const get = (srv, path) => new Promise((resolve, reject) => {
  http.get({ host: '127.0.0.1', port: srv.address().port, path }, (res) => {
    let body = ''; res.on('data', (c) => { body += c; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
  }).on('error', reject);
});
const link = () => require('../../bot/shared/services/app-login-link');

test('a link is signed for 7 days', () => {
  expect(link().TTL_S).toBe(7 * 24 * 60 * 60);
  const p = link().verifyAppLink(link().signAppLink(USER, 'lesson_plan'));
  expect(p.exp).toBe(Math.floor(T0 / 1000) + 7 * 24 * 60 * 60);
});

test('6 days after it was sent (a weekend, an evening) the link still signs her in', async () => {
  const token = link().signAppLink(USER, 'lesson_plan');
  jest.setSystemTime(new Date(T0 + 6 * DAY));
  const res = await get(await app(), `/go/${token}`);
  expect(res.status).toBe(303);
  expect(res.headers.location).toBe('/portal/teacher/lessons');
});

test('after 7 days it lands on the new-link page, with the button that asks the bot for a fresh one', async () => {
  const token = link().signAppLink(USER, 'lesson_plan');
  jest.setSystemTime(new Date(T0 + 7 * DAY + 60 * 1000));
  const res = await get(await app(), `/go/${token}`);
  expect(res.status).toBe(200);
  expect(res.body).toContain('This link has expired');
  expect(res.body).toContain('https://wa.me/923001234567?text=%2Fportal');
  expect(res.body).toContain('Get a new link');
});

test('every line that tells her how long a link lasts says 7 days, in English and Urdu', async () => {
  const page = (await get(await app(), '/go')).body;
  expect(page).toContain('Links last 7 days.');
  expect(page).toContain('لنک ۷ دن تک چلتا ہے۔');
  expect(page).not.toMatch(/24 hours|۲۴ گھنٹے/);

  const fs = require('fs');
  const path = require('path');
  const portal = fs.readFileSync(path.join(__dirname, '../../bot/shared/handlers/portal-command.handler.js'), 'utf8');
  expect(portal).toContain("body: 'Open your NIETE portal. This link works for 7 days.'");
  expect(portal).toContain('یہ لنک ۷ دن چلتا ہے۔');
  expect(portal).not.toMatch(/24 hours|۲۴ گھنٹے/);

  const { lpOwnLinkBody } = require('../../bot/shared/config/ux-strings').UX_STRINGS || require('../../bot/shared/config/ux-strings');
  expect(lpOwnLinkBody.en).toContain('Link works for 7 days.');
  expect(lpOwnLinkBody.ur).toContain('لنک ۷ دن چلے گا۔');
});
