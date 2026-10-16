/**
 * The join screen at the edge (quiz-join.routes.js): GET /quiz/join/:token asks the bot ONLY whether the switch is
 * on and the token good, then draws the page in the token's language — no test word, no "register", no phone field,
 * the saving notice above "Let's go!", practice asking the grade only. Switch off (the bot's 404) or a malformed
 * token → next(): the portal's own answer, byte for byte. The two POSTs ride the web quiz router's forwarder. The bot
 * is the network boundary (a fake fetch); the portal's own page is a stand-in that answers 418.
 */
const http = require('http');
const zlib = require('zlib');
const express = require('express');
const { createWebQuizRouter } = require('../routes/web-quiz.routes');
const { createQuizJoinRouter } = require('../routes/quiz-join.routes');

const BOT = 'http://bot.test';
const KEY = 'test-internal-key';
const DEVICE = 'AAAAAAAAAAAAAAAAAAAAAA';
const tok = (payload) => `${Buffer.from(JSON.stringify(payload)).toString('base64url')}.${'s'.repeat(22)}`;
const J = tok({ k: 'j', n: 'N'.repeat(22), l: 'ur', exp: 4102444800 });
const H = tok({ k: 'h', ids: ['x'], exp: 4102444800 });

function jsonRes(status, body) {
  return { status, ok: status >= 200 && status < 300, headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) }, text: async () => JSON.stringify(body) };
}
function start(app) { return new Promise((resolve) => { const srv = app.listen(0, () => resolve(srv)); }); }
function req(srv, method, p, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const r = http.request({ host: '127.0.0.1', port: srv.address().port, method, path: p,
      headers: { host: 'quiz.example.org', ...(data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}), ...headers } }, (res) => {
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
let page; // what the bot answers for the page shell
async function boot({ botUrl = BOT } = {}) {
  calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, opts });
    if (url.includes('/api/internal/wq/join/page/')) return jsonRes(page.status, page.body);
    if (url.endsWith('/api/internal/wq/join')) return jsonRes(200, { next: '/h/abc.def?from=join' });
    if (url.endsWith('/api/internal/wq/join/grade')) return jsonRes(200, { ok: true, prefetch: ['/wq/hub.js'] });
    return jsonRes(404, { error: 'not_found' });
  };
  const app = express();
  app.set('trust proxy', 1);
  app.use(createWebQuizRouter({ botUrl, apiKey: KEY, fetchImpl, canonicalBase: '' }));
  app.use(createQuizJoinRouter({ botUrl, apiKey: KEY, fetchImpl, logEvent: () => {} }));
  app.use((r, res) => res.status(418).send('the portal page'));
  srv = await start(app);
}
beforeEach(async () => { page = { status: 200, body: { ok: true, lang: 'ur', practice: false } }; await boot(); });
afterEach(() => new Promise((resolve) => srv.close(resolve)));

describe('GET /quiz/join/:token', () => {
  test('the Urdu join screen: five chips, the empty name field, the notice above the one primary, no banned word, the home\'s font', async () => {
    const res = await req(srv, 'GET', `/quiz/join/${J}`);
    expect(res.status).toBe(200);
    expect(calls.map((c) => c.url)).toEqual([`${BOT}/api/internal/wq/join/page/${J}`]);
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
    // the name field is empty: no value, no placeholder name
    expect(html).toMatch(/<input id="jn-name"[^>]*>/);
    expect(html.match(/<input id="jn-name"[^>]*>/)[0]).not.toMatch(/value=|placeholder=/);
    // IDENTITY §8: the notice block (its STOP sentence is static; the two named sentences fill as the name is typed) sits ABOVE "Let's go!"
    expect(html.indexOf('id="jn-notice"')).toBeGreaterThan(0);
    expect(html.indexOf('id="jn-notice"')).toBeLessThan(html.indexOf('id="jn-go"'));
    expect(html).toContain('واٹس ایپ پر ⁦<bdi dir="ltr">STOP</bdi>⁩ بھیج کر');
    expect(JSON.parse(html.match(/<script id="boot" type="application\/json">([\s\S]*?)<\/script>/)[1].replace(/\\u003c/g, '<').replace(/\\u003e/g, '>').replace(/\\u0026/g, '&')).copy.noticeSave)
      .toBe('جگنو اس فون نمبر کو ⁨{n}⁩ کے ساتھ جوڑ کر محفوظ کرے گا۔ یہ اسکول کا سال ختم ہونے تک (۳۱ مارچ) رہے گا، اور اگر کھیلنا جاری رہے تو اس کے بعد بھی۔');
    expect(html).toContain('<link rel="preload" href="/wq/fonts/wq-nastaliq-5.woff2" as="font" type="font/woff2" crossorigin>');
    expect(html).toContain('<script src="/wq/join.js?v=');
    const visible = html.replace(/<script[\s\S]*?<\/script>/g, '').toLowerCase();
    ['test', 'exam', 'assessment', 'register', 'امتحان', 'ٹیسٹ', 'school', 'type="tel"'].forEach((w) => expect(visible).not.toContain(w));
    // the weight: the page itself, gzip (the font is the home's own cached file)
    expect(zlib.gzipSync(Buffer.from(html)).length).toBeLessThan(6 * 1024);
  });

  test('practice: the strip on the screen, the grade only — no name field, no saving notice, no font preload', async () => {
    page = { status: 200, body: { ok: true, lang: 'en', practice: true } };
    const res = await req(srv, 'GET', `/quiz/join/${J}`);
    expect(res.status).toBe(200);
    expect(res.body).toContain('<body class="practice">');
    expect(res.body).toContain('Practice: nothing is saved on this phone');
    expect(res.body).not.toContain('id="jn-name"');
    expect(res.body).not.toContain('id="jn-notice"');
    expect(res.body).not.toContain('rel="preload"');
  });

  test('switch OFF (the bot answers 404) → the portal\'s own answer, byte for byte', async () => {
    page = { status: 404, body: { error: 'off' } };
    const res = await req(srv, 'GET', `/quiz/join/${J}`);
    expect(res.status).toBe(418);
    expect(res.body).toBe('the portal page');
  });

  test('a malformed token, or no bot configured → the portal\'s own answer, and the bot is never asked', async () => {
    expect((await req(srv, 'GET', '/quiz/join/garbage')).status).toBe(418);
    expect(calls).toHaveLength(0);
    await new Promise((resolve) => srv.close(resolve));
    await boot({ botUrl: '' });
    expect((await req(srv, 'GET', `/quiz/join/${J}`)).status).toBe(418);
  });

  test('a stale link → the signed "expired" words in its language; a bot failure → the signed "try again" words', async () => {
    page = { status: 410, body: { error: 'stale', lang: 'ur' } };
    const stale = await req(srv, 'GET', `/quiz/join/${J}`);
    expect(stale.status).toBe(410);
    expect(stale.body).toContain('اس لنک کی مدت ختم ہو گئی ہے۔');
    page = { status: 500, body: { error: 'server_error' } };
    const err = await req(srv, 'GET', `/quiz/join/${J}`, undefined, { 'accept-language': 'en-GB' });
    expect(err.status).toBe(502);
    expect(err.body).toContain('That didn&#39;t work. Try again in a moment.');
  });
});

describe('the two POSTs (the web quiz router\'s forwarder)', () => {
  test('/api/wq/join and /api/wq/join/grade reach the bot with this phone\'s device cookie as x-wq-device', async () => {
    const cookie = { cookie: `wq_dv=${DEVICE}` };
    const a = await req(srv, 'POST', '/api/wq/join', { t: J, grade: 3, name: 'Sara', device_ref: DEVICE }, cookie);
    expect(JSON.parse(a.body)).toEqual({ next: '/h/abc.def?from=join' });
    const g = await req(srv, 'POST', '/api/wq/join/grade', { t: J, grade: 2, device_ref: DEVICE }, cookie);
    expect(JSON.parse(g.body)).toEqual({ ok: true, prefetch: ['/wq/hub.js'] });
    expect(calls.map((c) => c.url)).toEqual([`${BOT}/api/internal/wq/join`, `${BOT}/api/internal/wq/join/grade`]);
    calls.forEach((c) => expect(c.opts.headers['x-wq-device']).toBe(DEVICE));
  });
});

describe('the hub route names the three new arrivals', () => {
  test('/h/<t>?from=quiz|bind|join reach the bot as src', async () => {
    for (const f of ['quiz', 'bind', 'join']) await req(srv, 'GET', `/h/${H}?from=${f}`);
    const hubCalls = calls.filter((c) => c.url.includes('/api/internal/wq/hub/'));
    expect(hubCalls.map((c) => c.url.split('?')[1])).toEqual(['src=quiz', 'src=bind', 'src=join']);
  });
});
