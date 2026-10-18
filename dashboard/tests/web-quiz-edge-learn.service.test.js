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
  lang: 'en', kids: [{ chip: '0123456789abcdef', first: 'Star Testwala', animal: 'owl', grade: '3' }], kid: '0123456789abcdef',
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
  // The 5 s re-ask after a failed ask, on the same clock: fire() runs it once.
  t.later = null; t.laterMs = null; t.laterUnref = 0;
  t.after = (fn, ms) => { t.later = fn; t.laterMs = ms; return { unref: () => { t.laterUnref += 1; } }; };
  t.cancel = () => { t.later = null; };
  t.tick = async () => { if (t.fn) t.fn(); await settle(); };
  t.fire = async () => { const f = t.later; t.later = null; if (f) f(); await settle(); };
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


// The portal's one learner of the page switches: a failed or timed-out ask is asked again at +5 s (only an explicit
// learn:false stops asking); replies are used in the order their asks started, never in the order they arrive; the
// answer also carries wait_ux and one_face (a field the answer lacks keeps what the process had); and apply() is the
// one writer of what an answer says, exported for another learner in the same process.
describe('one learner: re-ask at +5 s, replies by ask number, wait_ux and one_face, one apply()', () => {
  const { startEdgeLearn } = require('../lib/edge-learn');
  let srv;
  afterEach(() => new Promise((r) => { if (srv) { const s = srv; srv = null; s.close(r); } else r(); }));
  const heldBot = () => { const answer = []; return { answer, callBot: () => new Promise((ok, no) => answer.push({ ok, no })) }; };
  const ok = (body) => ({ status: 200, body });
  const ON = (fast) => ({ learn: true, fast, brand: 'niete', rt: false });

  it('the first ask fails (bot cold): a second ask at +5 s, and the next first page sends the head early from it', async () => {
    let first = true;
    const timers = testTimers();
    const bot = fakeBot({ edge: () => (first ? (first = false, 'reject') : LEARN_ON), pages: [{ hold: true, res: jsonRes(200, QUIZ({ fast: true })) }] });
    srv = await start(build(bot.fetchImpl, { timers }));
    await settle();
    expect(bot.edgeCalls()).toBe(1);
    expect(timers.laterMs).toBe(5000);
    expect(timers.laterUnref).toBe(1);
    await timers.fire();
    expect(bot.edgeCalls()).toBe(2);
    const { before } = await firstByteBeforeAnswer(srv, bot, '/q/AB12CD');
    expect(before).toBe(true);
  });

  it('the first ask times out (the call is cut at its timeout): a second ask at +5 s, and the next first page sends the head early', async () => {
    let n = 0;
    const bot = fakeBot({ edge: LEARN_ON, pages: [{ hold: true, res: jsonRes(200, QUIZ({ fast: true })) }] });
    const fetchImpl = (url, init) => {
      if (url.endsWith('/edge') && (n += 1) === 1) return new Promise((_, no) => init.signal.addEventListener('abort', () => no(new Error('aborted'))));
      return bot.fetchImpl(url);
    };
    const timers = testTimers();
    const app = express();
    app.set('trust proxy', 1);
    app.use(createWebQuizRouter({ botUrl: BOT, apiKey: KEY, fetchImpl, botTimeoutMs: 20, edgeLearn: { timers } }));
    srv = await start(app);
    await settle();
    expect(timers.laterMs).toBe(5000);
    await timers.fire();
    expect(n).toBe(2);
    const { before } = await firstByteBeforeAnswer(srv, bot, '/q/AB12CD');
    expect(before).toBe(true);
  });

  it('a failed ask keeps re-asking every 5 s until an answer; an explicit learn:false stops all asking', async () => {
    const bot = heldBot();
    const timers = testTimers();
    startEdgeLearn({ callBot: bot.callBot, apply: () => {}, timers });
    bot.answer[0].no(new Error('bot_unreachable'));
    await settle();
    await timers.fire();
    expect(bot.answer.length).toBe(2);
    bot.answer[1].ok({ status: 502, body: null }); // a bot restarting behind its gateway
    await settle();
    await timers.fire();
    expect(bot.answer.length).toBe(3);
    bot.answer[2].ok(ok({ learn: false }));
    await settle();
    expect(timers.later).toBe(null);
    expect(timers.fn).toBe(null);
    await timers.fire(); await timers.tick();
    expect(bot.answer.length).toBe(3);
  });

  it('a reply to ask 1 that lands after ask 2\'s reply was applied is dropped', async () => {
    const bot = heldBot();
    const applied = [];
    const e = startEdgeLearn({ callBot: bot.callBot, apply: (b) => applied.push(b.fast), timers: testTimers() });
    e.refresh(); // ask 2, while ask 1 (boot) is on its way
    expect(bot.answer.length).toBe(2);
    bot.answer[1].ok(ok(ON(true)));
    await settle();
    bot.answer[0].ok(ok(ON(false)));
    await settle();
    expect(applied).toEqual([true]);
  });

  it('a late learn:false to ask 1 after ask 2\'s learn:true does not stop the asking', async () => {
    const bot = heldBot();
    const timers = testTimers();
    const e = startEdgeLearn({ callBot: bot.callBot, apply: () => {}, timers });
    e.refresh();
    bot.answer[1].ok(ok(ON(true)));
    await settle();
    bot.answer[0].ok(ok({ learn: false }));
    await settle();
    expect(timers.fn).not.toBe(null);
  });

  it('replies that land in ask order are all used (only an older reply is dropped)', async () => {
    const bot = heldBot();
    const applied = [];
    const e = startEdgeLearn({ callBot: bot.callBot, apply: (b) => applied.push(b.fast), timers: testTimers() });
    e.refresh();
    bot.answer[0].ok(ok(ON(false)));
    await settle();
    bot.answer[1].ok(ok(ON(true)));
    await settle();
    expect(applied).toEqual([false, true]);
  });

  it('apply() is the one writer: called once per used answer, and exported (another learner\'s answer goes through it)', async () => {
    const bot = heldBot();
    const spy = jest.fn();
    const timers = testTimers();
    const e = startEdgeLearn({ callBot: bot.callBot, apply: spy, timers });
    bot.answer[0].ok(ok(ON(true)));
    await settle();
    expect(spy).toHaveBeenCalledTimes(1);
    await timers.tick();
    bot.answer[1].ok(ok(ON(false)));
    await settle();
    expect(spy).toHaveBeenCalledTimes(2);
    expect(typeof e.apply).toBe('function');
    e.apply(ON(true)); // the page-retry car's answer from the same route
    expect(spy).toHaveBeenCalledTimes(3);
    e.apply({ learn: false, fast: true }); // never anything but a learn:true answer
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it('in the router, lastFast is written only by apply() and the two page answers (no second learner writes it)', () => {
    const src = require('fs').readFileSync(require.resolve('../routes/web-quiz.routes'), 'utf8');
    expect((src.match(/(?<!let )\blastFast = /g) || []).length).toBe(3);
    expect((src.match(/startEdgeLearn\(/g) || []).length).toBe(1);
    expect(src).toMatch(/startEdgeLearn\(\{[^}]*apply: learned \}\)/); // the learner writes only through learned()
    expect(src).toMatch(/const learned = \(b\) => \{[\s\S]*?lastFast = b\.fast === true;\n  \};/);
  });

  // wait_ux and one_face through the router's apply (the router hands its learner out as router.edgeLearn)
  function router(edge, pages = []) {
    const bot = fakeBot({ edge, pages });
    const r = createWebQuizRouter({ botUrl: BOT, apiKey: KEY, fetchImpl: bot.fetchImpl, edgeLearn: { timers: testTimers() } });
    const app = express();
    app.set('trust proxy', 1);
    app.use(r);
    return { app, edge: r.edgeLearn, bot, pages };
  }
  const WAIT_MARK = 'wq-wbar';

  it('wait_ux: true in the learn answer → the first hub page\'s early frame has the wait bar; false → it has not', async () => {
    for (const [w, want] of [[true, true], [false, false]]) {
      const bot = fakeBot({ edge: { ...LEARN_ON, wait_ux: w }, pages: [{ hold: true, res: jsonRes(200, HUB({ fast: true, ...(w ? { wait_ux: true } : {}) })) }] });
      const s = await start(build(bot.fetchImpl, { timers: testTimers() }));
      await settle();
      const { early, before } = await firstByteBeforeAnswer(s, bot, `/h/${TOKEN}`);
      await new Promise((r) => s.close(r));
      expect(before).toBe(true);
      expect(early.includes(WAIT_MARK)).toBe(want);
    }
  });

  it('wait_hops: true (with wait_ux) in the learn answer → the first hub page\'s early frame has the hop bar; absent keeps it; false clears it', async () => {
    const HOP_MARK = 'beforeunload';
    const r = router({ learn: false });
    srv = await start(r.app);
    await settle();
    const top = async () => {
      r.pages.push({ hold: true, res: jsonRes(200, HUB({ fast: true })) });
      const { early, before } = await firstByteBeforeAnswer(srv, r.bot, `/h/${TOKEN}`);
      expect(before).toBe(true);
      return early;
    };
    // (each page's own hub answer teaches the process too, so each check applies its learn answers right before)
    r.edge.apply({ ...ON(true), wait_ux: true, wait_hops: true });
    expect((await top()).includes(HOP_MARK)).toBe(true);
    r.edge.apply({ ...ON(true), wait_ux: true, wait_hops: true });
    r.edge.apply({ ...ON(true), wait_ux: true }); // a bot that does not say: absent is not false
    expect((await top()).includes(HOP_MARK)).toBe(true);
    r.edge.apply({ ...ON(true), wait_ux: true, wait_hops: false });
    const off = await top();
    expect(off.includes(HOP_MARK)).toBe(false);
    expect(off.includes(WAIT_MARK)).toBe(true);
  });

  it('plain_paint: true in the learn answer → the first guessed quiz head says no words; absent keeps it; false clears it', async () => {
    const NOWORDS = '<html lang="" dir="auto">';
    const r = router({ learn: false });
    srv = await start(r.app);
    await settle();
    const top = async (code) => {
      r.pages.push({ hold: true, res: jsonRes(200, QUIZ({ fast: true })) });
      const { early, before } = await firstByteBeforeAnswer(srv, r.bot, `/q/${code}`);
      expect(before).toBe(true);
      return early;
    };
    // (each page's own answer teaches the process too, so each check applies its learn answers right before)
    r.edge.apply({ ...ON(true), plain_paint: true });
    expect((await top('AB12C1')).includes(NOWORDS)).toBe(true);
    r.edge.apply({ ...ON(true), plain_paint: true });
    r.edge.apply({ ...ON(true) }); // a bot that does not say: absent is not false
    expect((await top('AB12C2')).includes(NOWORDS)).toBe(true);
    r.edge.apply({ ...ON(true), plain_paint: false });
    expect((await top('AB12C3')).includes(NOWORDS)).toBe(false);
  });

  it('one_face: true → the closed page carries the one face; an answer without the field keeps it; false clears it', async () => {
    const ur = { headers: { 'accept-language': 'ur' } };
    const r = router({ learn: false });
    srv = await start(r.app);
    await settle();
    const cls = async () => ((await get(srv, '/h/not-a-token', ur)).body.match(/<html lang="ur" dir="rtl"( class="[^"]*")?>/) || [])[1] || '';
    expect(await cls()).not.toMatch(/wq-uf/); // before any learn: today's page
    r.edge.apply({ ...ON(false), one_face: true });
    expect(await cls()).toMatch(/wq-uf/);
    r.edge.apply(ON(false)); // a bot that does not say: absent is not false
    expect(await cls()).toMatch(/wq-uf/);
    r.edge.apply({ ...ON(false), one_face: false });
    expect(await cls()).not.toMatch(/wq-uf/);
  });

  it('wait_ux: an answer without the field keeps what the process had (absent is not false); false clears it', async () => {
    const r = router({ learn: false });
    srv = await start(r.app);
    await settle();
    const top = async () => {
      r.pages.push({ hold: true, res: jsonRes(200, HUB({ fast: true })) });
      const { early, before } = await firstByteBeforeAnswer(srv, r.bot, `/h/${TOKEN}`);
      expect(before).toBe(true);
      return early;
    };
    r.edge.apply({ ...ON(true), wait_ux: true });
    r.edge.apply(ON(true)); // no wait_ux field
    expect((await top()).includes(WAIT_MARK)).toBe(true);
    r.edge.apply({ ...ON(true), wait_ux: true });
    r.edge.apply({ ...ON(true), wait_ux: false });
    expect((await top()).includes(WAIT_MARK)).toBe(false);
  });
});

// The bot slower than the edge's own 10 s limit (BOT_TIMEOUT_MS) on a fresh process's first /h/: a stub bot that answers
// the hub in 11 s, on the test's fake clock. Edge learning on (the boot ask said fast): the frame went first, so the
// timeout ends it with the page asking again (nf=1), never the closed "not open right now" page. Off (today): the same
// timeout is that closed page, a 502.
describe('a fresh process, the bot answers the hub in 11 s (over the edge\'s 10 s limit)', () => {
  let srv;
  afterEach(() => new Promise((r) => (srv ? srv.close(r) : r())));
  const OFF_PAGE = 'The quiz is not open right now';
  const AGAIN = 'location.replace(location.pathname+(location.search?location.search+"&":"?")+"nf=1"+location.hash)';

  function slowHubBot(edge) {
    const calls = [];
    let asked;
    const hubAsked = new Promise((r) => { asked = r; });
    const fetchImpl = (url, init = {}) => {
      calls.push(url.slice(BOT.length));
      if (url.endsWith('/api/internal/wq/edge')) return Promise.resolve(jsonRes(200, edge));
      return new Promise((resolve, reject) => {
        const t = setTimeout(() => resolve(jsonRes(200, HUB({ fast: true }))), 11000);
        if (init.signal) init.signal.addEventListener('abort', () => { clearTimeout(t); const e = new Error('aborted'); e.name = 'AbortError'; reject(e); });
        asked();
      });
    };
    return { fetchImpl, calls, hubAsked };
  }
  async function openFirst(bot, edgeLearn) {
    srv = await start(build(bot.fetchImpl, edgeLearn));
    await settle(); // the boot ask (if any) answered, on the real clock
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'clearImmediate', 'queueMicrotask', 'setInterval', 'clearInterval', 'Date', 'hrtime', 'performance'] });
    try {
      const res = get(srv, `/h/${TOKEN}`);
      await bot.hubAsked;
      await jest.advanceTimersByTimeAsync(10000); // the edge's limit: the call is aborted (the bot would answer at 11 s)
      return await res;
    } finally {
      jest.useRealTimers();
    }
  }

  it('edge learning on (the boot ask answered fast: true): the Jugnu frame, then the page asks again, never kind "off"', async () => {
    const bot = slowHubBot(LEARN_ON);
    const r = await openFirst(bot, { timers: testTimers() });
    expect(r.status).toBe(200);
    expect(r.body).toMatch(/<link rel="stylesheet" href="\/wq\/wq\.css\?v=/);
    expect(r.body).toContain(AGAIN);
    expect(r.body).not.toContain(OFF_PAGE);
    expect(bot.calls.filter((u) => u.startsWith('/api/internal/wq/hub/')).length).toBe(1);
  });

  test.each([
    ['edge learning off (no learner: today)', false, null],
    ['the learner on, the bot says learn: false', 'learner', { learn: false }],
  ])('%s: the same timeout is today\'s closed page (502, "not open right now")', async (_, mode, edge) => {
    const bot = slowHubBot(edge || { learn: false });
    const r = await openFirst(bot, mode === 'learner' ? { timers: testTimers() } : false);
    expect(r.status).toBe(502);
    expect(r.body).toContain(OFF_PAGE);
    expect(r.body).not.toContain(AGAIN);
  });
});

// Every switch on (the every-switch shape: every 'web_quiz_…' key the bot's services name, read from their source, so a
// switch added tomorrow is covered with no edit): with edge learning on, the first /h/ of a fresh process is the page a
// process that learned from a payload sends today, byte for byte, and the bot is asked the same things besides the learn
// ask. Off vs on on that first page: only the early head's preload lines differ.
describe('every switch on: edge learning changes when the frame starts, never the page or the bot calls', () => {
  let srv;
  afterEach(() => new Promise((r) => (srv ? srv.close(r) : r())));
  const fs = require('fs');
  const path = require('path');
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : /\.js$/.test(e.name) ? [path.join(d, e.name)] : []));
  const EVERY_KEY = [...new Set(walk(path.join(__dirname, '../../bot/shared/services'))
    .flatMap((f) => fs.readFileSync(f, 'utf8').match(/'web_quiz_[a-z0-9_]+'/g) || []).map((s) => s.slice(1, -1)))].sort();
  // The hub answer with every field a switch puts on it set on, and every key as true besides.
  const HUB_ALL = () => HUB({ fast: true, rt: true, ui: { ur2: true }, one_face: true, wait_ux: true, wait_share: true, edge_learn: true,
    ...Object.fromEntries(EVERY_KEY.map((k) => [k, true])) });
  const LEARN_ALL = { learn: true, fast: true, brand: 'niete', rt: true, ui: { ur2: true }, one_face: true, wait_ux: true, wait_share: true };

  async function twoHubOpens(edgeLearn) {
    const calls = [];
    const fetchImpl = (url) => {
      calls.push(url.slice(BOT.length));
      return Promise.resolve(url.endsWith('/api/internal/wq/edge') ? jsonRes(200, LEARN_ALL) : jsonRes(200, HUB_ALL()));
    };
    srv = await start(build(fetchImpl, edgeLearn));
    await settle();
    const first = await get(srv, `/h/${TOKEN}`);
    const second = await get(srv, `/h/${TOKEN}`);
    await new Promise((ok) => srv.close(ok));
    srv = null;
    return { first, second, calls };
  }

  it('the key list is read from the bot\'s services (not hand-picked)', () => {
    expect(EVERY_KEY.length).toBeGreaterThan(50);
    expect(EVERY_KEY).toEqual(expect.arrayContaining(['web_quiz_edge_learn', 'web_quiz_fast', 'web_quiz_wait_ux', 'web_quiz_hub_fanout', 'web_quiz_one_face']));
  });

  it('on vs off: the same page bytes but the early head\'s preload lines, the same bot calls but the learn ask', async () => {
    const on = await twoHubOpens({ timers: testTimers() });
    const off = await twoHubOpens(false);
    expect(on.first.status).toBe(200);
    expect(off.first.status).toBe(200);
    // on: the first open is already the frame-first page, the same bytes today's second open (taught by a payload) sends
    expect(on.first.chunks.length).toBeGreaterThan(1);
    expect(on.first.body).toBe(off.second.body);
    expect(on.second.body).toBe(off.second.body);
    // off's first open is today's one-piece page: only the early head's preload lines are not in it
    const lines = (b) => b.split(/(?=<)/);
    const onlyOn = lines(on.first.body).filter((l) => !lines(off.first.body).includes(l));
    const onlyOff = lines(off.first.body).filter((l) => !lines(on.first.body).includes(l));
    expect(onlyOff.map((l) => l.trim()).filter(Boolean)).toEqual([]);
    expect(onlyOn.length).toBeGreaterThan(0);
    onlyOn.forEach((l) => expect(l.trim()).toMatch(/^(<link rel="preload" [^>]*>|)$/));
    // the bot: the same asks in the same order, the learn ask aside
    expect(on.calls.filter((u) => u !== '/api/internal/wq/edge')).toEqual(off.calls);
    expect(on.calls.filter((u) => u === '/api/internal/wq/edge').length).toBe(1);
    expect(off.calls.length).toBe(2);
  });
});


// Source scan: every frame-time switch the router learns from a hub or quiz payload (a `last<Name> = …` the routes
// assign) must also be written by learned(), the one learner: else a fresh process's first page (edge learning on) has
// the frame without it until its first payload, which is how wait_share was missed once.
describe('source scan: every last<Name> a payload sets is also set in learned()', () => {
  const fs = require('fs');
  const path = require('path');
  // Payload-only switches (not frame-time), each with its reason. Empty today: every last<Name> dresses a page or a frame
  // drawn before (or without) a bot answer.
  // lastPack: the set's hrefs come from a hub payload that names a child, never from a learn answer.
  // lastMin: the minified files' switch is named by a hub payload only, never by a learn answer.
  const PAYLOAD_ONLY = Object.freeze({ lastPack: true, lastMin: true });
  const src = fs.readFileSync(path.join(__dirname, '../routes/web-quiz.routes.js'), 'utf8');
  const assigned = (code) => new Set([...code.matchAll(/(?<![\w.])(last[A-Z]\w*)\s*=(?!=)/g)]
    .filter((m) => !/\b(let|const|var)\s+$/.test(code.slice(Math.max(0, m.index - 8), m.index)))
    .map((m) => m[1]));

  it('a frame-time switch learned from a hub payload must also be in learned() (fresh process)', () => {
    const start = src.indexOf('const learned = (b) => {');
    expect(start).toBeGreaterThan(-1);
    const end = src.indexOf('\n  };', start);
    const inLearned = assigned(src.slice(start, end));
    const outside = assigned(src.slice(0, start) + src.slice(end));
    expect(outside.size).toBeGreaterThanOrEqual(6); // lastBrand, lastRt, lastUi, lastFast, lastWaitUx, lastWaitShare at least
    const missing = [...outside].filter((n) => !inLearned.has(n) && !Object.prototype.hasOwnProperty.call(PAYLOAD_ONLY, n)).sort();
    if (missing.length) throw new Error(`a frame-time switch learned from a hub payload must also be in learned() (fresh process): ${missing.join(', ')}`);
    expect(missing).toEqual([]);
  });
});
