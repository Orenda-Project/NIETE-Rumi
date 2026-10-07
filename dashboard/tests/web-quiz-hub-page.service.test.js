/**
 * The kid hub on the edge: GET /h/:token renders the hub page server-side with the
 * bot's hub JSON as boot JSON (like /q/:code), an expired or forged link gets the
 * closed page, and /api/wq/hub/:token is forwarded with the read limiter.
 * The bot is the network boundary (a fake fetch); no first-party module is mocked.
 */
const http = require('http');
const express = require('express');
const { createWebQuizRouter } = require('../routes/web-quiz.routes');

const BOT = 'http://bot.test';
const KEY = 'test-internal-key';
const TOKEN = 'eyJrIjoiaCIsImlkcyI6WyJhIl0sImV4cCI6OTk5OTk5OTk5OX0.AbCdEfGhIjKlMnOpQrStUv';

function jsonRes(status, body) {
  return { status, ok: status >= 200 && status < 300, headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) }, text: async () => JSON.stringify(body) };
}
function req(srv, path, headers = {}) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: srv.address().port, path, headers }, (res) => {
      let out = '';
      res.on('data', (c) => { out += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: out }));
    }).on('error', reject);
  });
}

const HUB = {
  lang: 'ur', kids: [{ chip: '0123456789abcdef', first: 'سنا', animal: 'owl', grade: '3' }], kid: '0123456789abcdef',
  teacher: { code: 'NEWQ01', topic: 'Shapes </script><b>', subject: 'maths', sent_at: '2026-10-06T10:00:00Z', k: 'k1' },
  again: [], recs: [], challenge: null, lib: null, brand: 'niete',
};

let srv; let calls; let next;
beforeEach(async () => {
  calls = [];
  next = jsonRes(200, HUB);
  const app = express();
  app.use(createWebQuizRouter({ botUrl: BOT, apiKey: KEY, fetchImpl: async (url, opts) => { calls.push({ url, opts }); return next; } }));
  app.use((r, res) => res.status(418).send('fell through'));
  await new Promise((r) => { srv = app.listen(0, r); });
});
afterEach(() => new Promise((r) => srv.close(r)));

test('GET /h/:token: 200, the hub JSON as boot JSON (escaped), hub.js, the page in the kid\'s language', async () => {
  const r = await req(srv, `/h/${TOKEN}?kid=0123456789abcdef`);
  expect(r.status).toBe(200);
  expect(calls[0].url).toBe(`${BOT}/api/internal/wq/hub/${TOKEN}?kid=0123456789abcdef`);
  expect(calls[0].opts.headers['x-api-key']).toBe(KEY);
  expect(r.body).toMatch(/<html lang="ur" dir="rtl">/);
  expect(r.body).toMatch(/<script src="\/wq\/hub\.js\?v=[0-9a-f]{10}" defer><\/script>/);
  expect(r.body).not.toContain('</script><b>');
  const boot = JSON.parse(/<script id="boot" type="application\/json">([\s\S]*?)<\/script>/.exec(r.body)[1]);
  expect(boot).toMatchObject({ view: 'hub', token: TOKEN, kid: '0123456789abcdef', teacher: { code: 'NEWQ01' } });
  expect(boot.brand && boot.brand.mascot).toBeTruthy();
  expect(r.headers['cache-control']).toBe('no-cache');
  expect(r.headers['x-robots-tag']).toMatch(/noindex/);
});

test('an expired or forged link (bot 401): the closed page, asking for a new /quiz link, never the hub', async () => {
  next = jsonRes(401, { error: 'bad_token' });
  const r = await req(srv, `/h/${TOKEN}`);
  expect(r.status).toBe(401);
  expect(r.body).toContain('wq-closed');
  expect(r.body).toContain('/quiz');
  expect(r.body).not.toContain('hub.js');
});

test('a token that is not token-shaped never reaches the bot', async () => {
  const r = await req(srv, '/h/not-a-token');
  expect(r.status).toBe(401);
  expect(calls).toHaveLength(0);
});

test('the hub switched off (bot 503): the "not open right now" page', async () => {
  next = jsonRes(503, { error: 'web_quiz_off' });
  const r = await req(srv, `/h/${TOKEN}`);
  expect(r.status).toBe(503);
  expect(r.body).toContain('wq-closed');
});

test('GET /api/wq/hub/:token is forwarded to the bot', async () => {
  const r = await req(srv, `/api/wq/hub/${TOKEN}?kid=0123456789abcdef`);
  expect(r.status).toBe(200);
  expect(calls[0].url).toBe(`${BOT}/api/internal/wq/hub/${TOKEN}?kid=0123456789abcdef`);
  expect(JSON.parse(r.body).kid).toBe('0123456789abcdef');
});

test('an expired link on an Urdu phone (Accept-Language ur): the closed page in Urdu', async () => {
  next = jsonRes(401, { error: 'bad_token' });
  const r = await req(srv, `/h/${TOKEN}`, { 'accept-language': 'ur-PK,ur;q=0.9,en;q=0.8' });
  expect(r.status).toBe(401);
  expect(r.body).toMatch(/<html lang="ur" dir="rtl">/);
  expect(r.body).toContain('یہ لنک پرانا ہو چکا ہے');
  const en = await req(srv, `/h/${TOKEN}`, { 'accept-language': 'en-GB,en;q=0.9' });
  expect(en.body).toContain('This link has expired');
});

test('POST /api/wq/hub/:token (the page, with this phone\'s device_ref in the body) is forwarded to the bot, body intact', async () => {
  const body = JSON.stringify({ kid: '0123456789abcdef', device_ref: 'DevRefDevRefDevRef_-01' });
  const r = await new Promise((resolve, reject) => {
    const q = http.request({ host: '127.0.0.1', port: srv.address().port, path: `/api/wq/hub/${TOKEN}`, method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } }, (res) => {
      let out = ''; res.on('data', (c) => { out += c; }); res.on('end', () => resolve({ status: res.statusCode, body: out }));
    });
    q.on('error', reject); q.end(body);
  });
  expect(r.status).toBe(200);
  expect(calls[0].url).toBe(`${BOT}/api/internal/wq/hub/${TOKEN}`);
  expect(calls[0].opts.method).toBe('POST');
  expect(JSON.parse(calls[0].opts.body)).toEqual({ kid: '0123456789abcdef', device_ref: 'DevRefDevRefDevRef_-01' });
});
