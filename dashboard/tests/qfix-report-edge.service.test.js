/**
 * bd-5j1zaf — the report's public edge (GET /r/:token) forwards ?from= to the bot when it is exactly home | wa | list
 * (where the open came from: the teacher home's "See report", the 12 h WhatsApp report, the quiz list's link), so the
 * bot's teacher_report.opened can carry it. Anything else is dropped, like every other key the bot does not read.
 * The bot is the network boundary: a fake fetch records the path the edge called and plays back a page.
 */
const http = require('http');
const express = require('express');
const { createTeacherReportRouter } = require('../routes/teacher-report.routes');

const BOT = 'http://bot.test';
const TOK = 'eyJrIjoidHIifQ.AAAAAAAAAAAAAAAAAAAAAA';

const botRes = () => {
  const h = { 'content-type': 'text/html; charset=utf-8' };
  const body = '<p>report</p>';
  return {
    status: 200, ok: true,
    headers: { get: (k) => (h[k.toLowerCase()] != null ? h[k.toLowerCase()] : null) },
    text: async () => body,
    arrayBuffer: async () => { const b = Buffer.from(body); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); },
  };
};

let srv;
let called;
async function boot() {
  called = [];
  const app = express();
  app.use(createTeacherReportRouter({ botUrl: BOT, apiKey: 'k', fetchImpl: async (url) => { called.push(String(url)); return botRes(); } }));
  srv = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
}
afterEach(() => new Promise((r) => (srv ? srv.close(r) : r())));
function get(path) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: srv.address().port, path, method: 'GET' }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
    });
    r.on('error', reject);
    r.end();
  });
}

test.each(['home', 'wa', 'list', 'class'])('from=%s reaches the bot on the page call', async (from) => {
  await boot();
  const res = await get(`/r/${TOK}?from=${from}&lang=ur`);
  expect(res.status).toBe(200);
  expect(called).toHaveLength(1);
  expect(called[0]).toBe(`${BOT}/api/internal/tr/page/${TOK}?lang=ur&from=${from}`);
});

test('from=evil (or HOME, or twice, or empty) is dropped; the other keys still go', async () => {
  await boot();
  for (const q of ['from=evil', 'from=HOME', 'from=home&from=wa', 'from=', 'from=home%0d%0a']) {
    called = [];
    await get(`/r/${TOK}?${q}&tab=class`);
    expect(called).toEqual([`${BOT}/api/internal/tr/page/${TOK}?tab=class`]);
  }
});

test('no from: the bot call is today\'s', async () => {
  await boot();
  await get(`/r/${TOK}?lang=en`);
  expect(called).toEqual([`${BOT}/api/internal/tr/page/${TOK}?lang=en`]);
});
