/**
 * The quiz-maker page's public edge (/m/:token, /f/:token, /api/ft/*): the bot's 404 {off:true} → next() (the request
 * falls through to today's handling); a 200 page passes through, never stored; a malformed token → next() with no bot
 * call; a bot timeout → the small static error page. The bot is the network boundary (a fake fetch / callBot).
 */
const http = require('http');
const express = require('express');
const { createFirstTouchRouter } = require('../routes/first-touch.routes');
const { str } = require('../../bot/shared/services/first-touch/maker.strings');

const BOT = 'http://bot.test';
const KEY = 'test-internal-key';
const TOK = 'eyJrIjoibSJ9.AAAAAAAAAAAAAAAAAAAAAA';

function botRes(status, { body = '', type = 'text/html; charset=utf-8', location = null } = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (h) => ({ 'content-type': type, location }[h.toLowerCase()] || null) },
    text: async () => body,
    arrayBuffer: async () => { const b = Buffer.from(body); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); },
  };
}
const OFF = () => botRes(404, { body: JSON.stringify({ off: true }), type: 'application/json; charset=utf-8' });

let srv;
let calls;
async function boot(answer, opts = {}) {
  calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return answer(url, init); };
  const app = express();
  app.use(createFirstTouchRouter({ botUrl: BOT, apiKey: KEY, fetchImpl, ...opts }));
  // today's handling of everything the edge lets fall through
  app.use((req, res) => res.status(404).type('text').send('today'));
  srv = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
}
afterEach(() => new Promise((r) => (srv ? srv.close(r) : r())));

function request(method, path, { body = null, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const data = body == null ? null : JSON.stringify(body);
    const r = http.request({ host: '127.0.0.1', port: srv.address().port, method, path,
      headers: { ...(data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}), ...headers } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

describe('switch OFF at the bot: every forwarded route falls through to today', () => {
  test.each([
    ['GET', `/m/${TOK}`], ['GET', `/m/${TOK}/send?c=a0000000-0000-4000-8000-000000000001`], ['GET', `/f/${TOK}`], ['GET', `/f/${TOK}/teacher`],
    ['POST', '/api/ft/make'], ['POST', '/api/ft/step'], ['POST', '/api/ft/code'], ['POST', '/api/ft/door'], ['POST', '/api/ft/tour'],
  ])('%s %s → the bot says {off:true} → next()', async (method, path) => {
    await boot(OFF);
    const res = await request(method, path, method === 'POST' ? { body: { t: TOK, step: 'grade', grade: '4' } } : {});
    expect(calls).toHaveLength(1);
    expect(calls[0].url.startsWith(`${BOT}/api/internal/ft/`)).toBe(true);
    expect(calls[0].init.headers['x-api-key']).toBe(KEY);
    expect(res.status).toBe(404);
    expect(res.body).toBe('today');
  });
});

test('GET /m/:token → the bot\'s page passed through, no-store, on the bot\'s same path', async () => {
  await boot(() => botRes(200, { body: '<html>maker</html>' }));
  const res = await request('GET', `/m/${TOK}?lang=en&junk=1`);
  expect(calls[0].url).toBe(`${BOT}/api/internal/ft/m/${TOK}?lang=en`);
  expect(res.status).toBe(200);
  expect(res.body).toBe('<html>maker</html>');
  expect(res.headers['content-type']).toMatch(/text\/html/);
  expect(res.headers['cache-control']).toMatch(/no-store/);
});

test('POST /api/ft/make → JSON body forwarded with known fields only; the bot\'s JSON passed through', async () => {
  await boot(() => botRes(200, { body: JSON.stringify({ shareCodeId: 'x', message: 'm', qlang: null, preview: 'p' }), type: 'application/json' }));
  const res = await request('POST', '/api/ft/make', { body: { t: TOK, grade: '4', subject: 'maths', quizId: 'c0000000-0000-4000-8000-000000000002', extra: 'dropped' } });
  expect(calls[0].url).toBe(`${BOT}/api/internal/ft/api/ft/make`);
  expect(JSON.parse(calls[0].init.body)).toEqual({ t: TOK, grade: '4', subject: 'maths', quizId: 'c0000000-0000-4000-8000-000000000002' });
  expect(res.status).toBe(200);
  expect(JSON.parse(res.body)).toEqual({ shareCodeId: 'x', message: 'm', qlang: null, preview: 'p' });
});

test('POST /api/ft/step → a field outside its shape and a field not on the list are both dropped before the bot', async () => {
  await boot(() => botRes(204, { body: '' }));
  const res = await request('POST', '/api/ft/step', { body: {
    t: TOK, step: 'share_copy', grade: '9', subject: 'Maths<script>', quizId: 'not-a-uuid', phone: '+92300FIXTURE1', uid: 'x',
  } });
  expect(res.status).toBe(204);
  expect(JSON.parse(calls[0].init.body)).toEqual({ t: TOK, step: 'share_copy' });
});

test('POST /api/ft/tour → action and the dismiss\'s how reach the bot; anything else is dropped', async () => {
  await boot(() => botRes(204, { body: '' }));
  const res = await request('POST', '/api/ft/tour', { body: { t: TOK, action: 'dismiss', how: 'chip', uid: 'x', phone: '+92300FIXTURE1' } });
  expect(res.status).toBe(204);
  expect(JSON.parse(calls[0].init.body)).toEqual({ t: TOK, action: 'dismiss', how: 'chip' });
});

test('a bot redirect: wa.me and same-site paths pass through, anything else does not', async () => {
  await boot(() => botRes(302, { location: 'https://wa.me/?text=hi' }));
  let res = await request('GET', `/m/${TOK}/send?c=a0000000-0000-4000-8000-000000000001`);
  expect(res.status).toBe(302);
  expect(res.headers.location).toBe('https://wa.me/?text=hi');
  await new Promise((r) => srv.close(r));
  await boot(() => botRes(302, { location: 'https://evil.example/' }));
  res = await request('POST', '/api/ft/door', { body: { t: TOK } });
  expect(res.status).toBe(502);
});

test('a malformed token → next() with no bot call', async () => {
  await boot(() => botRes(200, { body: 'never' }));
  for (const p of ['/m/not-a-token', '/f/x.y']) {
    const res = await request('GET', p);
    expect(res.body).toBe('today');
  }
  const res = await request('POST', '/api/ft/make', { body: { t: 'nope', grade: '4' } });
  expect(res.body).toBe('today');
  expect(calls).toHaveLength(0);
});

test('a bot timeout on the page → the static mk.error page in the request\'s language; on a JSON route → 503 {error:mk.error}', async () => {
  await boot(() => { throw Object.assign(new Error('aborted'), { name: 'AbortError' }); });
  let res = await request('GET', `/m/${TOK}`, { headers: { 'accept-language': 'ur-PK,ur;q=0.9' } });
  expect(res.status).toBe(503);
  expect(res.body).toContain(str('mk.error', 'ur'));
  expect(res.headers['cache-control']).toMatch(/no-store/);
  res = await request('GET', `/m/${TOK}?lang=en`);
  expect(res.body).toContain(str('mk.error', 'en').replace(/'/g, '&#39;'));
  res = await request('POST', '/api/ft/make', { body: { t: TOK, grade: '4', subject: 'maths', quizId: 'c0000000-0000-4000-8000-000000000002' } });
  expect(res.status).toBe(503);
  expect(JSON.parse(res.body)).toEqual({ error: 'mk.error' });
});

test('a bot 5xx on the page → the static error page', async () => {
  await boot(() => botRes(500, { body: 'boom' }));
  const res = await request('GET', `/m/${TOK}`);
  expect(res.status).toBe(503);
  expect(res.body).toContain(str('mk.error', 'en').replace(/'/g, '&#39;'));
  expect(res.body).not.toContain('boom');
});

test('an injected callBot is used as is', async () => {
  const seen = [];
  const callBot = async (method, path) => { seen.push([method, path]); return { status: 200, bytes: Buffer.from('ok'), contentType: 'text/html' }; };
  const app = express();
  app.use(createFirstTouchRouter({ callBot }));
  srv = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const res = await request('GET', `/f/${TOK}`);
  expect(res.body).toBe('ok');
  expect(seen).toEqual([['GET', `/api/internal/ft/f/${TOK}`]]);
});
