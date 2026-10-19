'use strict';
/**
 * bd-x7aprz.3 — the /go page a dead link lands on hands her a NEW link in one tap.
 *
 * It used to say "Go back to WhatsApp and send /menu", which in the bot opens the menu, not a link.
 * Now its button opens this deployment's bot with /portal already typed (wa.me/<number>?text=/portal),
 * and /portal answers with a fresh signed link. The number is the environment's own
 * (WHATSAPP_BOT_NUMBER, else REFERRAL_BOT_NUMBER): a sandbox page must never open the production bot,
 * so with neither set the page has no button and tells her to send /portal.
 *
 * Also: a link for an account that has been deleted signs nobody in.
 */
const http = require('http');
const express = require('express');

const ENV = { ...process.env };
// This deployment's bot number, built from parts (no phone-shaped literal in the public repo).
const BOT = ['92', '302', '0000255'].join('');
const USER = '60530046-7ac3-4ea3-a976-b43c37c23213';
let sessions;
beforeEach(() => {
  jest.resetModules();
  sessions = [];
  jest.doMock('../../dashboard/services/telemetry.service', () => ({ logEvent() {}, flush() {}, isEnabled: () => true }));
  process.env = { ...ENV, INTERNAL_API_KEY: 'test-internal-key', SUPABASE_URL: 'https://sandboxref.supabase.co', WHATSAPP_BOT_NUMBER: BOT };
  delete process.env.REFERRAL_BOT_NUMBER;
});
afterAll(() => { process.env = ENV; });

let servers = [];
afterEach(async () => { await Promise.all(servers.map((s) => new Promise((r) => s.close(r)))); servers = []; });

async function app({ users = { [USER]: { id: USER, name: 'Ayesha' } } } = {}) {
  const a = express();
  a.use((req, _res, next) => {
    const s = { regenerate(cb) { cb(); }, save(cb) { cb(); } };
    req.session = s; sessions.push(s); next();
  });
  a.use(require('../../dashboard/routes/app-login.routes').createAppLoginRouter({
    findUser: async (id) => users[id] || null,
    isTeacherV2: async () => true,
  }));
  const srv = await new Promise((r) => { const s = a.listen(0, () => r(s)); });
  servers.push(srv);
  return srv;
}
const get = (srv, path) => new Promise((resolve, reject) => {
  http.get({ host: '127.0.0.1', port: srv.address().port, path }, (res) => {
    let body = ''; res.on('data', (c) => { body += c; }); res.on('end', () => resolve({ status: res.statusCode, body }));
  }).on('error', reject);
});

test.each(['/go', '/go/not-a-real-token-but-long-enough-to-be-checked-aaaaaaaaaaaa'])(
  '%s: a "Get a new link" button to this bot with /portal typed, in English and Urdu', async (path) => {
    const srv = await app();
    const res = await get(srv, path);
    expect(res.status).toBe(200);
    expect(res.body).toContain(`href="https://wa.me/${BOT}?text=%2Fportal"`);
    expect(res.body).toContain('Get a new link');
    expect(res.body).toContain('نیا لنک لیں');
    expect(res.body).not.toMatch(/\/menu/);
  },
);

test('REFERRAL_BOT_NUMBER is the fallback (it exists on every service already)', async () => {
  delete process.env.WHATSAPP_BOT_NUMBER;
  process.env.REFERRAL_BOT_NUMBER = '+92 302 0000255';
  const srv = await app();
  const res = await get(srv, '/go');
  expect(res.body).toContain(`href="https://wa.me/${BOT}?text=%2Fportal"`);
});

test('no bot number configured: no wa.me button (never another environment\'s bot), the words say /portal', async () => {
  delete process.env.WHATSAPP_BOT_NUMBER;
  const srv = await app();
  const res = await get(srv, '/go');
  expect(res.body).not.toContain('wa.me');
  expect(res.body).toContain('/portal');
});

test('a link for a deleted account signs nobody in', async () => {
  const token = require('../../bot/shared/services/app-login-link').signAppLink(USER, 'menu');
  const srv = await app({ users: { [USER]: { id: USER, name: 'Ayesha', deleted_at: '2026-10-01T00:00:00Z' } } });
  const res = await get(srv, `/go/${token}`);
  expect(res.status).toBe(200);
  expect(res.body).toContain('Get a new link');
  expect(sessions[0].portalUserId).toBeUndefined();
});
