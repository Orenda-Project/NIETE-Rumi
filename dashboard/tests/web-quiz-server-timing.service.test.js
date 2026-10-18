/**
 * The bot's step timings (Server-Timing on its internal hub answer, sent only with app_settings web_quiz_server_timing
 * on) at the edge:
 *  - the bot client keeps only the items on the one shared list (bot/shared/services/quiz/web-quiz-server-timing-names.js:
 *    `<name>;dur=<ms>`, plus the round-trip count `dbq;desc="<n>"`), and puts them on its slow-call log line;
 *  - on a hub page whose headers have not gone yet (fast switch off, nf=1) they go to the browser in ONE header:
 *    the edge's wait, the bot's items (another switch's app/db/dbq first, then the steps), the page's render;
 *    a header only, the body today's bytes;
 *  - on the flushed page (headers gone before the bot answers) the tail's boot JSON carries one `st`;
 *  - off (the bot sent no timing): no header, no `st`, every page byte for byte today's.
 * The bot is the network boundary (a fake fetch). No first-party module is mocked.
 */
const http = require('http');
const express = require('express');
const { createWebQuizRouter, createBotClient, renderHubPage } = require('../routes/web-quiz.routes');
const Names = require('../../bot/shared/services/quiz/web-quiz-server-timing-names');

const BOT = 'http://bot.test';
const KEY = 'test-internal-key';
const TOKEN = 'eyJrIjoiaCIsImlkcyI6WyJhIl0sImV4cCI6OTk5OTk5OTk5OX0.AbCdEfGhIjKlMnOpQrStUv';
const ST = 'ui;dur=5, gate;dur=40, kids;dur=120, ctx;dur=300, home;dur=3100, tail;dur=2, total;dur=3600';
// the other timing switch's items (web_quiz_wait_ux), as the bot sends them when both are on: appended, one header
const APP = 'app;dur=3650, db;dur=410, dbq;desc="23"';

function jsonRes(status, body, headers = {}) {
  const h = { 'content-type': 'application/json', ...headers };
  return { status, ok: status >= 200 && status < 300, headers: { get: (n) => (h[n.toLowerCase()] !== undefined ? h[n.toLowerCase()] : null) }, text: async () => JSON.stringify(body) };
}
const HUB = (extra = {}) => ({
  lang: 'en', kids: [{ chip: '0123456789abcdef', first: 'Sana Testwala', animal: 'owl', grade: '3' }], kid: '0123456789abcdef',
  teacher: null, again: [], recs: [], challenge: null, brand: 'niete', rt: false, ...extra,
});
const start = (app) => new Promise((resolve) => { const srv = app.listen(0, () => resolve(srv)); });
function get(srv, path) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: srv.address().port, method: 'GET', path, headers: { host: 'portal.example' } }, (res) => {
      let body = ''; res.setEncoding('utf8'); res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, raw: res.rawHeaders, body }));
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
const stLines = (raw) => raw.filter((h, i) => i % 2 === 0 && h.toLowerCase() === 'server-timing');

describe('the shared list of timing items', () => {
  test('names every step the bot writes, the request-wide names, and the round-trip count', () => {
    expect(Names.NAMES).toEqual(expect.arrayContaining(['edge', 'app', 'db', 'render', 'ui', 'gate', 'kids', 'ctx', 'take', 'teacher', 'recs', 'play', 'home', 'other', 'tail', 'total']));
    // the teacher home's writers can adopt the same list unchanged
    expect(Names.NAMES).toEqual(expect.arrayContaining(['settings', 'total', 'db', 'edge', 'app', 'th_home', 'th_library']));
    expect(Names.COUNT).toBe('dbq');
    expect(Names.clean('settings;dur=3, db;dur=40, total;dur=55')).toBe('settings;dur=3, db;dur=40, total;dur=55');
  });
  test('clean keeps only listed `name;dur=<ms>` and `dbq;desc="<n>"`, each name once, in order', () => {
    expect(Names.clean(`edge;dur=9, ${APP}, ${ST}`)).toBe(`edge;dur=9, ${APP}, ${ST}`);
    expect(Names.clean('db;desc="3", gate;dur=4, gate;dur=5, zzz;dur=1, dbq;dur=2, app;dur=1;desc=x, render;dur=-1')).toBe('gate;dur=4');
    expect(Names.clean(['app;dur=1', 'gate;dur=2'])).toBe('app;dur=1, gate;dur=2');
    expect(Names.clean(null)).toBeNull();
    expect(Names.clean('x;desc="Sana Testwala"')).toBeNull();
  });
  test('privacy: the round-trip count is digits only, no free text (a child\'s name never passes)', () => {
    expect(Names.clean('dbq;desc="Sana Testwala"')).toBeNull();
    expect(Names.clean('dbq;desc="Sana"')).toBeNull();
    expect(Names.clean('dbq;desc=""')).toBeNull();
    expect(Names.clean('dbq;desc="12"')).toBe('dbq;desc="12"');
    expect(Names.clean('gate;dur=4, dbq;desc="Sana Testwala", total;dur=9')).toBe('gate;dur=4, total;dur=9');
  });
  test('the length cap: a header over MAX_LEN comes out within it, whole items only, the first ones kept', () => {
    const items = Names.NAMES.map((n) => `${n};dur=1234567.123`);
    const raw = items.join(', ');
    expect(raw.length).toBeGreaterThan(Names.MAX_LEN);
    const out = Names.clean(raw);
    expect(out.length).toBeLessThanOrEqual(Names.MAX_LEN);
    const kept = out.split(', ');
    expect(kept.length).toBeGreaterThan(0);
    expect(kept.length).toBeLessThan(items.length);
    expect(kept.every(Names.isItem)).toBe(true);
    expect(kept).toEqual(items.slice(0, kept.length));
  });
});

describe('the bot client: step timings on the log line', () => {
  const slowClient = (headers, logged) => {
    let t = 1000000;
    return createBotClient({ botUrl: BOT, apiKey: KEY, now: () => t, logEvent: (e, p) => logged.push([e, p]),
      fetchImpl: async () => { t += 4000; return jsonRes(200, HUB(), headers); } });
  };
  const rq = { get: () => null, ip: '1.2.3.4' };

  test('a slow hub call: the line carries the steps, and the result too', async () => {
    const logged = [];
    const out = await slowClient({ 'server-timing': ST }, logged)('GET', '/api/internal/wq/hub/abc', rq);
    expect(calls(logged)).toEqual([expect.objectContaining({ outcome: 'slow', steps: ST })]);
    expect(out.steps).toBe(ST);
  });

  test('only listed items survive, at most the shared length', async () => {
    const logged = [];
    const dirty = `${ST}, evil;desc="x", gate;dur=-1, <script>;dur=1, a;dur=1;desc=y, ${'recs;dur=1, '.repeat(40)}`;
    const out = await slowClient({ 'server-timing': dirty }, logged)('GET', '/api/internal/wq/hub/abc', rq);
    expect(out.steps.length).toBeLessThanOrEqual(Names.MAX_LEN);
    expect(out.steps.split(', ').every(Names.isItem)).toBe(true);
    expect(out.steps.startsWith(ST)).toBe(true);
    expect(out.steps).not.toMatch(/evil|script|desc/);
    expect(calls(logged)[0].steps).toBe(out.steps);
  });

  test('no header: the line and the result are today\'s (no steps key)', async () => {
    const logged = [];
    const out = await slowClient({}, logged)('GET', '/api/internal/wq/hub/abc', rq);
    expect(calls(logged)[0]).not.toHaveProperty('steps');
    expect(Object.keys(out).sort()).toEqual(['body', 'location', 'status']);
  });
});

describe('GET /h/:token', () => {
  let srv;
  afterEach(() => new Promise((r) => (srv ? srv.close(r) : r())));

  test('fast off (headers not sent yet): edge wait, the bot\'s steps and the render go to the browser; the body is today\'s bytes', async () => {
    const { app } = build([jsonRes(200, HUB(), { 'server-timing': ST }), jsonRes(200, HUB())]);
    srv = await start(app);
    const a = await get(srv, `/h/${TOKEN}`);
    const b = await get(srv, `/h/${TOKEN}`);
    expect(a.headers['server-timing']).toMatch(new RegExp(`^edge;dur=\\d+, ${ST}, render;dur=\\d+$`));
    expect(b.headers['server-timing']).toBeUndefined();
    expect(a.body).toBe(b.body);
    expect(a.body).toBe(renderHubPage({ payload: HUB(), token: TOKEN, origin: 'http://portal.example', assetV: verOf(a.body) }));
  });

  test('BOTH switches on (wait_ux + server_timing): edge, app, db, dbq and every step in ONE header', async () => {
    const { app } = build([jsonRes(200, HUB(), { 'server-timing': `${APP}, ${ST}` })]);
    srv = await start(app);
    const res = await get(srv, `/h/${TOKEN}`);
    expect(stLines(res.raw)).toHaveLength(1);
    const v = res.headers['server-timing'];
    expect(v).toMatch(new RegExp(`^edge;dur=\\d+, ${APP}, ${ST}, render;dur=\\d+$`));
    const names = v.split(', ').map((i) => i.split(';')[0]);
    expect(names).toEqual(expect.arrayContaining(['edge', 'app', 'db', 'dbq', 'ui', 'gate', 'kids', 'ctx', 'home', 'tail', 'total', 'render']));
    expect(v).not.toMatch(/db;desc/);
  });

  test('fast on, nf=1: the header, and no st in the page', async () => {
    const { app } = build([jsonRes(200, HUB({ fast: true })), jsonRes(200, HUB({ fast: true }), { 'server-timing': ST })]);
    srv = await start(app);
    await get(srv, `/h/${TOKEN}`);
    const res = await get(srv, `/h/${TOKEN}?nf=1`);
    expect(res.headers['server-timing']).toMatch(/^edge;dur=\d+, ui;dur=5, gate;dur=40.*, total;dur=3600, render;dur=\d+$/);
    expect(res.body).not.toMatch(/"st"/);
  });

  test('flushed page, off (the bot sent no timing): no Server-Timing header, no st, today\'s bytes', async () => {
    const { app } = build([jsonRes(200, HUB({ fast: true })), jsonRes(200, HUB({ fast: true })), jsonRes(200, HUB({ fast: true }))]);
    srv = await start(app);
    await get(srv, `/h/${TOKEN}`);
    const a = await get(srv, `/h/${TOKEN}`);
    const b = await get(srv, `/h/${TOKEN}`);
    expect(a.headers['server-timing']).toBeUndefined();
    expect(a.body).toBe(b.body);
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

  test('flushed page, key on but the timing is not clean: nothing but listed items reaches the page', async () => {
    const { app } = build([jsonRes(200, HUB({ fast: true })), jsonRes(200, HUB({ fast: true }), { 'server-timing': 'gate;dur=4, </script><b>;dur=1, x;desc="y"' })]);
    srv = await start(app);
    await get(srv, `/h/${TOKEN}`);
    const res = await get(srv, `/h/${TOKEN}`);
    expect(boot(res.body).st).toBe('gate;dur=4');
  });
});
