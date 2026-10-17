/**
 * Web quiz edge: the bot's Server-Timing on a child's JSON answer (sent by the bot only with web_quiz_wait_ux on) is
 * passed to the phone beside the edge's own time, so a walk splits a slow screen into edge, bot and database.
 * No header from the bot (the switch off): the answer is today's, with no Server-Timing. A header in any other shape is
 * dropped. The real router over HTTP, the bot faked at the fetch boundary; no first-party module is mocked.
 */
const http = require('http');
const express = require('express');
const { createWebQuizRouter } = require('../routes/web-quiz.routes');

const BOT = 'http://bot.test';
const HUB_TOKEN = `${'a'.repeat(40)}.${'b'.repeat(22)}`;
const BODY = { games: [{ kind: 'numbers', stop: 'bigger' }] };

function jsonRes(status, body, st) {
  const hs = { 'content-type': 'application/json', ...(st == null ? {} : { 'server-timing': st }) };
  return { status, ok: status < 300, headers: { get: (h) => hs[h.toLowerCase()] || null }, text: async () => JSON.stringify(body) };
}
function start(app) { return new Promise((resolve) => { const srv = app.listen(0, () => resolve(srv)); }); }
function get(srv, path) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: srv.address().port, path }, (res) => {
      let out = '';
      res.on('data', (c) => { out += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: out }));
    }).on('error', reject);
  });
}
function build(st) {
  const app = express();
  app.use(createWebQuizRouter({ botUrl: BOT, apiKey: 'k', fetchImpl: async () => jsonRes(200, BODY, st), logEvent: () => {} }));
  return app;
}
const DOORS = `/api/wq/doors/h/${HUB_TOKEN}?kid=x&d=games&l=en`;

describe('web quiz edge: Server-Timing on the child API', () => {
  let srv;
  afterEach(() => new Promise((r) => (srv ? srv.close(r) : r())));

  test('the bot sends its timing (switch on): the phone gets edge + app + db, the body unchanged', async () => {
    srv = await start(build('app;dur=412, db;desc="9"'));
    const res = await get(srv, DOORS);
    expect(res.status).toBe(200);
    expect(res.headers['server-timing']).toMatch(/^edge;dur=\d+, app;dur=412, db;desc="9"$/);
    expect(JSON.parse(res.body)).toEqual(BODY);
  });

  test('no header from the bot (switch off): no Server-Timing, the same body bytes', async () => {
    srv = await start(build(null));
    const res = await get(srv, DOORS);
    expect(res.headers['server-timing']).toBeUndefined();
    expect(res.body).toBe(JSON.stringify(BODY));
  });

  test.each([['free text', 'app;dur=1, db;desc="child Ali"'], ['another name', 'sql;dur=5'], ['a long chain', `app;dur=1, db;desc="2", x;dur=${'9'.repeat(300)}`]])(
    'a header in any other shape (%s) is dropped', async (_, st) => {
      srv = await start(build(st));
      const res = await get(srv, DOORS);
      expect(res.headers['server-timing']).toBeUndefined();
      expect(res.body).toBe(JSON.stringify(BODY));
    },
  );
});
