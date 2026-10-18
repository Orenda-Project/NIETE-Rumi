'use strict';
/**
 * PR-E (m-links) — keyed ids.
 *   teacherKey: the leader's picker key — 16 hex, per environment, null without a key.
 *   userKey:    the key on a log line and a niete_fln_events row — byte-for-byte m-app's userKeyOf
 *               (hex(HMAC-SHA256(WEB_QUIZ_KID_KEY, 't|' + users.id))[0:16], null without a ≥32-byte key), so a
 *               `send` row's clip joins the recipient's own `open_link` row.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ENV = { ...process.env };
const ID = '11111111-1111-4111-8111-111111111111';
const KID_KEY = 'k'.repeat(32);
beforeEach(() => {
  jest.resetModules();
  process.env = { ...ENV, INTERNAL_API_KEY: 'k1', SUPABASE_URL: 'https://envone.supabase.co', WEB_QUIZ_KID_KEY: KID_KEY };
});
afterAll(() => { process.env = ENV; });
const K = () => require('../../bot/shared/services/fln-keys');
const formula = (id) => crypto.createHmac('sha256', KID_KEY).update(`t|${id}`).digest('hex').slice(0, 16);

test('teacherKey: 16 hex, stable, and never the same as userKey', () => {
  const t = K().teacherKey(ID);
  expect(t).toMatch(K().KEY_RX);
  expect(K().teacherKey(ID)).toBe(t);
  expect(K().userKey(ID)).toMatch(K().KEY_RX);
  expect(K().userKey(ID)).not.toBe(t);
  expect(t).not.toContain(ID.slice(0, 8));
});

test('teacherKey: another environment (Supabase host) gives another key', () => {
  const a = K().teacherKey(ID);
  process.env.SUPABASE_URL = 'https://envtwo.supabase.co';
  expect(K().teacherKey(ID)).not.toBe(a);
});

test('teacherKey: no INTERNAL_API_KEY, no SUPABASE_URL, or no id → null', () => {
  expect(K().teacherKey('')).toBeNull();
  expect(K().teacherKey(null)).toBeNull();
  delete process.env.INTERNAL_API_KEY;
  expect(K().teacherKey(ID)).toBeNull();
  process.env.INTERNAL_API_KEY = 'k1';
  process.env.SUPABASE_URL = 'not a url';
  expect(K().teacherKey(ID)).toBeNull();
});

test('userKey is the userKeyOf formula: HMAC-SHA256(WEB_QUIZ_KID_KEY, "t|" + id), first 16 hex', () => {
  expect(K().userKey(ID)).toBe(formula(ID));
  expect(K().userKey(` ${ID} `)).toBe(formula(ID));
  // it does not depend on INTERNAL_API_KEY or the Supabase host
  delete process.env.INTERNAL_API_KEY;
  delete process.env.SUPABASE_URL;
  expect(K().userKey(ID)).toBe(formula(ID));
});

test('userKey: no WEB_QUIZ_KID_KEY, one shorter than 32 bytes, or no id → null (never an unkeyed hash)', () => {
  expect(K().userKey('')).toBeNull();
  expect(K().userKey(null)).toBeNull();
  process.env.WEB_QUIZ_KID_KEY = 'k'.repeat(31);
  expect(K().userKey(ID)).toBeNull();
  delete process.env.WEB_QUIZ_KID_KEY;
  expect(K().userKey(ID)).toBeNull();
});

// Parity with m-app's own function. dashboard/routes/portal-fln.routes.js is m-app's file (PR-C); until it is on this
// branch the block below is SKIPPED (describe.skip) — the formula test above pins the same bytes meanwhile.
const MAPP_ROUTES = path.join(__dirname, '../../dashboard/routes/portal-fln.routes.js');
(fs.existsSync(MAPP_ROUTES) ? describe : describe.skip)('parity with m-app portal-fln.routes userKeyOf (skipped when that file is absent)', () => {
  test('userKeyOf(id) === fln-keys.userKey(id), and both null without the key', () => {
    const { userKeyOf } = require('../../dashboard/routes/portal-fln.routes');
    for (const id of [ID, '22222222-2222-4222-8222-222222222222', 42]) expect(K().userKey(id)).toBe(userKeyOf(id));
    delete process.env.WEB_QUIZ_KID_KEY;
    expect(K().userKey(ID)).toBe(userKeyOf(ID));
  });
});
