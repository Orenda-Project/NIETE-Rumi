/**
 * One origin for one child: a child-facing page asked for on a host that is not
 * the web quiz's canonical host answers 301 to the same path and query there.
 *
 * The remembered child (localStorage) lives per origin, so a link minted on the
 * platform's default domain and one minted on the custom domain made the same
 * child a stranger on one of them. The canonical host is WEB_QUIZ_BASE_URL, the
 * variable the bot mints child links from; unset means no redirect at all.
 *
 * The real router runs on an ephemeral port; the bot is the network boundary (a fake fetch).
 */
const http = require('http');
const express = require('express');
const { createWebQuizRouter } = require('../routes/web-quiz.routes');

const BOT = 'http://bot.test';
const KEY = 'test-internal-key';
const CANON = 'https://kids.example.test';
const OTHER = 'portal-default.example.test';

function jsonRes(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) },
    text: async () => JSON.stringify(body),
  };
}

function req(srv, method, path, host, body) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const r = http.request({ host: '127.0.0.1', port: srv.address().port, method, path,
      headers: { host, ...(data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}) } }, (res) => {
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
async function boot(extra = {}) {
  calls = [];
  const app = express();
  app.set('trust proxy', 1);
  app.use(createWebQuizRouter({ botUrl: BOT, apiKey: KEY, fetchImpl: async (url) => { calls.push(url); return jsonRes(404, { error: 'not_found' }); }, ...extra }));
  app.get('/r/:token', (r, res) => res.status(200).send('teacher report'));
  app.get('/health', (r, res) => res.status(200).send('ok'));
  app.use((r, res) => res.status(418).send('fell through'));
  srv = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
}
afterEach(() => new Promise((r) => (srv ? srv.close(r) : r())));

describe('child pages on a non-canonical host -> 301 to the canonical host', () => {
  beforeEach(() => boot({ canonicalBase: CANON }));

  test.each([
    '/q/ABC234?k=0123456789abcdef&lang=ur',
    '/q/ABC234',
    '/q/ABC234/class',
    '/q/ABC234/schools?x=1',
    '/h/abcdefghijklmnop',
    '/c/sometoken123?kid=0123456789abcdef',
    '/lib/sometoken123?g=3&s=science',
  ])('%s keeps its path and query, never reaches the bot', async (path) => {
    const res = await req(srv, 'GET', path, OTHER);
    expect(res.status).toBe(301);
    expect(res.headers.location).toBe(`${CANON}${path}`);
    expect(calls).toEqual([]);
  });

  test('HEAD redirects too (link previews ask with HEAD)', async () => {
    const res = await req(srv, 'HEAD', '/q/ABC234', OTHER);
    expect(res.status).toBe(301);
    expect(res.headers.location).toBe(`${CANON}/q/ABC234`);
  });

  test('on the canonical host (any case, with or without a port): served as today', async () => {
    for (const host of ['kids.example.test', 'KIDS.example.test', 'kids.example.test:443']) {
      const res = await req(srv, 'GET', '/q/ABC234', host);
      expect(res.status).not.toBe(301);
    }
    expect(calls.length).toBe(3);
  });

  test('never: /api/wq/*, the teacher report /r/*, /health, the share pictures, the page assets', async () => {
    const api = await req(srv, 'POST', '/api/wq/e', OTHER, { events: [] });
    expect(api.status).not.toBe(301);
    const apiGet = await req(srv, 'GET', '/api/wq/quiz/ABC234', OTHER);
    expect(apiGet.status).not.toBe(301);
    expect((await req(srv, 'GET', '/r/sometoken', OTHER)).status).toBe(200);
    expect((await req(srv, 'GET', '/health', OTHER)).status).toBe(200);
    expect((await req(srv, 'GET', '/q/ABC234/art/card.jpg?a=x', OTHER)).status).not.toBe(301);
    expect((await req(srv, 'GET', '/wq/wq.js', OTHER)).status).not.toBe(301);
    expect((await req(srv, 'GET', '/quizzes', OTHER)).status).toBe(418);
  });
});

describe('the canonical host comes from WEB_QUIZ_BASE_URL', () => {
  const saved = process.env.WEB_QUIZ_BASE_URL;
  afterEach(() => { if (saved === undefined) delete process.env.WEB_QUIZ_BASE_URL; else process.env.WEB_QUIZ_BASE_URL = saved; });

  test('set: a non-canonical host is redirected there', async () => {
    process.env.WEB_QUIZ_BASE_URL = `${CANON}/`;
    await boot();
    const res = await req(srv, 'GET', '/q/ABC234?k=0123456789abcdef', OTHER);
    expect(res.status).toBe(301);
    expect(res.headers.location).toBe(`${CANON}/q/ABC234?k=0123456789abcdef`);
  });

  test('unset or not a URL: nothing redirects (today\'s behaviour)', async () => {
    for (const v of [undefined, '', 'not a url']) {
      if (v === undefined) delete process.env.WEB_QUIZ_BASE_URL; else process.env.WEB_QUIZ_BASE_URL = v;
      await boot();
      const res = await req(srv, 'GET', '/q/ABC234', OTHER);
      expect(res.status).not.toBe(301);
      await new Promise((r) => srv.close(r)); srv = null;
    }
  });
});
