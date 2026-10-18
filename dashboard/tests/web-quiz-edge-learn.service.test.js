/**
 * A fresh portal process learns the page switches from the bot (app_settings web_quiz_edge_learn, read by the bot,
 * default off): one background call to GET /api/internal/wq/edge when the router is made, again every 60 s.
 *
 * With the bot saying `learn: true, fast: true`, the FIRST /q/ and /h/ page of a fresh process sends the page's head
 * before the bot's quiz/hub answer (today only the second page does). With `learn: false`, a failed or a hanging
 * call, every page is today's, byte for byte, and never waits on that call. A page payload always wins.
 *
 * The bot is the network boundary (a fake fetch answering by path, quiz/hub answers released by hand); the 60 s
 * timer is the test's own. No first-party module is mocked.
 */
const http = require('http');
const express = require('express');
const { createWebQuizRouter, renderQuizPage, renderHubPage } = require('../routes/web-quiz.routes');

const BOT = 'http://bot.test';
const KEY = 'test-internal-key';
const ORIGIN = 'http://portal.example';

function jsonRes(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) },
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  };
}

const QUIZ = (extra = {}) => ({
  quiz: {
    id: 'q-1', code: 'AB12CD', topic: 'Parts of a plant', lang: 'en', dir: 'ltr', grade: '3', subject: 'Science', n: 1,
    questions: [{ qid: 'x1', i: 1, text: 'Which part drinks water?', options: [{ slot: 'A', text: 'Roots' }, { slot: 'B', text: 'Leaves' }], correct_slot: 'A' }],
  },
  cls: { label: 'Class 3', teacher: 'Teacher', chips: [] },
  live: { class_today: 0, ict_today_floor: 40 },
  video: null,
  preview: false,
  brand: 'niete',
  rt: false,
  ...extra,
});
const TOKEN = 'eyJrIjoiaCIsImlkcyI6WyJhIl0sImV4cCI6OTk5OTk5OTk5OX0.AbCdEfGhIjKlMnOpQrStUv';
const HUB = (extra = {}) => ({
  lang: 'en', kids: [{ chip: '0123456789abcdef', first: 'Star', animal: 'owl', grade: '3' }], kid: '0123456789abcdef',
  teacher: null, again: [], recs: [], challenge: null, brand: 'niete', rt: false, ...extra,
});
const ver = (body) => body.match(/wq\.css\?v=([0-9a-f]+)/)[1];
const LEARN_ON = { learn: true, fast: true, brand: 'niete', rt: false };

const start = (app) => new Promise((resolve) => { const srv = app.listen(0, () => resolve(srv)); });
const settle = () => new Promise((r) => setTimeout(r, 30));

function get(srv, path, { onFirstChunk, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const r = http.request({ host: '127.0.0.1', port: srv.address().port, method: 'GET', path, headers: { host: 'portal.example', ...headers } }, (res) => {
      const chunks = [];
      res.setEncoding('utf8');
      res.on('data', (c) => { chunks.push(c); if (chunks.length === 1 && onFirstChunk) onFirstChunk(c); });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, chunks, body: chunks.join(''), ms: Date.now() - t0 }));
    });
    r.on('error', reject);
    r.end();
  });
}

/**
 * The bot: /edge answers from `edge` (a value, a function, 'reject' or 'hang'); quiz and hub answers come from
 * `pages` in order, a { hold: true, res } one waiting for release().
 */
function fakeBot({ edge, pages = [] }) {
  const calls = [];
  let held = [];
  const fetchImpl = (url) => {
    calls.push(url);
    if (url.endsWith('/api/internal/wq/edge')) {
      const e = typeof edge === 'function' ? edge() : edge;
      if (e === 'reject') return Promise.reject(new Error('down'));
      if (e === 'hang') return new Promise(() => {});
      return Promise.resolve(jsonRes(200, e));
    }
    const p = pages.shift();
    if (p && p.hold) return new Promise((r) => held.push(() => r(p.res)));
    return Promise.resolve(p);
  };
  const release = () => { const h = held; held = []; h.forEach((f) => f()); };
  return { fetchImpl, calls, release, edgeCalls: () => calls.filter((u) => u.endsWith('/edge')).length };
}

/** The 60 s refresh on the test's own clock: tick() runs it once. */
function testTimers() {
  const t = { fn: null, ms: null, unref: 0, set: (fn, ms) => { t.fn = fn; t.ms = ms; return { unref: () => { t.unref += 1; } }; }, clear: () => { t.fn = null; } };
  t.tick = async () => { if (t.fn) t.fn(); await settle(); };
  return t;
}

function build(fetchImpl, edgeLearn) {
  const app = express();
  app.set('trust proxy', 1);
  app.use(createWebQuizRouter({ botUrl: BOT, apiKey: KEY, fetchImpl, ...(edgeLearn === undefined ? {} : { edgeLearn }) }));
  return app;
}

/** GET path while the bot's page answer is held: was the first byte sent before the bot answered? */
async function firstByteBeforeAnswer(srv, bot, path) {
  let early = null;
  let answered = false;
  let answeredAtFirstChunk = null;
  const answer = () => { if (!answered) { answered = true; bot.release(); } };
  const fallback = setTimeout(answer, 400); // an edge that sends nothing early ends red, not hung
  const res = await get(srv, path, { onFirstChunk: (c) => { early = c; answeredAtFirstChunk = answered; answer(); } });
  clearTimeout(fallback);
  return { res, early, before: answeredAtFirstChunk === false };
}

describe('a fresh portal process: the bot says learn + fast on', () => {
  let srv;
  afterEach(() => new Promise((r) => (srv ? srv.close(r) : r())));

  it('(a) the FIRST /q/<code> sends the head and the Jugnu frame before the bot answers the quiz', async () => {
    const timers = testTimers();
    const bot = fakeBot({ edge: LEARN_ON, pages: [{ hold: true, res: jsonRes(200, QUIZ({ fast: true })) }] });
    srv = await start(build(bot.fetchImpl, { timers }));
    await settle();
    const { res, early, before } = await firstByteBeforeAnswer(srv, bot, '/q/AB12CD');
    expect(before).toBe(true);
    expect(res.status).toBe(200);
    expect(early).toMatch(/<link rel="stylesheet" href="\/wq\/wq\.css\?v=/);
    expect(early).toMatch(/<div class="wq-boot"><img src="\/wq\/jugnu\/hello\.webp"/);
    expect(early).not.toMatch(/id="boot"/);
    expect(JSON.parse(res.body.match(/<script id="boot" type="application\/json">([\s\S]*?)<\/script>/)[1]).quiz.code).toBe('AB12CD');
    expect(bot.edgeCalls()).toBe(1);
    expect(timers.ms).toBe(60000);
    expect(timers.unref).toBe(1);
  });

  it('(a) the FIRST /h/<token> sends the head before the bot answers the hub', async () => {
    const bot = fakeBot({ edge: LEARN_ON, pages: [{ hold: true, res: jsonRes(200, HUB({ fast: true })) }] });
    srv = await start(build(bot.fetchImpl, { timers: testTimers() }));
    await settle();
    const { res, early, before } = await firstByteBeforeAnswer(srv, bot, `/h/${TOKEN}`);
    expect(before).toBe(true);
    expect(res.status).toBe(200);
    expect(early).toMatch(/<link rel="stylesheet" href="\/wq\/wq\.css\?v=/);
    expect(res.body.trimEnd().endsWith('</html>')).toBe(true);
  });

  it('(a) the learned brand and Urdu polish dress a closed page before any payload', async () => {
    const ur = { headers: { 'accept-language': 'ur' } };
    const bot = fakeBot({ edge: { learn: true, fast: false, brand: 'rumi', rt: false, ui: { ur2: true } }, pages: [] });
    srv = await start(build(bot.fetchImpl, { timers: testTimers() }));
    await settle();
    const learned = await get(srv, '/h/not-a-token', ur);
    const today = await (async () => {
      const b2 = fakeBot({ edge: { learn: false } });
      const s2 = await start(build(b2.fetchImpl, { timers: testTimers() }));
      await settle();
      const r = await get(s2, '/h/not-a-token', ur);
      await new Promise((ok) => s2.close(ok));
      return r;
    })();
    expect(learned.status).toBe(401);
    expect(learned.body).not.toBe(today.body);
    expect(learned.body).toMatch(/<html lang="ur" dir="rtl" class="wq-ur2">/);
    expect(today.body).not.toMatch(/wq-ur2/);
  });

  it('(d) a payload with fast:false after learning true: the next page sends nothing early (the payload wins)', async () => {
    const timers = testTimers();
    const bot = fakeBot({ edge: LEARN_ON, pages: [jsonRes(200, QUIZ()), { hold: true, res: jsonRes(200, QUIZ()) }] });
    srv = await start(build(bot.fetchImpl, { timers }));
    await settle();
    await get(srv, '/q/AB12CD');
    const { res, before } = await firstByteBeforeAnswer(srv, bot, '/q/AB12CD');
    expect(before).toBe(false);
    expect(res.body).toBe(renderQuizPage({ payload: QUIZ(), code: 'AB12CD', view: 'quiz', origin: ORIGIN, assetV: ver(res.body) }));
  });

  it('a refresh that started before a payload never undoes what the payload taught', async () => {
    let answerEdge = null;
    let first = true;
    const bot = fakeBot({
      edge: () => (first ? (first = false, LEARN_ON) : 'slow'),
      pages: [jsonRes(200, QUIZ()), { hold: true, res: jsonRes(200, QUIZ()) }],
    });
    const fetchImpl = (url) => (url.endsWith('/edge') && !first
      ? new Promise((r) => { answerEdge = () => r(jsonRes(200, LEARN_ON)); })
      : bot.fetchImpl(url));
    const timers = testTimers();
    srv = await start(build(fetchImpl, { timers }));
    await settle();
    await timers.tick(); // a refresh is on its way
    await get(srv, '/q/AB12CD'); // the payload says fast is off
    answerEdge();
    await settle();
    const { before } = await firstByteBeforeAnswer(srv, bot, '/q/AB12CD');
    expect(before).toBe(false);
  });

  it('the 60 s refresh: off at boot (one ask, then quiet); a hub answer saying edge_learn re-arms it → the next page sends the head early', async () => {
    let edge = { learn: false };
    const timers = testTimers();
    const bot = fakeBot({ edge: () => edge, pages: [jsonRes(200, HUB({ edge_learn: true })), { hold: true, res: jsonRes(200, QUIZ({ fast: true })) }] });
    srv = await start(build(bot.fetchImpl, { timers }));
    await settle();
    edge = LEARN_ON;
    await timers.tick();
    expect(bot.edgeCalls()).toBe(1); // off: no refresh
    await get(srv, `/h/${TOKEN}`); // the switch flipped on: the hub's answer says so
    await timers.tick();
    expect(bot.edgeCalls()).toBe(2);
    const { before } = await firstByteBeforeAnswer(srv, bot, '/q/AB12CD');
    expect(before).toBe(true);
  });
});

describe('learn off, failed or hanging: every first page is today\'s, byte for byte, and never waits', () => {
  let srv;
  afterEach(() => new Promise((r) => (srv ? srv.close(r) : r())));

  // Today's first page on a fresh process: a router with no learning at all (the code before this change answers the same).
  async function todays(path, payload) {
    const b = fakeBot({ edge: 'hang', pages: [jsonRes(200, payload)] });
    const s = await start(build(b.fetchImpl, false));
    const r = await get(s, path);
    await new Promise((ok) => s.close(ok));
    expect(b.edgeCalls()).toBe(0);
    return r;
  }
  const ROWS = [
    ['(b) learn:false', { learn: false }],
    ['(b) learn:false with fields it must ignore', { learn: false, fast: true, brand: 'rumi', ui: { ur2: true } }],
    ['(b) learn not strictly true', { learn: 'true', fast: true }],
    ['(c) the call rejects', 'reject'],
    ['(c) the call hangs', 'hang'],
  ];
  async function firstPage(edge, path, payload) {
    const bot = fakeBot({ edge, pages: [jsonRes(200, payload)] });
    srv = await start(build(bot.fetchImpl, { timers: testTimers() }));
    await settle();
    const r = await get(srv, path);
    expect(bot.edgeCalls()).toBe(1);
    return r;
  }

  test.each(ROWS)('%s: the first /q/<code>', async (_, edge) => {
    const want = await todays('/q/AB12CD', QUIZ({ fast: true }));
    const q = await firstPage(edge, '/q/AB12CD', QUIZ({ fast: true }));
    expect(q.status).toBe(200);
    expect(q.body).toBe(want.body);
    expect(q.body).toBe(renderQuizPage({ payload: QUIZ({ fast: true }), code: 'AB12CD', view: 'quiz', origin: ORIGIN, assetV: ver(q.body) }));
    expect(q.chunks.length).toBe(want.chunks.length);
    expect(q.headers['content-type']).toBe(want.headers['content-type']);
    expect(q.headers['cache-control']).toBe(want.headers['cache-control']);
    expect(q.ms).toBeLessThan(1000);
  });

  test.each(ROWS)('%s: the first /h/<token>', async (_, edge) => {
    const want = await todays(`/h/${TOKEN}`, HUB({ fast: true }));
    const h = await firstPage(edge, `/h/${TOKEN}`, HUB({ fast: true }));
    expect(h.status).toBe(200);
    expect(h.body).toBe(want.body);
    expect(h.body).toBe(renderHubPage({ payload: HUB({ fast: true }), token: TOKEN, origin: ORIGIN, assetV: ver(h.body) }));
    expect(h.chunks.length).toBe(want.chunks.length);
    expect(h.ms).toBeLessThan(1000);
  });

  it('(c) a hanging call is not called again while it hangs (no pile-up)', async () => {
    const timers = testTimers();
    const bot = fakeBot({ edge: 'hang' });
    srv = await start(build(bot.fetchImpl, { timers }));
    await settle();
    await timers.tick();
    await timers.tick();
    expect(bot.edgeCalls()).toBe(1);
  });

  it('no bot address or key: no call at all', async () => {
    const bot = fakeBot({ edge: LEARN_ON });
    const app = express();
    app.use(createWebQuizRouter({ botUrl: '', apiKey: '', fetchImpl: bot.fetchImpl, edgeLearn: { timers: testTimers() } }));
    srv = await start(app);
    await settle();
    expect(bot.edgeCalls()).toBe(0);
  });
});

// Switch OFF is one ask per process, never a stream (lead-chief-5 060928 MF1, redteam-n2 061309); the call's timeout never
// holds a process open (MF2); a router built without a fake bot inside a test never calls out (MF3).
describe('switch off: one boot ask per process lifetime; on: every 60 s; re-armed only by a hub answer carrying the key', () => {
  let srv;
  afterEach(() => new Promise((r) => (srv ? srv.close(r) : r())));
  const tenMinutes = async (timers) => { for (let i = 0; i < 10; i += 1) await timers.tick(); };

  it('off (learn:false): exactly 1 bot call, then the timer is stopped: 0 more calls over 10 minutes', async () => {
    const timers = testTimers();
    const bot = fakeBot({ edge: { learn: false } });
    srv = await start(build(bot.fetchImpl, { timers }));
    await settle();
    await tenMinutes(timers);
    expect(bot.edgeCalls()).toBe(1);
    expect(timers.fn).toBe(null);
  });
  it('on (learn:true): asked again every 60 s (boot + 10 over 10 minutes)', async () => {
    const timers = testTimers();
    const bot = fakeBot({ edge: LEARN_ON });
    srv = await start(build(bot.fetchImpl, { timers }));
    await settle();
    await tenMinutes(timers);
    expect(bot.edgeCalls()).toBe(11);
  });
  it('on, then flipped off: the first learn:false stops the asking', async () => {
    let edge = LEARN_ON;
    const timers = testTimers();
    const bot = fakeBot({ edge: () => edge });
    srv = await start(build(bot.fetchImpl, { timers }));
    await settle();
    await timers.tick();
    edge = { learn: false };
    await timers.tick();
    await tenMinutes(timers);
    expect(bot.edgeCalls()).toBe(3);
  });
  it('off → on through a hub answer carrying edge_learn: true re-arms the asking (once); the page is today\'s, without the key', async () => {
    const timers = testTimers();
    let edge = { learn: false };
    const bot = fakeBot({ edge: () => edge, pages: [jsonRes(200, HUB({ edge_learn: true })), jsonRes(200, HUB({ edge_learn: true }))] });
    srv = await start(build(bot.fetchImpl, { timers }));
    await settle();
    await tenMinutes(timers);
    expect(bot.edgeCalls()).toBe(1);
    const h = await get(srv, `/h/${TOKEN}`);
    expect(h.body).toBe(renderHubPage({ payload: HUB(), token: TOKEN, origin: ORIGIN, assetV: ver(h.body) }));
    await get(srv, `/h/${TOKEN}`); // a second answer saying so does not stack a second timer
    edge = LEARN_ON;
    await timers.tick();
    expect(bot.edgeCalls()).toBe(2);
    await timers.tick();
    expect(bot.edgeCalls()).toBe(3);
  });
  it('the page\'s own hub calls (GET and POST /api/wq/hub/:token) re-arm it too, and their JSON never carries the key', async () => {
    const timers = testTimers();
    let edge = { learn: false };
    const bot = fakeBot({ edge: () => edge, pages: [jsonRes(200, HUB({ edge_learn: true })), jsonRes(200, HUB({ edge_learn: true }))] });
    srv = await start(build(bot.fetchImpl, { timers }));
    await settle();
    await tenMinutes(timers);
    expect(bot.edgeCalls()).toBe(1);
    const call = (method) => new Promise((resolve, reject) => {
      const r = http.request({ host: '127.0.0.1', port: srv.address().port, method, path: `/api/wq/hub/${TOKEN}`, headers: { host: 'portal.example', 'content-type': 'application/json' } }, (res) => {
        let b = ''; res.setEncoding('utf8'); res.on('data', (c) => { b += c; }); res.on('end', () => resolve({ status: res.statusCode, body: b }));
      });
      r.on('error', reject);
      r.end(method === 'POST' ? JSON.stringify({ kid: '0123456789abcdef' }) : undefined);
    });
    const g = await call('GET');
    expect(g.status).toBe(200);
    expect(g.body).toBe(JSON.stringify(HUB()));
    edge = LEARN_ON;
    await timers.tick();
    expect(bot.edgeCalls()).toBe(2);
    const p = await call('POST');
    expect(p.body).toBe(JSON.stringify(HUB()));
    await timers.tick();
    expect(bot.edgeCalls()).toBe(3);
  });
  it('a hub answer without the key never arms it', async () => {
    const timers = testTimers();
    const bot = fakeBot({ edge: { learn: false }, pages: [jsonRes(200, HUB())] });
    srv = await start(build(bot.fetchImpl, { timers }));
    await settle();
    await get(srv, `/h/${TOKEN}`);
    await tenMinutes(timers);
    expect(bot.edgeCalls()).toBe(1);
  });
  it('the edge call\'s timeout timer is unref\'d (it never holds a process or a test run open)', async () => {
    const real = global.setTimeout;
    const made = [];
    const spy = jest.spyOn(global, 'setTimeout').mockImplementation((fn, ms, ...a) => { const t = real(fn, ms, ...a); made.push({ ms, t }); return t; });
    try {
      const bot = fakeBot({ edge: 'hang' });
      const app = express();
      app.use(createWebQuizRouter({ botUrl: BOT, apiKey: KEY, fetchImpl: bot.fetchImpl, botTimeoutMs: 7777, edgeLearn: { timers: testTimers() } }));
      srv = await start(app);
    } finally { spy.mockRestore(); }
    const t = made.filter((m) => m.ms === 7777);
    expect(t.length).toBe(1);
    expect(t[0].t.hasRef()).toBe(false);
    clearTimeout(t[0].t);
  });
  it('inside a test run, a router built like production (no fake bot, a bot address and key from a dev .env) makes 0 network calls', async () => {
    const env = { MAIN_BOT_URL: process.env.MAIN_BOT_URL, INTERNAL_API_KEY: process.env.INTERNAL_API_KEY };
    process.env.MAIN_BOT_URL = 'http://bot.invalid'; process.env.INTERNAL_API_KEY = 'dev-key-from-env';
    const calls = [];
    const had = global.fetch;
    global.fetch = (...a) => { calls.push(a[0]); return new Promise(() => {}); };
    try {
      const app = express();
      app.use(createWebQuizRouter({ botUrl: process.env.MAIN_BOT_URL, apiKey: process.env.INTERNAL_API_KEY }));
      srv = await start(app);
      await settle();
    } finally {
      global.fetch = had;
      Object.entries(env).forEach(([k, v]) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; });
    }
    expect(calls).toEqual([]);
  });
});
