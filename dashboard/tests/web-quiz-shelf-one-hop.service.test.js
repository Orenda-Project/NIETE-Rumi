/**
 * The shelf, the videos door and a story in one hop (app_settings web_quiz_fast on; the fast first page only).
 *
 * Before: a direct `/h/<t>#stories` asked, one after another, hub.js → wq-home.js → wq-doors.js / wq-stories.js →
 * /api/wq/doors/… and /api/wq/stories/shelf/… — every hop after the bot's answer, so the first cover waited for four
 * round trips on a slow phone even with every file cached. Now:
 *   - the head (sent before the bot answers) reads the hash on the phone and preloads the home's next scripts and styles
 *     at the hub's own ?v= while the bot is still working;
 *   - the tail starts the door's / shelf's / library's / book's read the moment the boot JSON is parsed (before any
 *     script runs), and the door and shelf scripts take that answer instead of asking again (one shelf read per open);
 *   - a story's page-1 picture is fetched as soon as the book arrives; the shelf's first covers likewise, and the covers
 *     below the fold wait until they scroll into view.
 * Switch off: today's page byte for byte, and the scripts behave as today (no WQPRE on the page).
 *
 * The bot is the network boundary (a fake fetch the test releases by hand); the phone is a vm running the shipped
 * scripts. Invented children only.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const express = require('express');
const { createWebQuizRouter, renderHubPage } = require('../routes/web-quiz.routes');

const WQ = path.join(__dirname, '..', 'public', 'wq');
const BOT = 'http://bot.test';
const KEY = 'test-internal-key';
const TOKEN = 'eyJrIjoiaCIsImlkcyI6WyJhIl0sImV4cCI6OTk5OTk5OTk5OX0.AbCdEfGhIjKlMnOpQrStUv';
const KID = '0123456789abcdef';

function jsonRes(status, body) {
  return { status, ok: status >= 200 && status < 300, headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) }, text: async () => JSON.stringify(body) };
}
const HUB = (extra = {}) => ({
  lang: 'en', kids: [{ chip: KID, first: 'Sana', animal: 'owl', grade: '3' }], kid: KID,
  teacher: null, again: [], recs: [], challenge: null, brand: 'niete', rt: false, home_v3: 1, stories: { on: 1 },
  doors: { stories: [{ kind: 'shelf' }], games: [], videos: { watch: true } }, ...extra,
});
const start = (app) => new Promise((resolve) => { const srv = app.listen(0, () => resolve(srv)); });
function get(srv, p, { onFirstChunk } = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: srv.address().port, method: 'GET', path: p, headers: { host: 'portal.example' } }, (res) => {
      const chunks = [];
      res.setEncoding('utf8');
      res.on('data', (c) => { chunks.push(c); if (chunks.length === 1 && onFirstChunk) onFirstChunk(c); });
      res.on('end', () => resolve({ status: res.statusCode, chunks, body: chunks.join('') }));
    });
    r.on('error', reject);
    r.end();
  });
}
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
  app.use(createWebQuizRouter({ botUrl: BOT, apiKey: KEY, fetchImpl }));
  return app;
}

/** One hub open with the switch on: the head as it reached the phone before the bot answered, and the whole page. */
async function fastOpen(payload) {
  const bot = heldBot([jsonRes(200, HUB({ fast: true })), { hold: true, res: jsonRes(200, payload) }]);
  const srv = await start(build(bot.fetchImpl));
  try {
    await get(srv, `/h/${TOKEN}`);
    let early = null;
    const fallback = setTimeout(bot.release, 400);
    const res = await get(srv, `/h/${TOKEN}`, { onFirstChunk: (c) => { early = c; bot.release(); } });
    clearTimeout(fallback);
    return { early, body: res.body, v: res.body.match(/\/wq\/hub\.js\?v=([0-9a-z]+)/)[1] };
  } finally { await new Promise((r) => srv.close(r)); }
}
const inline = (html) => (html.match(/<script>([\s\S]*?)<\/script>/g) || []).map((s) => s.replace(/^<script>|<\/script>$/g, ''));

/** A phone: the page's inline scripts in order, in a vm with a fake head, fetch and Image. */
function phone({ hash = '', search = '', store = {}, answers = {} } = {}) {
  const head = [];
  const fetches = [];
  const pictures = [];
  const ls = new Map(Object.entries(store));
  const answer = (url) => {
    const k = Object.keys(answers).find((a) => url.indexOf(a) >= 0);
    const body = k ? answers[k] : {};
    const res = { status: 200, ok: true, json: () => Promise.resolve(JSON.parse(JSON.stringify(body))), text: () => Promise.resolve(JSON.stringify(body)) };
    res.clone = () => ({ ...res });
    return res;
  };
  const win = {
    location: { hash, search, pathname: `/h/${TOKEN}` },
    localStorage: { getItem: (k) => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, String(v)) },
    fetch: (url, init) => { fetches.push({ url, init }); return Promise.resolve(answer(url)); },
    Image: function Image() { const im = {}; pictures.push(im); return im; },
    encodeURIComponent, JSON, Date, Promise, String, RegExp, Object, Array, Math, Number, setTimeout, clearTimeout,
  };
  win.window = win;
  win.document = {
    head: { appendChild: (el) => head.push(el) },
    documentElement: {}, title: '',
    createElement: (tag) => ({ tag, setAttribute(k, v) { this[k] = v; } }),
    getElementById: () => null, querySelector: () => null, addEventListener() {},
  };
  vm.createContext(win);
  return { win, head, fetches, pictures, ls, run: (src) => vm.runInContext(src, win) };
}
const preloads = (p) => p.head.filter((l) => l.rel === 'preload').map((l) => `${l.as}:${l.href}`).sort();
const flush = () => new Promise((r) => setImmediate(r));

describe.each(['en', 'ur'])('switch on (%s): the head preloads the next scripts while the bot works', (lang) => {
  test.each([
    ['#stories', ['wq-doors.css', 'wq-doors.js', 'wq-home.css', 'wq-home.js', 'wq-stories.css', 'wq-stories.js']],
    ['#videos', ['wq-doors.css', 'wq-doors.js', 'wq-home.css', 'wq-home.js']],
    ['#games', ['wq-doors.css', 'wq-doors.js', 'wq-home.css', 'wq-home.js']],
    ['#story/b-lost-deer', ['wq-doors.css', 'wq-doors.js', 'wq-home.css', 'wq-home.js', 'wq-stories.css', 'wq-stories.js']],
    ['', []],
  ])('%s', async (hash, files) => {
    const { early, v } = await fastOpen(HUB({ fast: true, lang }));
    expect(early).not.toMatch(/id="boot"/);
    const p = phone({ hash });
    inline(early).forEach(p.run);
    const as = (f) => (/\.css$/.test(f) ? 'style' : 'script');
    expect(preloads(p)).toEqual(files.map((f) => `${as(f)}:/wq/${f}?v=${v}`).sort());
  });

  test('a phone whose last home was the v3 home preloads the home and its doors on a plain open too', async () => {
    const { early, v } = await fastOpen(HUB({ fast: true, lang }));
    const p = phone({ store: { wq_h3: '1' } });
    inline(early).forEach(p.run);
    expect(preloads(p)).toEqual([`script:/wq/wq-doors.js?v=${v}`, `script:/wq/wq-home.js?v=${v}`, `style:/wq/wq-doors.css?v=${v}`, `style:/wq/wq-home.css?v=${v}`]);
  });
});

describe.each(['en', 'ur'])('switch on (%s): the tail starts the reads before any script runs', (lang) => {
  const l = lang;
  const SHELF = { lang: l, grade: 3, books: [1, 2, 3, 4, 5, 6].map((n) => ({ id: `b${n}`, title: `Book ${n}`, cover: `/s/b${n}/cover.webp`, lang: l, grade: 3 })) };
  const BOOK = { id: 'b-lost-deer', lang: l, pages: [{ n: 1, image: { url: '/s/b-lost-deer/p1.webp', w: 720, h: 960 } }, { n: 2, image: { url: '/s/b-lost-deer/p2.webp', w: 720, h: 960 } }] };
  const run = async (hash, payload = HUB({ fast: true, lang }), store = {}) => {
    const { early, body } = await fastOpen(payload);
    const p = phone({ hash, store, answers: { '/stories/shelf/': SHELF, '/stories/book/': BOOK } });
    const tail = body.slice(early.length);
    // every inline script of the page, head first, in document order, and nothing after the first page script
    const firstScript = tail.indexOf('<script src=');
    inline(early).concat(inline(tail.slice(0, firstScript))).forEach(p.run);
    await flush(); await flush();
    return p;
  };
  const doorsUrl = (d) => `/api/wq/doors/h/${encodeURIComponent(TOKEN)}?kid=${KID}&d=${d}&l=${l}`;
  const shelfUrl = (extra = '') => `/api/wq/stories/shelf/h/${encodeURIComponent(TOKEN)}?kid=${KID}${extra}&l=${l}`;

  test('#stories: the door\'s rows and the shelf, together; the first covers fetched as the shelf lands', async () => {
    const p = await run('#stories');
    expect(p.fetches.map((f) => f.url).sort()).toEqual([doorsUrl('stories'), shelfUrl()].sort());
    expect(p.fetches.every((f) => f.init && f.init.credentials === 'same-origin')).toBe(true);
    expect(p.pictures.map((i) => i.src)).toEqual(['/s/b1/cover.webp', '/s/b2/cover.webp', '/s/b3/cover.webp', '/s/b4/cover.webp']);
  });
  test('#stories: the shelf read carries the phone\'s grade, language and teacher books as the reader does', async () => {
    const p = await run('#stories', undefined, { wq_st_gl: '4,ur', [`wq_st_t:${KID}`]: 'b9,b7' });
    expect(p.fetches.map((f) => f.url)).toContain(`/api/wq/stories/shelf/h/${encodeURIComponent(TOKEN)}?kid=${KID}&g=4&l=ur&t=${encodeURIComponent('b9,b7')}`);
  });
  test('#videos: the library\'s subjects', async () => {
    const p = await run('#videos');
    expect(p.fetches.map((f) => f.url)).toEqual([`/api/wq/lib/h/${encodeURIComponent(TOKEN)}?kid=${KID}&l=${l}`]);
  });
  test('#story/<id>: the book, and its first page\'s picture the moment the book arrives', async () => {
    const p = await run('#story/b-lost-deer');
    expect(p.fetches.map((f) => f.url)).toEqual([`/api/wq/stories/book/b-lost-deer/h/${encodeURIComponent(TOKEN)}?kid=${KID}`]);
    expect(p.pictures.map((i) => i.src)).toEqual(['/s/b-lost-deer/p1.webp']);
  });
  test('#story/<id>/p2: the picture of the page it opens on', async () => {
    const p = await run('#story/b-lost-deer/p2');
    expect(p.pictures.map((i) => i.src)).toEqual(['/s/b-lost-deer/p2.webp']);
  });
  test('no child chosen yet (a locked or shared phone), a coach\'s preview, stories off: nothing read early', async () => {
    expect((await run('#stories', HUB({ fast: true, lang, kid: null }))).fetches).toEqual([]);
    expect((await run('#stories', HUB({ fast: true, lang, practice: 1 }))).fetches).toEqual([]);
    expect((await run('#story/b-lost-deer', HUB({ fast: true, lang, stories: null }))).fetches).toEqual([]);
    expect((await run('#stories', HUB({ fast: true, lang, home_v3: 0 }))).fetches).toEqual([]);
  });
  test('the phone remembers whether its home is the v3 home (for the next open\'s head)', async () => {
    expect((await run('')).ls.get('wq_h3')).toBe('1');
    expect((await run('', HUB({ fast: true, lang, home_v3: 0 }), { wq_h3: '1' })).ls.get('wq_h3')).toBe('0');
  });
});

describe.each(['en', 'ur'])('switch on (%s): a class link to a story (?kid=<chip>#story/<id>) starts the book before the server answers', (lang) => {
  const BOOK = { id: 'b-lost-deer', lang, pages: [{ n: 1, image: { url: '/s/b-lost-deer/p1.webp', w: 720, h: 960 } }] };
  const bookUrl = `/api/wq/stories/book/b-lost-deer/h/${encodeURIComponent(TOKEN)}?kid=${KID}`;
  test('the head alone asks for the book and its first picture; the tail does not ask again', async () => {
    const { early, body } = await fastOpen(HUB({ fast: true, lang }));
    const p = phone({ hash: '#story/b-lost-deer', search: `?from=link&kid=${KID}&lang=${lang}`, answers: { '/stories/book/': BOOK } });
    inline(early).forEach(p.run);
    await flush(); await flush();
    expect(p.fetches.map((f) => f.url)).toEqual([bookUrl]);
    expect(p.pictures.map((i) => i.src)).toEqual(['/s/b-lost-deer/p1.webp']);
    const tail = body.slice(early.length);
    inline(tail.slice(0, tail.indexOf('<script src='))).forEach(p.run);
    await flush();
    expect(p.fetches.map((f) => f.url)).toEqual([bookUrl]);
  });
  test('no chip, a malformed chip, or not a story: nothing before the server answers', async () => {
    const { early } = await fastOpen(HUB({ fast: true, lang }));
    for (const [hash, search] of [['#story/b-lost-deer', '?from=link'], ['#story/b-lost-deer', '?kid=XYZ'], ['#stories', `?kid=${KID}`]]) {
      const p = phone({ hash, search });
      inline(early).forEach(p.run);
      await flush();
      expect([hash, search, p.fetches]).toEqual([hash, search, []]);
    }
  });
});

/** The shipped door / shelf scripts on a phone whose page started the reads early. */
function scriptsPhone(hash, lang) {
  const p = phone({ hash, answers: { '/stories/shelf/': { lang, grade: 3, books: [{ id: 'b1', title: 'Book 1', cover: '/s/b1/c.webp', lang, grade: 3 }] }, '/doors/': { stories: [], shelf: true } } });
  const el = () => ({ attrs: {}, innerHTML: '', setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k] == null ? null : this.attrs[k]; }, addEventListener() {}, querySelector: () => null, querySelectorAll: () => [] });
  p.el = el;
  return p;
}

describe.each(['en', 'ur'])('switch on (%s): the door and the shelf take the early answer — one read each per open', (lang) => {
  test('two shelves on one open (the home\'s slot, then the door\'s) and the door\'s rows: one network read each', async () => {
    const { early, body } = await fastOpen(HUB({ fast: true, lang }));
    const p = scriptsPhone('#stories', lang);
    const tail = body.slice(early.length);
    inline(early).concat(inline(tail.slice(0, tail.indexOf('<script src=')))).forEach(p.run);
    p.run(fs.readFileSync(path.join(WQ, 'wq-home.js'), 'utf8'));
    p.run(fs.readFileSync(path.join(WQ, 'wq-doors.js'), 'utf8'));
    p.run(fs.readFileSync(path.join(WQ, 'wq-stories.js'), 'utf8'));
    await flush();
    const ctx = { token: TOKEN, kid: KID, lang };
    p.win.WQSTORIES.shelf(p.el(), ctx);
    p.win.WQSTORIES.shelf(p.el(), { token: TOKEN, kid: KID, lang }, { token: TOKEN, lang });
    const B = { ...HUB({ fast: true, lang }), token: TOKEN };
    const root = p.el();
    p.win.WQDOORS.mount(root, B, { token: TOKEN, lang, ev() {} }, 'stories');
    await flush(); await flush();
    const n = (rx) => p.fetches.filter((f) => rx.test(f.url)).length;
    expect(n(/\/stories\/shelf\//)).toBe(1);
    expect(n(/\/doors\//)).toBe(1);
  });
  test('a failed early read is asked again by the script (never a dead shelf)', async () => {
    const { early, body } = await fastOpen(HUB({ fast: true, lang }));
    const p = scriptsPhone('#stories', lang);
    let first = true;
    const real = p.win.fetch;
    p.win.fetch = (url, init) => { if (first && /\/stories\/shelf\//.test(url)) { first = false; p.fetches.push({ url, init }); return Promise.reject(new TypeError('Failed to fetch')); } return real(url, init); };
    const tail = body.slice(early.length);
    inline(early).concat(inline(tail.slice(0, tail.indexOf('<script src=')))).forEach(p.run);
    p.run(fs.readFileSync(path.join(WQ, 'wq-stories.js'), 'utf8'));
    await flush();
    const sh = p.el();
    p.win.WQSTORIES.shelf(sh, { token: TOKEN, kid: KID, lang });
    await flush(); await flush(); await flush();
    expect(p.fetches.filter((f) => /\/stories\/shelf\//.test(f.url)).length).toBe(2);
    expect(sh.innerHTML).toMatch(/wqs-book/);
  });
});

describe('switch on: the shelf\'s covers below the fold wait until they scroll into view', () => {
  test('every cover starts blank; the first four are fetched as the shelf lands; one gets its picture when seen', async () => {
    const { early, body } = await fastOpen(HUB({ fast: true }));
    const books = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => ({ id: `b${n}`, title: `Book ${n}`, cover: `/s/b${n}/c.webp`, lang: 'en', grade: 3 }));
    const p = phone({ hash: '#stories', answers: { '/stories/shelf/': { lang: 'en', grade: 3, books } } });
    const seen = [];
    p.win.IntersectionObserver = function IO(fn, opt) { this.opt = opt; this.observe = (el) => seen.push({ el, fn, io: this }); this.unobserve = () => {}; };
    const tail = body.slice(early.length);
    inline(early).concat(inline(tail.slice(0, tail.indexOf('<script src=')))).forEach(p.run);
    p.run(fs.readFileSync(path.join(WQ, 'wq-stories.js'), 'utf8'));
    const sh = { attrs: {}, innerHTML: '', setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k] == null ? null : this.attrs[k]; }, addEventListener() {} };
    p.win.WQSTORIES.shelf(sh, { token: TOKEN, kid: KID, lang: 'en' });
    await flush(); await flush(); await flush();
    // one shelf read (the early one), the first four covers already asked for
    expect(p.fetches.filter((f) => /\/stories\/shelf\//.test(f.url)).length).toBe(1);
    expect(p.pictures.map((i) => i.src)).toEqual(['/s/b1/c.webp', '/s/b2/c.webp', '/s/b3/c.webp', '/s/b4/c.webp']);
    const imgs = sh.innerHTML.match(/<img[^>]*>/g);
    expect(imgs.length).toBe(9);
    imgs.forEach((h) => { expect(h).toMatch(/ srcset="data:image\/gif;base64,[^"]+"/); expect(h).toMatch(/ onload="WQPRE\.see\(this\)"/); expect(h).toMatch(/ src="\/s\/b\d\/c\.webp"/); });
    // the blank loads → watched; scrolled into view → the srcset goes and the cover's own src loads
    const im = { attrs: { srcset: 'data:x' }, getAttribute(k) { return this.attrs[k] == null ? null : this.attrs[k]; }, removeAttribute(k) { delete this.attrs[k]; } };
    p.win.WQPRE.see(im);
    expect(seen.length).toBe(1);
    seen[0].fn([{ isIntersecting: false, target: im }], seen[0].io);
    expect(im.attrs.srcset).toBe('data:x');
    seen[0].fn([{ isIntersecting: true, target: im }], seen[0].io);
    expect(im.attrs.srcset).toBeUndefined();
    p.win.WQPRE.see(im); // its own picture's load: nothing more to do
    expect(seen.length).toBe(1);
  });
  test('a phone without IntersectionObserver gets every cover at once', async () => {
    const { early } = await fastOpen(HUB({ fast: true }));
    const p = phone({ hash: '' });
    inline(early).forEach(p.run);
    const im = { attrs: { srcset: 'data:x' }, getAttribute(k) { return this.attrs[k] == null ? null : this.attrs[k]; }, removeAttribute(k) { delete this.attrs[k]; } };
    p.win.WQPRE.see(im);
    expect(im.attrs.srcset).toBeUndefined();
  });
});

describe('switch off: today\'s page and today\'s scripts', () => {
  test('the hub page carries no early reads and no starter (byte for byte today\'s render)', () => {
    const html = renderHubPage({ payload: HUB(), token: TOKEN, origin: 'http://portal.example', assetV: 'abcdef0123' });
    expect(html).not.toMatch(/WQPRE/);
  });
  test('without WQPRE the shelf asks the network itself and the covers are today\'s markup', async () => {
    const p = phone({ answers: { '/stories/shelf/': { lang: 'en', grade: 3, books: [1, 2, 3, 4, 5, 6].map((n) => ({ id: `b${n}`, title: `B${n}`, cover: `/s/b${n}/c.webp`, lang: 'en', grade: 3 })) } } });
    p.run(fs.readFileSync(path.join(WQ, 'wq-stories.js'), 'utf8'));
    const sh = { attrs: {}, innerHTML: '', setAttribute(k, v) { this.attrs[k] = v; }, getAttribute() { return null; }, addEventListener() {} };
    p.win.WQSTORIES.shelf(sh, { token: TOKEN, kid: KID, lang: 'en' });
    await flush(); await flush();
    expect(p.fetches.length).toBe(1);
    expect((sh.innerHTML.match(/<img[^>]* src="\/s\/b\d\/c\.webp"[^>]* loading="lazy"/g) || []).length).toBe(6);
    expect(sh.innerHTML).not.toMatch(/srcset=/);
  });
});
