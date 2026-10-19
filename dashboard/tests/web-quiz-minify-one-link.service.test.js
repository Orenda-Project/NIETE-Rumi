/**
 * Minified page files (web_quiz_minify) with the child home's early head (fast, home_pre, home_inline): each script and
 * stylesheet is on a page ONCE, at ONE address.
 *
 * The early head is sent before the bot answers, so it follows what this edge learned from an earlier answer. Live on
 * sandbox, right after the switch went on, the first answer this edge saw with `min: true` was a locked one (a new
 * phone), and a locked answer keeps what the last child's page taught. The heads then named the home's files at the
 * raw ?v=<hex> while the rest of the page (hub.js, the tail) named ?v=<hex>m: a new phone fetched both copies after the
 * load, and a phone with the cookie preloaded the raw ones and used the minified ones (8 stylesheets, 12 scripts).
 * Rows here: every page names each /wq file at one version, the version the page's own hub.js has; with the switch on
 * and the copies made that is the m one, and a carried file holds the minified text only.
 *
 * The bot is the network boundary (a fake fetch; held answers released by hand). No first-party module is mocked.
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const { createWebQuizRouter, assetVersion } = require('../routes/web-quiz.routes');
const HomeInline = require('../routes/web-quiz-home-inline');
const HomePre = require('../routes/web-quiz-home-preload');
const EarlyUnlock = require('../routes/web-quiz-early-unlock');

const BOT = 'http://bot.test';
const KEY = 'test-internal-key';
const TOKEN = 'eyJrIjoiaCIsImlkcyI6WyJhIl0sImV4cCI6OTk5OTk5OTk5OX0.AbCdEfGhIjKlMnOpQrStUv';
const KID = '0123456789abcdef';
const WQ = path.join(__dirname, '..', 'public', 'wq');
const HEX = assetVersion();

function jsonRes(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) },
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  };
}

// The hub answer with the home's speed switches on (as sandbox sends it).
const HUB = (extra = {}) => ({
  lang: 'en', kids: [{ chip: KID, first: 'Asad Testwala', animal: 'owl', grade: '3' }], kid: KID,
  teacher: null, again: [], recs: [], challenge: null, brand: 'niete', rt: false, fast: true, home_pre: true,
  home_v3: true, adv: true, one_button: true, play: { first: null }, home_inline: true,
  ui: extra.lang === 'ur' ? { ur2: true, adv: true } : { adv: true },
  doors: { stories: [{ kind: 'shelf' }], games: [], videos: { watch: true } }, ...extra,
});
const LOCKED = (extra = {}) => ({ lang: 'en', locked: true, kids: [], kid: null, teacher: null, again: [], recs: [], challenge: null, lib: null, brand: 'niete', rt: false, fast: true, home_pre: true, home_inline: true, ...extra });
const MIN = { min: true };

const start = (app) => new Promise((resolve) => { const srv = app.listen(0, () => resolve(srv)); })
  .then((srv) => Promise.resolve(app.minReady).then(() => srv));

function get(srv, p, { onFirstChunk, onChunk, cookie } = {}) {
  return new Promise((resolve, reject) => {
    const headers = { host: 'portal.example', ...(cookie ? { cookie } : {}) };
    const r = http.request({ host: '127.0.0.1', port: srv.address().port, method: 'GET', path: p, headers }, (res) => {
      const chunks = [];
      res.setEncoding('utf8');
      res.on('data', (c) => { chunks.push(c); if (onChunk) onChunk(c); if (chunks.length === 1 && onFirstChunk) onFirstChunk(c); });
      res.on('end', () => resolve({ status: res.statusCode, chunks, body: chunks.join('') }));
    });
    r.on('error', reject);
    r.end();
  });
}

/** A bot whose hub answers come in order; a { hold: true, res } one waits for release(). */
function heldBot(answers) {
  let held = [];
  const fetchImpl = () => {
    const body = answers.shift();
    if (body && body.hold) return new Promise((r) => held.push(() => r(body.res)));
    return Promise.resolve(body && body.res ? body.res : body);
  };
  return { fetchImpl, release: () => { const h = held; held = []; h.forEach((f) => f()); } };
}

function build(fetchImpl) {
  const app = express();
  app.set('trust proxy', 1);
  const router = createWebQuizRouter({ botUrl: BOT, apiKey: KEY, fetchImpl });
  app.use(router);
  app.minReady = router.minifyReady;
  return app;
}

/** A page whose head went before the bot answered: what went early, and the whole page. */
async function flushedOpen(srv, bot, opts = {}) {
  let answered = false; let answeredAtFirstChunk = null; let early = '';
  const answer = () => { if (!answered) { answered = true; bot.release(); } };
  const fallback = setTimeout(answer, 400);
  const res = await get(srv, opts.path || `/h/${TOKEN}`, {
    ...opts,
    onChunk: (c) => { if (!answered) early += c; },
    onFirstChunk: () => { answeredAtFirstChunk = answered; setTimeout(answer, 100); },
  });
  clearTimeout(fallback);
  return { early, answeredAtFirstChunk, body: res.body };
}

// The versions each /wq file (the hub version's files, not the adventure kit's own) is named at, anywhere on the page:
// tags, preloads, carried blocks, the run list.
const ADV = new Set(['wq-adv.js', 'wq-adv-more.js', 'wq-adventure.css']);
function versions(html) {
  const out = {};
  const rx = /\/wq\/([A-Za-z0-9._-]+\.(?:js|css))\?v=([0-9A-Za-z]+)/g;
  let m;
  while ((m = rx.exec(html))) {
    if (ADV.has(m[1])) continue;
    (out[m[1]] = out[m[1]] || new Set()).add(m[2]);
  }
  return Object.fromEntries(Object.entries(out).map(([f, s]) => [f, [...s].sort()]));
}
const allAt = (html, v) => Object.fromEntries(Object.keys(versions(html)).map((f) => [f, [v]]));
// What a phone fetches for this page (tags and preloads), as urls.
function asks(html) {
  const out = [];
  const rx = /<link rel="stylesheet" href="([^"]+)">|<link rel="preload" href="([^"]+)" as="(?:script|style)"[^>]*>|<script src="([^"]+)"[^>]* defer><\/script>/g;
  let m;
  while ((m = rx.exec(html))) out.push(m[1] || m[2] || m[4]);
  return out.filter((u) => /^\/wq\/[^/?]+\.(js|css)\?/.test(u));
}
const carriedJs = (html) => {
  const out = {};
  const rx = /<script type="text\/x-wq" src="([^"]+)"[^>]*>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = rx.exec(html))) out[m[1]] = m[2];
  return out;
};

describe('web_quiz_minify with the early home head: each file once, at one address', () => {
  let srv;
  beforeEach(() => { HomeInline._resetAll(); HomePre._reset(); EarlyUnlock._reset(); });
  afterEach(() => new Promise((r) => (srv ? srv.close(r) : r())));

  for (const lang of ['en', 'ur']) {
    test(`${lang}: a fresh process (after a deploy) whose learner says min: the FIRST page, before any hub answer, names every file at the m version`, async () => {
      const edge = { learn: true, fast: true, brand: 'niete', rt: false, ui: lang === 'ur' ? { ur2: true, adv: true } : { adv: true }, one_face: false, wait_ux: false, home_inline: true, ...MIN };
      const bot = heldBot([{ hold: true, res: jsonRes(200, LOCKED({ lang, ...MIN })) }]);
      const fetchImpl = (url, init) => (String(url).endsWith('/api/internal/wq/edge') ? Promise.resolve(jsonRes(200, edge)) : bot.fetchImpl(url, init));
      const app = express();
      app.set('trust proxy', 1);
      const timers = { set: () => ({ unref() {} }), clear() {}, after: () => ({ unref() {} }), cancel() {} };
      const router = createWebQuizRouter({ botUrl: BOT, apiKey: KEY, fetchImpl, edgeLearn: { timers } });
      app.use(router);
      app.minReady = router.minifyReady;
      srv = await start(app);
      await new Promise((r) => setTimeout(r, 20)); // the learner's one ask
      const { early, body } = await flushedOpen(srv, bot, { path: `/h/${TOKEN}${lang === 'ur' ? '?lang=ur' : ''}` });
      expect(early).toContain(`/wq/hub.js?v=${HEX}m`);
      expect(versions(body)).toEqual(allAt(body, `${HEX}m`));
    });

    test(`${lang}: the switch goes on, seen first on a new phone's locked answer; the next new phone's page names every file once, at the m version, and carries only the minified copies`, async () => {
      const bot = heldBot([
        jsonRes(200, HUB({ lang })), // before the flip: teaches the raw addresses
        jsonRes(200, LOCKED({ lang, ...MIN })), // the flip, first seen on a locked page (keeps what was taught)
        { hold: true, res: jsonRes(200, LOCKED({ lang, ...MIN })) },
      ]);
      srv = await start(build(bot.fetchImpl));
      await get(srv, `/h/${TOKEN}`);
      await get(srv, `/h/${TOKEN}`);
      const { body, answeredAtFirstChunk } = await flushedOpen(srv, bot);
      expect(answeredAtFirstChunk).toBe(false);
      expect(body).toContain(`/wq/hub.js?v=${HEX}m`);
      expect(versions(body)).toEqual(allAt(body, `${HEX}m`));
      // a carried script is the minified copy, never the raw text
      const js = carriedJs(body);
      expect(Object.keys(js).length).toBeGreaterThan(2);
      for (const [href, text] of Object.entries(js)) {
        const file = href.split('?')[0].replace('/wq/', '');
        if (ADV.has(file) || file === 'wq-tel.js') continue; // the kit's own version; wq-tel stays raw (its error columns)
        const raw = fs.readFileSync(path.join(WQ, file), 'utf8');
        expect([href, text.length < raw.length]).toEqual([href, true]);
      }
    });

    test(`${lang}: the same flip, a phone with the cookie: each file asked for once, at the m version (no raw preload)`, async () => {
      const bot = heldBot([
        jsonRes(200, HUB({ lang })),
        jsonRes(200, LOCKED({ lang, ...MIN })),
        { hold: true, res: jsonRes(200, HUB({ lang, ...MIN })) },
      ]);
      srv = await start(build(bot.fetchImpl));
      await get(srv, `/h/${TOKEN}`);
      await get(srv, `/h/${TOKEN}`);
      const { body } = await flushedOpen(srv, bot, { cookie: `wqhc=${HEX}m` });
      const a = asks(body);
      expect(a.length).toBeGreaterThan(3);
      expect(a.filter((u) => !ADV.has(u.split('?')[0].replace('/wq/', '')) && !u.endsWith(`?v=${HEX}m`))).toEqual([]);
      expect(versions(body)).toEqual(allAt(body, `${HEX}m`));
    });
  }

  test('the switch goes on while a head is out (the head named the raw files): that page keeps the head\'s version throughout; the next is all m', async () => {
    const bot = heldBot([
      jsonRes(200, HUB()),
      { hold: true, res: jsonRes(200, HUB(MIN)) },
      { hold: true, res: jsonRes(200, HUB(MIN)) },
    ]);
    srv = await start(build(bot.fetchImpl));
    await get(srv, `/h/${TOKEN}`);
    const first = await flushedOpen(srv, bot);
    expect(versions(first.body)).toEqual(allAt(first.body, HEX));
    const next = await flushedOpen(srv, bot);
    expect(next.body).toContain(`/wq/hub.js?v=${HEX}m`);
    expect(versions(next.body)).toEqual(allAt(next.body, `${HEX}m`));
  });

  test('with the early unlock (a new phone\'s locked page drawn in the last child\'s shape): the flip seen on a locked answer; that page names every file once, at the m version', async () => {
    const EU = { early_unlock: true };
    const bot = heldBot([
      jsonRes(200, HUB(EU)),
      jsonRes(200, LOCKED({ ...EU, ...MIN })),
      { hold: true, res: jsonRes(200, LOCKED({ ...EU, ...MIN })) },
    ]);
    srv = await start(build(bot.fetchImpl));
    await get(srv, `/h/${TOKEN}`);
    await get(srv, `/h/${TOKEN}`);
    const { body } = await flushedOpen(srv, bot);
    expect(body).toContain('/wq/wq-home.css');
    expect(versions(body)).toEqual(allAt(body, `${HEX}m`));
  });

  test('the switch goes off again: the next new phone\'s page names every file once, raw', async () => {
    const bot = heldBot([
      jsonRes(200, HUB(MIN)),
      jsonRes(200, LOCKED()),
      { hold: true, res: jsonRes(200, LOCKED()) },
    ]);
    srv = await start(build(bot.fetchImpl));
    await get(srv, `/h/${TOKEN}`);
    await get(srv, `/h/${TOKEN}`);
    const { body } = await flushedOpen(srv, bot);
    expect(body).toContain(`/wq/hub.js?v=${HEX}"`);
    expect(versions(body)).toEqual(allAt(body, HEX));
  });
});

describe('web_quiz_minify: the adventure look\'s own files (wq-adventure.css, wq-adv.js, wq-adv-more.js) ride it too', () => {
  let srv;
  beforeEach(() => { HomeInline._resetAll(); HomePre._reset(); EarlyUnlock._reset(); });
  afterEach(() => new Promise((r) => (srv ? srv.close(r) : r())));
  const advAt = (html) => {
    const out = {};
    for (const m of html.matchAll(/\/wq\/(wq-adv\.js|wq-adv-more\.js|wq-adventure\.css)\?v=([0-9A-Za-z]+)/g)) (out[m[1]] = out[m[1]] || new Set()).add(m[2]);
    return Object.fromEntries(Object.entries(out).map(([f, s]) => [f, [...s]]));
  };

  for (const lang of ['en', 'ur']) {
    test(`${lang}: on, the page names the kit once, at its m version, and a carried kit file is the minified copy; off, raw`, async () => {
      const bot = heldBot([jsonRes(200, HUB({ lang, ...MIN })), { hold: true, res: jsonRes(200, LOCKED({ lang, ...MIN })) }]);
      srv = await start(build(bot.fetchImpl));
      await get(srv, `/h/${TOKEN}`, { cookie: 'wq_dv=AAAAAAAAAAAAAAAAAAAAAA' });
      const { body } = await flushedOpen(srv, bot);
      const at = advAt(body);
      expect(Object.keys(at).sort()).toEqual(expect.arrayContaining(['wq-adv.js', 'wq-adventure.css']));
      for (const [f, vs] of Object.entries(at)) expect([f, vs.length, /m$/.test(vs[0])]).toEqual([f, 1, true]);
      for (const [href, text] of Object.entries(carriedJs(body))) {
        if (!/\/wq\/wq-adv\.js\?/.test(href)) continue;
        expect(text.length).toBeLessThan(fs.readFileSync(path.join(WQ, 'wq-adv.js'), 'utf8').length);
      }
      // the minified copy is served at that address
      const v = at['wq-adv.js'][0];
      const r = await get(srv, `/wq/wq-adv.js?v=${v}`);
      expect(r.status).toBe(200);
      expect(r.body.length).toBeLessThan(fs.readFileSync(path.join(WQ, 'wq-adv.js'), 'utf8').length);
      await new Promise((ok) => srv.close(ok)); srv = null;
      HomeInline._resetAll(); HomePre._reset(); EarlyUnlock._reset();
      const off = heldBot([jsonRes(200, HUB({ lang })), { hold: true, res: jsonRes(200, LOCKED({ lang })) }]);
      srv = await start(build(off.fetchImpl));
      await get(srv, `/h/${TOKEN}`, { cookie: 'wq_dv=AAAAAAAAAAAAAAAAAAAAAA' });
      const plain = await flushedOpen(srv, off);
      for (const [f, vs] of Object.entries(advAt(plain.body))) expect([f, vs.length, /m$/.test(vs[0])]).toEqual([f, 1, false]);
    });
  }

  test('wq-adv.js asks for wq-adv-more.js (and the sound kit) at its own version, the m one included', () => {
    const src = fs.readFileSync(path.join(WQ, 'wq-adv.js'), 'utf8');
    const rx = new RegExp(/\[\?&\]v=\(([^)]*)\)/.exec(src)[1]);
    expect(rx.exec('d7e696eec1m')[0]).toBe('d7e696eec1m');
  });
});
