/**
 * The light Urdu face (web_quiz_face_lite) reaches an Urdu child's Home with the streamed first page and edge learning on.
 *
 * Live on prod the switch was on and every Urdu Home still drew with wq-nastaliq-6: the streamed head is drawn from what
 * this edge learned (lastUi), the learn answer (every 60 s) said `ui: {ur2: true}` without `fl`, and flushFixes keeps the
 * face the head preloaded. The learn answer also never named the adventure look, so each tick dropped it from the guessed
 * head and the tail added the look's sheet and kit late.
 * Rows: a learn answer's `fl` and `adv` reach the first open after a process start and every later open (a learn tick
 * between two opens keeps them); a learn answer without `adv` keeps what the process had (absent is not false); a head
 * guessed English for an Urdu page (no Urdu face preloaded yet) takes the light face from the answer.
 *
 * The bot is the network boundary (a fake fetch answering by path, hub answers released by hand); the 60 s timer is
 * the test's own. No first-party module is mocked.
 */
const http = require('http');
const express = require('express');
const { createWebQuizRouter } = require('../routes/web-quiz.routes');

const BOT = 'http://bot.test';
const KEY = 'test-internal-key';
const TOKEN = 'eyJrIjoiaCIsImlkcyI6WyJhIl0sImV4cCI6OTk5OTk5OTk5OX0.AbCdEfGhIjKlMnOpQrStUv';
const KID = '0123456789abcdef';

function jsonRes(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) },
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  };
}

// An Urdu child's hub answer with the polished look, the light face and the adventure look on (as prod sends it).
const HUB_UR = (extra = {}) => ({
  lang: 'ur', kids: [{ chip: KID, first: 'Asad Testwala', animal: 'owl', grade: '3' }], kid: KID,
  teacher: null, again: [], recs: [], challenge: null, brand: 'niete', rt: false, fast: true,
  adv: true, one_button: true, ui: { ur2: true, fl: true }, ...extra,
});
const LEARN = (extra = {}) => ({ learn: true, fast: true, brand: 'niete', rt: false, ui: { ur2: true, fl: true }, one_face: false, adv: true, ...extra });

const start = (app) => new Promise((resolve) => { const srv = app.listen(0, () => resolve(srv)); });
const settle = () => new Promise((r) => setTimeout(r, 30));

function get(srv, p, { onChunk, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: srv.address().port, method: 'GET', path: p, headers: { host: 'portal.example', ...headers } }, (res) => {
      const chunks = [];
      res.setEncoding('utf8');
      res.on('data', (c) => { chunks.push(c); if (onChunk) onChunk(c, chunks.length); });
      res.on('end', () => resolve({ status: res.statusCode, body: chunks.join('') }));
    });
    r.on('error', reject);
    r.end();
  });
}

/** /edge answers from `edge()`; hub answers come from `pages` in order, each held until release(). */
function fakeBot({ edge, pages = [] }) {
  let held = [];
  const fetchImpl = (url) => {
    if (url.endsWith('/api/internal/wq/edge')) return Promise.resolve(jsonRes(200, edge()));
    const p = pages.shift();
    return new Promise((r) => held.push(() => r(jsonRes(200, p))));
  };
  return { fetchImpl, release: () => { const h = held; held = []; h.forEach((f) => f()); } };
}

function testTimers() {
  const t = { fn: null, set: (fn) => { t.fn = fn; return { unref: () => {} }; }, clear: () => { t.fn = null; } };
  t.after = () => ({ unref: () => {} });
  t.cancel = () => {};
  t.tick = async () => { if (t.fn) t.fn(); await settle(); };
  return t;
}

function build(fetchImpl, timers) {
  const app = express();
  app.set('trust proxy', 1);
  app.use(createWebQuizRouter({ botUrl: BOT, apiKey: KEY, fetchImpl, edgeLearn: { timers } }));
  return app;
}

/** One open of the Home: what went before the bot answered (the head), and the whole page. */
async function open(srv, bot, p, headers) {
  let early = '';
  let answered = false;
  const answer = () => { if (!answered) { answered = true; bot.release(); } };
  const fallback = setTimeout(answer, 400);
  const res = await get(srv, p, { headers, onChunk: (c, n) => { if (!answered) early += c; if (n === 1) setTimeout(answer, 50); } });
  clearTimeout(fallback);
  return { early, body: res.body };
}

const FACE6 = /wq-nastaliq-6\.woff2/;
const FACE7 = /wq-nastaliq-7\.woff2/;
const preloads = (html) => [...html.matchAll(/<link rel="preload" href="([^"]+)" as="font"/g)].map((m) => m[1]);
const htmlTag = (html) => (/<html [^>]*>/.exec(html) || [''])[0];
// what the page's root ends with, after the tail's one-line fix (if any) ran on the head's class
function rootClass(html) {
  const cls = new Set(((/<html [^>]*class="([^"]*)"/.exec(html) || [])[1] || '').split(/\s+/).filter(Boolean));
  const fix = /<script>\(function\(h\)\{([\s\S]*?)\}\)\(document\.documentElement\)<\/script>/.exec(html.slice(html.indexOf('<body>')));
  if (fix) {
    for (const m of fix[1].matchAll(/h\.classList\.(add|remove)\("([\w-]+)"\)/g)) (m[1] === 'add' ? cls.add(m[2]) : cls.delete(m[2]));
  }
  return cls;
}

describe('the light Urdu face reaches an Urdu Home (edge learning + streamed first page)', () => {
  let srv;
  afterEach(() => new Promise((r) => (srv ? srv.close(r) : r())));

  it('the first open after a process start: the head preloads wq-nastaliq-7 only, with the wq-fl class and its face', async () => {
    const timers = testTimers();
    const bot = fakeBot({ edge: () => LEARN(), pages: [HUB_UR()] });
    srv = await start(build(bot.fetchImpl, timers));
    await settle();
    const { early, body } = await open(srv, bot, `/h/${TOKEN}?lang=ur`);
    expect(preloads(early)).toEqual(['/wq/fonts/wq-nastaliq-7.woff2']);
    expect(early).not.toMatch(FACE6);
    expect(htmlTag(early)).toMatch(/wq-fl/);
    expect(early).toMatch(/<style id="wq-fl">/);
    expect(rootClass(body).has('wq-fl')).toBe(true);
  });

  it('every later open, with a learn tick between each: still wq-nastaliq-7 and the adventure look in the head', async () => {
    const timers = testTimers();
    const bot = fakeBot({ edge: () => LEARN(), pages: [HUB_UR(), HUB_UR(), HUB_UR()] });
    srv = await start(build(bot.fetchImpl, timers));
    await settle();
    for (let i = 0; i < 3; i += 1) {
      const { early, body } = await open(srv, bot, `/h/${TOKEN}?lang=ur`);
      expect([i, preloads(early)]).toEqual([i, ['/wq/fonts/wq-nastaliq-7.woff2']]);
      expect([i, rootClass(body).has('wq-fl')]).toEqual([i, true]);
      // the adventure look's sheet is in the head, not added late by the tail
      expect([i, /wq-adventure\.css/.test(early)]).toEqual([i, true]);
      await timers.tick();
    }
  });

  it('a learn answer without `adv` keeps the look a hub answer taught (absent is not false); `adv: false` clears it', async () => {
    const timers = testTimers();
    let edge = LEARN({ adv: undefined });
    const bot = fakeBot({ edge: () => edge, pages: [HUB_UR(), HUB_UR(), HUB_UR({ adv: false, one_button: false })] });
    srv = await start(build(bot.fetchImpl, timers));
    await settle();
    await open(srv, bot, `/h/${TOKEN}?lang=ur`);
    await timers.tick();
    const second = await open(srv, bot, `/h/${TOKEN}?lang=ur`);
    expect(htmlTag(second.early)).toMatch(/wq-adv/);
    expect(second.early).toMatch(/wq-adventure\.css/);
    edge = LEARN({ adv: false });
    await timers.tick();
    const third = await open(srv, bot, `/h/${TOKEN}?lang=ur`);
    expect(htmlTag(third.early)).not.toMatch(/wq-adv/);
  });

  it('a head guessed English (no ?lang, an English phone) for an Urdu child: the page takes the light face, never -6', async () => {
    const timers = testTimers();
    const bot = fakeBot({ edge: () => LEARN(), pages: [HUB_UR()] });
    srv = await start(build(bot.fetchImpl, timers));
    await settle();
    const { early, body } = await open(srv, bot, `/h/${TOKEN}`, { 'accept-language': 'en-US' });
    expect(htmlTag(early)).toMatch(/lang="en"/);
    expect(preloads(early)).toEqual([]);
    expect(rootClass(body).has('wq-fl')).toBe(true);
    // the tail declares and preloads the light face (inside the fix's string) before the page's scripts
    expect(body).toMatch(/wq-fl.{0,40}insertAdjacentHTML[\s\S]*wq-nastaliq-7\.woff2/);
    expect(body).not.toMatch(FACE6);
  });

  it('a head guessed with -6 (the light face learned off) for a light-face answer keeps -6: one face per page', async () => {
    const timers = testTimers();
    const bot = fakeBot({ edge: () => LEARN({ ui: { ur2: true } }), pages: [HUB_UR()] });
    srv = await start(build(bot.fetchImpl, timers));
    await settle();
    const { early, body } = await open(srv, bot, `/h/${TOKEN}?lang=ur`);
    expect(preloads(early)).toEqual(['/wq/fonts/wq-nastaliq-6.woff2']);
    expect(rootClass(body).has('wq-fl')).toBe(false);
    expect(body).not.toMatch(FACE7);
  });
});
