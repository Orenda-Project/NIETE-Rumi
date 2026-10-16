/**
 * "Keep my place" on the edge: the hub page links wq-bind.js / wq-bind.css ONLY when the bot's hub JSON carries
 * `bind` (web_quiz_phone_bind on), the three /api/wq/bind/* routes are forwarded with the device cookie, and with
 * the switch off the hub page HTML is byte-identical to the snapshot taken before this change.
 * The bot is the network boundary (a fake fetch); no first-party module is mocked.
 */
const http = require('http');
const express = require('express');
const { createWebQuizRouter, renderHubPage } = require('../routes/web-quiz.routes');

const BOT = 'http://bot.test';
const KEY = 'test-internal-key';
const TOKEN = 'eyJrIjoiaCIsImlkcyI6WyJhIl0sImV4cCI6OTk5OTk5OTk5OX0.AbCdEfGhIjKlMnOpQrStUv';
const HUB = {
  lang: 'ur', kids: [{ chip: '0123456789abcdef', first: 'زارا', animal: 'owl', grade: '3' }], kid: '0123456789abcdef',
  teacher: null, again: [], recs: [], challenge: null, lib: null, brand: 'niete',
};

function jsonRes(status, body) {
  return { status, ok: status >= 200 && status < 300, headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) }, text: async () => JSON.stringify(body) };
}
function call(srv, method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request({ host: '127.0.0.1', port: srv.address().port, method, path, headers: { ...(data ? { 'content-type': 'application/json' } : {}), ...headers } }, (res) => {
      let out = '';
      res.on('data', (c) => { out += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: out }));
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

describe('the hub page', () => {
  test('switch off (no bind in the hub JSON): the HTML is the snapshot, no wq-bind tag', () => {
    const html = renderHubPage({ payload: HUB, token: TOKEN, origin: 'https://edge.test', assetV: 'v000000001' });
    expect(html).not.toMatch(/wq-bind/);
    expect(html).toMatchSnapshot();
  });
  test('switch on (bind in the hub JSON): wq-bind.css and wq-bind.js are linked, the script before hub.js', () => {
    const html = renderHubPage({ payload: { ...HUB, bind: { offer: true, hub: TOKEN, kid: HUB.kid } }, token: TOKEN, origin: 'https://edge.test', assetV: 'v000000001' });
    expect(html).toMatch(/<link rel="stylesheet" href="\/wq\/wq-bind\.css\?v=v000000001">/);
    expect(html).toMatch(/<script src="\/wq\/wq-bind\.js\?v=v000000001" defer><\/script>\n<script src="\/wq\/hub\.js/);
  });
});

describe('the /api/wq/bind/* routes', () => {
  let srv; let calls;
  beforeEach(async () => {
    calls = [];
    const app = express();
    app.use(createWebQuizRouter({ botUrl: BOT, apiKey: KEY, fetchImpl: async (url, opts) => { calls.push({ url, opts }); return jsonRes(200, { ok: true }); } }));
    app.use((r, res) => res.status(418).send('fell through'));
    await new Promise((r) => { srv = app.listen(0, r); });
  });
  afterEach(() => new Promise((r) => srv.close(r)));

  test('mint, status and undo reach the bot with this phone\'s device', async () => {
    const dv = 'wq_dv=AAAAAAAAAAAAAAAAAAAAAA';
    expect((await call(srv, 'POST', '/api/wq/bind/mint', { hub: TOKEN, kid: HUB.kid }, { cookie: dv })).status).toBe(200);
    expect((await call(srv, 'GET', '/api/wq/bind/status?code=JUGNU-ABCDE', null, { cookie: dv })).status).toBe(200);
    expect((await call(srv, 'POST', '/api/wq/bind/undo', { code: 'JUGNU-ABCDE' }, { cookie: dv })).status).toBe(200);
    expect(calls.map((c) => `${c.opts.method} ${c.url.replace(BOT, '')}`)).toEqual([
      'POST /api/internal/wq/bind/mint', 'GET /api/internal/wq/bind/status?code=JUGNU-ABCDE', 'POST /api/internal/wq/bind/undo',
    ]);
    expect(calls.every((c) => c.opts.headers['x-wq-device'] === 'AAAAAAAAAAAAAAAAAAAAAA')).toBe(true);
  });
});
