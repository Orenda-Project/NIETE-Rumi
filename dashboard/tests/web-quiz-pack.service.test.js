/**
 * The child home's scripts and styles as one file each (the bot's hub answer says `pack: true` when app_settings
 * web_quiz_pack is on; dashboard/routes/web-quiz-pack.js).
 *
 * ON: the hub page links ONE stylesheet and ONE script for the home (exactly the files today's page would ask for, in
 * today's order, the door screens inside), then hub.js as its own tag. GET /wq/pack/<set>.js|.css answers the plain
 * files joined; its ?v= is its own content hash, and only that ?v= is kept a year (immutable); any other ?v= or none
 * gets the same bytes with no-cache; a name outside the fixed list is a 404; with web_quiz_brotli on, br. The flushed
 * head (web_quiz_fast) preloads the two pack files at the tags' exact addresses, in wq-tel.js's place, with
 * web_quiz_home_preload off or on (#2842's per-file preloads are then not written: the files are in the pack).
 * A pack that fails to load falls back to the files by name, each once.
 * OFF (no `pack`, or anything but true): every page is today's, byte for byte, with web_quiz_home_preload off and on
 * (golden recorded on #2842's head 9f404ae8e, before this switch existed; ?v= masked).
 *
 * The bot is the network boundary (a fake fetch). No first-party module is mocked. Invented children only.
 */
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const zlib = require('zlib');
const http = require('http');
const express = require('express');
const { createWebQuizRouter, renderHubPage, assetVersion } = require('../routes/web-quiz.routes');

let HomePre;
try { HomePre = require('../routes/web-quiz-home-preload'); } catch (_) { HomePre = { _reset() {} }; }
let PackMod = null;
try { PackMod = require('../routes/web-quiz-pack'); } catch (_) { /* before this change: the ON rows run red */ }

const BOT = 'http://bot.test';
const KEY = 'test-internal-key';
const WQ = path.join(__dirname, '..', 'public', 'wq');
const ORIGIN = 'http://portal.example';
const TOKEN = 'eyJrIjoiaCIsImlkcyI6WyJhIl0sImV4cCI6OTk5OTk5OTk5OX0.AbCdEfGhIjKlMnOpQrStUv';
const KID = '0123456789abcdef';
const GOLDEN_FILE = path.join(__dirname, 'fixtures', 'pack-off-golden.json');
const HEX = assetVersion();

const raw = (f) => fs.readFileSync(path.join(WQ, f));
const joinJs = (fs_) => Buffer.concat(fs_.map(raw).flatMap((b, i) => (i ? [Buffer.from(';\n'), b] : [b])));
const joinCss = (fs_) => Buffer.concat(fs_.map(raw).flatMap((b, i) => (i ? [Buffer.from('\n'), b] : [b])));
// The pack's own version, computed here from the bytes: each member's name and bytes (and the read-along player's,
// which the preview loads at the preview's ?v=), sha256, 10 hex.
function packV(files) {
  const h = crypto.createHash('sha256');
  const all = files.includes('wq-readalong-listen.js') ? [...files, 'wq-readalong.js'] : files;
  for (const f of all) { h.update(f); h.update(raw(f)); }
  return h.digest('hex').slice(0, 10);
}
const JS_ALL = ['wq-tel.js', 'wq-bind.js', 'wq-home.js', 'wq-doors.js', 'hub-play.js', 'wq-readalong-listen.js'];
const CSS_ALL = ['wq-doors.css', 'wq-bind.css', 'wq-home.css'];
const JS_HREF = `/wq/pack/tel.bind.home.doors.play.listen.js?v=${packV(JS_ALL)}&in=/wq/wq-readalong-listen.js`;
const CSS_HREF = `/wq/pack/doors.bind.home.css?v=${packV(CSS_ALL)}`;

function jsonRes(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) },
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  };
}
// The hub answer as sandbox sends it today (fast, the v3 home, keep my place, Jugnu's corner, the read-along preview).
const HUB = (extra = {}) => ({
  lang: 'en', kids: [{ chip: KID, first: 'Sana', animal: 'owl', grade: '3' }], kid: KID,
  teacher: null, again: [], recs: [], challenge: null, brand: 'niete', rt: false, fast: true,
  home_v3: 1, bind: { offer: false }, play: { first: null }, listen: true,
  doors: { stories: [{ kind: 'shelf' }], games: [], videos: { watch: true } }, ...extra,
});
const LOCKED = (extra = {}) => ({ lang: 'en', locked: true, kids: [], kid: null, teacher: null, again: [], recs: [], challenge: null, lib: null, brand: 'niete', rt: false, fast: true, ...extra });

const start = (app) => new Promise((resolve) => { const srv = app.listen(0, () => resolve(srv)); });
const stop = (srv) => new Promise((r) => srv.close(r));
function get(srv, p, { headers = {}, onFirstChunk } = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: srv.address().port, method: 'GET', path: p, headers: { host: 'portal.example', ...headers } }, (res) => {
      const chunks = [];
      res.on('data', (c) => { chunks.push(c); if (chunks.length === 1 && onFirstChunk) onFirstChunk(c.toString('utf8')); });
      res.on('end', () => { const buf = Buffer.concat(chunks); resolve({ status: res.statusCode, headers: res.headers, buf, body: buf.toString('utf8') }); });
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
function build(fetchImpl, extra = {}) {
  const app = express();
  app.set('trust proxy', 1);
  const router = createWebQuizRouter({ botUrl: BOT, apiKey: KEY, fetchImpl, brotliOn: () => false, ...extra });
  app.use(router);
  app.packReady = router.packReady;
  return app;
}
/** The page's first chunk while the bot has not answered yet, and the whole page. */
async function flushedOpen(srv, bot) {
  let answered = false; let answeredAtFirstChunk = null; let early = null;
  const answer = () => { if (!answered) { answered = true; bot.release(); } };
  const fallback = setTimeout(answer, 400);
  const res = await get(srv, `/h/${TOKEN}`, { onFirstChunk: (c) => { early = c; answeredAtFirstChunk = answered; answer(); } });
  clearTimeout(fallback);
  return { early, answeredAtFirstChunk, body: res.body };
}
const mask = (s) => s.replace(/\?v=[0-9a-f]{10}/g, '?v=V');
// (the attribute's value as the browser reads it: &amp; is &)
const attr = (v) => v.replace(/&amp;/g, '&');
const tagsOf = (html) => [...html.matchAll(/<link rel="stylesheet" href="([^"]+)"(?: onerror="[^"]*")?>|<script src="([^"]+)"[^>]*><\/script>/g)].map((m) => attr(m[1] || m[2]));
const preloadsOf = (html) => [...html.matchAll(/<link rel="preload" href="([^"]+)" as="(script|style)"( crossorigin)?>/g)].map((m) => [m[2], attr(m[1]), Boolean(m[3])]);

// ── OFF: today's pages, byte for byte ───────────────────────────────────────────────────────────────────────────────
// The first (unflushed), the early head, the flushed page, a locked page and the page after it, EN and UR, with
// web_quiz_home_preload off and on: the hub answers as the bot sends them with `pack` absent.
async function offPages(lang, pre, pack) {
  HomePre._reset();
  const ui = lang === 'ur' ? { ur2: true } : undefined;
  const x = { lang, ui, ...(pre ? { home_pre: true } : {}), ...(pack === undefined ? {} : { pack }) };
  const bot = heldBot([jsonRes(200, HUB(x)), { hold: true, res: jsonRes(200, HUB(x)) }, jsonRes(200, LOCKED({ lang, ...(pre ? { home_pre: true } : {}), ...(pack === undefined ? {} : { pack }) })), jsonRes(200, HUB(x))]);
  const srv = await start(build(bot.fetchImpl));
  try {
    const first = await get(srv, `/h/${TOKEN}`);
    const flushed = await flushedOpen(srv, bot);
    const locked = await get(srv, `/h/${TOKEN}`);
    const after = await get(srv, `/h/${TOKEN}`);
    expect(flushed.answeredAtFirstChunk).toBe(false);
    return { first: mask(first.body), early: mask(flushed.early), flushed: mask(flushed.body), locked: mask(locked.body), after: mask(after.body) };
  } finally { await stop(srv); }
}
const MODES = [['en', false], ['ur', false], ['en', true], ['ur', true]];
const modeKey = (lang, pre) => `${lang}_${pre ? 'pre_on' : 'pre_off'}`;

describe('switch off: every hub page is today\'s, byte for byte (golden from 9f404ae8e), home preload off and on', () => {
  beforeEach(() => HomePre._reset());
  test('no `pack` key: first, early head, flushed, locked, after; EN and UR', async () => {
    const pages = {};
    for (const [lang, pre] of MODES) pages[modeKey(lang, pre)] = await offPages(lang, pre, undefined);
    if (process.env.WQ_PACK_RECORD === '1') fs.writeFileSync(GOLDEN_FILE, `${JSON.stringify(pages, null, 1)}\n`);
    const golden = JSON.parse(fs.readFileSync(GOLDEN_FILE, 'utf8'));
    expect(pages).toEqual(golden);
    // the home preload ON pages do carry #2842's per-file preloads (the golden covers both heads)
    expect(golden.en_pre_on.early).toContain('<link rel="preload" href="/wq/wq-home.js?v=V" as="script">');
    expect(golden.en_pre_off.early).not.toContain('<link rel="preload" href="/wq/wq-home.js?v=V" as="script">');
  });
  test.each([['the string "true"', 'true'], ['false', false], ['1', 1], ['the string \'"true"\'', '"true"'], ['{ on: true }', { on: true }]])(
    '`pack` set to %s is off: today\'s pages (only the boot JSON carries the bot\'s word)', async (_, v) => {
      const golden = JSON.parse(fs.readFileSync(GOLDEN_FILE, 'utf8'));
      for (const [lang, pre] of [['en', false], ['en', true]]) {
        const pages = await offPages(lang, pre, v);
        const strip = (h) => h.split(`,"pack":${JSON.stringify(v)}`).join('');
        for (const k of Object.keys(pages)) expect([k, strip(pages[k])]).toEqual([k, golden[modeKey(lang, pre)][k]]);
        for (const k of Object.keys(pages)) expect(pages[k]).not.toContain('/wq/pack/');
      }
    });
});

// ── ON: the page's tags ─────────────────────────────────────────────────────────────────────────────────────────────
describe('switch on: the hub page links one stylesheet and one script for the home, then hub.js', () => {
  test('sandbox\'s answer: html-level tags are exactly [wq.css, pack.css, pack.js, hub.js], each at its own version', () => {
    const html = renderHubPage({ payload: HUB({ pack: true }), token: TOKEN, origin: ORIGIN, assetV: HEX });
    expect(tagsOf(html)).toEqual([`/wq/wq.css?v=${HEX}`, CSS_HREF, JS_HREF, `/wq/hub.js?v=${HEX}`]);
    expect(html).not.toMatch(/<script src="\/wq\/(wq-tel|wq-bind|wq-home|hub-play|wq-readalong-listen)\.js/);
    expect(html).toContain('&amp;in=/wq/wq-readalong-listen.js" defer>');   // the html escapes its own &
  });

  test('execution order: the pack runs today\'s tags in today\'s order (the door screens right after the home)', async () => {
    const today = tagsOf(renderHubPage({ payload: HUB(), token: TOKEN, origin: ORIGIN, assetV: HEX }))
      .filter((u) => /\.js\?/.test(u)).map((u) => u.split('?')[0].replace('/wq/', '')).filter((f) => f !== 'hub.js');
    expect(today).toEqual(['wq-tel.js', 'wq-bind.js', 'wq-home.js', 'hub-play.js', 'wq-readalong-listen.js']);
    expect(JS_ALL.filter((f) => f !== 'wq-doors.js')).toEqual(today);
    expect(JS_ALL.indexOf('wq-doors.js')).toBe(JS_ALL.indexOf('wq-home.js') + 1);
    // the styles keep today's cascade: wq-doors.css is appended to <head> by wq-home.js today, BEFORE the tail's styles
    const todayCss = tagsOf(renderHubPage({ payload: HUB(), token: TOKEN, origin: ORIGIN, assetV: HEX })).filter((u) => /\.css\?/.test(u)).map((u) => u.split('?')[0].replace('/wq/', ''));
    expect(todayCss).toEqual(['wq.css', 'wq-bind.css', 'wq-home.css']);
    expect(CSS_ALL).toEqual(['wq-doors.css', ...todayCss.slice(1)]);
  });

  test('a file the answer does not name is not in the pack (no keep my place, no corner, no preview)', async () => {
    const html = renderHubPage({ payload: HUB({ pack: true, bind: undefined, play: undefined, listen: undefined }), token: TOKEN, origin: ORIGIN, assetV: HEX });
    const js = ['wq-tel.js', 'wq-home.js', 'wq-doors.js'];
    expect(tagsOf(html)).toEqual([`/wq/wq.css?v=${HEX}`, `/wq/pack/doors.home.css?v=${packV(['wq-doors.css', 'wq-home.css'])}`,
      `/wq/pack/tel.home.doors.js?v=${packV(js)}`, `/wq/hub.js?v=${HEX}`]);
    const srv = await start(build(() => Promise.resolve(null)));
    try {
      const r = await get(srv, `/wq/pack/tel.home.doors.js?v=${packV(js)}`);
      expect(r.buf.equals(joinJs(js))).toBe(true);
      expect(r.buf.includes(raw('hub-play.js'))).toBe(false);
      expect(r.buf.includes(raw('wq-bind.js'))).toBe(false);
    } finally { await stop(srv); }
  });

  test('a locked answer: the pack holds wq-tel alone (no style); after unlocking hub.js loads the rest by name, as today', () => {
    const html = renderHubPage({ payload: LOCKED({ pack: true }), token: TOKEN, origin: ORIGIN, assetV: HEX });
    expect(tagsOf(html)).toEqual([`/wq/wq.css?v=${HEX}`, `/wq/pack/tel.js?v=${packV(['wq-tel.js'])}`, `/wq/hub.js?v=${HEX}`]);
  });

  test('the fallback home (`home_fb`): the home\'s own files stay out of the pack and keep today\'s tags (hub.js asks for wq-home.js)', () => {
    const html = renderHubPage({ payload: HUB({ pack: true, home_fb: 1 }), token: TOKEN, origin: ORIGIN, assetV: HEX });
    const js = ['wq-tel.js', 'wq-bind.js', 'wq-doors.js', 'hub-play.js', 'wq-readalong-listen.js'];
    expect(tagsOf(html)).toEqual([`/wq/wq.css?v=${HEX}`, `/wq/pack/doors.bind.css?v=${packV(['wq-doors.css', 'wq-bind.css'])}`,
      `/wq/pack/tel.bind.doors.play.listen.js?v=${packV(js)}&in=/wq/wq-readalong-listen.js`, `/wq/wq-home.css?v=${HEX}`, `/wq/hub.js?v=${HEX}`]);
    expect(html).toContain(`<link rel="preload" href="/wq/wq-home.js?v=${HEX}" as="script">`);
  });

  test('through the edge: `pack: true` gives the pack page; the next answer without it, today\'s page again', async () => {
    const bot = heldBot([jsonRes(200, HUB({ pack: true, fast: undefined })), jsonRes(200, HUB({ fast: undefined }))]);
    const srv = await start(build(bot.fetchImpl));
    try {
      const on = await get(srv, `/h/${TOKEN}`);
      expect(tagsOf(on.body)).toEqual([`/wq/wq.css?v=${HEX}`, CSS_HREF, JS_HREF, `/wq/hub.js?v=${HEX}`]);
      const off = await get(srv, `/h/${TOKEN}`);
      expect(off.body).toBe(renderHubPage({ payload: HUB({ fast: undefined }), token: TOKEN, origin: ORIGIN, assetV: HEX }));
    } finally { await stop(srv); }
  });
});

// ── GET /wq/pack/<set> ──────────────────────────────────────────────────────────────────────────────────────────────
describe('GET /wq/pack/<set>.js|.css', () => {
  let srv;
  beforeAll(async () => { srv = await start(build(() => Promise.resolve(null))); });
  afterAll(() => stop(srv));

  test('the plain files in page order, joined by ";\\n" (js) or a new line (css); a year, immutable, at its own ?v=', async () => {
    const js = await get(srv, JS_HREF);
    expect(js.status).toBe(200);
    expect(js.headers['content-type']).toMatch(/javascript/);
    expect(js.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(js.buf.equals(joinJs(JS_ALL))).toBe(true);
    expect(() => new vm.Script(js.body)).not.toThrow();
    const css = await get(srv, CSS_HREF);
    expect(css.status).toBe(200);
    expect(css.headers['content-type']).toMatch(/text\/css/);
    expect(css.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(css.buf.equals(joinCss(CSS_ALL))).toBe(true);
  });

  test('an unknown ?v= (the hub\'s, a stale one, a minified-looking one, junk) or none: the same bytes, no-cache', async () => {
    const name = 'tel.bind.home.doors.play.listen.js';
    for (const q of [`?v=${HEX}`, '?v=0000000000', `?v=${packV(JS_ALL)}m`, '?v=zz', '']) {
      const r = await get(srv, `/wq/pack/${name}${q}`);
      expect([q, r.status, r.headers['cache-control']]).toEqual([q, 200, 'no-cache']);
      expect(r.buf.equals(joinJs(JS_ALL))).toBe(true);
    }
    // a set's version is its own: another set's ?v= is unknown to it
    const other = await get(srv, `/wq/pack/tel.home.doors.js?v=${packV(JS_ALL)}`);
    expect(other.headers['cache-control']).toBe('no-cache');
  });

  test('the version is the members\' content: a changed byte in one member, a new ?v=; the same files, the same ?v=', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wq-pack-'));
    try {
      for (const f of ['wq-tel.js', 'wq-home.js', 'wq-doors.js']) fs.copyFileSync(path.join(WQ, f), path.join(dir, f));
      const a = PackMod.createPack({ dir }).version('tel.home.doors.js');
      expect(a).toBe(packV(['wq-tel.js', 'wq-home.js', 'wq-doors.js']));
      expect(a).toMatch(/^[0-9a-f]{10}$/);
      fs.appendFileSync(path.join(dir, 'wq-doors.js'), '\n');
      const b = PackMod.createPack({ dir }).version('tel.home.doors.js');
      expect(b).not.toBe(a);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('a name outside the fixed list is a 404 (no other file, no path, no repeat, no other order)', async () => {
    for (const p of ['wq.js', 'hub.js', 'tel.hub.js', 'tel.evil.js', '..%2Fwq.js', '..%2F..%2Fpackage.json', 'home.tel.js', 'tel.tel.js',
      'tel.css', 'play.css', 'home.doors.css', 'home.doors.txt', '.js', 'tel..home.js', 'TEL.js', 'stories.js']) {
      const r = await get(srv, `/wq/pack/${p}?v=${HEX}`);
      expect([p, r.status, r.headers['cache-control']]).toEqual([p, 404, 'no-store']);
    }
  });

  test('web_quiz_brotli on, a phone that takes br, the pack\'s own ?v=: brotli of the same bytes (made once, in the background)', async () => {
    const app = build(() => Promise.resolve(null), { brotliOn: () => true });
    const s2 = await start(app);
    try {
      const br = { 'accept-encoding': 'br, gzip' };
      const name = 'tel.bind.home.doors.play.listen.js';
      const first = await get(s2, JS_HREF, { headers: br });   // the copy is being made: the plain bytes meanwhile
      expect(first.buf.equals(joinJs(JS_ALL))).toBe(true);
      await app.packReady(name);
      const r = await get(s2, JS_HREF, { headers: br });
      expect(r.headers['content-encoding']).toBe('br');
      expect(r.headers['cache-control']).toBe('public, max-age=31536000, immutable');
      expect(r.headers.vary).toBe('Accept-Encoding');
      expect(zlib.brotliDecompressSync(r.buf).equals(joinJs(JS_ALL))).toBe(true);
      expect(r.buf.length).toBeLessThan(joinJs(JS_ALL).length / 3);
      const again = await get(s2, JS_HREF, { headers: { ...br, 'if-none-match': r.headers.etag } });
      expect(again.status).toBe(304);
      // no br asked, or an unknown ?v=: plain
      expect((await get(s2, JS_HREF)).headers['content-encoding']).toBeUndefined();
      const stale = await get(s2, `/wq/pack/${name}?v=0000000000`, { headers: br });
      expect([stale.headers['content-encoding'], stale.headers['cache-control']]).toEqual([undefined, 'no-cache']);
    } finally { await stop(s2); }
  });
});

// ── the flushed head (web_quiz_fast), with web_quiz_home_preload off and on ─────────────────────────────────────────
const fileOf = (u) => u.split('?')[0].replace('/wq/', '');
describe('the flushed head preloads the two pack files (exact hrefs) in place of the home\'s files', () => {
  beforeEach(() => HomePre._reset());
  test.each([['home preload on', true], ['home preload off', false]])('%s: the early head preloads [pack.css, pack.js, hub.js]; each file is fetched at ONE address', async (_, pre) => {
    const x = { pack: true, ...(pre ? { home_pre: true } : {}) };
    const bot = heldBot([jsonRes(200, HUB(x)), { hold: true, res: jsonRes(200, HUB(x)) }]);
    const srv = await start(build(bot.fetchImpl));
    try {
      await get(srv, `/h/${TOKEN}`);   // the answer that teaches this edge `fast` and the pack it links
      const { early, answeredAtFirstChunk, body } = await flushedOpen(srv, bot);
      expect(answeredAtFirstChunk).toBe(false);
      expect(early).not.toMatch(/id="boot"/);
      expect(preloadsOf(early)).toEqual([['style', CSS_HREF, false], ['script', JS_HREF, false], ['script', `/wq/hub.js?v=${HEX}`, false]]);
      // the tail asks for exactly those addresses: every preload is used, none twice
      const tags = tagsOf(body);
      expect(tags).toEqual([`/wq/wq.css?v=${HEX}`, CSS_HREF, JS_HREF, `/wq/hub.js?v=${HEX}`]);
      for (const [, u] of preloadsOf(body)) expect([u, tags.includes(u)]).toEqual([u, true]);
      // no home file is asked by its own name anywhere on the page
      for (const f of ['wq-tel.js', 'wq-bind.js', 'wq-bind.css', 'wq-home.js', 'wq-home.css', 'hub-play.js', 'wq-readalong-listen.js', 'wq-doors.js', 'wq-doors.css']) {
        expect([f, [...preloadsOf(body).map(([, u]) => u), ...tags].filter((u) => fileOf(u) === f)]).toEqual([f, []]);
      }
      // the requests the page makes for its scripts and styles: 4 (11 with the files by name)
      expect(new Set([...tags, ...preloadsOf(body).map(([, u]) => u)]).size).toBe(4);
    } finally { await stop(srv); }
  });

  test('a locked answer keeps the learned pack; an answer without `pack` forgets it: the next head is today\'s (golden)', async () => {
    const golden = JSON.parse(fs.readFileSync(GOLDEN_FILE, 'utf8'));
    const bot = heldBot([
      jsonRes(200, HUB({ pack: true })),
      jsonRes(200, LOCKED({ pack: true })),
      jsonRes(200, HUB({ pack: true })),   // flushed, after the locked one: still the pack's preloads
      jsonRes(200, HUB()),                 // the switch went OFF
      jsonRes(200, HUB()),                 // flushed: today's head
    ]);
    const srv = await start(build(bot.fetchImpl));
    try {
      await get(srv, `/h/${TOKEN}`);
      const locked = await get(srv, `/h/${TOKEN}`);
      expect(preloadsOf(locked.body).map(([, u]) => u)).toEqual([CSS_HREF, JS_HREF, `/wq/hub.js?v=${HEX}`]);
      const kept = await get(srv, `/h/${TOKEN}`);
      expect(preloadsOf(kept.body).map(([, u]) => u)).toEqual([CSS_HREF, JS_HREF, `/wq/hub.js?v=${HEX}`]);
      await get(srv, `/h/${TOKEN}`);
      const off = await get(srv, `/h/${TOKEN}`);
      expect(off.body).not.toContain('/wq/pack/');
      expect(mask(off.body)).toBe(golden.en_pre_off.after);
    } finally { await stop(srv); }
  });

  test('home preload on, the fallback home: the head preloads the pack and the home\'s own two files, each at its tag\'s address', async () => {
    const x = { pack: true, home_pre: true, home_fb: 1 };
    const bot = heldBot([jsonRes(200, HUB(x)), jsonRes(200, HUB(x))]);
    const srv = await start(build(bot.fetchImpl));
    try {
      await get(srv, `/h/${TOKEN}`);
      const { early } = await flushedOpen(srv, bot);
      const pre = preloadsOf(early).map(([as, u]) => [as, fileOf(u)]);
      expect(pre).toEqual([['style', 'wq-home.css'], ['script', 'wq-home.js'], ['style', 'pack/doors.bind.css'], ['script', 'pack/tel.bind.doors.play.listen.js'], ['script', 'hub.js']]);
    } finally { await stop(srv); }
  });
});

// ── the page's own scripts with the pack on (a vm, the shipped files as the edge serves them) ───────────────────────
// A payload with Stories and the corner's install card (the fixture of the earlier pack PR), for the door screens.
const VHUB = (extra = {}) => ({
  lang: 'en', kids: [{ chip: KID, first: 'Zara', animal: 'owl', grade: '3' }], kid: KID,
  teacher: null, again: [], recs: [], challenge: { on: true, exercises: [] }, lib: null, brand: 'niete', rt: false,
  bind: { on: true }, home_v3: 1, play: { install: true }, stories: { on: true },
  doors: { stories: [{ kind: 'shelf' }], games: [], videos: null },
  ...extra,
});
const BARE = (extra = {}) => VHUB({ bind: undefined, play: undefined, ...extra });

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
const scriptsBeforeHub = (html) => { const t = tagsOf(html).filter((u) => /\.js(\?|$|&)/.test(u)); return t.slice(0, t.indexOf(`/wq/hub.js?v=${HEX}`)); };

describe('the page\'s scripts with the pack on (a vm)', () => {
  let srv;
  beforeAll(async () => { srv = await start(build(() => Promise.resolve(null))); });
  afterAll(() => stop(srv));

  async function firstMount(payload, hash) {
    const html = renderHubPage({ payload, token: TOKEN, origin: ORIGIN, assetV: HEX });
    const P = page(html, { hash });
    const before = scriptsBeforeHub(html);
    expect(before.filter((u) => u.startsWith('/wq/pack/'))).toHaveLength(1);
    for (const u of before) vm.runInContext((await get(srv, u)).body, P.sandbox);
    expect(P.win.WQHOME).toBeTruthy();
    const root = fakeRoot({ '[data-stories-shelf]': el({ parentNode: {} }) });
    P.win.WQHOME.mount(root, payload, { token: TOKEN, lang: 'en', ev() {}, go() {} });
    return { P, root };
  }

  test('the door files are in before hub.js runs: #stories draws the door screen at the first mount, no request for wq-doors.js/.css', async () => {
    const { P, root } = await firstMount(VHUB({ pack: true }), '#stories');
    expect(P.win.WQDOORS).toBeTruthy();
    expect(root.attrs['data-m']).toBe('H3-stories');
    expect(P.urls().filter((u) => /wq-doors/.test(u))).toEqual([]);
    // the reader comes on its own, as its own files at hub.js's ?v=
    expect(P.urls()).toEqual([`/wq/wq-stories.css?v=${HEX}`, `/wq/wq-stories.js?v=${HEX}`]);
  });

  test('the home\'s loader (wq-home.js loadOnce) still finds hub.js\'s ?v= with the pack on', async () => {
    const { P } = await firstMount(VHUB({ pack: true }), '');
    P.win.WQHOME.loadOnce('wq-book');
    expect(P.urls()).toEqual(expect.arrayContaining([`/wq/wq-book.css?v=${HEX}`, `/wq/wq-book.js?v=${HEX}`]));
    expect(P.sandbox.document.querySelector('script[src*="/wq/hub.js"]').getAttribute('src')).toBe(`/wq/hub.js?v=${HEX}`);
  });
});

// ── a pack that does not arrive: the files by name, each once ───────────────────────────────────────────────────────
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
// The pack stylesheet's tag as the browser builds it: its inline onerror becomes the element's handler, `this` the element.
function packLink(html, sandbox) {
  const m = /<link rel="stylesheet" href="(\/wq\/pack\/[^"]+)"( onerror="([^"]*)")?>/.exec(html);
  expect(m).toBeTruthy();
  const link = { href: m[1], onerror: m[3] ? vm.runInContext(`(function () { ${m[3].replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')} })`, sandbox) : null };
  return { link, fail: () => { if (link.onerror) link.onerror.call(link, { type: 'error' }); } };
}
const count = (urls, u) => urls.filter((x) => x === u).length;

describe('the pack fails to load: the home\'s files by name, each once', () => {
  let srv;
  beforeAll(async () => { srv = await start(build(() => Promise.resolve(null))); });
  afterAll(() => stop(srv));

  test('pack script fails (nothing in it ran): hub.js asks /wq/wq-home.js and .css exactly once, at its ?v=, never the pack again', () => {
    const html = renderHubPage({ payload: BARE({ pack: true }), token: TOKEN, origin: ORIGIN, assetV: HEX });
    expect(tagsOf(html)).toContain(`/wq/pack/tel.home.doors.js?v=${packV(['wq-tel.js', 'wq-home.js', 'wq-doors.js'])}`);
    const H = hubVm(html);
    H.run();
    expect(H.sandbox.window.WQHOME).toBeUndefined();
    expect(count(H.urls(), `/wq/wq-home.js?v=${HEX}`)).toBe(1);
    expect(count(H.urls(), `/wq/wq-home.css?v=${HEX}`)).toBe(1);
    expect(H.urls().filter((u) => /\/wq\/pack\//.test(u))).toEqual([]);
    // wq-home.js fails too: the home's own failure path draws a page; wq-home.js is not asked again here
    H.asked.find((x) => x.src === `/wq/wq-home.js?v=${HEX}`).l.error();
    H.timers.forEach((t) => t.fn());
    expect(H.root.innerHTML).not.toBe('');
    expect(count(H.urls(), `/wq/wq-home.js?v=${HEX}`)).toBe(1);
  });

  test('pack stylesheet fails, its script ran: each style it held asked exactly once, by name, in its order; no script asked', async () => {
    const html = renderHubPage({ payload: VHUB({ pack: true }), token: TOKEN, origin: ORIGIN, assetV: HEX });
    const before = [];
    for (const u of scriptsBeforeHub(html)) before.push((await get(srv, u)).body);
    const H = hubVm(html, { before });
    const { fail } = packLink(html, H.sandbox);
    fail();
    fail();   // a second error event asks for nothing more
    H.sandbox.window.WQHOME = { mount() {}, loadOnce() {} };   // the home mounts from the pack, as on the phone
    H.run();
    const css = H.urls().filter((u) => /\.css(\?|$)/.test(u));
    expect(css).toEqual([`/wq/wq-doors.css?v=${HEX}`, `/wq/wq-bind.css?v=${HEX}`, `/wq/wq-home.css?v=${HEX}`]);
    expect(H.urls().filter((u) => /\.js(\?|$)/.test(u))).toEqual([]);
  });

  test('pack stylesheet loads: nothing more is asked (the handler is only a fallback)', () => {
    const html = renderHubPage({ payload: VHUB({ pack: true }), token: TOKEN, origin: ORIGIN, assetV: HEX });
    const H = hubVm(html);
    packLink(html, H.sandbox);
    H.sandbox.window.WQHOME = { mount() {}, loadOnce() {} };
    H.run();
    expect(H.urls()).toEqual([]);
  });

  test('the fallback home on (home_fb): the home is not in the pack; hub.js\'s own ask, retry and plain home are today\'s', () => {
    const html = renderHubPage({ payload: BARE({ pack: true, home_fb: 1 }), token: TOKEN, origin: ORIGIN, assetV: HEX });
    const H = hubVm(html);
    H.run();
    const homeJs = () => H.asked.filter((x) => x.src === `/wq/wq-home.js?v=${HEX}`);
    expect(homeJs()).toHaveLength(1);
    // the home's stylesheet is today's own tag, so hub.js does not ask for it again
    expect(count(H.urls(), `/wq/wq-home.css?v=${HEX}`)).toBe(0);
    homeJs()[0].l.error();
    H.timers.filter((t) => t.ms === 1500).forEach((t) => t.fn());
    expect(homeJs()).toHaveLength(2);
    homeJs()[1].l.error();
    expect(H.root.innerHTML).toContain('wq-fbdoor');
  });
});

// ── the read-along preview inside the pack ──────────────────────────────────────────────────────────────────────────
describe('the read-along preview in the pack', () => {
  let srv;
  beforeAll(async () => { srv = await start(build(() => Promise.resolve(null))); });
  afterAll(() => stop(srv));
  const LISTEN_V = crypto.createHash('sha256').update(raw('wq-readalong-listen.js')).update(raw('wq-readalong.js')).digest('hex').slice(0, 10);

  async function listenBoot(html) {
    const H = hubVm(html, { hash: '#listen/p-sun-12' });
    for (const u of scriptsBeforeHub(html)) vm.runInContext((await get(srv, u)).body, H.sandbox);
    const W = H.sandbox.window;
    expect(W.WQLISTEN).toBeTruthy();
    const calls = [];
    const take = W.WQLISTEN.take;
    W.WQLISTEN.take = function (...a) { calls.push(a.map((x) => typeof x)); return take.apply(this, a); };
    H.sandbox.WQLISTEN = W.WQLISTEN;
    H.run();
    const player = H.asked.filter((x) => /\/wq\/wq-readalong\.js/.test(x.src || ''));
    expect(player).toHaveLength(1);
    player[0].l.load();
    return { calls, fetches: H.fetches.filter((u) => u.startsWith('/api/wq/listen/')), player: player[0].src, data: H.root.attrs['data-m'] };
  }

  test('the preview\'s boot hook runs once with today\'s address; its player loads at the pack\'s ?v=, which hashes the player too', async () => {
    const today = await listenBoot(renderHubPage({ payload: VHUB({ listen: true }), token: TOKEN, origin: ORIGIN, assetV: HEX }));
    const packed = await listenBoot(renderHubPage({ payload: VHUB({ pack: true, listen: true }), token: TOKEN, origin: ORIGIN, assetV: HEX }));
    expect(today.calls).toEqual([['function', 'function', 'function']]);
    expect(packed.calls).toEqual(today.calls);
    expect(packed.fetches).toEqual(today.fetches);
    expect(today.fetches).toHaveLength(1);
    expect(packed.data).toBe(today.data);
    expect(today.player).toBe(`/wq/wq-readalong.js?v=${LISTEN_V}`);
    expect(packed.player).toBe(`/wq/wq-readalong.js?v=${packV(JS_ALL)}`);
  });
});

// ── this phone's device_ref with the pack on ────────────────────────────────────────────────────────────────────────
describe('with the pack on, hub.js still adopts this phone\'s wq_dv cookie into localStorage wq_d', () => {
  let srv;
  beforeAll(async () => { srv = await start(build(() => Promise.resolve(null))); });
  afterAll(() => stop(srv));
  const DV = 'Ab3_dE6-gH9jK2mN5pQ8sT';
  async function firstOpen(pack) {
    const payload = BARE({ locked: true, ...(pack ? { pack: true } : {}) });
    const html = renderHubPage({ payload, token: TOKEN, origin: ORIGIN, assetV: HEX });
    const store = new Map();
    const before = [];
    for (const u of scriptsBeforeHub(html)) before.push((await get(srv, u)).body);
    const H = hubVm(html, { before, cookie: `other=1; wq_dv=${DV}`, store });
    H.run();
    return { tags: tagsOf(html), store, fetches: H.fetches };
  }
  test('pack on: wq_d is the cookie\'s ref after boot, as with the pack off; the same ask as this phone', async () => {
    const on = await firstOpen(true);
    expect(on.tags.some((u) => u.startsWith('/wq/pack/'))).toBe(true);
    expect(on.store.get('wq_d')).toBe(JSON.stringify(DV));
    const off = await firstOpen(false);
    expect(off.tags.some((u) => u.startsWith('/wq/pack/'))).toBe(false);
    expect(off.store.get('wq_d')).toBe(JSON.stringify(DV));
    expect(on.fetches).toEqual(off.fetches);
  });
});
