/**
 * Web quiz edge (portal): one log line for every portal -> bot call that fails or is slow.
 *
 * A child's tap that the bot cannot answer in time comes back as a 502 "bot_unreachable",
 * and until now the portal kept no record of it: the client's catch dropped the error and
 * the quiz router is mounted ahead of the request logger. These tests drive the real
 * router over HTTP with the bot faked at the fetch boundary, and assert on the line
 * (web_quiz.bot_call) the edge logs: which bot route, how long, and why it failed.
 * No first-party module is mocked.
 */
const http = require('http');
const express = require('express');
const { createWebQuizRouter, createBotClient } = require('../routes/web-quiz.routes');

const BOT = 'http://bot.test';
const KEY = 'test-internal-key';
const HUB_TOKEN = `${'a'.repeat(40)}.${'b'.repeat(22)}`;

function jsonRes(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) },
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  };
}

// A bot that never answers: the request ends only when the edge aborts it.
function hangingFetch() {
  return (url, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener('abort', () => {
      const e = new Error('This operation was aborted');
      e.name = 'AbortError';
      reject(e);
    });
  });
}

function start(app) {
  return new Promise((resolve) => { const srv = app.listen(0, () => resolve(srv)); });
}

function req(srv, method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const r = http.request({ host: '127.0.0.1', port: srv.address().port, method, path,
      headers: data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {} }, (res) => {
      let out = '';
      res.on('data', (c) => { out += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: out }));
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

function build(fetchImpl, extra = {}) {
  const logged = [];
  const app = express();
  app.set('trust proxy', 1);
  app.use(createWebQuizRouter({ botUrl: BOT, apiKey: KEY, fetchImpl, logEvent: (e, p) => logged.push([e, p]), ...extra }));
  return { app, logged };
}

const botCalls = (logged) => logged.filter(([e]) => e === 'web_quiz.bot_call').map(([, p]) => p);

describe('web quiz edge: a failed or slow bot call is logged', () => {
  let srv;
  afterEach(() => new Promise((r) => (srv ? srv.close(r) : r())));

  test('a bot that does not answer in time: 502 bot_unreachable and a timeout line', async () => {
    const { app, logged } = build(hangingFetch(), { botTimeoutMs: 50 });
    srv = await start(app);
    const res = await req(srv, 'POST', '/api/wq/session', { code: 'AB12CD', new: { name: 'Ali' } });
    expect(res.status).toBe(502);
    expect(JSON.parse(res.body)).toEqual({ error: 'bot_unreachable' });
    const calls = botCalls(logged);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ route: '/api/internal/wq/session', method: 'POST', outcome: 'timeout' });
    expect(calls[0].ms).toBeGreaterThanOrEqual(40);
  });

  test('a connection error is logged with its cause code', async () => {
    const fetchImpl = async () => {
      const e = new TypeError('fetch failed');
      e.cause = { code: 'ECONNRESET' };
      throw e;
    };
    const { app, logged } = build(fetchImpl);
    srv = await start(app);
    const res = await req(srv, 'GET', '/api/wq/board/AB12CD');
    expect(res.status).toBe(502);
    expect(botCalls(logged)).toEqual([expect.objectContaining({ route: '/api/internal/wq/board/:code', method: 'GET', outcome: 'error', cause: 'ECONNRESET' })]);
  });

  test('a bot 5xx is logged as upstream_5xx with its status', async () => {
    const { app, logged } = build(async () => jsonRes(500, { error: 'boom' }));
    srv = await start(app);
    const res = await req(srv, 'POST', '/api/wq/session', { code: 'AB12CD', new: { name: 'Ali' } });
    expect(res.status).toBe(502);
    expect(botCalls(logged)).toEqual([expect.objectContaining({ route: '/api/internal/wq/session', outcome: 'upstream_5xx', status: 500 })]);
  });

  test('a call that answers but takes 3 s or more is logged as slow; a quick one is not logged', async () => {
    let t = 1000000;
    const now = () => t;
    const slowFetch = async (url) => {
      if (url.includes('/session')) t += 3500;
      else t += 120;
      return jsonRes(200, { st: 'x' });
    };
    const { app, logged } = build(slowFetch, { now });
    srv = await start(app);
    expect((await req(srv, 'POST', '/api/wq/session', { code: 'AB12CD', new: { name: 'Ali' } })).status).toBe(200);
    expect((await req(srv, 'GET', '/api/wq/board/AB12CD')).status).toBe(200);
    expect(botCalls(logged)).toEqual([expect.objectContaining({ route: '/api/internal/wq/session', outcome: 'slow', status: 200, ms: 3500 })]);
  });

  test('a token in the path is never logged: the route is the template (:token)', async () => {
    const { app, logged } = build(hangingFetch(), { botTimeoutMs: 30 });
    srv = await start(app);
    await req(srv, 'GET', `/api/wq/hub/${HUB_TOKEN}`);
    const calls = botCalls(logged);
    expect(calls).toHaveLength(1);
    expect(calls[0].route).toBe('/api/internal/wq/hub/:token');
    expect(JSON.stringify(logged)).not.toContain(HUB_TOKEN);
  });

  test('the shared client (also used by the teacher report) logs through its own sink', async () => {
    const logged = [];
    const callBot = createBotClient({ botUrl: BOT, apiKey: KEY, fetchImpl: async () => jsonRes(500, {}), logEvent: (e, p) => logged.push([e, p]) });
    const out = await callBot('GET', '/api/internal/tr/page/sometoken123?x=1', { get: () => null, ip: '1.2.3.4' });
    expect(out.status).toBe(500);
    expect(botCalls(logged)).toEqual([expect.objectContaining({ route: '/api/internal/tr/page/:x', outcome: 'upstream_5xx', status: 500 })]);
    expect(JSON.stringify(logged)).not.toContain('sometoken123');
  });

  test('a 503 (the web quiz switched off) is a normal answer, not logged', async () => {
    const { app, logged } = build(async () => jsonRes(503, { error: 'web_quiz_off' }));
    srv = await start(app);
    expect((await req(srv, 'POST', '/api/wq/session', { code: 'AB12CD', new: { name: 'Ali' } })).status).toBe(503);
    expect(botCalls(logged)).toEqual([]);
  });
});
