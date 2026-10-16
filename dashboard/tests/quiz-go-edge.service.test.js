/**
 * The one door's public edge (/quiz/go/:token, /api/go/*): it forwards path-for-path and never verifies a token (the
 * portal holds no token secret). The bot's "switch off" falls through to today's handling with nothing set on the
 * response; only this site's own pages pass as a Location (or a JSON `next`); a bot that cannot be reached is the
 * go.error page, never a 500; a phone with no device ref gets one. The bot is the network boundary (a fake fetch).
 */
const http = require('http');
const express = require('express');
const { createQuizGoRouter } = require('../routes/quiz-go.routes');

const BOT = 'http://bot.test';
const KEY = 'test-internal-key';
const N = 'abcdefghijklmnopqrstuv';
const TOK = 'eyJrIjoiZ28ifQ.AAAAAAAAAAAAAAAAAAAAAA';

function botRes(status, { body = '', type = 'application/json', location = null } = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (h) => ({ 'content-type': type, location }[h.toLowerCase()] || null) },
    text: async () => body,
    arrayBuffer: async () => { const b = Buffer.from(body); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); },
  };
}
function start(app) { return new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); }); }
function req(srv, method, path, { headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: srv.address().port, method, path, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    r.on('error', reject);
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

let srv;
let calls;
async function boot(answer) {
  calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return answer(url, init); };
  const app = express();
  app.use(createQuizGoRouter({ botUrl: BOT, apiKey: KEY, fetchImpl }));
  app.use((r, res) => res.status(299).send('today'));   // "today's handling" for anything that falls through
  srv = await start(app);
}
afterEach(() => new Promise((r) => (srv ? srv.close(r) : r())));

test('the landing is forwarded with the key and a device ref; the bot\'s page passes through; a phone with none gets one', async () => {
  await boot(() => botRes(200, { body: '<!doctype html><main data-screen="role"></main>', type: 'text/html; charset=utf-8' }));
  const r = await req(srv, 'GET', `/quiz/go/${TOK}`);
  expect(r.status).toBe(200);
  expect(r.body).toContain('data-screen="role"');
  expect(calls[0].url).toBe(`${BOT}/api/internal/go/land/${TOK}`);
  expect(calls[0].init.headers['x-api-key']).toBe(KEY);
  const minted = String(r.headers['set-cookie']).match(/wq_dv=([A-Za-z0-9_-]{22}); Path=\/; Max-Age=2592000; SameSite=Lax/);
  expect(minted).not.toBeNull();
  expect(calls[0].init.headers['x-wq-device']).toBe(minted[1]);
  expect(r.headers['cache-control']).toBe('private, no-store');
});

test('a phone with a device ref keeps it; ?ask=1 is passed on; nothing else of the query is', async () => {
  await boot(() => botRes(200, { body: 'ok', type: 'text/html' }));
  const r = await req(srv, 'GET', `/quiz/go/${TOK}?ask=1&phone=1&x=y`, { headers: { cookie: `wq_dv=${N}` } });
  expect(r.headers['set-cookie']).toBeUndefined();
  expect(calls[0].url).toBe(`${BOT}/api/internal/go/land/${TOK}?ask=1`);
  expect(calls[0].init.headers['x-wq-device']).toBe(N);
});

test.each([
  '/quiz/teacher/th.AAAAAAAAAAAAAAAAAAAAAA',
  '/quiz/join/j.AAAAAAAAAAAAAAAAAAAAAA',
  '/h/hub.AAAAAAAAAAAAAAAAAAAAAA?from=quiz',
  '/m/mk.AAAAAAAAAAAAAAAAAAAAAA',
])('the bot\'s 302 to this site\'s page %s passes', async (loc) => {
  await boot(() => botRes(302, { location: loc }));
  const r = await req(srv, 'GET', `/quiz/go/${TOK}`);
  expect(r.status).toBe(302);
  expect(r.headers.location).toBe(loc);
});

test('a Location off this site is refused (go.error, 502)', async () => {
  await boot(() => botRes(302, { location: 'https://evil.example/x' }));
  const r = await req(srv, 'GET', `/quiz/go/${TOK}`);
  expect(r.status).toBe(502);
  expect(r.body).toContain('data-screen="go.error"');
});

test('the switch off at the bot → today\'s handling answers, with NOTHING set by this router (no cookie)', async () => {
  await boot(() => botRes(404, { body: JSON.stringify({ off: true }) }));
  const r = await req(srv, 'GET', `/quiz/go/${TOK}`);
  expect(r.status).toBe(299);
  expect(r.body).toBe('today');
  expect(r.headers['set-cookie']).toBeUndefined();
  expect((await req(srv, 'POST', '/api/go/role', { body: { t: TOK, side: 'child' } })).status).toBe(299);
});

test('a malformed token falls through with no bot call', async () => {
  await boot(() => { throw new Error('no bot call expected'); });
  expect((await req(srv, 'GET', '/quiz/go/not-a-token')).status).toBe(299);
  expect((await req(srv, 'POST', '/api/go/who', { body: { t: 'nope' } })).status).toBe(299);
  expect(calls).toHaveLength(0);
});

test('a bot that cannot be reached → the go.error page (503), never a 500', async () => {
  await boot(() => { throw new Error('ECONNREFUSED'); });
  const r = await req(srv, 'GET', `/quiz/go/${TOK}`, { headers: { 'accept-language': 'ur-PK' } });
  expect(r.status).toBe(503);
  expect(r.body).toContain('یہ نہیں ہو سکا۔');
  expect((await req(srv, 'POST', '/api/go/role', { body: { t: TOK, side: 'teacher' } })).status).toBe(503);
});

test('POST /api/go/role forwards only {t, side}; the answer\'s next must be this site\'s page', async () => {
  await boot(() => botRes(200, { body: JSON.stringify({ next: '/quiz/teacher/th.AAAAAAAAAAAAAAAAAAAAAA', side: 'teacher' }) }));
  const r = await req(srv, 'POST', '/api/go/role', { body: { t: TOK, side: 'teacher', phone: '+92300FIXTURE0', role: 'admin' } });
  expect(r.status).toBe(200);
  expect(JSON.parse(r.body)).toEqual({ next: '/quiz/teacher/th.AAAAAAAAAAAAAAAAAAAAAA', side: 'teacher' });
  expect(JSON.parse(calls[0].init.body)).toEqual({ t: TOK, side: 'teacher' });
  srv.close();
  await boot(() => botRes(200, { body: JSON.stringify({ next: 'https://evil.example' }) }));
  expect((await req(srv, 'POST', '/api/go/role', { body: { t: TOK, side: 'teacher' } })).status).toBe(502);
});

test('POST /api/go/who forwards {t, d}; /api/go/bind forwards {t, pick, d} and drops anything else (a kid, a name)', async () => {
  await boot(() => botRes(200, { body: JSON.stringify({ side: 'unknown', next: null }) }));
  expect(JSON.parse((await req(srv, 'POST', '/api/go/who', { body: { t: TOK, d: N } })).body)).toEqual({ side: 'unknown', next: null });
  expect(JSON.parse(calls[0].init.body)).toEqual({ t: TOK, d: N });
  await req(srv, 'POST', '/api/go/bind', { body: { t: TOK, pick: '0123456789abcdef', d: N, kid: '55555555-5555-4555-8555-000000000001', first: 'Sara' } });
  expect(JSON.parse(calls[1].init.body)).toEqual({ t: TOK, pick: '0123456789abcdef', d: N });
});

test('POST /api/go/persona forwards only {t, as ∈ fresh|teacher_empty|real}', async () => {
  await boot(() => botRes(200, { body: JSON.stringify({ next: `/quiz/go/${TOK}` }) }));
  await req(srv, 'POST', '/api/go/persona', { body: { t: TOK, as: 'fresh', phone: '+92300FIXTURE0' } });
  expect(JSON.parse(calls[0].init.body)).toEqual({ t: TOK, as: 'fresh' });
  await req(srv, 'POST', '/api/go/persona', { body: { t: TOK, as: 'admin' } });
  expect(JSON.parse(calls[1].init.body)).toEqual({ t: TOK });
});
