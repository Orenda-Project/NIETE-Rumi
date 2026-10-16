/**
 * The teacher report's timing headers at the edge (GET /r/:token): when the bot's page answer carries x-render-ms and
 * x-queue-age (it does only with web_quiz_events_v2 on), the edge passes them back to the phone and adds x-edge-ms,
 * its own time from the request to the send. Without them the edge's answer is today's: no timing header at all.
 * The bot is the network boundary: a fake fetch plays back its answer. No first-party module is mocked.
 */
const http = require('http');
const express = require('express');
const { createTeacherReportRouter } = require('../routes/teacher-report.routes');

const BOT = 'http://bot.test';
const TOK = 'eyJrIjoidHIifQ.AAAAAAAAAAAAAAAAAAAAAA';

const botRes = (status, extra = {}, body = '<p>report</p>') => {
  const h = { 'content-type': 'text/html; charset=utf-8', ...extra };
  return {
    status, ok: status >= 200 && status < 300,
    headers: { get: (k) => (h[k.toLowerCase()] != null ? h[k.toLowerCase()] : null) },
    text: async () => body,
    arrayBuffer: async () => { const b = Buffer.from(body); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); },
  };
};

let srv;
async function boot(answer) {
  const app = express();
  app.use(createTeacherReportRouter({ botUrl: BOT, apiKey: 'k', fetchImpl: async () => answer() }));
  srv = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
}
afterEach(() => new Promise((r) => (srv ? srv.close(r) : r())));
function get(path) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: srv.address().port, path, method: 'GET' }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    });
    r.on('error', reject);
    r.end();
  });
}

test('the bot\'s x-render-ms and x-queue-age come back to the phone, with the edge\'s own x-edge-ms', async () => {
  await boot(() => botRes(200, { 'x-render-ms': '412', 'x-queue-age': '86401' }));
  const res = await get(`/r/${TOK}?tab=jugnu`);
  expect(res.status).toBe(200);
  expect(res.body).toBe('<p>report</p>');
  expect(res.headers['x-render-ms']).toBe('412');
  expect(res.headers['x-queue-age']).toBe('86401');
  expect(res.headers['x-edge-ms']).toMatch(/^\d{1,7}$/);
});

test('no kept queue: x-render-ms and x-edge-ms only', async () => {
  await boot(() => botRes(200, { 'x-render-ms': '9' }));
  const res = await get(`/r/${TOK}`);
  expect(res.headers['x-render-ms']).toBe('9');
  expect(res.headers).not.toHaveProperty('x-queue-age');
  expect(res.headers['x-edge-ms']).toMatch(/^\d{1,7}$/);
});

test('golden: the bot sends no timing (events v2 off) -> the edge adds none; the page is byte-identical', async () => {
  await boot(() => botRes(200));
  const res = await get(`/r/${TOK}?tab=class`);
  expect(res.status).toBe(200);
  expect(res.body).toBe('<p>report</p>');
  for (const h of ['x-render-ms', 'x-queue-age', 'x-edge-ms']) expect(res.headers).not.toHaveProperty(h);
});

test('a value that is not a whole number of ms/s is dropped, never echoed', async () => {
  await boot(() => botRes(200, { 'x-render-ms': '12abc', 'x-queue-age': '-1' }));
  const res = await get(`/r/${TOK}`);
  for (const h of ['x-render-ms', 'x-queue-age', 'x-edge-ms']) expect(res.headers).not.toHaveProperty(h);
});

test('only the report page passes them: the PDF and an error answer carry none', async () => {
  await boot(() => botRes(200, { 'content-type': 'application/pdf', 'x-render-ms': '50' }, '%PDF'));
  const pdf = await get(`/r/${TOK}/pdf`);
  expect(pdf.status).toBe(200);
  for (const h of ['x-render-ms', 'x-edge-ms']) expect(pdf.headers).not.toHaveProperty(h);
  srv.close(); srv = null;
  await boot(() => botRes(500, { 'x-render-ms': '50' }));
  const bad = await get(`/r/${TOK}`);
  expect(bad.status).toBe(502);
  for (const h of ['x-render-ms', 'x-edge-ms']) expect(bad.headers).not.toHaveProperty(h);
});
