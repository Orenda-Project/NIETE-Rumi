/**
 * The join screen at the edge: GET /quiz/join/:token renders at once (no bot call before the first byte), in the
 * token's language, with no test word, no "register", no phone field; the two POSTs forward a cleaned body with the
 * device as x-wq-device; anything malformed is refused at the edge. The bot is the network boundary (a fake fetch).
 */
const http = require('http');
const zlib = require('zlib');
const express = require('express');
const { createWebQuizRouter } = require('../routes/web-quiz.routes');

const BOT = 'http://bot.test';
const KEY = 'test-internal-key';
const DEVICE = 'AAAAAAAAAAAAAAAAAAAAAA';
const tok = (payload) => `${Buffer.from(JSON.stringify(payload)).toString('base64url')}.${'s'.repeat(22)}`;
const J_UR = tok({ k: 'j', n: 'N'.repeat(22), l: 'ur', exp: 4102444800 });
const J_EN_PRACTICE = tok({ k: 'j', m: 'practice', l: 'en', exp: 4102444800 });
const H = tok({ k: 'h', ids: ['x'], exp: 4102444800 });

function jsonRes(status, body) {
  return { status, ok: status >= 200 && status < 300, headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) }, text: async () => JSON.stringify(body) };
}
function start(app) { return new Promise((resolve) => { const srv = app.listen(0, () => resolve(srv)); }); }
function req(srv, method, p, body) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const r = http.request({ host: '127.0.0.1', port: srv.address().port, method, path: p,
      headers: { host: 'quiz.example.org', ...(data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}) } }, (res) => {
      let out = '';
      res.on('data', (c) => { out += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: out }));
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}
let srv;
let calls;
beforeEach(async () => {
  calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, opts });
    if (url.endsWith('/api/internal/wq/join')) return jsonRes(200, { next: '/h/abc.def?from=join' });
    if (url.endsWith('/api/internal/wq/join/grade')) return jsonRes(200, { ok: true, prefetch: ['/wq/hub.js'] });
    return jsonRes(404, { error: 'not_found' });
  };
  const app = express();
  app.set('trust proxy', 1);
  app.use(createWebQuizRouter({ botUrl: BOT, apiKey: KEY, fetchImpl, canonicalBase: '' }));
  app.use((r, res) => res.status(418).send('fell through'));
  srv = await start(app);
});
afterEach(() => new Promise((resolve) => srv.close(resolve)));

describe('GET /quiz/join/:token', () => {
  test('the Urdu join screen, at once: no bot call, five chips, the name field, one primary, no banned word', async () => {
    const res = await req(srv, 'GET', `/quiz/join/${J_UR}`);
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(0);
    expect(res.headers['cache-control']).toBe('no-store');
    const html = res.body;
    expect(html).toContain('<html lang="ur" dir="rtl">');
    expect(html).toContain('data-screen="join"');
    expect(html).toContain('آپ کس جماعت میں ہیں؟');
    expect(html).toContain('جگنو آپ کو کیا کہہ کر بلائے؟');
    expect((html.match(/data-tap="grade"/g) || []).length).toBe(5);
    ['۱', '۲', '۳', '۴', '۵'].forEach((g) => expect(html).toContain(`>${g}</button>`));
    expect(html).not.toMatch(/·/);
    expect((html.match(/data-primary/g) || []).length).toBe(1);
    expect(html).toContain('<script src="/wq/join.js?v=');
    const visible = html.replace(/<script[\s\S]*?<\/script>/g, '');
    ['test', 'exam', 'assessment', 'register', 'امتحان', 'ٹیسٹ', 'school', 'phone number"', 'type="tel"'].forEach((w) => expect(visible.toLowerCase()).not.toContain(w));
    // the weight budget: the page itself, gzip, well under the question page's 30 KB
    expect(zlib.gzipSync(Buffer.from(html)).length).toBeLessThan(6 * 1024);
  });

  test('practice: the English screen with the practice line and no saving notice', async () => {
    const res = await req(srv, 'GET', `/quiz/join/${J_EN_PRACTICE}`);
    expect(res.status).toBe(200);
    expect(res.body).toContain('Practice: nothing is saved on this phone');
    expect(res.body).not.toContain('Jugnu will save this phone number');
  });

  test('not a join token (malformed, or another kind) → the closed page, no bot call', async () => {
    expect((await req(srv, 'GET', '/quiz/join/garbage')).status).toBe(404);
    expect((await req(srv, 'GET', `/quiz/join/${H}`)).status).toBe(404);
    expect(calls).toHaveLength(0);
  });
});

describe('the two POSTs', () => {
  test('/api/wq/join forwards a cleaned body and the device as x-wq-device', async () => {
    const res = await req(srv, 'POST', '/api/wq/join', { t: J_UR, grade: 3, name: 'Sara', device_ref: DEVICE, extra: 'dropped', force: true });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ next: '/h/abc.def?from=join' });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${BOT}/api/internal/wq/join`);
    expect(calls[0].opts.headers['x-wq-device']).toBe(DEVICE);
    expect(JSON.parse(calls[0].opts.body)).toEqual({ t: J_UR, grade: 3, name: 'Sara', force: true });
  });

  test('/api/wq/join/grade forwards the grade tap', async () => {
    const res = await req(srv, 'POST', '/api/wq/join/grade', { t: J_UR, grade: 2, device_ref: DEVICE });
    expect(JSON.parse(res.body)).toEqual({ ok: true, prefetch: ['/wq/hub.js'] });
    expect(JSON.parse(calls[0].opts.body)).toEqual({ t: J_UR, grade: 2 });
  });

  test('a bad grade, a missing name, a forged token shape → 400 at the edge, no bot call', async () => {
    expect((await req(srv, 'POST', '/api/wq/join', { t: J_UR, grade: 7, name: 'Sara' })).status).toBe(400);
    expect((await req(srv, 'POST', '/api/wq/join', { t: J_UR, grade: 3 })).status).toBe(400);
    expect((await req(srv, 'POST', '/api/wq/join', { t: 'x', grade: 3, name: 'Sara' })).status).toBe(400);
    expect((await req(srv, 'POST', '/api/wq/join/grade', { t: J_UR, grade: 0 })).status).toBe(400);
    expect(calls).toHaveLength(0);
  });
});

describe('the hub route names the two new arrivals', () => {
  test('/h/<t>?from=quiz and ?from=join reach the bot as src', async () => {
    await req(srv, 'GET', `/h/${H}?from=quiz`);
    await req(srv, 'GET', `/h/${H}?from=join`);
    const hubCalls = calls.filter((c) => c.url.includes('/api/internal/wq/hub/'));
    expect(hubCalls.map((c) => c.url.split('?')[1])).toEqual(['src=quiz', 'src=join']);
  });
});
