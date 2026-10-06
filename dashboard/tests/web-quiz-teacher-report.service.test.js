/**
 * The teacher's web report edge (portal): /r/:token, /r/:token/pdf, /r/:token/remind,
 * forwarded to the bot's /api/internal/tr/* with the internal key — the same bot client
 * the child quiz uses. The bot is the network boundary: a fake fetch records what the
 * edge sent and plays back what the bot answers. No first-party module is mocked.
 */
const http = require('http');
const express = require('express');
const { createTeacherReportRouter } = require('../routes/teacher-report.routes');

const BOT = 'http://bot.test';
const KEY = 'test-internal-key';
const TOK = 'eyJrIjoidHIifQ.AAAAAAAAAAAAAAAAAAAAAA';

function botRes(status, { body = '', type = 'text/html; charset=utf-8', location = null, bytes = null } = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (h) => ({ 'content-type': type, location }[h.toLowerCase()] || null) },
    text: async () => body,
    arrayBuffer: async () => { const b = bytes || Buffer.from(body); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); },
  };
}

function start(app) {
  return new Promise((resolve) => { const srv = app.listen(0, () => resolve(srv)); });
}
function get(srv, path, headers = {}) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: srv.address().port, path, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    }).on('error', reject);
  });
}

let srv;
let calls;
async function boot(answer, opts = {}) {
  calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return answer(url, init); };
  const app = express();
  app.set('trust proxy', true);
  app.use(createTeacherReportRouter({ botUrl: BOT, apiKey: KEY, fetchImpl, ...opts }));
  srv = await start(app);
}
afterEach(() => new Promise((r) => (srv ? srv.close(r) : r())));

const expectPrivate = (res) => {
  expect(res.headers['cache-control']).toBe('private, no-store');
  expect(res.headers['x-robots-tag']).toMatch(/noindex/);
  expect(res.headers['referrer-policy']).toBe('no-referrer');
};

test('GET /r/:token forwards to the bot page route with the key, the query and the UA, and pipes the HTML back', async () => {
  await boot(() => botRes(200, { body: '<!doctype html><html dir="rtl"><p>report</p></html>' }));
  const res = await get(srv, `/r/${TOK}?lang=ur&tab=class&class=a0000000-0000-4000-8000-00000000003b`, { 'user-agent': 'WhatsApp/2.24' });
  expect(res.status).toBe(200);
  expect(res.headers['content-type']).toMatch(/text\/html/);
  expect(res.body.toString()).toContain('<p>report</p>');
  expectPrivate(res);
  expect(calls).toHaveLength(1);
  expect(calls[0].url).toBe(`${BOT}/api/internal/tr/page/${TOK}?lang=ur&tab=class&class=a0000000-0000-4000-8000-00000000003b`);
  expect(calls[0].init.headers['x-api-key']).toBe(KEY);
  expect(calls[0].init.headers['user-agent']).toBe('WhatsApp/2.24');
});

test('the bot\'s expired page keeps its status (410) and is never cached', async () => {
  await boot(() => botRes(410, { body: '<html>This link has expired</html>' }));
  const res = await get(srv, `/r/${TOK}`);
  expect(res.status).toBe(410);
  expect(res.body.toString()).toMatch(/expired/);
  expectPrivate(res);
});

test('GET /r/:token/pdf pipes the PDF bytes as an attachment', async () => {
  const pdf = Buffer.from('%PDF-1.4 fake bytes');
  await boot(() => botRes(200, { type: 'application/pdf', bytes: pdf }));
  const res = await get(srv, `/r/${TOK}/pdf?lang=en`);
  expect(res.status).toBe(200);
  expect(res.headers['content-type']).toMatch(/application\/pdf/);
  expect(res.headers['content-disposition']).toMatch(/^attachment; filename="quiz-report-\d{4}-\d{2}-\d{2}\.pdf"$/);
  expect(res.body.equals(pdf)).toBe(true);
  expectPrivate(res);
  expect(calls[0].url).toBe(`${BOT}/api/internal/tr/pdf/${TOK}?lang=en`);
});

test('GET /r/:token/remind passes the bot\'s 302 to wa.me straight through', async () => {
  const loc = 'https://wa.me/?text=%F0%9F%93%A3%20Our%20quiz';
  await boot(() => botRes(302, { location: loc, body: '' }));
  const res = await get(srv, `/r/${TOK}/remind?quiz=22222222-2222-4222-8222-222222222222`);
  expect(res.status).toBe(302);
  expect(res.headers.location).toBe(loc);
  expectPrivate(res);
  expect(calls[0].url).toBe(`${BOT}/api/internal/tr/remind/${TOK}?quiz=22222222-2222-4222-8222-222222222222`);
  expect(calls[0].init.redirect).toBe('manual');
});

test('a redirect anywhere but wa.me is not followed', async () => {
  await boot(() => botRes(302, { location: 'https://evil.test/' }));
  const res = await get(srv, `/r/${TOK}/remind`);
  expect(res.status).toBe(502);
});

test('a token that is not token-shaped never reaches the bot', async () => {
  await boot(() => botRes(200, { body: 'x' }));
  const res = await get(srv, '/r/not%20a%20token%3Cb%3E');
  expect(res.status).toBe(404);
  expect(calls).toHaveLength(0);
});

test('bot unreachable: a 502 page, private', async () => {
  await boot(() => { throw new Error('ECONNREFUSED'); });
  const res = await get(srv, `/r/${TOK}`);
  expect(res.status).toBe(502);
  expect(res.headers['content-type']).toMatch(/text\/html/);
  expectPrivate(res);
});

test('not configured (no bot URL or key): 503, nothing forwarded', async () => {
  await boot(() => botRes(200), { apiKey: '' });
  const res = await get(srv, `/r/${TOK}`);
  expect(res.status).toBe(503);
  expect(calls).toHaveLength(0);
});

test('the latency log never records a report token: /r/<token> paths are logged by shape', () => {
  const { loggedPath } = require('../middleware/latency-logger');
  expect(loggedPath(`/r/${TOK}`)).toBe('/r/:token');
  expect(loggedPath(`/r/${TOK}/pdf`)).toBe('/r/:token/pdf');
  expect(loggedPath(`/r/${TOK}/remind`)).toBe('/r/:token/remind');
  expect(loggedPath('/t/abc.def')).toBe('/t/:token');
  expect(loggedPath('/q/AB12CD')).toBe('/q/AB12CD');
});

test('the training link /t/<token> is never answered by the report router (it falls through to training)', async () => {
  await boot(() => botRes(200, { body: 'report' }));
  const res = await get(srv, `/t/${TOK}`);
  expect(res.status).toBe(404);
  expect(res.body.toString()).not.toContain('report');
  expect(calls).toHaveLength(0);
});

function postForm(srv, path, form) {
  return new Promise((resolve, reject) => {
    const data = new URLSearchParams(form).toString();
    const r = http.request({ host: '127.0.0.1', port: srv.address().port, method: 'POST', path,
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'content-length': Buffer.byteLength(data) } }, (res) => {
      res.resume();
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers }));
    });
    r.on('error', reject);
    r.end(data);
  });
}

const Q = '22222222-2222-4222-8222-222222222222';

test('POST /r/:token/class: the form becomes JSON for the bot (known fields only), and its 303 back to the report passes through', async () => {
  await boot(() => botRes(303, { location: `/r/${TOK}` }));
  const res = await postForm(srv, `/r/${TOK}/class`, { quiz: Q, key: 'k-3b', extra: 'dropped' });
  expect(res.status).toBe(303);
  expect(res.headers.location).toBe(`/r/${TOK}`);
  expectPrivate(res);
  expect(calls[0].url).toBe(`${BOT}/api/internal/tr/class/${TOK}`);
  expect(calls[0].init.method).toBe('POST');
  expect(calls[0].init.headers['x-api-key']).toBe(KEY);
  expect(JSON.parse(calls[0].init.body)).toEqual({ quiz: Q, key: 'k-3b' });
});

test('POST /r/:token/fix forwards ref + add / studentId', async () => {
  await boot(() => botRes(303, { location: `/r/${TOK}?e=1` }));
  const res = await postForm(srv, `/r/${TOK}/fix`, { quiz: Q, ref: '33333333-3333-4333-8333-333333333333', studentId: 'b0000000-0000-4000-8000-000000000002' });
  expect(res.status).toBe(303);
  expect(res.headers.location).toBe(`/r/${TOK}?e=1`);
  expect(JSON.parse(calls[0].init.body)).toEqual({ quiz: Q, ref: '33333333-3333-4333-8333-333333333333', studentId: 'b0000000-0000-4000-8000-000000000002' });
});

test('a POST redirect anywhere but back to a report is refused', async () => {
  await boot(() => botRes(303, { location: 'https://evil.test/' }));
  const res = await postForm(srv, `/r/${TOK}/class`, { quiz: Q, key: 'k' });
  expect(res.status).toBe(502);
});
