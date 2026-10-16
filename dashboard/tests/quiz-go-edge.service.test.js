/**
 * The one door's public edge (/quiz/go/:token, /api/go/*): an unknown phone's question page is rendered HERE without
 * a bot call (the first byte never waits on the database); every other landing is forwarded and only this site's own
 * pages pass as a Location; the bot's "switch off" falls through to today's handling; a bot that cannot be reached is
 * the go.error page, never a 500; a phone with no device ref gets one. The bot is the network boundary (a fake fetch).
 */
process.env.WEB_QUIZ_TOKEN_SECRET = 'unit-secret-not-a-secret';
const http = require('http');
const express = require('express');
const { createQuizGoRouter } = require('../routes/quiz-go.routes');
const GoToken = require('../../bot/shared/services/first-touch/go.token');

const BOT = 'http://bot.test';
const KEY = 'test-internal-key';
const N = 'abcdefghijklmnopqrstuv';
const tok = (side, lang = 'bi') => GoToken.signGo({ uid: 'u-1', side, n: N, lang, src: 'typed' });

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

test('unknown → the question page from the edge, no bot call; a device ref is set for a phone without one', async () => {
  await boot(() => { throw new Error('no bot call expected'); });
  const r = await req(srv, 'GET', `/quiz/go/${tok('unknown')}`);
  expect(r.status).toBe(200);
  expect(r.body).toContain('data-screen="role"');
  expect(calls).toHaveLength(0);
  expect(String(r.headers['set-cookie'])).toMatch(/wq_dv=[A-Za-z0-9_-]{22}; Path=\/; Max-Age=2592000; SameSite=Lax/);
  expect(r.headers['cache-control']).toBe('private, no-store');
});

test('a known side → forwarded with the key and the device ref; the bot\'s 302 to the teacher home passes', async () => {
  await boot(() => botRes(302, { location: '/quiz/teacher/th.AAAAAAAAAAAAAAAAAAAAAA' }));
  const r = await req(srv, 'GET', `/quiz/go/${tok('teacher')}`, { headers: { cookie: `wq_dv=${N}` } });
  expect(r.status).toBe(302);
  expect(r.headers.location).toBe('/quiz/teacher/th.AAAAAAAAAAAAAAAAAAAAAA');
  expect(calls[0].url).toBe(`${BOT}/api/internal/go/land/${tok('teacher')}`);
  expect(calls[0].init.headers['x-api-key']).toBe(KEY);
  expect(calls[0].init.headers['x-wq-device']).toBe(N);
});

test('the child home 302 (/h/<hub>?src=quiz) passes; a Location off this site is refused (go.error, 502)', async () => {
  await boot(() => botRes(302, { location: '/h/hub.AAAAAAAAAAAAAAAAAAAAAA?src=quiz' }));
  expect((await req(srv, 'GET', `/quiz/go/${tok('child')}`)).headers.location).toBe('/h/hub.AAAAAAAAAAAAAAAAAAAAAA?src=quiz');
  srv.close();
  await boot(() => botRes(302, { location: 'https://evil.example/x' }));
  const r = await req(srv, 'GET', `/quiz/go/${tok('child')}`);
  expect(r.status).toBe(502);
  expect(r.body).toContain('data-screen="go.error"');
});

test('the switch off at the bot → falls through to today\'s handling', async () => {
  await boot(() => botRes(404, { body: JSON.stringify({ off: true }) }));
  expect((await req(srv, 'GET', `/quiz/go/${tok('teacher')}`)).status).toBe(299);
  expect((await req(srv, 'POST', '/api/go/role', { body: { t: tok('unknown'), side: 'child' } })).status).toBe(299);
});

test('a malformed token falls through with no bot call', async () => {
  await boot(() => { throw new Error('no bot call expected'); });
  expect((await req(srv, 'GET', '/quiz/go/not-a-token')).status).toBe(299);
  expect(calls).toHaveLength(0);
});

test('a bot that cannot be reached → the go.error page (503), never a 500', async () => {
  await boot(() => { throw new Error('ECONNREFUSED'); });
  const r = await req(srv, 'GET', `/quiz/go/${tok('teacher', 'ur')}`);
  expect(r.status).toBe(503);
  expect(r.body).toContain('یہ نہیں ہو سکا۔');
});

test('POST /api/go/role forwards only {t, side}; the answer\'s next must be this site\'s page', async () => {
  await boot(() => botRes(200, { body: JSON.stringify({ next: '/quiz/teacher/th.AAAAAAAAAAAAAAAAAAAAAA', side: 'teacher' }) }));
  const r = await req(srv, 'POST', '/api/go/role', { body: { t: tok('unknown'), side: 'teacher', phone: '+92300FIXTURE0', role: 'admin' } });
  expect(r.status).toBe(200);
  expect(JSON.parse(r.body)).toEqual({ next: '/quiz/teacher/th.AAAAAAAAAAAAAAAAAAAAAA', side: 'teacher' });
  expect(JSON.parse(calls[0].init.body)).toEqual({ t: tok('unknown'), side: 'teacher' });
  srv.close();
  await boot(() => botRes(200, { body: JSON.stringify({ next: 'https://evil.example' }) }));
  expect((await req(srv, 'POST', '/api/go/role', { body: { t: tok('unknown'), side: 'teacher' } })).status).toBe(502);
});

test('POST /api/go/who and /api/go/bind forward; bind passes only a uuid kid', async () => {
  await boot(() => botRes(200, { body: JSON.stringify({ side: 'unknown', next: null }) }));
  expect(JSON.parse((await req(srv, 'POST', '/api/go/who', { body: { t: tok('unknown') } })).body)).toEqual({ side: 'unknown', next: null });
  await req(srv, 'POST', '/api/go/bind', { body: { t: tok('child'), kid: 'not-a-uuid' } });
  expect(JSON.parse(calls[1].init.body)).toEqual({ t: tok('child') });
});
