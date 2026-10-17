/**
 * One file each for the child home's scripts and styles (the bot's hub payload says `pack: true` when app_settings
 * web_quiz_pack is on).
 *
 * On: the hub page links ONE stylesheet and ONE script for the home (wq-tel, keep my place, the home, its door screens,
 * the Jugnu corner: only the ones the payload names), then hub.js as its own tag. GET /wq/pack/<set>.js|.css answers
 * the files joined, built once and kept in memory, immutable for a year at the page's own ?v=; any other ?v= gets the
 * same bytes, not kept. A name outside the fixed list is a 404. With the minified files on too, the pack is built from
 * the minified copies (one builder, two inputs).
 * Off (no `pack`, or anything but true): the hub page is today's, byte for byte, plain and streamed (golden).
 *
 * The page's own scripts run in a vm with a small fake DOM: with the pack on, the home's first mount on #stories draws
 * the door screen at once (no second request for the door files), and the lazy files still find their ?v= (hub.js's
 * tag for the home's loader, the reader's own tag for the reader's).
 *
 * The bot is the network boundary (a fake fetch). No first-party module is mocked. Invented children only.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const http = require('http');
const express = require('express');
const { createWebQuizRouter, renderHubPage, assetVersion, minifySource } = require('../routes/web-quiz.routes');

const BOT = 'http://bot.test';
const KEY = 'test-internal-key';
const WQ = path.join(__dirname, '..', 'public', 'wq');
const ORIGIN = 'http://portal.example';
const TOKEN = 'eyJrIjoiaCIsImlkcyI6WyJhIl0sImV4cCI6OTk5OTk5OTk5OX0.AbCdEfGhIjKlMnOpQrStUv';
const KID = '0123456789abcdef';
const GOLDEN = path.join(__dirname, 'web-quiz-pack-off.golden.json');
const HEX = assetVersion();

function jsonRes(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) },
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  };
}
// A hub payload with every part the tail can name: keep my place, the v3 home, the Jugnu corner (with the install
// manifest) and Stories.
const HUB = (extra = {}) => ({
  lang: 'en', kids: [{ chip: KID, first: 'Zara', animal: 'owl', grade: '3' }], kid: KID,
  teacher: null, again: [], recs: [], challenge: { on: true, exercises: [] }, lib: null, brand: 'niete', rt: false,
  bind: { on: true }, home_v3: 1, play: { install: true }, stories: { on: true },
  doors: { stories: [{ kind: 'shelf' }], games: [], videos: null },
  ...extra,
});
const BARE = (extra = {}) => HUB({ bind: undefined, play: undefined, ...extra });

const start = (app) => new Promise((resolve) => { const srv = app.listen(0, () => resolve(srv)); })
  .then((srv) => Promise.resolve(app.minReady).then(() => srv));
function get(srv, p, headers = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: srv.address().port, method: 'GET', path: p, headers: { host: 'portal.example', ...headers } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => { const buf = Buffer.concat(chunks); resolve({ status: res.statusCode, headers: res.headers, buf, body: buf.toString('utf8') }); });
    });
    r.on('error', reject);
    r.end();
  });
}
const bot = (answers) => () => Promise.resolve(answers.shift());
function build(answers, extra = {}) {
  const app = express();
  app.set('trust proxy', 1);
  const router = createWebQuizRouter({ botUrl: BOT, apiKey: KEY, fetchImpl: bot(answers), ...extra });
  app.use(router);
  app.minReady = router.minifyReady;
  return app;
}
const raw = (f) => fs.readFileSync(path.join(WQ, f));
const joinJs = (bufs) => Buffer.concat(bufs.flatMap((b, i) => (i ? [Buffer.from(';\n'), b] : [b])));
const joinCss = (bufs) => Buffer.concat(bufs.flatMap((b, i) => (i ? [Buffer.from('\n'), b] : [b])));
// The page's stylesheets and scripts by URL, in page order (what the phone asks for from the html itself).
const tagsOf = (html) => [...html.matchAll(/<link rel="stylesheet" href="([^"]+)">|<script src="([^"]+)"[^>]*><\/script>/g)].map((m) => m[1] || m[2]);
const preloadsOf = (html) => [...html.matchAll(/<link rel="preload" href="([^"]+)" as="(script|style)">/g)].map((m) => m[1]);
// the version and the bot's wait (the streamed page's mark) are not the page's shape
const noV = (html) => html.split(HEX).join('<V>').replace(/"wq-bot",\{detail:\d+\}/, '"wq-bot",{detail:<ms>}');

// Two pages: today's plain render and today's streamed render (web_quiz_fast on), for the full payload.
async function offPages(payload) {
  const srv = await start(build([jsonRes(200, payload), jsonRes(200, payload), jsonRes(200, { ...payload, fast: true }), jsonRes(200, { ...payload, fast: true })]));
  try {
    await get(srv, `/h/${TOKEN}`);
    const plain = (await get(srv, `/h/${TOKEN}`)).body;
    await get(srv, `/h/${TOKEN}`); // the edge learns `fast`
    const fast = (await get(srv, `/h/${TOKEN}`)).body;
    return { plain: noV(plain), fast: noV(fast) };
  } finally { await new Promise((r) => srv.close(r)); }
}

describe('switch off: the hub page is today\'s, byte for byte (golden recorded before the switch existed)', () => {
  test('no `pack` key, plain and streamed', async () => {
    const pages = await offPages(HUB());
    if (process.env.WQ_PACK_RECORD === '1') fs.writeFileSync(GOLDEN, `${JSON.stringify(pages, null, 1)}\n`);
    const golden = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'));
    expect(pages.plain).toBe(golden.plain);
    expect(pages.fast).toBe(golden.fast);
    expect(pages.fast).toContain('<link rel="preload" href="/wq/wq-tel.js?v=<V>" as="script">');
  });
  test.each([['the string "true"', 'true'], ['false', false], ['1', 1]])('`pack` set to %s is off: today\'s page', async (_, v) => {
    const golden = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'));
    const pages = await offPages(HUB({ pack: v }));
    // the boot JSON carries the bot's word as it came; nothing else on the page moves
    const strip = (h) => h.replace(`,"pack":${JSON.stringify(v)}`, '');
    expect(strip(pages.plain)).toBe(golden.plain);
    expect(strip(pages.fast)).toBe(golden.fast);
    expect(pages.plain).not.toContain('/wq/pack/');
  });
});

describe('switch on: the hub page links one stylesheet and one script for the home, then hub.js', () => {
  test('every part: html-level tags are exactly [wq.css, pack.css, pack.js, hub.js]', () => {
    const html = renderHubPage({ payload: HUB({ pack: true }), token: TOKEN, origin: ORIGIN, assetV: HEX });
    expect(tagsOf(html)).toEqual([
      `/wq/wq.css?v=${HEX}`,
      `/wq/pack/bind.home.doors.css?v=${HEX}`,
      `/wq/pack/tel.bind.home.doors.play.js?v=${HEX}`,
      `/wq/hub.js?v=${HEX}`,
    ]);
    expect(html).toContain('<script id="boot" type="application/json">');
    expect(html).toMatch(/<link rel="manifest" href="\/h\/[^"]+\/manifest\.webmanifest/);
  });
  test('a script the payload does not name is not in the pack (no keep my place, no Jugnu corner)', async () => {
    const html = renderHubPage({ payload: BARE({ pack: true }), token: TOKEN, origin: ORIGIN, assetV: HEX });
    expect(tagsOf(html)).toEqual([`/wq/wq.css?v=${HEX}`, `/wq/pack/home.doors.css?v=${HEX}`, `/wq/pack/tel.home.doors.js?v=${HEX}`, `/wq/hub.js?v=${HEX}`]);
    const srv = await start(build([]));
    try {
      const js = await get(srv, `/wq/pack/tel.home.doors.js?v=${HEX}`);
      expect(js.buf.equals(joinJs(['wq-tel.js', 'wq-home.js', 'wq-doors.js'].map(raw)))).toBe(true);
      expect(js.buf.includes(raw('hub-play.js'))).toBe(false);
      expect(js.buf.includes(raw('wq-bind.js'))).toBe(false);
      const css = await get(srv, `/wq/pack/home.doors.css?v=${HEX}`);
      expect(css.buf.includes(raw('wq-bind.css'))).toBe(false);
    } finally { await new Promise((r) => srv.close(r)); }
  });
  test('the read-along preview keeps its own tag, after the pack and before hub.js', () => {
    const html = renderHubPage({ payload: HUB({ pack: true, listen: true }), token: TOKEN, origin: ORIGIN, assetV: HEX });
    const t = tagsOf(html);
    expect(t[2]).toMatch(/^\/wq\/pack\/tel\.bind\.home\.doors\.play\.js/);
    expect(t[3]).toMatch(/^\/wq\/wq-readalong-listen\.js\?v=/);
    expect(t[4]).toBe(`/wq/hub.js?v=${HEX}`);
  });
  test('through the edge: the bot\'s `pack: true` gives the pack page; the next payload without it, today\'s page again', async () => {
    const srv = await start(build([jsonRes(200, HUB({ pack: true })), jsonRes(200, HUB())]));
    try {
      const on = await get(srv, `/h/${TOKEN}`);
      expect(tagsOf(on.body)).toEqual([`/wq/wq.css?v=${HEX}`, `/wq/pack/bind.home.doors.css?v=${HEX}`, `/wq/pack/tel.bind.home.doors.play.js?v=${HEX}`, `/wq/hub.js?v=${HEX}`]);
      const off = await get(srv, `/h/${TOKEN}`);
      expect(off.body).toBe(renderHubPage({ payload: HUB(), token: TOKEN, origin: ORIGIN, assetV: HEX }));
    } finally { await new Promise((r) => srv.close(r)); }
  });
});

describe('GET /wq/pack/<set>.js|.css', () => {
  let srv;
  beforeAll(async () => { srv = await start(build([])); });
  afterAll(() => new Promise((r) => srv.close(r)));

  test('the files in the order the page ran them, joined by ";\\n" (js) or a new line (css), immutable for a year at the page\'s ?v=', async () => {
    const js = await get(srv, `/wq/pack/tel.bind.home.doors.play.js?v=${HEX}`);
    expect(js.status).toBe(200);
    expect(js.headers['content-type']).toMatch(/javascript/);
    expect(js.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(js.buf.equals(joinJs(['wq-tel.js', 'wq-bind.js', 'wq-home.js', 'wq-doors.js', 'hub-play.js'].map(raw)))).toBe(true);
    expect(() => new vm.Script(js.body)).not.toThrow();
    const css = await get(srv, `/wq/pack/bind.home.doors.css?v=${HEX}`);
    expect(css.status).toBe(200);
    expect(css.headers['content-type']).toMatch(/text\/css/);
    expect(css.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(css.buf.equals(joinCss(['wq-bind.css', 'wq-home.css', 'wq-doors.css'].map(raw)))).toBe(true);
  });
  test('a stale or unknown ?v=, or none: the same bytes, not kept (no-cache)', async () => {
    const want = joinJs(['wq-tel.js', 'wq-home.js', 'wq-doors.js'].map(raw));
    for (const q of ['?v=0000000000', '?v=zz', '']) {
      const r = await get(srv, `/wq/pack/tel.home.doors.js${q}`);
      expect([q, r.status, r.headers['cache-control']]).toEqual([q, 200, 'no-cache']);
      expect(r.buf.equals(want)).toBe(true);
    }
  });
  test('a name outside the fixed list is a 404 (no other file, no path)', async () => {
    for (const p of ['wq.js', 'hub.js', 'tel.hub.js', 'tel.evil.js', '..%2Fwq.js', '..%2F..%2Fpackage.json', 'home.tel.js', 'tel.tel.js',
      'tel.css', 'play.css', 'home.doors.txt', '.js', 'tel..home.js', 'TEL.js', 'stories.js']) {
      const r = await get(srv, `/wq/pack/${p}?v=${HEX}`);
      expect([p, r.status]).toEqual([p, 404]);
    }
  });
});

describe('the streamed page (web_quiz_fast on)', () => {
  test('the head preloads the pack the edge last linked (not wq-tel.js); the tail links it', async () => {
    const p = HUB({ fast: true, pack: true });
    const srv = await start(build([jsonRes(200, p), jsonRes(200, p)]));
    try {
      await get(srv, `/h/${TOKEN}`);
      const r = await get(srv, `/h/${TOKEN}`);
      expect(preloadsOf(r.body)).toEqual([`/wq/pack/bind.home.doors.css?v=${HEX}`, `/wq/pack/tel.bind.home.doors.play.js?v=${HEX}`, `/wq/hub.js?v=${HEX}`]);
      expect(r.body).toContain(`<link rel="preload" href="/wq/pack/bind.home.doors.css?v=${HEX}" as="style">`);
      expect(tagsOf(r.body)).toEqual([`/wq/wq.css?v=${HEX}`, `/wq/pack/bind.home.doors.css?v=${HEX}`, `/wq/pack/tel.bind.home.doors.play.js?v=${HEX}`, `/wq/hub.js?v=${HEX}`]);
    } finally { await new Promise((r) => srv.close(r)); }
  });
  test('the switch turned off: the next streamed page is today\'s again (golden)', async () => {
    const golden = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'));
    const on = HUB({ fast: true, pack: true });
    const off = HUB({ fast: true });
    const srv = await start(build([jsonRes(200, on), jsonRes(200, off), jsonRes(200, off)]));
    try {
      await get(srv, `/h/${TOKEN}`);
      await get(srv, `/h/${TOKEN}`); // streamed with the pack's preload; the edge learns it is off
      const r = await get(srv, `/h/${TOKEN}`);
      expect(noV(r.body)).toBe(golden.fast);
    } finally { await new Promise((r) => srv.close(r)); }
  });
});

describe('with the minified files on too (`min: true` and `pack: true`)', () => {
  const MIN_JS = ['wq-tel.js', 'wq-bind.js', 'wq-home.js', 'wq-doors.js', 'hub-play.js'];
  // wq-tel.js stays raw, as its own minified URL does
  const minOf = (f) => (f === 'wq-tel.js' ? raw(f) : Buffer.from(minifySource(raw(f).toString('utf8'), f.endsWith('.css')), 'utf8'));
  test.each([['minify first, then pack', [{ min: true }, { min: true, pack: true }]], ['pack first, then minify', [{ pack: true }, { pack: true, min: true }]]])(
    '%s: the page links the pack at ?v=<hex>m and the pack is the minified copies joined', async (_, steps) => {
      const srv = await start(build(steps.map((s) => jsonRes(200, HUB(s)))));
      try {
        await get(srv, `/h/${TOKEN}`);
        const page = await get(srv, `/h/${TOKEN}`);
        expect(tagsOf(page.body)).toEqual([`/wq/wq.css?v=${HEX}m`, `/wq/pack/bind.home.doors.css?v=${HEX}m`, `/wq/pack/tel.bind.home.doors.play.js?v=${HEX}m`, `/wq/hub.js?v=${HEX}m`]);
        const js = await get(srv, `/wq/pack/tel.bind.home.doors.play.js?v=${HEX}m`);
        expect(js.headers['cache-control']).toBe('public, max-age=31536000, immutable');
        expect(js.buf.equals(joinJs(MIN_JS.map(minOf)))).toBe(true);
        expect(js.buf.length).toBeLessThan(joinJs(MIN_JS.map(raw)).length);
        expect(() => new vm.Script(js.body)).not.toThrow();
        const css = await get(srv, `/wq/pack/bind.home.doors.css?v=${HEX}m`);
        expect(css.buf.equals(joinCss(['wq-bind.css', 'wq-home.css', 'wq-doors.css'].map(minOf)))).toBe(true);
        // the plain version is now stale: the raw files joined, not kept
        const old = await get(srv, `/wq/pack/tel.bind.home.doors.play.js?v=${HEX}`);
        expect(old.headers['cache-control']).toBe('no-cache');
        expect(old.buf.equals(joinJs(MIN_JS.map(raw)))).toBe(true);
      } finally { await new Promise((r) => srv.close(r)); }
    });
});

// ── the page's own scripts, with the pack on ─────────────────────────────────────────────────────────────────────
// A small fake DOM (no jsdom in this package): the page's script tags and the ones the scripts add, matched by
// `script[src*="…"]` exactly as the shipped files ask for them.
function el(extra = {}) {
  return {
    attrs: {}, hidden: false, listeners: {}, parentNode: null,
    setAttribute(k, v) { this.attrs[k] = String(v); }, removeAttribute(k) { delete this.attrs[k]; },
    getAttribute(k) { return this.attrs[k] == null ? null : this.attrs[k]; },
    addEventListener(n, fn) { (this.listeners[n] = this.listeners[n] || []).push(fn); },
    querySelector: () => null, querySelectorAll: () => [], ...extra,
  };
}
function page(html, { hash = '#stories' } = {}) {
  const added = [];
  const scripts = tagsOf(html).filter((u) => /\.js(\?|$)/.test(u)).map((src) => el({ tag: 'script', attrs: { src } }));
  const boot = /<script id="boot" type="application\/json">([\s\S]*?)<\/script>/.exec(html)[1];
  const document = {
    getElementById: (id) => (id === 'boot' ? { textContent: boot } : null),
    querySelector: (sel) => {
      const m = /^script\[src\*="([^"]+)"\]$/.exec(sel);
      if (!m) return null;
      return [...scripts, ...added.filter((x) => x.tag === 'script')].find((s) => String(s.getAttribute('src') || '').includes(m[1])) || null;
    },
    createElement: (tag) => {
      const x = el({ tag });
      // the shipped loaders set .src / .href: kept as the attribute a selector reads
      Object.defineProperty(x, 'src', { get() { return this.attrs.src; }, set(v) { this.attrs.src = v; } });
      Object.defineProperty(x, 'href', { get() { return this.attrs.href; }, set(v) { this.attrs.href = v; } });
      return x;
    },
    addEventListener() {}, visibilityState: 'visible',
    head: { appendChild: (x) => added.push(x) },
  };
  const location = { hash, pathname: `/h/${TOKEN}`, search: '' };
  const win = { scrollTo() {}, addEventListener() {}, location };
  win.window = win;
  const sandbox = { window: win, document, location, localStorage: { getItem: () => null, setItem() {} }, navigator: {}, fetch: () => new Promise(() => {}),
    MutationObserver: function MO() { this.observe = () => {}; }, setTimeout, clearTimeout, setImmediate, JSON, Math, String, Number, Array, Object,
    encodeURIComponent, Date, isFinite, RegExp };
  vm.createContext(sandbox);
  return { sandbox, win, added, urls: () => added.map((x) => x.attrs.src || x.attrs.href) };
}
function fakeRoot(map = {}) {
  return { innerHTML: '', attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k]; }, querySelector: (sel) => map[sel] || null, querySelectorAll: () => [] };
}

describe('the page\'s scripts with the pack on (a vm, the shipped files as the edge serves them)', () => {
  let srv;
  beforeAll(async () => { srv = await start(build([])); });
  afterAll(() => new Promise((r) => srv.close(r)));

  // The page's scripts before hub.js, run in page order, as the edge serves them; then hub.js's first home mount.
  async function firstMount(payload, hash) {
    const html = renderHubPage({ payload, token: TOKEN, origin: ORIGIN, assetV: HEX });
    const P = page(html, { hash });
    const tags = tagsOf(html).filter((u) => /\.js(\?|$)/.test(u));
    expect(tags.filter((u) => u.startsWith('/wq/pack/'))).toHaveLength(1);
    for (const u of tags.slice(0, tags.indexOf(`/wq/hub.js?v=${HEX}`))) vm.runInContext((await get(srv, u)).body, P.sandbox);
    expect(P.win.WQHOME).toBeTruthy(); // hub.js mounts the home it finds (hub.js: window.WQHOME → mount, else loadOnce)
    const root = fakeRoot({ '[data-stories-shelf]': el({ parentNode: {} }) });
    P.win.WQHOME.mount(root, payload, { token: TOKEN, lang: 'en', ev() {}, go() {} });
    return { P, root };
  }

  test('the door files are in before hub.js runs: #stories draws the door screen at the first mount, no request for wq-doors.js/.css', async () => {
    const { P, root } = await firstMount(HUB({ pack: true }), '#stories');
    expect(P.win.WQDOORS).toBeTruthy();
    expect(root.attrs['data-m']).toBe('H3-stories');
    expect(P.urls().filter((u) => /wq-doors/.test(u))).toEqual([]);
    // the reader comes on its own, as its own files at hub.js's ?v=
    expect(P.urls()).toEqual([`/wq/wq-stories.css?v=${HEX}`, `/wq/wq-stories.js?v=${HEX}`]);
  });

  test('the home\'s loader (wq-home.js loadOnce) finds hub.js\'s ?v= with the pack on', async () => {
    const { P } = await firstMount(HUB({ pack: true }), '');
    P.win.WQHOME.loadOnce('wq-book');
    expect(P.urls()).toEqual(expect.arrayContaining([`/wq/wq-book.css?v=${HEX}`, `/wq/wq-book.js?v=${HEX}`]));
    expect(P.urls().filter((u) => /wq-doors/.test(u))).toEqual([]);
  });

  test('the reader\'s own loader (wq-stories.js load) still finds its ?v= from its own tag', async () => {
    const { P } = await firstMount(HUB({ pack: true }), '#stories');
    // the reader's lookup, as the shipped file has it
    const src = fs.readFileSync(path.join(WQ, 'wq-stories.js'), 'utf8');
    expect(src).toContain('document.querySelector(\'script[src*="wq-stories.js"]\'), v = s && /[?&]v=([\\w-]+)/.exec(s.getAttribute(\'src\') || \'\')');
    const s = P.sandbox.document.querySelector('script[src*="wq-stories.js"]');
    expect(s).toBeTruthy();
    expect(/[?&]v=([\w-]+)/.exec(s.getAttribute('src'))[1]).toBe(HEX);
    // and no pack URL is ever taken for the reader's or hub.js's own tag
    expect(P.sandbox.document.querySelector('script[src*="/wq/hub.js"]').getAttribute('src')).toBe(`/wq/hub.js?v=${HEX}`);
  });
});
