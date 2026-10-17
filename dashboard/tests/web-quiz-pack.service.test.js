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
// the read-along preview's own version (the edge hashes the preview and the player it loads)
const LISTEN_V = require('crypto').createHash('sha256')
  .update(fs.readFileSync(path.join(WQ, 'wq-readalong-listen.js'))).update(fs.readFileSync(path.join(WQ, 'wq-readalong.js'))).digest('hex').slice(0, 10);
const LISTEN_GOLDEN = path.join(__dirname, 'web-quiz-pack-listen.golden.json');

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
// (the attribute's value as the browser reads it: &amp; is &)
const attr = (v) => v.replace(/&amp;/g, '&');
const tagsOf = (html) => [...html.matchAll(/<link rel="stylesheet" href="([^"]+)"(?: onerror="[^"]*")?>|<script src="([^"]+)"[^>]*><\/script>/g)].map((m) => attr(m[1] || m[2]));
const preloadsOf = (html) => [...html.matchAll(/<link rel="preload" href="([^"]+)" as="(script|style)">/g)].map((m) => attr(m[1]));
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
    // the ON-only marks are absent, plain and streamed: no pack tag or preload, the home's files as their own tags
    for (const html of [pages.plain, pages.fast]) {
      expect(html).not.toContain('/wq/pack/');
      for (const f of ['wq-tel.js', 'wq-bind.js', 'wq-bind.css', 'wq-home.js', 'wq-home.css', 'hub-play.js']) expect(html).toContain(`/wq/${f}?v=<V>`);
    }
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
  test('the read-along preview (its switch on): the last file in the pack, no tag of its own; one request fewer', () => {
    const before = tagsOf(renderHubPage({ payload: HUB({ listen: true }), token: TOKEN, origin: ORIGIN, assetV: HEX }));
    expect(before).toContain(`/wq/wq-readalong-listen.js?v=${LISTEN_V}`);
    const html = renderHubPage({ payload: HUB({ pack: true, listen: true }), token: TOKEN, origin: ORIGIN, assetV: HEX });
    expect(tagsOf(html)).toEqual([
      `/wq/wq.css?v=${HEX}`,
      `/wq/pack/bind.home.doors.css?v=${HEX}`,
      `/wq/pack/tel.bind.home.doors.play.listen.js?v=${HEX}l${LISTEN_V}&in=/wq/wq-readalong-listen.js`,
      `/wq/hub.js?v=${HEX}`,
    ]);
    expect(html).not.toContain('<script src="/wq/wq-readalong-listen.js');
    expect(html).toContain('&amp;in=/wq/wq-readalong-listen.js" defer>');   // the html escapes its own &
    // the cold home's own requests from the html: one fewer than with the pack and the preview as its own tag
    const packNoListen = tagsOf(renderHubPage({ payload: HUB({ pack: true }), token: TOKEN, origin: ORIGIN, assetV: HEX })).length + 1;
    expect(tagsOf(html).length).toBe(packNoListen - 1);
    expect(tagsOf(html).length).toBe(4);
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

// ── a pack that does not arrive: the home's own loader is the safety net ─────────────────────────────────────────────
// hub.js, as shipped, in a vm whose document holds the page's own tags (from the rendered html): what it asks for when
// the pack's script or stylesheet fails to load. hub.js finds no window.WQHOME and asks for wq-home by its own name
// (loadOnce), once; from there the home's existing failure path takes over (today: a failed wq-home.js draws the hub).
function hubVm(html, { before = [], hash = '', cookie = '', store = new Map() } = {}) {
  const asked = [];
  const fetches = [];
  const timers = [];
  const beacons = [];
  const tags = tagsOf(html).map((u) => ({ getAttribute: (k) => (k === 'src' || k === 'href' ? u : null) }));
  const root = { _h: '', set innerHTML(h) { this._h = h; }, get innerHTML() { return this._h; }, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; },
    getAttribute(k) { return k === 'data-m' ? (this.attrs[k] || 'H2') : null; }, querySelector: () => null, querySelectorAll: () => [], appendChild() {} };
  const boot = /<script id="boot" type="application\/json">([\s\S]*?)<\/script>/.exec(html)[1];
  const win = { scrollTo() {}, addEventListener() {} };
  const document = {
    documentElement: { setAttribute() {}, classList: { toggle() {}, contains: () => false } }, cookie,
    getElementById: (id) => (id === 'wq' ? root : id === 'boot' ? { textContent: boot } : null),
    querySelector: (sel) => {
      const m = /^(?:script|link)\[(?:src|href)\*="([^"]+)"\]$/.exec(sel);
      return m ? tags.find((t) => t.getAttribute('src').includes(m[1])) || null : null;
    },
    createElement: (tag) => ({ tag, l: {}, addEventListener(n, fn) { this.l[n] = fn; } }),
    head: { appendChild: (x) => { asked.push(x); } },
  };
  win.document = document;
  const sandbox = {
    window: win, document, navigator: { sendBeacon: (u, b) => { beacons.push(JSON.parse(b.parts[0])); return true; } }, history: { replaceState() {} }, location: { search: '', hash, protocol: 'https:', pathname: `/h/${TOKEN}` }, Blob: function Blob(parts) { this.parts = parts; },
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => { store.set(k, String(v)); } }, fetch: (u) => { fetches.push(String(u)); return new Promise(() => {}); }, MutationObserver: function MO() { this.observe = () => {}; },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout() {}, Date, JSON, Math, String, Number, Array, Object, Promise, isFinite, encodeURIComponent, Uint8Array, RegExp,
  };
  vm.createContext(sandbox);
  for (const src of before) vm.runInContext(src, sandbox);
  return { sandbox, asked, fetches, timers, beacons, root, urls: () => asked.map((x) => x.src || x.href), run: () => vm.runInContext(fs.readFileSync(path.join(WQ, 'hub.js'), 'utf8'), sandbox) };
}
// The pack stylesheet's tag as the browser builds it: its inline onerror (when the edge writes one) becomes the
// element's handler, fired with the element as `this`.
function packLink(html, sandbox) {
  const m = /<link rel="stylesheet" href="(\/wq\/pack\/[^"]+)"( onerror="([^"]*)")?>/.exec(html);
  expect(m).toBeTruthy();
  const link = { href: m[1], onerror: m[3] ? vm.runInContext(`(function () { ${m[3].replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')} })`, sandbox) : null };
  return { link, fail: () => { if (link.onerror) link.onerror.call(link, { type: 'error' }); } };
}
const count = (urls, u) => urls.filter((x) => x === u).length;

describe('the pack fails to load: the home\'s own loader asks for its files by name, once', () => {
  test('pack script fails (error event, nothing in it ran): hub.js asks /wq/wq-home.js and .css exactly once, at its ?v=', () => {
    const html = renderHubPage({ payload: BARE({ pack: true }), token: TOKEN, origin: ORIGIN, assetV: HEX });
    expect(tagsOf(html)).toContain(`/wq/pack/tel.home.doors.js?v=${HEX}`);
    const H = hubVm(html);   // the pack's script never ran: no window.WQHOME
    H.run();
    expect(H.sandbox.window.WQHOME).toBeUndefined();
    expect(count(H.urls(), `/wq/wq-home.js?v=${HEX}`)).toBe(1);
    expect(count(H.urls(), `/wq/wq-home.css?v=${HEX}`)).toBe(1);
    expect(H.urls().filter((u) => /\/wq\/pack\//.test(u))).toEqual([]);   // never the pack again
    // wq-home.js fails too: the home's existing failure path draws a page, and wq-home.js is not asked again here
    H.asked.find((x) => x.src === `/wq/wq-home.js?v=${HEX}`).l.error();
    expect(H.root.innerHTML).not.toBe('');
    expect(count(H.urls(), `/wq/wq-home.js?v=${HEX}`)).toBe(1);
  });

  test('pack script fails with the minified files on: wq-home.js is asked at the page\'s ?v=<hex>m', () => {
    const html = renderHubPage({ payload: BARE({ pack: true, min: true }), token: TOKEN, origin: ORIGIN, assetV: `${HEX}m` });
    const H = hubVm(html);
    H.run();
    expect(count(H.urls(), `/wq/wq-home.js?v=${HEX}m`)).toBe(1);
  });

  test('pack stylesheet fails (error event), its script ran: wq-home.css (and the other named styles) asked exactly once each', async () => {
    const html = renderHubPage({ payload: HUB({ pack: true }), token: TOKEN, origin: ORIGIN, assetV: HEX });
    const srv = await start(build([]));
    let js;
    try { js = (await get(srv, `/wq/pack/tel.bind.home.doors.play.js?v=${HEX}`)).body; } finally { await new Promise((r) => srv.close(r)); }
    const H = hubVm(html, { before: [js] });   // the pack's script ran: window.WQHOME is there
    const { fail } = packLink(html, H.sandbox);
    fail();
    fail();   // a second error event (a retried fetch) asks for nothing more
    H.sandbox.window.WQHOME = { mount() {}, loadOnce() {} };   // the home mounts from the pack, as it does on the phone
    H.run();
    const css = H.urls().filter((u) => /\.css(\?|$)/.test(u));
    expect(count(css, `/wq/wq-home.css?v=${HEX}`)).toBe(1);
    expect(css).toEqual([`/wq/wq-bind.css?v=${HEX}`, `/wq/wq-home.css?v=${HEX}`, `/wq/wq-doors.css?v=${HEX}`]);
    expect(H.urls().filter((u) => /\.js(\?|$)/.test(u))).toEqual([]);   // the scripts came in the pack: none asked again
  });

  test('pack stylesheet loads: nothing more is asked (the error handler is only a fallback)', () => {
    const html = renderHubPage({ payload: HUB({ pack: true }), token: TOKEN, origin: ORIGIN, assetV: HEX });
    const H = hubVm(html);
    packLink(html, H.sandbox);   // no error event
    H.sandbox.window.WQHOME = { mount() {}, loadOnce() {} };
    H.run();
    expect(H.urls()).toEqual([]);
  });
});

// ── the read-along preview inside the pack ───────────────────────────────────────────────────────────────────────────
describe('the read-along preview in the pack (web_quiz_pack and the read-along switch both on)', () => {
  let srv;
  beforeAll(async () => { srv = await start(build([])); });
  afterAll(() => new Promise((r) => srv.close(r)));
  const LISTEN_PACK = `/wq/pack/tel.bind.home.doors.play.listen.js?v=${HEX}l${LISTEN_V}&in=/wq/wq-readalong-listen.js`;

  test('either switch off: today\'s page, byte for byte (golden recorded before the preview joined the pack)', () => {
    const pages = {
      pack_off_listen_on: noV(renderHubPage({ payload: HUB({ listen: true }), token: TOKEN, origin: ORIGIN, assetV: HEX })),
      pack_on_listen_off: noV(renderHubPage({ payload: HUB({ pack: true }), token: TOKEN, origin: ORIGIN, assetV: HEX })),
    };
    if (process.env.WQ_PACK_RECORD === '1') fs.writeFileSync(LISTEN_GOLDEN, `${JSON.stringify(pages, null, 1)}\n`);
    const golden = JSON.parse(fs.readFileSync(LISTEN_GOLDEN, 'utf8'));
    expect(pages.pack_off_listen_on).toBe(golden.pack_off_listen_on);
    expect(pages.pack_on_listen_off).toBe(golden.pack_on_listen_off);
  });

  test('the pack holds the preview last, in page order; immutable only at the version that covers the preview', async () => {
    const r = await get(srv, LISTEN_PACK);
    expect([r.status, r.headers['cache-control']]).toEqual([200, 'public, max-age=31536000, immutable']);
    expect(r.buf.equals(joinJs(['wq-tel.js', 'wq-bind.js', 'wq-home.js', 'wq-doors.js', 'hub-play.js', 'wq-readalong-listen.js'].map(raw)))).toBe(true);
    // the hub's version alone does not cover the preview's file: same bytes, not kept
    const plain = await get(srv, `/wq/pack/tel.bind.home.doors.play.listen.js?v=${HEX}`);
    expect([plain.status, plain.headers['cache-control']]).toEqual([200, 'no-cache']);
    // and a set without the preview is not kept at the preview's version
    const other = await get(srv, `/wq/pack/tel.home.doors.js?v=${HEX}l${LISTEN_V}`);
    expect(other.headers['cache-control']).toBe('no-cache');
  });

  test('the streamed head preloads the same URL the tail links', async () => {
    const p = HUB({ fast: true, pack: true, listen: true });
    const s2 = await start(build([jsonRes(200, p), jsonRes(200, p)]));
    try {
      await get(s2, `/h/${TOKEN}`);
      const r = await get(s2, `/h/${TOKEN}`);
      expect(preloadsOf(r.body)).toContain(LISTEN_PACK);
      expect(tagsOf(r.body)).toContain(LISTEN_PACK);
      expect(r.body).not.toContain('<script src="/wq/wq-readalong-listen.js');
    } finally { await new Promise((r) => s2.close(r)); }
  });

  // The page's scripts in order, then hub.js, on /h/<t>#listen/<pid>: the preview's boot hook, its address and the
  // player it asks for.
  async function listenBoot(html) {
    const H = hubVm(html, { hash: '#listen/p-sun-12' });
    const tags = tagsOf(html).filter((u) => /\.js(\?|$|&)/.test(u));
    for (const u of tags.slice(0, tags.indexOf(`/wq/hub.js?v=${HEX}`))) vm.runInContext((await get(srv, u)).body, H.sandbox);
    const W = H.sandbox.window;
    expect(W.WQLISTEN).toBeTruthy();
    const calls = [];
    const take = W.WQLISTEN.take;
    W.WQLISTEN.take = function (...a) { calls.push(a.map((x) => typeof x)); return take.apply(this, a); };
    H.sandbox.WQLISTEN = W.WQLISTEN;   // hub.js names it bare (a page global on the phone)
    H.run();
    const player = H.asked.filter((x) => /\/wq\/wq-readalong\.js/.test(x.src || ''));
    expect(player).toHaveLength(1);
    player[0].l.load();
    return { calls, fetches: H.fetches.filter((u) => u.startsWith('/api/wq/listen/')), player: player[0].src, data: H.root.attrs['data-m'] };
  }

  test('the preview\'s boot hook runs once with the same address as today; its player still loads at a version that covers it', async () => {
    const today = await listenBoot(renderHubPage({ payload: HUB({ listen: true }), token: TOKEN, origin: ORIGIN, assetV: HEX }));
    const packed = await listenBoot(renderHubPage({ payload: HUB({ pack: true, listen: true }), token: TOKEN, origin: ORIGIN, assetV: HEX }));
    expect(today.calls).toEqual([['function', 'function', 'function']]);
    expect(packed.calls).toEqual(today.calls);
    expect(today.fetches).toHaveLength(1);
    expect(today.fetches[0]).toMatch(/^\/api\/wq\/listen\/h\/[^/]+\/p-sun-12\?lang=en$/);
    expect(packed.fetches).toEqual(today.fetches);
    expect(packed.data).toBe(today.data);
    expect(today.player).toBe(`/wq/wq-readalong.js?v=${LISTEN_V}`);
    // the pack's version holds the preview's own (the player and the preview change together)
    expect(packed.player).toBe(`/wq/wq-readalong.js?v=${HEX}l${LISTEN_V}`);
  });
});

// ── with the home's retry and plain home (web_quiz_home_fallback_v3, `home_fb`) on the base ──────────────────────────
// The pack adds no failure path of its own: a pack script that does not load leaves no window.WQHOME, and hub.js's one
// home line asks for wq-home by name. Where hub.js carries the retry and the plain home (homeAsk / homeErr), that line
// is homeAsk, so a failed pack goes through it: one retry, then the plain home, each failure counted. Where it does not,
// the line is today's loadOnce (the tests above). These run only on a hub.js that has them (a merge with that change).
const HUB_SRC = fs.readFileSync(path.join(WQ, 'hub.js'), 'utf8');
const HAS_FB = /function homeAsk\(/.test(HUB_SRC) && /function homeErr\(/.test(HUB_SRC);
(HAS_FB ? describe : describe.skip)('the pack fails to load, with the home\'s retry and plain home on the base', () => {
  const failed = (H) => H.beacons.flatMap((b) => b.events).filter((e) => e.n === 'home_load_failed').map((e) => [e.file, e.i]);
  const homeJs = (H) => H.asked.filter((x) => x.src === `/wq/wq-home.js?v=${HEX}`);

  test('home_fb on: the pack script fails, wq-home.js is asked once, then once more 1.5 s after it fails, then the plain home', () => {
    const html = renderHubPage({ payload: BARE({ pack: true, home_fb: 1 }), token: TOKEN, origin: ORIGIN, assetV: HEX });
    const H = hubVm(html);
    H.run();
    expect(homeJs(H)).toHaveLength(1);
    homeJs(H)[0].l.error();
    expect(failed(H)).toEqual([['wq-home.js', 1]]);
    expect(homeJs(H)).toHaveLength(1);                  // the retry waits
    H.timers.filter((t) => t.ms === 1500).forEach((t) => t.fn());
    expect(homeJs(H)).toHaveLength(2);                  // once more, same address
    expect(H.urls().filter((u) => /\/wq\/pack\//.test(u))).toEqual([]);
    homeJs(H)[1].l.error();
    expect(failed(H)).toEqual([['wq-home.js', 1], ['wq-home.js', 2]]);
    expect(H.root.innerHTML).toContain('wq-fbdoor');   // the plain home with its three doors, never today's hub
    expect(H.root.innerHTML).not.toContain('wq-htile');
  });

  test('home_fb off: the pack script fails, wq-home.js is asked once and its failure draws today\'s hub (no retry)', () => {
    const html = renderHubPage({ payload: BARE({ pack: true }), token: TOKEN, origin: ORIGIN, assetV: HEX });
    const H = hubVm(html);
    H.run();
    expect(homeJs(H)).toHaveLength(1);
    homeJs(H)[0].l.error();
    H.timers.forEach((t) => t.fn());
    expect(homeJs(H)).toHaveLength(1);
    expect(failed(H)).toEqual([]);
    expect(H.root.innerHTML).not.toBe('');
    expect(H.root.innerHTML).not.toContain('wq-fbdoor');
  });
});

// ── this phone's device_ref with the pack on ─────────────────────────────────────────────────────────────────────────
// hub.js adopts a valid wq_dv cookie the server already gave this phone into localStorage wq_d (deviceRef), the ref the
// class link's "Is it <name>?" reads later. The pack moves the scripts before hub.js, not hub.js: the copy still runs.
describe('with the pack on, hub.js still adopts this phone\'s wq_dv cookie into localStorage wq_d', () => {
  let srv;
  beforeAll(async () => { srv = await start(build([])); });
  afterAll(() => new Promise((r) => srv.close(r)));
  const DV = 'Ab3_dE6-gH9jK2mN5pQ8sT';

  // A first open on a phone the server already marked (the class link set wq_dv): the render is locked, hub.js asks the
  // hub again as this phone (unlock -> hubFor -> deviceRef), and the cookie's ref lands in wq_d. Pack on, as today.
  async function firstOpen(pack) {
    const payload = BARE({ locked: true, ...(pack ? { pack: true } : {}) });
    const html = renderHubPage({ payload, token: TOKEN, origin: ORIGIN, assetV: HEX });
    const store = new Map();
    const before = [];
    const tags = tagsOf(html).filter((u) => /\.js(\?|$|&)/.test(u));
    for (const u of tags.slice(0, tags.indexOf(`/wq/hub.js?v=${HEX}`))) before.push((await get(srv, u)).body);
    const H = hubVm(html, { before, cookie: `other=1; wq_dv=${DV}`, store });
    H.run();
    return { tags, store, fetches: H.fetches };
  }
  test('pack on: wq_d is the cookie\'s ref after boot, as with the pack off', async () => {
    const on = await firstOpen(true);
    expect(on.tags).toContain(`/wq/pack/tel.home.doors.js?v=${HEX}`);
    expect(on.store.get('wq_d')).toBe(JSON.stringify(DV));
    const off = await firstOpen(false);
    expect(off.tags.some((u) => u.startsWith('/wq/pack/'))).toBe(false);
    expect(off.store.get('wq_d')).toBe(JSON.stringify(DV));
    expect(on.fetches).toEqual(off.fetches);   // the same ask as this phone
  });
});
