'use strict';
/**
 * PR-E (m-links) — POST /api/internal/fln/send: the portal asks the bot to send a plan to teachers it has already
 * scoped. Real Express over HTTP, the real internal-api router (so the mount line is exercised), the real
 * fln-send.service and token module; mocked at the boundary: supabase (users lookup + event insert),
 * WhatsAppService, the window check.
 */
const http = require('http');
const express = require('express');

const ENV = { ...process.env };
const KEY = 'test-internal-key';
const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';
const SENDER = '99999999-9999-4999-8999-999999999999';
const USERS = {
  [T1]: { id: T1, phone_number: '920000000001', preferred_language: 'ur', deleted_at: null },
  [T2]: { id: T2, phone_number: '920000000002', preferred_language: 'en', deleted_at: '2026-10-01T00:00:00Z' },
};
let WA; let inserted; let servers = [];
beforeEach(() => {
  jest.resetModules();
  process.env = { ...ENV, INTERNAL_API_KEY: KEY, SUPABASE_URL: 'https://envone.supabase.co', PORTAL_URL: 'https://portal.example.test' };
  inserted = [];
  WA = { sendCtaUrl: jest.fn(async () => true), sendTemplate: jest.fn(async () => true) };
  jest.doMock('../../bot/shared/services/whatsapp.service', () => WA);
  jest.doMock('../../bot/shared/services/quiz/quiz-delivery.service', () => ({ _hasOpenMessageWindow: jest.fn(async () => false) }));
  jest.doMock('../../bot/shared/config/supabase', () => ({
    from: (table) => ({
      insert: async (row) => { inserted.push({ table, row }); return { error: null }; },
      select: () => ({ in: async (_col, ids) => ({ data: ids.map((id) => USERS[id]).filter(Boolean), error: null }) }),
    }),
  }));
});
afterEach(async () => { await Promise.all(servers.map((s) => new Promise((r) => s.close(r)))); servers = []; });
afterAll(() => { process.env = ENV; });

async function bot() {
  const a = express();
  a.use(express.json());
  a.use('/api/internal', require('../../bot/shared/routes/internal-fln-send.routes'));
  const srv = await new Promise((r) => { const s = a.listen(0, () => r(s)); });
  servers.push(srv);
  return srv;
}
const post = (srv, path, body, key = KEY) => new Promise((resolve, reject) => {
  const data = JSON.stringify(body);
  const req = http.request({ host: '127.0.0.1', port: srv.address().port, path, method: 'POST',
    headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data), ...(key ? { 'x-api-key': key } : {}) } }, (res) => {
    let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => resolve({ status: res.statusCode, body: b ? JSON.parse(b) : null }));
  });
  req.on('error', reject); req.end(data);
});
const body = (teachers) => ({
  sender: { id: SENDER, role: 'principal' },
  plan: { id: 11156, title: 'Sounds of c/k', lang: 'en' },
  teachers,
});

test('sends to each live teacher; a deleted or unknown user is failed; one event row each', async () => {
  const srv = await bot();
  const res = await post(srv, '/api/internal/fln/send', body([
    { id: T1, key: 'aaaaaaaaaaaaaaaa' }, { id: T2, key: 'bbbbbbbbbbbbbbbb' },
    { id: '33333333-3333-4333-8333-333333333333', key: 'cccccccccccccccc' },
  ]));
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ success: true, queued: 1, failed: ['bbbbbbbbbbbbbbbb', 'cccccccccccccccc'] });
  expect(WA.sendTemplate).toHaveBeenCalledTimes(1);
  const [to, name, lang, comps] = WA.sendTemplate.mock.calls[0];
  expect([to, name, lang]).toEqual(['920000000001', 'fln_plan_open_v1', 'ur']);
  expect(comps[0].parameters[0].text).toBe('پرنسپل');
  const tok = comps[1].parameters[0].text;
  expect(require('../../bot/shared/services/app-login-link').verifyAppLink(tok)).toEqual(expect.objectContaining({ u: T1, f: 'fln:11156' }));
  const senderKey = require('../../bot/shared/services/fln-keys').userKey(SENDER);
  expect(inserted.map((i) => [i.table, i.row.user_key, i.row.clip, i.row.result])).toEqual([
    ['niete_fln_events', senderKey, 'aaaaaaaaaaaaaaaa', 'sent'],
    ['niete_fln_events', senderKey, 'bbbbbbbbbbbbbbbb', 'failed'],
    ['niete_fln_events', senderKey, 'cccccccccccccccc', 'failed'],
  ]);
});

test('without the internal key → 401, nothing sent', async () => {
  const res = await post(await bot(), '/api/internal/fln/send', body([{ id: T1, key: 'aaaaaaaaaaaaaaaa' }]), 'wrong');
  expect(res.status).toBe(401);
  expect(WA.sendTemplate).not.toHaveBeenCalled();
});

test.each([
  ['no teachers', { ...body([]) }],
  ['31 teachers', body(Array.from({ length: 31 }, (_, i) => ({ id: T1, key: i.toString(16).padStart(16, '0') })))],
  ['a non-digit plan', { ...body([{ id: T1, key: 'aaaaaaaaaaaaaaaa' }]), plan: { id: 'x1', title: 't' } }],
  ['a bad key', body([{ id: T1, key: 'NOT-A-KEY' }])],
  ['no sender', { ...body([{ id: T1, key: 'aaaaaaaaaaaaaaaa' }]), sender: null }],
])('%s → 400 bad_request, nothing sent', async (_n, b) => {
  const res = await post(await bot(), '/api/internal/fln/send', b);
  expect(res.status).toBe(400);
  expect(res.body).toEqual({ success: false, error: 'bad_request' });
  expect(WA.sendTemplate).not.toHaveBeenCalled();
});

test('the internal-api router mounts it (the one hook line): the same call through /api/internal reaches it', async () => {
  jest.doMock('../../bot/shared/storage/r2', () => ({}));
  const a = express();
  a.use(express.json());
  a.use('/api/internal', require('../../bot/shared/routes/internal-api.routes'));
  const srv = await new Promise((r) => { const s = a.listen(0, () => r(s)); });
  servers.push(srv);
  const res = await post(srv, '/api/internal/fln/send', body([{ id: T1, key: 'aaaaaaaaaaaaaaaa' }]));
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ success: true, queued: 1, failed: [] });
  expect(WA.sendTemplate).toHaveBeenCalledTimes(1);
});
