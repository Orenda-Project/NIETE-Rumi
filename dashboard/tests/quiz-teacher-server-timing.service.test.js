/**
 * The teacher home's public edge passes the bot's Server-Timing header on, verbatim, on the home's and the library's JSON
 * only (/api/th/home, /api/th/library); a bot answer without one → no such header and today's headers. The real bot
 * client (createBotClient) runs over an injected fetch, so the header is read where the bot's answer arrives.
 */
const http = require('http');
const express = require('express');
const { createQuizTeacherRouter } = require('../routes/quiz-teacher.routes');

const TOK = `eyJrIjoidGgifQ.${'A'.repeat(22)}`;
const UUID = 'a0000000-0000-4000-8000-000000000001';
const SPA = '<!doctype html><title>SPA</title>';
const BODY = '{"a":1}';
const TIMING = 'settings;dur=1.5, db;dur=20.2, total;dur=23.0';

let srv;
async function boot(headers) {
  const fetchImpl = async () => new Response(BODY, { status: 200, headers: { 'content-type': 'application/json; charset=utf-8', ...headers } });
  const app = express();
  app.use(createQuizTeacherRouter({ botUrl: 'http://bot.invalid', apiKey: 'unit-key', fetchImpl }));
  app.use((req, res) => res.status(200).type('html').send(SPA));
  srv = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
}
afterEach(() => new Promise((r) => (srv ? srv.close(r) : r())));

function get(path) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: srv.address().port, path, agent: false }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    }).on('error', reject);
  });
}
const stable = (h) => { const o = { ...h }; ['date', 'etag', 'connection', 'keep-alive'].forEach((k) => delete o[k]); return o; };
// today's edge headers for a 200 JSON answer of the bot
const TODAY = {
  'x-powered-by': 'Express', 'cache-control': 'private, no-store', 'x-robots-tag': 'noindex, nofollow', 'referrer-policy': 'no-referrer',
  'content-type': 'application/json; charset=utf-8', 'content-length': String(BODY.length),
};

describe('the bot sent Server-Timing', () => {
  test.each(['/api/th/home', '/api/th/library'])('%s: passed on verbatim, the body unchanged', async (p) => {
    await boot({ 'server-timing': TIMING });
    const res = await get(`${p}?t=${TOK}&g=2`);
    expect(res.status).toBe(200);
    expect(res.headers['server-timing']).toBe(TIMING);
    expect(res.body).toBe(BODY);
    expect(stable(res.headers)).toEqual({ ...TODAY, 'server-timing': TIMING });
  });

  test('never on another route (the poll, the page)', async () => {
    await boot({ 'server-timing': TIMING });
    for (const p of [`/api/th/quiz/${UUID}?t=${TOK}`, `/quiz/teacher/${TOK}`]) {
      const res = await get(p);
      expect(res.status).toBe(200);
      expect(res.headers['server-timing']).toBeUndefined();
    }
  });
});

describe('the bot sent none', () => {
  test.each(['/api/th/home', '/api/th/library'])('%s: no Server-Timing; today\'s headers', async (p) => {
    await boot({});
    const res = await get(`${p}?t=${TOK}&g=2`);
    expect(res.status).toBe(200);
    expect(res.headers['server-timing']).toBeUndefined();
    expect(res.body).toBe(BODY);
    expect(stable(res.headers)).toEqual(TODAY);
  });
});
