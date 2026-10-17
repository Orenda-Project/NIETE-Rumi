/**
 * The shelf, the videos door and a story in one hop (app_settings web_quiz_one_hop, on only with web_quiz_fast: it
 * builds on the fast first page; the bot's hub answer says `one_hop: true` only when both are on).
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
 * Switch off: today's page byte for byte (fast off, and fast on with one hop off: the golden captured before this
 * change, fixtures/one-hop-off-golden.json), and the scripts behave as today (no WQPRE on the page).
 * The head is sent before the hub's answer is known: it follows the last hub answer the edge saw (as the fast page
 * follows the last `fast`), so the first fast opens after a start are today's.
 *
 * The bot is the network boundary (a fake fetch the test releases by hand); the phone is a vm running the shipped
 * scripts. Invented children only.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const express = require('express');
const crypto = require('crypto');
const R = require('../routes/web-quiz.routes');
const Hop = require('../routes/web-quiz-fast-hop');
const OffCases = require('./fixtures/one-hop-off-cases');
const OFF_GOLDEN = require('./fixtures/one-hop-off-golden.json');

const { createWebQuizRouter, renderHubPage } = R;

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

/**
 * One hub open with the switch on: the head as it reached the phone before the bot answered, and the whole page.
 * The opens before it teach the edge the bot's last answer: the first one `fast` (it is not streamed yet), the
 * second one `one_hop` (streamed, its head sent before that answer was known).
 */
async function fastOpen(payload, before = [HUB({ fast: true, one_hop: true }), HUB({ fast: true, one_hop: true })]) {
  const bot = heldBot([...before.map((b) => jsonRes(200, b)), { hold: true, res: jsonRes(200, payload) }]);
  const srv = await start(build(bot.fetchImpl));
  try {
    for (let i = 0; i < before.length; i += 1) await get(srv, `/h/${TOKEN}`);
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
  const watchers = [];
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
    MutationObserver: function MO(fn) { this.fn = fn; this.observe = () => { watchers.push(this); }; },
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
  return { win, head, fetches, pictures, watchers, ls, run: (src) => vm.runInContext(src, win) };
}
const preloads = (p) => p.head.filter((l) => l.rel === 'preload').map((l) => `${l.as}:${l.href}`).sort();
const flush = () => new Promise((r) => setImmediate(r));

beforeEach(() => Hop._reset());

describe.each(['en', 'ur'])('switch on (%s): the head preloads the next scripts while the bot works', (lang) => {
  test.each([
    ['#stories', ['wq-doors.css', 'wq-doors.js', 'wq-home.css', 'wq-home.js', 'wq-stories.css', 'wq-stories.js']],
    ['#videos', ['wq-doors.css', 'wq-doors.js', 'wq-home.css', 'wq-home.js']],
    ['#games', ['wq-doors.css', 'wq-doors.js', 'wq-home.css', 'wq-home.js']],
    ['#story/b-lost-deer', ['wq-doors.css', 'wq-doors.js', 'wq-home.css', 'wq-home.js', 'wq-stories.css', 'wq-stories.js']],
    ['', []],
  ])('%s', async (hash, files) => {
    const { early, v } = await fastOpen(HUB({ fast: true, one_hop: true, lang }));
    expect(early).not.toMatch(/id="boot"/);
    const p = phone({ hash });
    inline(early).forEach(p.run);
    const as = (f) => (/\.css$/.test(f) ? 'style' : 'script');
    expect(preloads(p)).toEqual(files.map((f) => `${as(f)}:/wq/${f}?v=${v}`).sort());
  });

  test('a phone whose last home was the v3 home preloads the home and its doors on a plain open too', async () => {
    const { early, v } = await fastOpen(HUB({ fast: true, one_hop: true, lang }));
    const p = phone({ store: { wq_h3: '1' } });
    inline(early).forEach(p.run);
    expect(preloads(p)).toEqual([`script:/wq/wq-doors.js?v=${v}`, `script:/wq/wq-home.js?v=${v}`, `style:/wq/wq-doors.css?v=${v}`, `style:/wq/wq-home.css?v=${v}`]);
  });
});

describe.each(['en', 'ur'])('switch on (%s): the tail starts the reads before any script runs', (lang) => {
  const l = lang;
  const SHELF = { lang: l, grade: 3, books: [1, 2, 3, 4, 5, 6].map((n) => ({ id: `b${n}`, title: `Book ${n}`, cover: `/s/b${n}/cover.webp`, lang: l, grade: 3 })) };
  const BOOK = { id: 'b-lost-deer', lang: l, pages: [{ n: 1, image: { url: '/s/b-lost-deer/p1.webp', w: 720, h: 960 } }, { n: 2, image: { url: '/s/b-lost-deer/p2.webp', w: 720, h: 960 } }] };
  const run = async (hash, payload = HUB({ fast: true, one_hop: true, lang }), store = {}) => {
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
    expect((await run('#stories', HUB({ fast: true, one_hop: true, lang, kid: null }))).fetches).toEqual([]);
    expect((await run('#stories', HUB({ fast: true, one_hop: true, lang, practice: 1 }))).fetches).toEqual([]);
    expect((await run('#story/b-lost-deer', HUB({ fast: true, one_hop: true, lang, stories: null }))).fetches).toEqual([]);
    expect((await run('#stories', HUB({ fast: true, one_hop: true, lang, home_v3: 0 }))).fetches).toEqual([]);
  });
  test('the phone remembers whether its home is the v3 home (for the next open\'s head)', async () => {
    expect((await run('')).ls.get('wq_h3')).toBe('1');
    expect((await run('', HUB({ fast: true, one_hop: true, lang, home_v3: 0 }), { wq_h3: '1' })).ls.get('wq_h3')).toBe('0');
  });
});

describe.each(['en', 'ur'])('switch on (%s): a class link to a story (?kid=<chip>#story/<id>) starts the book before the server answers', (lang) => {
  const BOOK = { id: 'b-lost-deer', lang, pages: [{ n: 1, image: { url: '/s/b-lost-deer/p1.webp', w: 720, h: 960 } }] };
  const bookUrl = `/api/wq/stories/book/b-lost-deer/h/${encodeURIComponent(TOKEN)}?kid=${KID}`;
  test('the head alone asks for the book and its first picture; the tail does not ask again', async () => {
    const { early, body } = await fastOpen(HUB({ fast: true, one_hop: true, lang }));
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
    const { early } = await fastOpen(HUB({ fast: true, one_hop: true, lang }));
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
    const { early, body } = await fastOpen(HUB({ fast: true, one_hop: true, lang }));
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
    const B = { ...HUB({ fast: true, one_hop: true, lang }), token: TOKEN };
    const root = p.el();
    p.win.WQDOORS.mount(root, B, { token: TOKEN, lang, ev() {} }, 'stories');
    await flush(); await flush();
    const n = (rx) => p.fetches.filter((f) => rx.test(f.url)).length;
    expect(n(/\/stories\/shelf\//)).toBe(1);
    expect(n(/\/doors\//)).toBe(1);
  });
  test('a failed early read is asked again by the script (never a dead shelf)', async () => {
    const { early, body } = await fastOpen(HUB({ fast: true, one_hop: true, lang }));
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

describe('switch on: the early preload of the home script is the page\'s own script file', () => {
  test('wq-home.js: the head\'s preload href is exactly the page\'s own script tag href, with no crossorigin (a second preload of it shares one download)', async () => {
    const { early, body } = await fastOpen(HUB({ fast: true, one_hop: true, home_v3: 1 }));
    const p = phone({ hash: '#stories' });
    inline(early).forEach(p.run);
    const pre = p.head.filter((e) => /wq-home\.js/.test(e.href || ''));
    expect(pre.length).toBe(1);
    const own = /<script src="(\/wq\/wq-home\.js\?v=[^"]+)" defer><\/script>/.exec(body);
    expect(own).not.toBeNull();
    expect(pre[0].href).toBe(own[1]);
    expect(pre[0].as).toBe('script');
    expect(Object.keys(pre[0]).filter((k) => /cross/i.test(k))).toEqual([]);
    expect(early).not.toMatch(/crossorigin/i);
  });
});

describe('switch on: the shelf\'s covers below the fold wait until they scroll into view', () => {
  test('every cover starts blank; the first four are fetched as the shelf lands; one gets its picture when seen', async () => {
    const { early, body } = await fastOpen(HUB({ fast: true, one_hop: true }));
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
    // the shelf (unchanged script) draws them with native lazy loading; the page's watcher turns each one blank-first
    imgs.forEach((h) => { expect(h).toMatch(/ loading="lazy"/); expect(h).toMatch(/ src="\/s\/b\d\/c\.webp"/); });
    expect(p.watchers.length).toBe(1);
    const fake = (h) => { const a = { loading: 'lazy', width: '160', height: '240', src: /src="([^"]+)"/.exec(h)[1] }; return { a, removeAttribute(k) { delete a[k]; }, setAttribute(k, v) { a[k] = v; } }; };
    const els = imgs.map(fake);
    const node = { nodeType: 1, matches: () => false, querySelectorAll: (sel) => { expect(sel).toBe("img[loading='lazy'][width='160'][height='240']"); return els; } };
    p.watchers[0].fn([{ addedNodes: [{ nodeType: 3 }, node] }]);
    els.forEach((e) => { expect(e.a.loading).toBeUndefined(); expect(e.a.srcset).toMatch(/^data:image\/gif;base64,/); expect(e.a.onload).toBe('WQPRE.see(this)'); expect(e.a.src).toMatch(/^\/s\/b\d\/c\.webp$/); });
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
    const { early } = await fastOpen(HUB({ fast: true, one_hop: true }));
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

// ── The switch: web_quiz_one_hop (the bot's hub answer says `one_hop: true` only with it and web_quiz_fast on) ──
const sha = (s) => ({ bytes: Buffer.byteLength(s), sha256: crypto.createHash('sha256').update(s).digest('base64') });
const hashed = (pages) => Object.fromEntries(Object.entries(pages).map(([k, v]) => [k, typeof v === 'string' ? sha(v) : { early: sha(v.early), body: sha(v.body) }]));
const { _note: _golden, ...GOLDEN } = OFF_GOLDEN;

describe('one hop off: the hub page is today\'s byte for byte (the golden captured before this change)', () => {
  test('fast off, and fast on with one hop off (no `one_hop` in the hub\'s answer): EN/UR x {default, home_v3 0, locked}', async () => {
    expect(hashed(await OffCases.cases(R))).toEqual(GOLDEN);
  });
  // The bot sends `one_hop: true` or nothing; whatever else an answer carries, only the boolean true turns it on.
  test.each([['the string "true"', 'true'], ['the string \'"true"\'', '"true"'], ['"yes"', 'yes'], ['1', 1], ['{enabled:true}', { enabled: true }], ['false', false], ['null', null]])(
    'an answer with one_hop %s is off: the head is today\'s, the page carries no early reads, the next open\'s head is today\'s', async (_, odd) => {
      const off = HUB({ fast: true, one_hop: odd });
      const s = await fastOpen(off, [off, off]);
      expect(sha(OffCases.normV(s.early))).toEqual(GOLDEN.fast_en_default.early);
      expect(s.body).not.toMatch(/WQPRE/);
      // a page with no early head never has an early read either: the page's tail is today's, its boot JSON aside
      expect(s.body.replace(`,"one_hop":${JSON.stringify(odd)}`, '')).not.toMatch(/WQPRE|WQLZ/);
    });
  test('absent: the page with fast on is today\'s, and stays so open after open', async () => {
    const off = HUB({ fast: true });
    const s = await fastOpen(off, [off, off, off]);
    expect({ early: sha(OffCases.normV(s.early)), body: sha(OffCases.normV(s.body)) }).toEqual(GOLDEN.fast_en_default);
  });
});

describe('one hop on (both switches): the head follows the last hub answer the edge saw', () => {
  test('after a start: the first streamed open is today\'s (its head was sent before the answer); from the next one the early reads ride along', async () => {
    const on = HUB({ fast: true, one_hop: true });
    // first open: not streamed (the edge has not seen `fast` yet); second: streamed, today's head, learns one_hop
    const second = await fastOpen(on, [on]);
    expect(sha(OffCases.normV(second.early))).toEqual(GOLDEN.fast_en_default.early);
    expect(second.early).not.toMatch(/WQPRE/);
    // its own tail follows its own answer at once (a no-op without the head: the call checks for WQPRE first)
    expect(second.body).toMatch(/window\.WQPRE&&WQPRE\.go&&WQPRE\.go\(/);
    const third = await fastOpen(on, [on, on]);
    expect(third.early).toMatch(/window\.WQPRE=|w\.WQPRE=/);
  });
  test('flipped off: the next answer without `one_hop` has today\'s tail; the open after it has today\'s head again', async () => {
    const on = HUB({ fast: true, one_hop: true });
    const off = HUB({ fast: true });
    const lag = await fastOpen(off, [on, on]);
    expect(lag.early).toMatch(/WQPRE/); // sent before the flip was known (one open late, as the fast page itself)
    expect(lag.body.slice(lag.early.length)).not.toMatch(/WQPRE/);
    const after = await fastOpen(off, [on, on, off]);
    expect({ early: sha(OffCases.normV(after.early)), body: sha(OffCases.normV(after.body)) }).toEqual(GOLDEN.fast_en_default);
  });
  test('one hop on without the fast page (the bot never says so, but an answer could): today\'s one-shot page, no early reads', async () => {
    for (const [lang, name] of [['en', 'default'], ['ur', 'default']]) {
      const html = renderHubPage({ payload: HUB({ lang, one_hop: true }), token: TOKEN, origin: OffCases.ORIGIN, assetV: OffCases.ASSET_V });
      expect(html).not.toMatch(/WQPRE|WQLZ/);
      expect(sha(html.replace(',"one_hop":true', ''))).toEqual(GOLDEN[`off_${lang}_${name}`]);
    }
  });
});

// The tail's shelf read still IN FLIGHT when the shelf script asks for it (the order on a real phone), then it fails,
// answers non-OK, or (case iii) answered non-OK before the script asked: the script's shelf is always asked again from
// the network and drawn. Hop.head() + Hop.tail() inline scripts, then the shipped wq-stories.js, in a vm.
describe('one hop on: a failed or non-OK early read is asked again from the network (never a dead shelf)', () => {
  const SHELF1 = { lang: 'en', grade: 3, books: [{ id: 'b1', title: 'Book 1', cover: '/s/b1/c.webp', lang: 'en', grade: 3 }] };
  const okRes = (body) => { const r = { status: 200, ok: true, json: () => Promise.resolve(JSON.parse(JSON.stringify(body))) }; r.clone = () => ({ ...r }); return r; };
  const badRes = () => { const r = { status: 500, ok: false, json: () => Promise.resolve({}) }; r.clone = () => ({ ...r }); return r; };
  function heldPhone(firstShelf) {
    const fetches = [];
    const ls = new Map();
    let first = true;
    const win = {
      location: { hash: '#stories', search: '', pathname: `/h/${TOKEN}` },
      localStorage: { getItem: (k) => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, String(v)) },
      fetch: (url, init) => {
        fetches.push({ url, init });
        if (first && /\/stories\/shelf\//.test(url)) { first = false; return firstShelf.promise; }
        return Promise.resolve(okRes(/\/stories\/shelf\//.test(url) ? SHELF1 : {}));
      },
      Image: function Image() {},
      encodeURIComponent, JSON, Date, Promise, String, RegExp, Object, Array, Math, Number, setTimeout, clearTimeout,
    };
    win.window = win;
    win.document = { head: { appendChild() {} }, documentElement: {}, title: '', createElement: () => ({ setAttribute() {} }), getElementById: () => null, querySelector: () => null, addEventListener() {} };
    vm.createContext(win);
    return { win, fetches, run: (src) => vm.runInContext(src, win) };
  }
  const deferred = () => { const d = {}; d.promise = new Promise((res, rej) => { d.resolve = res; d.reject = rej; }); return d; };
  const shelfEl = () => ({ attrs: {}, innerHTML: '', setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k] == null ? null : this.attrs[k]; }, addEventListener() {}, querySelector: () => null, querySelectorAll: () => [] });
  const shelfReads = (p) => p.fetches.filter((f) => /\/stories\/shelf\//.test(f.url)).length;

  async function open(firstShelf, settleBeforeScript) {
    const p = heldPhone(firstShelf);
    Hop.tail('', { one_hop: true }); // the edge's last hub answer said one_hop: the head carries the early reads
    const head = inline(Hop.head('abcdef0123'));
    expect(head.length).toBe(1);
    const tail = inline(Hop.tail('<script id="boot">var B={}</script>\n', { kid: KID, lang: 'en', home_v3: 1, stories: { on: 1 }, one_hop: true }, TOKEN));
    head.concat(tail).forEach(p.run);
    expect(shelfReads(p)).toBe(1); // the tail's early read, in flight
    if (settleBeforeScript) { settleBeforeScript(); await flush(); await flush(); }
    p.run(fs.readFileSync(path.join(WQ, 'wq-stories.js'), 'utf8'));
    const sh = shelfEl();
    p.win.WQSTORIES.shelf(sh, { token: TOKEN, kid: KID, lang: 'en' });
    return { p, sh };
  }

  test('in flight, then FAILED: the script\'s shelf is re-asked from the network (never a dead shelf)', async () => {
    const d = deferred();
    const { p, sh } = await open(d, null);
    await flush();
    d.reject(new TypeError('Failed to fetch'));
    await flush(); await flush(); await flush(); await flush();
    expect(shelfReads(p)).toBe(2);
    expect(sh.innerHTML).toMatch(/wqs-book/);
  });
  test('in flight, then NON-OK (500): the script\'s shelf is re-asked from the network', async () => {
    const d = deferred();
    const { p, sh } = await open(d, null);
    await flush();
    d.resolve(badRes());
    await flush(); await flush(); await flush(); await flush();
    expect(shelfReads(p)).toBe(2);
    expect(sh.innerHTML).toMatch(/wqs-book/);
  });
  test('settled NON-OK (500) before the script asks: re-asked from the network', async () => {
    const d = deferred();
    const { p, sh } = await open(d, () => d.resolve(badRes()));
    await flush(); await flush(); await flush(); await flush();
    expect(shelfReads(p)).toBe(2);
    expect(sh.innerHTML).toMatch(/wqs-book/);
  });
  test('in flight, then OK: the script takes the early answer (one network read)', async () => {
    const d = deferred();
    const { p, sh } = await open(d, null);
    await flush();
    d.resolve(okRes(SHELF1));
    await flush(); await flush(); await flush(); await flush();
    expect(shelfReads(p)).toBe(1);
    expect(sh.innerHTML).toMatch(/wqs-book/);
  });
});

// The rows assert what only the switch on can do: an early read issued and re-used. Off (every row): no early read, no
// head preload, the shelf's own read is today's one network read; on: one early read, and the shelf script's own GET
// of that URL never reaches the network (it takes the early answer).
describe('the switch rows assert what only "on" can do: the early read', () => {
  const SHELF6 = { lang: 'en', grade: 3, books: [1, 2, 3].map((n) => ({ id: `b${n}`, title: `Book ${n}`, cover: `/s/b${n}/c.webp`, lang: 'en', grade: 3 })) };
  const shelfEl = () => ({ attrs: {}, innerHTML: '', setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k] == null ? null : this.attrs[k]; }, addEventListener() {}, querySelector: () => null, querySelectorAll: () => [] });
  async function openStories(answer) {
    const s = await fastOpen(answer, [answer, answer]);
    const p = phone({ hash: '#stories', answers: { '/stories/shelf/': SHELF6 } });
    const tail = s.body.slice(s.early.length);
    inline(s.early).concat(inline(tail.slice(0, tail.indexOf('<script src=')))).forEach(p.run);
    await flush(); await flush();
    const early = { reads: p.fetches.length, preloads: preloads(p).length, WQPRE: typeof p.win.WQPRE };
    p.run(fs.readFileSync(path.join(WQ, 'wq-stories.js'), 'utf8'));
    const sh = shelfEl();
    p.win.WQSTORIES.shelf(sh, { token: TOKEN, kid: KID, lang: 'en' });
    await flush(); await flush(); await flush();
    return { early, shelfReads: p.fetches.filter((f) => /\/stories\/shelf\//.test(f.url)).length, drawn: /wqs-book/.test(sh.innerHTML) };
  }
  test.each([['absent (no row, or a failed read: the bot sends nothing)', undefined], ['the string "true"', 'true'], ['the string \'"true"\'', '"true"'], ['"yes"', 'yes'], ['1', 1], ['{enabled:true}', { enabled: true }]])(
    'off, one_hop %s: no early read, no head preload, the shelf\'s one read is its own', async (_, odd) => {
      const r = await openStories(odd === undefined ? HUB({ fast: true }) : HUB({ fast: true, one_hop: odd }));
      expect(r.early).toEqual({ reads: 0, preloads: 0, WQPRE: 'undefined' });
      expect(r.shelfReads).toBe(1);
      expect(r.drawn).toBe(true);
    });
  test('on (one_hop true): one early read before any script, re-used by the shelf (the script\'s own GET never reaches the network)', async () => {
    const r = await openStories(HUB({ fast: true, one_hop: true }));
    expect(r.early.reads).toBe(2); // the door's rows and the shelf, each once
    expect(r.early.preloads).toBe(6);
    expect(r.shelfReads).toBe(1); // the early one: the script added none
    expect(r.drawn).toBe(true);
  });
});
