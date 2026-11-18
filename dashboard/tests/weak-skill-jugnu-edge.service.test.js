/**
 * bd-ptl6x9.7 — the teacher report edge for the weak-skill Jugnu nudge's button: GET /r/:token/sfwd reaches the
 * bot's /sfwd route with class, ex and lang; its 302 to wa.me passes through, any other location is refused; the
 * bot's 404 (switch off, not her list) stays a 404; an ex outside the three games is dropped before the bot.
 */
const http = require('http');
const express = require('express');
const { createTeacherReportRouter } = require('../routes/teacher-report.routes');

const BOT = 'http://bot.test';
const TOK = 'eyJrIjoidHIifQ.AAAAAAAAAAAAAAAAAAAAAA';
const LIST = 'a0000000-0000-4000-8000-00000000003b';

const botRes = (status, location = null) => ({
  status, ok: status < 300, headers: { get: (h) => ({ 'content-type': 'text/html', location }[h.toLowerCase()] || null) },
  text: async () => '', arrayBuffer: async () => new ArrayBuffer(0),
});
const get = (srv, path) => new Promise((resolve, reject) => {
  http.get({ host: '127.0.0.1', port: srv.address().port, path }, (res) => { res.resume(); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers })); }).on('error', reject);
});

let srv;
let calls;
async function boot(answer) {
  calls = [];
  const app = express();
  app.use(createTeacherReportRouter({ botUrl: BOT, apiKey: 'k', fetchImpl: async (url) => { calls.push(url); return answer(url); } }));
  srv = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
}
afterEach(() => new Promise((r) => (srv ? srv.close(r) : r())));

test('the bot\'s 302 to wa.me passes through, with class, ex and lang forwarded', async () => {
  await boot(() => botRes(302, 'https://wa.me/?text=play'));
  const res = await get(srv, `/r/${TOK}/sfwd?class=${LIST}&ex=missing&lang=ur`);
  expect(res.status).toBe(302);
  expect(res.headers.location).toBe('https://wa.me/?text=play');
  expect(calls[0]).toMatch(new RegExp(`^${BOT}/api/internal/tr/sfwd/${TOK}\\?`));
  expect(calls[0]).toMatch(/[?&]ex=missing(&|$)/);
  expect(calls[0]).toMatch(new RegExp(`[?&]class=${LIST}`));
});

test('any other location is refused', async () => {
  await boot(() => botRes(302, 'https://evil.test/'));
  expect((await get(srv, `/r/${TOK}/sfwd?class=${LIST}&ex=missing`)).status).toBe(502);
});

test('the bot\'s 404 stays a 404', async () => {
  await boot(() => botRes(404));
  expect((await get(srv, `/r/${TOK}/sfwd?class=${LIST}&ex=missing`)).status).toBe(404);
});

test('an ex outside the three games never reaches the bot', async () => {
  await boot(() => botRes(404));
  await get(srv, `/r/${TOK}/sfwd?class=${LIST}&ex=read`);
  expect(calls[0]).not.toMatch(/ex=/);
});
