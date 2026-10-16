/**
 * The teacher report edge for the class week card's forward (bot switch web_quiz_class_week): GET /r/:token/wfwd
 * reaches the bot's /wfwd route, its 302 to wa.me passes through, anything else is refused, and the bot's 404
 * (switch off, class not drawn, outside the window) stays a 404. The bot is the network boundary (a fake fetch).
 */
const http = require('http');
const express = require('express');
const { createTeacherReportRouter } = require('../routes/teacher-report.routes');

const BOT = 'http://bot.test';
const KEY = 'test-internal-key';
const TOK = 'eyJrIjoidHIifQ.AAAAAAAAAAAAAAAAAAAAAA';

function botRes(status, { body = '', type = 'text/html; charset=utf-8', location = null, bytes = null } = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (h) => ({ 'content-type': type, location }[h.toLowerCase()] || null) },
    text: async () => body,
    arrayBuffer: async () => { const b = bytes || Buffer.from(body); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); },
  };
}

function start(app) {
  return new Promise((resolve) => { const srv = app.listen(0, () => resolve(srv)); });
}
function get(srv, path, headers = {}) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: srv.address().port, path, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    }).on('error', reject);
  });
}

let srv;
let calls;
async function boot(answer, opts = {}) {
  calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return answer(url, init); };
  const app = express();
  app.set('trust proxy', true);
  app.use(createTeacherReportRouter({ botUrl: BOT, apiKey: KEY, fetchImpl, ...opts }));
  srv = await start(app);
}
afterEach(() => new Promise((r) => (srv ? srv.close(r) : r())));

const LIST = 'a0000000-0000-4000-8000-00000000003b';

test('GET /r/:token/wfwd passes the bot\'s 302 to wa.me through; another location is refused', async () => {
  await boot(() => botRes(302, { location: 'https://wa.me/?text=Open%20our%20class%20link' }));
  const res = await get(srv, `/r/${TOK}/wfwd?class=${LIST}&lang=ur`);
  expect(res.status).toBe(302);
  expect(res.headers.location).toBe('https://wa.me/?text=Open%20our%20class%20link');
  expect(calls[0].url).toBe(`${BOT}/api/internal/tr/wfwd/${TOK}?lang=ur&class=${LIST}`);
  await new Promise((r) => srv.close(r));
  await boot(() => botRes(302, { location: 'https://evil.test/' }));
  expect((await get(srv, `/r/${TOK}/wfwd?class=${LIST}`)).status).toBe(502);
});

test('GET /r/:token/wfwd: the bot\'s 404 (off, not drawn, outside the window) stays a 404', async () => {
  await boot(() => botRes(404, { body: '<html>missing</html>' }));
  expect((await get(srv, `/r/${TOK}/wfwd?class=${LIST}`)).status).toBe(404);
});
