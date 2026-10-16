/**
 * Storybooks on the edge: /api/wq/stories/* forwarded to the bot's /api/internal/wq/stories/* with the phone's
 * device (the bot decides everything, including 404 stories_off with the switch off); a malformed token or a page
 * the edge does not know never reaches the bot. Invented tokens only.
 */
const http = require('http');
const express = require('express');
const { createWebQuizRouter } = require('../routes/web-quiz.routes');

const BOT = 'http://bot.test';
const KEY = 'test-internal-key';
const TOKEN = 'eyJrIjoiaCIsImlkcyI6WyJhIl0sImV4cCI6OTk5OTk5OTk5OX0.AbCdEfGhIjKlMnOpQrStUv';
const BOOK = '5b000001-0000-4000-8000-000000000000';

describe('/api/wq/stories/*', () => {
  let srv; let calls; let answer;
  function call(method, p, { headers = {}, body } = {}) {
    return new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: srv.address().port, path: p, method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers } }, (res) => {
        let out = ''; res.on('data', (c) => { out += c; }); res.on('end', () => resolve({ status: res.statusCode, body: out, cache: res.headers['cache-control'] }));
      });
      req.on('error', reject);
      if (body) req.write(JSON.stringify(body));
      req.end();
    });
  }
  beforeEach(async () => {
    calls = [];
    answer = { status: 200, body: { ok: true } };
    const app = express();
    app.use(createWebQuizRouter({ botUrl: BOT, apiKey: KEY, fetchImpl: async (url, opts) => { calls.push({ url, opts }); return { status: answer.status, ok: answer.status < 400, headers: { get: () => 'application/json' }, text: async () => JSON.stringify(answer.body) }; } }));
    await new Promise((r) => { srv = app.listen(0, r); });
  });
  afterEach(() => new Promise((r) => srv.close(r)));

  test('the shelf: forwarded with its query and the phone\'s device, never cached', async () => {
    const r = await call('GET', `/api/wq/stories/shelf/h/${TOKEN}?kid=0123456789abcdef&g=2&l=ur`, { headers: { cookie: 'wq_dv=AAAAAAAAAAAAAAAAAAAAAA' } });
    expect(r.status).toBe(200);
    expect(r.cache).toBe('no-store');
    expect(calls[0].url).toBe(`${BOT}/api/internal/wq/stories/shelf/h/${TOKEN}?kid=0123456789abcdef&g=2&l=ur`);
    expect(calls[0].opts.headers['x-wq-device']).toBe('AAAAAAAAAAAAAAAAAAAAAA');
  });
  test('the book: forwarded', async () => {
    const r = await call('GET', `/api/wq/stories/book/${BOOK}/h/${TOKEN}?kid=0123456789abcdef`);
    expect(r.status).toBe(200);
    expect(calls[0].url).toBe(`${BOT}/api/internal/wq/stories/book/${BOOK}/h/${TOKEN}?kid=0123456789abcdef`);
  });
  test('an event: POSTed with its body', async () => {
    const r = await call('POST', `/api/wq/stories/event/h/${TOKEN}`, { body: { kid: '0123456789abcdef', book_id: BOOK, event: 'story_opened', data: { shelf_position: 2 } } });
    expect(r.status).toBe(200);
    expect(calls[0].url).toBe(`${BOT}/api/internal/wq/stories/event/h/${TOKEN}`);
    expect(calls[0].opts.method).toBe('POST');
    expect(JSON.parse(calls[0].opts.body)).toEqual({ kid: '0123456789abcdef', book_id: BOOK, event: 'story_opened', data: { shelf_position: 2 } });
  });
  test('the switch off (the bot\'s 404 stories_off) reaches the page as it is', async () => {
    answer = { status: 404, body: { error: 'stories_off' } };
    const r = await call('GET', `/api/wq/stories/shelf/h/${TOKEN}`);
    expect(r.status).toBe(404);
    expect(JSON.parse(r.body)).toEqual({ error: 'stories_off' });
  });
  test('a malformed token never reaches the bot', async () => {
    const r = await call('GET', '/api/wq/stories/shelf/h/not-a-token');
    expect(r.status).toBe(404);
    expect(calls).toHaveLength(0);
  });
});
