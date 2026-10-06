/**
 * Web quiz edge: the video library's routes (/api/wq/lib/*, /api/wq/videos/dl/*) and the
 * library script on the quiz page.
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


describe('web quiz edge: the library', () => {
  let srv; let calls; let next;
  beforeEach(async () => {
    calls = [];
    next = jsonRes(200, { grade: '3', subjects: [] });
    srv = await start(build(async (url, opts) => { calls.push({ url, opts }); return next; }));
  });
  afterEach(() => new Promise((r) => srv.close(r)));

  it('forwards the library from a quiz and from the hub, with the query', async () => {
    const a = await req(srv, 'GET', '/api/wq/lib/AB12CD?st=abc&s=Maths');
    expect(a.status).toBe(200);
    expect(JSON.parse(a.body)).toEqual({ grade: '3', subjects: [] });
    await req(srv, 'GET', '/api/wq/lib/h/eyJrIjoiaCJ9.abcdefghij_KLMNOPQR-12?kid=c1');
    expect(calls.map((c) => c.url)).toEqual([
      `${BOT}/api/internal/wq/lib/AB12CD?st=abc&s=Maths`,
      `${BOT}/api/internal/wq/lib/h/eyJrIjoiaCJ9.abcdefghij_KLMNOPQR-12?kid=c1`,
    ]);
    expect(calls[0].opts.method).toBe('GET');
  });

  it('a hub token that is not token-shaped never reaches the bot', async () => {
    const res = await req(srv, 'GET', '/api/wq/lib/h/%3Cscript%3E');
    expect(res.status).toBe(404);
    expect(calls).toHaveLength(0);
  });

  it('Download: the bot\'s 302 to the attachment link passes through unfollowed', async () => {
    next = { status: 302, ok: false, headers: { get: (h) => (h.toLowerCase() === 'location' ? 'https://r2.example/v_web.mp4?X-Amz-Signature=1' : null) }, text: async () => '' };
    const res = await req(srv, 'GET', '/api/wq/videos/dl/AB12CD?st=abc&vid=aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('https://r2.example/v_web.mp4?X-Amz-Signature=1');
    expect(calls[0].url).toBe(`${BOT}/api/internal/wq/videos/dl/AB12CD?st=abc&vid=aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaaa`);
  });

  it('the quiz page loads the library script before wq.js, both versioned', () => {
    const html = renderQuizPage({ payload: QUIZ, code: 'AB12CD', view: 'quiz', origin: 'https://x', assetV: 'v1' });
    const lib = html.indexOf('<script src="/wq/wq-lib.js?v=v1" defer></script>');
    const wq = html.indexOf('<script src="/wq/wq.js?v=v1" defer></script>');
    expect(lib).toBeGreaterThan(0);
    expect(wq).toBeGreaterThan(lib);
  });
});
