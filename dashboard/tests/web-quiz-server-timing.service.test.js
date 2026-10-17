/**
 * The bot's step timings (Server-Timing on its internal hub answer, sent only with app_settings web_quiz_server_timing
 * on) at the edge:
 *  - the bot client puts them on its slow-call log line (sanitized: only `name;dur=<ms>` items, 200 characters at most);
 *  - on a hub page whose headers have not gone yet (fast switch off, nf=1) they are forwarded to the browser beside the
 *    bot's wait and the page's render: a header only, the body today's bytes;
 *  - on the flushed page (headers gone before the bot answers) the tail's boot JSON carries one `st` for the beacon;
 *  - off (the bot sent no timing): no header, no `st`, every page byte for byte today's.
 * The bot is the network boundary (a fake fetch). No first-party module is mocked.
 */
const http = require('http');
const express = require('express');
const { createWebQuizRouter, createBotClient, renderHubPage } = require('../routes/web-quiz.routes');

const BOT = 'http://bot.test';
const KEY = 'test-internal-key';
const TOKEN = 'eyJrIjoiaCIsImlkcyI6WyJhIl0sImV4cCI6OTk5OTk5OTk5OX0.AbCdEfGhIjKlMnOpQrStUv';
const ST = 'ui;dur=5, gate;dur=40, kids;dur=120, ctx;dur=300, home;dur=3100, tail;dur=2, total;dur=3600';

function jsonRes(status, body, headers = {}) {
  const h = { 'content-type': 'application/json', ...headers };
  return { status, ok: status >= 200 && status < 300, headers: { get: (n) => (h[n.toLowerCase()] !== undefined ? h[n.toLowerCase()] : null) }, text: async () => JSON.stringify(body) };
}
const HUB = (extra = {}) => ({
  lang: 'en', kids: [{ chip: '0123456789abcdef', first: 'Sana', animal: 'owl', grade: '3' }], kid: '0123456789abcdef',
  teacher: null, again: [], recs: [], challenge: null, brand: 'niete', rt: false, ...extra,
});
const start = (app) => new Promise((resolve) => { const srv = app.listen(0, () => resolve(srv)); });
function get(srv, path) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: srv.address().port, method: 'GET', path, headers: { host: 'portal.example' } }, (res) => {
      let body = ''; res.setEncoding('utf8'); res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    r.on('error', reject); r.end();
  });
}
function build(answers, extra = {}) {
  const logged = [];
  const q = answers.slice();
  const app = express();
  app.set('trust proxy', 1);
  app.use(createWebQuizRouter({ botUrl: BOT, apiKey: KEY, fetchImpl: async () => q.shift(), logEvent: (e, p) => logged.push([e, p]), ...extra }));
  return { app, logged };
}
const boot = (body) => JSON.parse(body.match(/<script id="boot" type="application\/json">([\s\S]*?)<\/script>/)[1]);
const verOf = (body) => body.match(/wq\.css\?v=([0-9a-f]+)/)[1];
const calls = (logged) => logged.filter(([e]) => e === 'web_quiz.bot_call').map(([, p]) => p);

describe('the bot client: step timings on the log line', () => {
  const slowClient = (headers, logged) => {
    let t = 1000000;
    return createBotClient({ botUrl: BOT, apiKey: KEY, now: () => t, logEvent: (e, p) => logged.push([e, p]),
      fetchImpl: async () => { t += 4000; return jsonRes(200, HUB(), headers); } });
  };
  const rq = { get: () => null, ip: '1.2.3.4' };

  test('a slow hub call: the line carries st, and the result too', async () => {
    const logged = [];
    const out = await slowClient({ 'server-timing': ST }, logged)('GET', '/api/internal/wq/hub/abc', rq);
    expect(calls(logged)).toEqual([expect.objectContaining({ outcome: 'slow', st: ST })]);
    expect(out.st).toBe(ST);
  });

  test('only name;dur= items survive, at most 200 characters', async () => {
    const logged = [];
    const dirty = `${ST}, evil;desc="x", gate;dur=-1, <script>;dur=1, a;dur=1;desc=y, ${'z;dur=1, '.repeat(40)}`;
    const out = await slowClient({ 'server-timing': dirty }, logged)('GET', '/api/internal/wq/hub/abc', rq);
    expect(out.st.length).toBeLessThanOrEqual(200);
    expect(out.st.split(', ').every((i) => /^[a-z]+;dur=\d+(\.\d+)?$/.test(i))).toBe(true);
    expect(out.st.startsWith(ST)).toBe(true);
    expect(out.st).not.toMatch(/evil|script|desc/);
    expect(calls(logged)[0].st).toBe(out.st);
  });

  test('no header: the line and the result are today\'s (no st key)', async () => {
    const logged = [];
    const out = await slowClient({}, logged)('GET', '/api/internal/wq/hub/abc', rq);
    expect(calls(logged)[0]).not.toHaveProperty('st');
    expect(out).not.toHaveProperty('st');
    expect(Object.keys(out).sort()).toEqual(['body', 'location', 'status']);
  });

});

describe('GET /h/:token', () => {
  let srv;
  afterEach(() => new Promise((r) => (srv ? srv.close(r) : r())));

  test('fast off (headers not sent yet): bot wait, the bot\'s steps and the render go to the browser; the body is today\'s bytes', async () => {
    const { app } = build([jsonRes(200, HUB(), { 'server-timing': ST }), jsonRes(200, HUB())]);
    srv = await start(app);
    const a = await get(srv, `/h/${TOKEN}`);
    const b = await get(srv, `/h/${TOKEN}`);
    expect(a.headers['server-timing']).toMatch(new RegExp(`^bot;dur=\\d+, ${ST}, render;dur=\\d+$`));
    expect(b.headers['server-timing']).toBeUndefined();
    expect(a.body).toBe(b.body);
    expect(a.body).toBe(renderHubPage({ payload: HUB(), token: TOKEN, origin: 'http://portal.example', assetV: verOf(a.body) }));
  });

  test('fast on, nf=1: beside the portal\'s own bot;dur=, and no st in the page', async () => {
    const { app } = build([jsonRes(200, HUB({ fast: true })), jsonRes(200, HUB({ fast: true }), { 'server-timing': ST })]);
    srv = await start(app);
    await get(srv, `/h/${TOKEN}`);
    const res = await get(srv, `/h/${TOKEN}?nf=1`);
    expect(res.headers['server-timing']).toMatch(/^bot;dur=\d+, ui;dur=5, gate;dur=40.*, total;dur=3600, render;dur=\d+$/);
    expect(res.body).not.toMatch(/"st"/);
  });

  test('flushed page, off (the bot sent no timing): no Server-Timing header, no st, today\'s bytes', async () => {
    const { app } = build([jsonRes(200, HUB({ fast: true })), jsonRes(200, HUB({ fast: true })), jsonRes(200, HUB({ fast: true }))]);
    srv = await start(app);
    await get(srv, `/h/${TOKEN}`);
    const a = await get(srv, `/h/${TOKEN}`);
    const b = await get(srv, `/h/${TOKEN}`);
    expect(a.headers['server-timing']).toBeUndefined();
    const bare = (x) => x.replace(/<script>performance\.mark\("wq-bot",\{detail:\d+\}\)<\/script>\n/, '');
    expect(bare(a.body)).toBe(bare(b.body));
    expect(a.body).not.toMatch(/"st"|dur=/);
    expect(boot(a.body)).not.toHaveProperty('st');
  });

  test('flushed page, key on: one st in the tail\'s boot JSON, nothing else changes', async () => {
    const { app } = build([jsonRes(200, HUB({ fast: true })), jsonRes(200, HUB({ fast: true }), { 'server-timing': ST }), jsonRes(200, HUB({ fast: true }))]);
    srv = await start(app);
    await get(srv, `/h/${TOKEN}`);
    const on = await get(srv, `/h/${TOKEN}`);
    const off = await get(srv, `/h/${TOKEN}`);
    expect(on.headers['server-timing']).toBeUndefined();
    expect(boot(on.body).st).toBe(ST);
    const { st, ...rest } = boot(on.body);
    expect(rest).toEqual(boot(off.body));
    expect(on.body.match(/"st":/g)).toHaveLength(1);
  });

  test('flushed page, key on but the timing is not clean: nothing but clean items reaches the page', async () => {
    const { app } = build([jsonRes(200, HUB({ fast: true })), jsonRes(200, HUB({ fast: true }), { 'server-timing': `gate;dur=4, </script><b>;dur=1, x;desc="y"` })]);
    srv = await start(app);
    await get(srv, `/h/${TOKEN}`);
    const res = await get(srv, `/h/${TOKEN}`);
    expect(boot(res.body).st).toBe('gate;dur=4');
  });
});
