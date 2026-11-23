/**
 * The one tap from a WhatsApp message reaches the bot through the teacher home's public edge (quiz_forward_button):
 * GET /quiz/teacher/<qf token>/fwd is forwarded path-for-path with no query, and the bot's 302 → wa.me is relayed as it
 * is; the page's share-sheet beacons (fwd_native, fwd_result) carry their result `r` through the step allow-list.
 * The bot is an injected fake callBot (the network boundary).
 */
const http = require('http');
const express = require('express');
const { createQuizTeacherRouter } = require('../routes/quiz-teacher.routes');

const TOK = `eyJrIjoicWYifQ.${'A'.repeat(22)}`;
let srv;
let calls;
async function boot(answer) {
  calls = [];
  const callBot = async (method, path, req, body, o) => { calls.push({ method, path, body, opts: o }); return answer; };
  const app = express();
  app.use(createQuizTeacherRouter({ callBot }));
  app.use((req, res) => res.status(200).type('html').send('<!doctype html><title>SPA</title>'));
  srv = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
}
afterEach(() => new Promise((r) => (srv ? srv.close(r) : r())));
function request(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const data = body == null ? null : JSON.stringify(body);
    const r = http.request({ host: '127.0.0.1', port: srv.address().port, method, path,
      headers: data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {} }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

describe('GET /quiz/teacher/<qf>/fwd', () => {
  test('forwarded to the bot as /quiz/teacher/<t>/fwd with no query (anything asked is dropped); the 302 → wa.me is relayed', async () => {
    const wa = 'https://wa.me/?text=Class%2C%20play';
    await boot({ status: 302, location: wa, headers: { location: wa }, bytes: Buffer.alloc(0) });
    const r = await request('GET', `/quiz/teacher/${TOK}/fwd?evil=1&lang=ur`);
    expect(calls.map((c) => c.path)).toEqual([`/api/internal/th/quiz/teacher/${TOK}/fwd`]);
    expect(r.status).toBe(302);
    expect(r.headers.location).toBe(wa);
  });

  test('the bot\'s 302 → whatsapp://send?text= (WhatsApp\'s own browser) is relayed, not turned into a 502', async () => {
    const sch = 'whatsapp://send?text=Class%2C%20play';
    await boot({ status: 302, location: sch, headers: { location: sch }, bytes: Buffer.alloc(0) });
    const r = await request('GET', `/quiz/teacher/${TOK}/fwd`);
    expect(r.status).toBe(302);
    expect(r.headers.location).toBe(sch);
  });

  test('a junk token never reaches the bot', async () => {
    await boot({ status: 302, bytes: Buffer.alloc(0) });
    await request('GET', '/quiz/teacher/not-a-token/fwd');
    expect(calls).toEqual([]);
  });
});

describe('the share-sheet beacons', () => {
  test('fwd_result carries r (one of shared / dismissed / failed); anything else is dropped', async () => {
    await boot({ status: 204, bytes: Buffer.alloc(0) });
    await request('POST', '/api/th/step', { t: TOK, step: 'fwd_result', id: 'a0000000-0000-4000-8000-000000000001', r: 'dismissed' });
    await request('POST', '/api/th/step', { t: TOK, step: 'fwd_result', r: '<script>' });
    expect(calls.map((c) => c.body)).toEqual([
      { t: TOK, step: 'fwd_result', id: 'a0000000-0000-4000-8000-000000000001', r: 'dismissed' },
      { t: TOK, step: 'fwd_result' },
    ]);
  });
});

// The one-lesson page for a lesson PLAN (the bot's ?lesson=, twin of ?session=) is reachable only if the page shell's
// query allow-list carries it: a well-formed `lsn_` key reaches the bot beside the page language; any other shape is
// dropped (the bot then answers today's home).
describe('GET /quiz/teacher/<t>?lesson=<lesson key>', () => {
  const KEY = 'lsn_lp_v8_00000000-0000-4000-8000-0000000000a1';
  test('a lesson key reaches the bot with the page language; a malformed one is dropped; other pages never carry it', async () => {
    await boot({ status: 200, bytes: Buffer.from('<html>x</html>'), contentType: 'text/html' });
    await request('GET', `/quiz/teacher/${TOK}?lesson=${KEY}`);
    await request('GET', `/quiz/teacher/${TOK}?lang=en&lesson=${KEY}`);
    await request('GET', `/quiz/teacher/${TOK}?lesson=lsn_lp_v8_a%20b`);
    await request('GET', `/quiz/teacher/${TOK}?lesson=not-a-key`);
    await request('GET', `/quiz/teacher/${TOK}/stories?lesson=${KEY}`);
    expect(calls.map((c) => c.path)).toEqual([
      `/api/internal/th/quiz/teacher/${TOK}?lesson=${KEY}`,
      `/api/internal/th/quiz/teacher/${TOK}?lang=en&lesson=${KEY}`,
      `/api/internal/th/quiz/teacher/${TOK}`,
      `/api/internal/th/quiz/teacher/${TOK}`,
      `/api/internal/th/quiz/teacher/${TOK}/stories`,
    ]);
  });
});
