/**
 * The teacher report edge for the Jugnu tab (bot switch web_quiz_teacher_jugnu): ?tab=jugnu reaches the bot
 * (which ignores it while the switch is off — the bot's golden test proves the page byte-identical), the
 * forward link's 302 to wa.me passes through, and the confirm queue's no-JS form becomes JSON with its
 * known fields only. The bot is the network boundary (a fake fetch); no first-party module is mocked.
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

function postForm(srv, path, form) {
  return new Promise((resolve, reject) => {
    const data = new URLSearchParams(form).toString();
    const r = http.request({ host: '127.0.0.1', port: srv.address().port, method: 'POST', path,
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'content-length': Buffer.byteLength(data) } }, (res) => {
      res.resume();
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers }));
    });
    r.on('error', reject);
    r.end(data);
  });
}


const LIST = 'a0000000-0000-4000-8000-00000000003b';
const LOOSE = 'd0000000-0000-4000-8000-000000000001';
const KID = 'b0000000-0000-4000-8000-000000000003';

test('GET /r/:token?tab=jugnu&class= reaches the bot page route with tab=jugnu', async () => {
  await boot(() => botRes(200, { body: '<html>tab</html>' }));
  await get(srv, `/r/${TOK}?tab=jugnu&class=${LIST}&lang=ur`);
  expect(calls[0].url).toBe(`${BOT}/api/internal/tr/page/${TOK}?lang=ur&tab=jugnu&class=${LIST}`);
  await get(srv, `/r/${TOK}?tab=nope`);
  expect(calls[1].url).toBe(`${BOT}/api/internal/tr/page/${TOK}`);
});

test('GET /r/:token/fwd passes the bot\'s 302 to wa.me through; anything else is refused', async () => {
  await boot(() => botRes(302, { location: 'https://wa.me/?text=This%20week' }));
  const res = await get(srv, `/r/${TOK}/fwd?class=${LIST}&lang=en`);
  expect(res.status).toBe(302);
  expect(res.headers.location).toBe('https://wa.me/?text=This%20week');
  expect(calls[0].url).toBe(`${BOT}/api/internal/tr/fwd/${TOK}?lang=en&class=${LIST}`);
  await new Promise((r) => srv.close(r));
  await boot(() => botRes(302, { location: 'https://evil.test/' }));
  expect((await get(srv, `/r/${TOK}/fwd?class=${LIST}`)).status).toBe(502);
});

test('GET /r/:token/fwd: the bot\'s 404 (switch off, no story) stays a 404', async () => {
  await boot(() => botRes(404, { body: '<html>missing</html>' }));
  expect((await get(srv, `/r/${TOK}/fwd?class=${LIST}`)).status).toBe(404);
});

test('POST /r/:token/queue: the form becomes JSON with the pair, the decision and the class only; the 303 back passes', async () => {
  await boot(() => botRes(303, { location: `/r/${TOK}?tab=jugnu&class=${LIST}` }));
  const res = await postForm(srv, `/r/${TOK}/queue`, { loose_id: LOOSE, candidate_id: KID, decision: 'same', class: LIST, phone: '+920000000000' });
  expect(res.status).toBe(303);
  expect(res.headers.location).toBe(`/r/${TOK}?tab=jugnu&class=${LIST}`);
  expect(calls[0].url).toBe(`${BOT}/api/internal/tr/queue/${TOK}`);
  expect(JSON.parse(calls[0].init.body)).toEqual({ loose_id: LOOSE, candidate_id: KID, decision: 'same', class: LIST });
  await postForm(srv, `/r/${TOK}/queue`, { loose_id: 'x', candidate_id: KID, decision: 'merge', class: LIST });
  expect(JSON.parse(calls[1].init.body)).toEqual({ candidate_id: KID, class: LIST });
});

test('POST /r/:token/unbind ("Saved on WhatsApp ✓ · Undo"): the binding id and the class only reach the bot; the 303 back passes', async () => {
  const BIND = 'e0000000-0000-4000-8000-000000000001';
  await boot(() => botRes(303, { location: `/r/${TOK}?tab=jugnu&class=${LIST}` }));
  const res = await postForm(srv, `/r/${TOK}/unbind`, { binding: BIND, class: LIST, phone: '+920000000000', revoked_by: 'page_undo' });
  expect(res.status).toBe(303);
  expect(res.headers.location).toBe(`/r/${TOK}?tab=jugnu&class=${LIST}`);
  expect(calls[0].url).toBe(`${BOT}/api/internal/tr/unbind/${TOK}`);
  expect(JSON.parse(calls[0].init.body)).toEqual({ binding: BIND, class: LIST });
});
