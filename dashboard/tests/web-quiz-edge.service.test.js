/**
 * Web quiz edge (portal): /q/:code server-side render, /api/wq/* forwarding to the
 * bot's /api/internal/wq/*, the closed-quiz page and the rate-limit wiring.
 *
 * The bot is the network boundary: every test injects a fake fetch and asserts on
 * what the edge sent and what it answered. No first-party module is mocked.
 */
const http = require('http');
const express = require('express');
const { createWebQuizRouter, renderQuizPage } = require('../routes/web-quiz.routes');

const BOT = 'http://bot.test';
const KEY = 'test-internal-key';

function jsonRes(status, body, headers = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (h) => headers[h.toLowerCase()] || (h.toLowerCase() === 'content-type' ? 'application/json' : null) },
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  };
}

const QUIZ = {
  quiz: {
    id: 'q-1', code: 'AB12CD', topic: 'Parts of a plant </script><b>', lang: 'en', dir: 'ltr', grade: '3', subject: 'Science', n: 1,
    questions: [{ qid: 'x1', i: 1, text: 'Which part drinks water?', options: [{ slot: 'A', text: 'Roots' }, { slot: 'B', text: 'Leaves' }], correct_slot: 'A', why: 'Roots drink.' }],
  },
  cls: { label: 'Class 3', teacher: 'Teacher', chips: [] },
  live: { class_today: 3, ict_today_floor: 40 },
  video: null,
  preview: false,
};

function start(app) {
  return new Promise((resolve) => {
    const srv = app.listen(0, () => resolve(srv));
  });
}

function req(srv, method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : (typeof body === 'string' ? body : JSON.stringify(body));
    const r = http.request({ host: '127.0.0.1', port: srv.address().port, method, path,
      headers: { ...(data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}), ...headers } }, (res) => {
      let out = '';
      res.on('data', (c) => { out += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: out }));
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

function build(fetchImpl, extra = {}) {
  const app = express();
  app.set('trust proxy', 1);
  app.use(createWebQuizRouter({ botUrl: BOT, apiKey: KEY, fetchImpl, ...extra }));
  app.use((r, res) => res.status(418).send('fell through'));
  return app;
}

describe('web quiz edge: forwarding /api/wq/* -> bot /api/internal/wq/*', () => {
  let srv; let calls; let next;
  beforeEach(async () => {
    calls = [];
    next = jsonRes(200, { ok: 1 });
    srv = await start(build(async (url, opts) => { calls.push({ url, opts }); return typeof next === 'function' ? next(url, opts) : next; }));
  });
  afterEach(() => new Promise((r) => srv.close(r)));

  it('adds the internal key and the client ip, maps the path, forwards the body unchanged', async () => {
    const body = { code: 'AB12CD', chip: '0123456789abcdef' };
    const res = await req(srv, 'POST', '/api/wq/session', body, { 'x-forwarded-for': '203.0.113.9' });
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${BOT}/api/internal/wq/session`);
    expect(calls[0].opts.method).toBe('POST');
    expect(calls[0].opts.headers['x-api-key']).toBe(KEY);
    expect(calls[0].opts.headers['x-forwarded-for']).toBe('203.0.113.9');
    expect(JSON.parse(calls[0].opts.body)).toEqual(body);
  });

  it("forwards the teacher's who-played calls", async () => {
    await req(srv, 'POST', '/api/wq/who', { code: 'AB12CD', p: 'tok' });
    await req(srv, 'POST', '/api/wq/who/fix', { code: 'AB12CD', p: 'tok', ref: 's1', roll: 12 });
    expect(calls.map((c) => c.url)).toEqual([`${BOT}/api/internal/wq/who`, `${BOT}/api/internal/wq/who/fix`]);
  });

  it('forwards GET with its query string', async () => {
    await req(srv, 'GET', '/api/wq/board/AB12CD?st=abc');
    expect(calls[0].url).toBe(`${BOT}/api/internal/wq/board/AB12CD?st=abc`);
    expect(calls[0].opts.method).toBe('GET');
  });

  it('passes a bot 4xx through with its body (the page needs 409 maybe_you)', async () => {
    next = jsonRes(409, { error: 'maybe_you', candidates: [] });
    const res = await req(srv, 'POST', '/api/wq/session', { code: 'AB12CD', new: { name: 'Ali' } });
    expect(res.status).toBe(409);
    expect(JSON.parse(res.body).error).toBe('maybe_you');
  });

  it('maps a bot 5xx to 502 upstream_error and a network failure to 502 bot_unreachable', async () => {
    next = jsonRes(500, { error: 'boom', stack: 'secret' });
    let res = await req(srv, 'POST', '/api/wq/finish', { st: 'x' });
    expect(res.status).toBe(502);
    expect(JSON.parse(res.body)).toEqual({ error: 'upstream_error' });
    next = () => { throw new Error('ECONNREFUSED'); };
    res = await req(srv, 'POST', '/api/wq/finish', { st: 'x' });
    expect(res.status).toBe(502);
    expect(JSON.parse(res.body)).toEqual({ error: 'bot_unreachable' });
  });

  it('keeps 503 web_quiz_off as 503', async () => {
    next = jsonRes(503, { error: 'web_quiz_off' });
    const res = await req(srv, 'GET', '/api/wq/quiz/AB12CD');
    expect(res.status).toBe(503);
  });

  it('passes a media redirect through as a 302 without following it', async () => {
    next = { status: 302, ok: false, headers: { get: (h) => (h.toLowerCase() === 'location' ? 'https://r2.example/x.webp?sig=1' : null) }, text: async () => '' };
    const res = await req(srv, 'GET', '/api/wq/media/AB12CD/x1?k=q');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('https://r2.example/x.webp?sig=1');
    expect(calls[0].opts.redirect).toBe('manual');
  });

  it('refuses a body over the cap without calling the bot', async () => {
    const big = { events: [{ n: 'x', pad: 'a'.repeat(40000) }] };
    const res = await req(srv, 'POST', '/api/wq/e', big);
    expect(res.status).toBe(413);
    expect(calls).toHaveLength(0);
  });

  it('refuses unknown api paths without calling the bot', async () => {
    const res = await req(srv, 'POST', '/api/wq/admin/drop', {});
    expect(res.status).toBe(404);
    expect(calls).toHaveLength(0);
  });

  it('answers 503 when the bot url or key is not configured', async () => {
    const s2 = await start(build(async () => jsonRes(200, {}), { botUrl: '', apiKey: '' }));
    const res = await req(s2, 'GET', '/api/wq/quiz/AB12CD');
    await new Promise((r) => s2.close(r));
    expect(res.status).toBe(503);
  });
});

describe('web quiz edge: GET /q/:code server-side render', () => {
  let srv; let calls; let next;
  beforeEach(async () => {
    calls = [];
    next = jsonRes(200, QUIZ);
    srv = await start(build(async (url, opts) => { calls.push({ url, opts }); return next; }));
  });
  afterEach(() => new Promise((r) => srv.close(r)));

  it('injects the quiz payload as the boot script, safely escaped', async () => {
    const res = await req(srv, 'GET', '/q/ab12cd?p=tok', undefined, { host: 'portal.example' });
    expect(res.status).toBe(200);
    expect(calls[0].url).toBe(`${BOT}/api/internal/wq/quiz/AB12CD?p=tok`);
    expect(calls[0].opts.headers['x-api-key']).toBe(KEY);
    const m = res.body.match(/<script id="boot" type="application\/json">([\s\S]*?)<\/script>/);
    expect(m).not.toBeNull();
    expect(m[1]).not.toMatch(/<\/script/i);
    const boot = JSON.parse(m[1]);
    expect(boot.quiz.topic).toBe('Parts of a plant </script><b>');
    expect(boot.view).toBe('quiz');
    expect(boot.code).toBe('AB12CD');
  });

  it('sets OG tags, noindex and no-cache', async () => {
    const res = await req(srv, 'GET', '/q/AB12CD', undefined, { host: 'portal.example' });
    expect(res.body).toMatch(/<meta property="og:title" content="Parts of a plant &lt;\/script&gt;&lt;b&gt;[^"]*"/);
    expect(res.body).toMatch(/<meta property="og:description" content="[^"]+"/);
    expect(res.body).toMatch(/<meta property="og:image" content="http:\/\/portal\.example\/wq\/og\.jpg"/);
    expect(res.body).toMatch(/<meta name="robots" content="noindex, nofollow"/);
    expect(res.headers['x-robots-tag']).toMatch(/noindex/);
    expect(res.headers['cache-control']).toMatch(/no-cache/);
    expect(res.headers['content-type']).toMatch(/text\/html/);
  });

  it('renders the class league table view at /q/:code/class', async () => {
    const res = await req(srv, 'GET', '/q/AB12CD/class');
    const boot = JSON.parse(res.body.match(/<script id="boot" type="application\/json">([\s\S]*?)<\/script>/)[1]);
    expect(boot.view).toBe('class');
  });

  it('an expired code gets a friendly page in the quiz language, status 410', async () => {
    next = jsonRes(410, { error: 'expired', lang: 'ur' });
    const res = await req(srv, 'GET', '/q/AB12CD');
    expect(res.status).toBe(410);
    expect(res.body).toMatch(/dir="rtl"/);
    expect(res.body).toContain('یہ کوئز بند ہو چکا ہے');
    expect(res.body).not.toMatch(/id="boot"/);
  });

  it('an unknown code gets the friendly page in English, status 404', async () => {
    next = jsonRes(404, { error: 'not_found' });
    const res = await req(srv, 'GET', '/q/ZZZZZZ');
    expect(res.status).toBe(404);
    expect(res.body).toContain('This quiz has closed');
  });

  it('a bot 404 without the contract error (endpoint not deployed) is "not open", not "closed"', async () => {
    next = { status: 404, ok: false, headers: { get: () => 'text/html' }, text: async () => '<!DOCTYPE html><pre>Cannot GET</pre>' };
    const res = await req(srv, 'GET', '/q/AB12CD');
    expect(res.status).toBe(503);
    expect(res.body).toContain('The quiz is not open right now');
  });

  it('a malformed code never reaches the bot', async () => {
    const res = await req(srv, 'GET', '/q/..%2Fadmin');
    expect(res.status).toBe(404);
    expect(calls).toHaveLength(0);
  });

  it('renderQuizPage puts the page language and direction on <html>', () => {
    const html = renderQuizPage({ payload: { ...QUIZ, quiz: { ...QUIZ.quiz, lang: 'ur', dir: 'rtl' } }, code: 'AB12CD', view: 'quiz', origin: 'https://x', assetV: 'v1' });
    expect(html).toMatch(/<html lang="ur" dir="rtl">/);
    expect(html).toContain('/wq/wq.js?v=v1');
  });
});

describe('web quiz edge: rate limits', () => {
  it('limits finish to 10/min per session token, then 429 without calling the bot', async () => {
    const calls = [];
    const srv = await start(build(async (url) => { calls.push(url); return jsonRes(200, {}); }));
    const codes = [];
    for (let i = 0; i < 12; i++) codes.push((await req(srv, 'POST', '/api/wq/finish', { st: 'same-token' })).status);
    const other = await req(srv, 'POST', '/api/wq/finish', { st: 'other-token' });
    await new Promise((r) => srv.close(r));
    expect(codes.slice(0, 10).every((c) => c === 200)).toBe(true);
    expect(codes[10]).toBe(429);
    expect(calls).toHaveLength(11);
    expect(other.status).toBe(200);
  });

  it('counts only unknown codes toward the enumeration limit (20/min per ip)', async () => {
    let status = 404;
    const srv = await start(build(async () => jsonRes(status, { error: 'not_found' })));
    const codes = [];
    for (let i = 0; i < 21; i++) codes.push((await req(srv, 'GET', `/api/wq/quiz/ZZZZ${String(i).padStart(2, '0')}`)).status);
    expect(codes[19]).toBe(404);
    expect(codes[20]).toBe(429);
    await new Promise((r) => srv.close(r));
    status = 200;
    const srv2 = await start(build(async () => jsonRes(200, QUIZ)));
    const ok = [];
    for (let i = 0; i < 25; i++) ok.push((await req(srv2, 'GET', '/api/wq/quiz/AB12CD')).status);
    await new Promise((r) => srv2.close(r));
    expect(ok.every((c) => c === 200)).toBe(true);
  });
});

describe('web quiz edge: static and probe', () => {
  it('serves /wq/ assets with a long cache and /wq-probe as html', async () => {
    const srv = await start(build(async () => jsonRes(200, {})));
    const css = await req(srv, 'GET', '/wq/wq.css');
    const probe = await req(srv, 'GET', '/wq-probe');
    await new Promise((r) => srv.close(r));
    expect(css.status).toBe(200);
    expect(css.headers['cache-control']).toMatch(/max-age=31536000/);
    expect(probe.status).toBe(200);
    expect(probe.body).toContain('/api/wq/e');
    expect(probe.headers['x-robots-tag']).toMatch(/noindex/);
  });
});
