/**
 * The grown-up's preview on the hub page (/h/<token>#listen/<passage_id>, public/wq/hub.js): the practice home's story
 * tiles open it to HEAR a practice story before sending it — the stored clip with the word highlight (wq-readalong.js,
 * stubbed here), fetched from /api/wq/listen/h/<token>/<pid>; no run, no microphone, no sticker, no event keyed by a
 * child. The edge adds that script to the hub page only when the bot's hub JSON says `listen: true` (the switch on, the
 * hub's own phone); hub.js keeps one guard expression. Without the script (the switch off) or without the hash, the hub
 * is today's and nothing more is fetched. Run whole in a vm with the string-backed fake DOM of the Book tests.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const WQ = path.join(__dirname, '..', 'public', 'wq');
const HUB_SRC = fs.readFileSync(path.join(WQ, 'hub.js'), 'utf8');
const LISTEN_SRC = fs.readFileSync(path.join(WQ, 'wq-readalong-listen.js'), 'utf8');
const BOOTS = require('./fixtures/hub-play-boots.json');
const STUB = 'window.WQReadAlong = { mount: function (el, d, o) { var r = window.__ra = { el: el, d: d, o: o, destroyed: 0 }; return { destroy: function () { r.destroyed += 1; } }; } };';
const PID = 'en.listen.1.story02';
const TIMED = { v: 1, id: PID, lang: 'en', dir: 'ltr', audio: { url: 'https://signed.test/a.ogg', ms: 4000 }, words: [{ i: 0, t: 'Rain', s_ms: 100, e_ms: 400 }] };
const ok = (body) => () => ({ status: 200, body });

// The opening tag a simple selector (.class or #id) names, and where its element ends (same-tag depth count).
function find(html, sel, from) {
  const re = sel[0] === '#'
    ? new RegExp('<([a-z]+)\\b[^>]*\\bid="' + sel.slice(1) + '"[^>]*>', 'g')
    : new RegExp('<([a-z]+)\\b[^>]*\\bclass="(?:[^"]*\\s)?' + sel.slice(1) + '(?:\\s[^"]*)?"[^>]*>', 'g');
  re.lastIndex = from || 0;
  const m = re.exec(html);
  if (!m) return null;
  const tag = m[1];
  const tok = new RegExp('<' + tag + '\\b|</' + tag + '>', 'g');
  tok.lastIndex = m.index + m[0].length;
  let depth = 1;
  let t;
  while ((t = tok.exec(html))) {
    depth += t[0][1] === '/' ? -1 : 1;
    if (depth === 0) return { start: m.index, openEnd: m.index + m[0].length, end: t.index + t[0].length };
  }
  return { start: m.index, openEnd: m.index + m[0].length, end: html.length };
}

function open({ hash = '', boot, routes = {}, listen = true }) {
  const answer = {};
  const head = [];
  const fetches = [];
  const timers = [];
  const replaced = [];
  let cache = {};
  const root = {
    _h: '', attrs: {},
    set innerHTML(h) { this._h = h; cache = {}; }, get innerHTML() { return this._h; },
    setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k]; }, appendChild() {},
    querySelector(sel) {
      if (!/^[.#][\w-]+$/.test(sel) || !find(this._h, sel)) return null;
      return (cache[sel] = cache[sel] || elFor(sel));
    },
    querySelectorAll(sel) {
      if (!/^[.#][\w-]+$/.test(sel)) return [];
      const out = [];
      let at = 0;
      let f;
      while ((f = find(root._h, sel, at))) { out.push(elFor(sel, out.length, root._h.slice(f.start, f.end))); at = f.end; }
      return out;
    },
  };
  // An element in the string: listeners of its own, insertAdjacentHTML / removeChild splice the string, as the
  // browser does; a removed element's listeners go with it.
  // From querySelectorAll, an element keeps its own markup (snap), so removing several in a row takes each one out.
  function elFor(sel, nth = 0, snap = null) {
    const at = () => { let f = null; let from = 0; for (let i = 0; i <= nth; i++) { f = find(root._h, sel, from); if (!f) return null; from = f.end; } return f; };
    const el = {
      sel, listeners: {}, hidden: false,
      addEventListener(n, fn) { (this.listeners[n] = this.listeners[n] || []).push(fn); },
      fire(n, e) { (this.listeners[n] || []).forEach((fn) => fn.call(this, e || { preventDefault() {} })); },
      getAttribute: (k) => { const f = at(); const m = f && new RegExp('\\b' + k + '="([^"]*)"').exec(root._h.slice(f.start, f.openEnd)); return m ? m[1] : null; },
      insertAdjacentHTML(pos, h) {
        const f = at();
        const i = pos === 'afterend' ? f.end : pos === 'beforebegin' ? f.start : pos === 'afterbegin' ? f.openEnd : f.end - (root._h.slice(0, f.end).length - root._h.slice(0, f.end).lastIndexOf('</'));
        root._h = root._h.slice(0, i) + h + root._h.slice(i);
      },
    };
    el.parentNode = { removeChild: () => { const i = snap ? root._h.indexOf(snap) : -1; const f = snap ? (i >= 0 ? { start: i, end: i + snap.length } : null) : at(); if (f) { root._h = root._h.slice(0, f.start) + root._h.slice(f.end); cache = {}; } } };
    el.remove = () => el.parentNode.removeChild(el);
    return el;
  }
  const ctx = {
    document: {
      documentElement: { setAttribute() {}, classList: { toggle() {}, contains: () => false } }, cookie: '',
      getElementById: (id) => (id === 'wq' ? root : id === 'boot' ? { textContent: JSON.stringify(boot) } : head.find((e) => e.id === id) || null),
      querySelector: (sel) => (/hub\.js/.test(sel) ? { getAttribute: () => '/wq/hub.js?v=abc123' } : /readalong-listen\.js/.test(sel) && listen ? { getAttribute: () => '/wq/wq-readalong-listen.js?v=def456' } : null),
      createElement: (tag) => ({ tag, listeners: {}, setAttribute() {}, addEventListener(n, fn) { (this.listeners[n] = this.listeners[n] || []).push(fn); } }),
      head: { appendChild: (el) => head.push(el) },
    },
    navigator: { userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/130.0 Mobile Safari/537.36', sendBeacon: () => true },
    history: { replaceState(s, t, u) { replaced.push(u); ctx.location.hash = ''; } },
    location: { pathname: '/h/tok.tok', search: '', hash, protocol: 'https:', host: 'wq.example.test', assign() {}, reload() {} },
    Blob: function Blob() {},
    fetch: (url, o) => {
      fetches.push(String(url));
      let r = { status: 200, body: answer };
      for (const [rx, fn] of Object.entries(routes)) if (new RegExp(rx).test(String(url))) r = fn(String(url));
      return Promise.resolve({ status: r.status, ok: r.status < 300, json: () => Promise.resolve(r.body), text: () => Promise.resolve(JSON.stringify(r.body)) });
    },
    localStorage: { getItem: () => null, setItem() {} },
    setTimeout: (fn) => { timers.push(fn); return timers.length; },
    Date, JSON, Math, String, Number, Array, Object, Promise, isFinite, encodeURIComponent, Uint8Array,
  };
  ctx.window = ctx;
  ctx.window.scrollTo = () => {};
  const wl = {};
  ctx.window.addEventListener = (n, fn) => { (wl[n] = wl[n] || []).push(fn); };
  vm.createContext(ctx);
  // the edge's order: the preview's script (only when the hub JSON says `listen`), then hub.js, both deferred
  if (listen) vm.runInContext(LISTEN_SRC, ctx);
  vm.runInContext(HUB_SRC, ctx);
  const flush = async () => { for (let i = 0; i < 6; i++) { await Promise.resolve(); while (timers.length) timers.shift()(); } };
  const script = (re) => head.filter((e) => e.tag === 'script' && re.test(e.src || ''));
  const arrive = async (re, src) => { if (src) vm.runInContext(src, ctx); script(re).forEach((s) => (s.listeners.load || []).forEach((fn) => fn())); await flush(); };
  return { ctx, head, fetches, root, html: () => root._h, flush, script, arrive, replaced, wl };
}


describe('#listen/<pid> on the hub page', () => {
  test.each(['en', 'ur'])('%s: the timing is asked by the hub token, the player script fetched once, mounted on it (it never plays by itself); no child event', async (lang) => {
    const p = open({ hash: '#listen/' + PID, boot: { ...BOOTS.done, lang }, routes: { 'listen/h/': ok({ readalong: TIMED }) } });
    await p.flush();
    expect(p.html()).toContain('id="wq-listen-ra"');
    expect(p.script(/wq-readalong-listen\.js/)).toHaveLength(0);
    expect(p.script(/wq-readalong\.js/).map((e) => e.src)).toEqual(['/wq/wq-readalong.js?v=def456']);
    await p.arrive(/wq-readalong\.js/, STUB);
    await p.flush();
    const asked = p.fetches.filter((u) => /\/api\/wq\/listen\//.test(u));
    expect(asked).toEqual([`/api/wq/listen/h/${encodeURIComponent(BOOTS.done.token)}/${PID}?lang=${lang}`]);
    expect(p.ctx.__ra.d).toEqual(TIMED);
    expect(p.ctx.__ra.o.labels).toEqual(lang === 'ur' ? { play: 'سنیں', pause: 'روکیں', replay: 'دوبارہ سنیں' } : { play: 'Play', pause: 'Pause', replay: 'Hear it again' });
    expect(p.fetches.filter((u) => /\/api\/wq\/e$/.test(u))).toHaveLength(0);
    expect(p.fetches.filter((u) => /\/api\/wq\/ch\//.test(u))).toHaveLength(0);
  });
  test('Back drops the player and draws the hub, the hash cleared', async () => {
    const p = open({ hash: '#listen/' + PID, boot: { ...BOOTS.done, lang: 'en' }, routes: { 'listen/h/': ok({ readalong: TIMED }) } });
    await p.flush();
    await p.arrive(/wq-readalong\.js/, STUB);
    p.root.querySelector('#wq-listen-back').fire('click');
    await p.flush();
    expect(p.ctx.__ra.destroyed).toBe(1);
    expect(p.html()).not.toContain('id="wq-listen-ra"');
    expect(p.html()).toBe(open({ boot: { ...BOOTS.done, lang: 'en' } }).html());
    expect(p.replaced.pop()).toMatch(/\/h\//);
  });
  test('refused (switch off, a counted passage, a forwarded link on another phone, no file): straight back to the hub, never a blank page', async () => {
    for (const status of [403, 404, 401]) {
      const p = open({ hash: '#listen/' + PID, boot: { ...BOOTS.done, lang: 'en' }, routes: { 'listen/h/': () => ({ status, body: { error: 'x' } }) } });
      await p.flush();
      await p.arrive(/wq-readalong\.js/, STUB);
      await p.flush();
      expect(p.html()).not.toContain('id="wq-listen-ra"');
      expect(p.html()).toBe(open({ boot: { ...BOOTS.done, lang: 'en' } }).html());
      expect(p.ctx.__ra).toBeUndefined();
    }
  });
  test('a hash that is not a passage id, or no hash: today\'s hub, nothing asked', async () => {
    for (const hash of ['', '#listen/../x', '#story/abc']) {
      const p = open({ hash, boot: { ...BOOTS.done, lang: 'en' } });
      await p.flush();
      expect(p.html()).not.toContain('id="wq-listen-ra"');
      expect(p.html()).toBe(open({ boot: { ...BOOTS.done, lang: 'en' }, listen: false }).html());
      expect(p.script(/wq-readalong/)).toHaveLength(0);
      expect(p.fetches.filter((u) => /\/api\/wq\/listen\//.test(u))).toHaveLength(0);
    }
  });
  test('the tile sets the hash in place (hashchange, owned by the preview\'s script): the preview opens without a reload', async () => {
    const p = open({ boot: { ...BOOTS.done, lang: 'en' }, routes: { 'listen/h/': ok({ readalong: TIMED }) } });
    await p.flush();
    expect(p.wl.hashchange).toHaveLength(1);
    p.ctx.location.hash = '#listen/' + PID;
    p.wl.hashchange.forEach((fn) => fn({}));
    await p.flush();
    expect(p.html()).toContain('id="wq-listen-ra"');
  });
  test('a locked hub (the link on another phone) never opens the preview, even with the hash', async () => {
    const p = open({ hash: '#listen/' + PID, boot: { ...BOOTS.done, lang: 'en', locked: true, kids: [], kid: null }, routes: { 'listen/h/': ok({ readalong: TIMED }) } });
    await p.flush();
    p.wl.hashchange.forEach((fn) => fn({}));
    await p.flush();
    expect(p.html()).not.toContain('id="wq-listen-ra"');
    expect(p.fetches.filter((u) => /\/api\/wq\/listen\//.test(u))).toHaveLength(0);
  });
});

describe('the switch off: the edge sends no preview script, and hub.js is today\'s hub', () => {
  test('with a #listen/ hash and no preview script: the hub boots as with no hash, and no script or preview call is made', async () => {
    const off = open({ hash: '#listen/' + PID, boot: { ...BOOTS.done, lang: 'en' }, listen: false, routes: { 'listen/h/': ok({ readalong: TIMED }) } });
    await off.flush();
    const plain = open({ boot: { ...BOOTS.done, lang: 'en' }, listen: false });
    await plain.flush();
    expect(off.html()).toBe(plain.html());
    expect(off.head.filter((e) => e.tag === 'script')).toEqual(plain.head.filter((e) => e.tag === 'script'));
    expect(off.script(/wq-readalong/)).toHaveLength(0);
    expect(off.fetches).toEqual(plain.fetches);
    expect(off.wl.hashchange).toBeUndefined();
  });
  test('hub.js holds one guard expression for the preview: no hash test, no listener, no loader of its own', () => {
    expect(HUB_SRC.match(/WQLISTEN/g)).toHaveLength(2);
    expect(HUB_SRC).toContain('else if (!(window.WQLISTEN && WQLISTEN.take(boot, render, bar))) boot();');
    expect(HUB_SRC).not.toMatch(/hashchange|#listen|readalong/);
  });
});

describe('the edge forwards the two read-along routes to the bot (and refuses a malformed token before it)', () => {
  const http = require('http');
  const express = require('express');
  const { createWebQuizRouter } = require('../routes/web-quiz.routes');
  const BOT = 'http://bot.test';
  const TOKEN = 'eyJrIjoiaCIsImlkcyI6WyJhIl0sImV4cCI6OTk5OTk5OTk5OX0.AbCdEfGhIjKlMnOpQrStUv';
  let srv; let calls;
  const get = (p) => new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: srv.address().port, path: p }, (res) => { let out = ''; res.on('data', (c) => { out += c; }); res.on('end', () => resolve({ status: res.statusCode, body: out })); }).on('error', reject);
  });
  beforeEach(async () => {
    calls = [];
    const app = express();
    app.use(createWebQuizRouter({ botUrl: BOT, apiKey: 'k', fetchImpl: async (url, opts) => { calls.push({ url, opts }); return { status: 200, ok: true, headers: { get: () => 'application/json' }, text: async () => JSON.stringify({ readalong: TIMED }) }; } }));
    await new Promise((r) => { srv = app.listen(0, r); });
  });
  afterEach(() => new Promise((r) => srv.close(r)));
  test('a practice listen\'s words by the run token; the preview by the hub token', async () => {
    expect((await get(`/api/wq/ch/words/${TOKEN}?lang=ur`)).status).toBe(200);
    expect(calls[0].url).toBe(`${BOT}/api/internal/wq/ch/words/${TOKEN}?lang=ur`);
    expect((await get(`/api/wq/listen/h/${TOKEN}/${PID}?lang=en`)).status).toBe(200);
    expect(calls[1].url).toBe(`${BOT}/api/internal/wq/listen/h/${TOKEN}/${PID}?lang=en`);
    expect((await get('/api/wq/ch/words/not-a-token')).status).toBe(404);
    expect((await get(`/api/wq/listen/h/not-a-token/${PID}`)).status).toBe(404);
    expect(calls).toHaveLength(2);
  });
});

describe('the edge: the preview\'s script on the hub page only when the hub JSON says `listen`', () => {
  const { renderHubPage, assetVersion } = require('../routes/web-quiz.routes');
  const TOKEN = 'eyJrIjoiaCIsImlkcyI6WyJhIl0sImV4cCI6OTk5OTk5OTk5OX0.AbCdEfGhIjKlMnOpQrStUv';
  const page = (extra) => renderHubPage({ payload: { ...BOOTS.done, ...extra }, token: TOKEN, origin: 'https://wq.example.test', assetV: 'abc123abcd' });
  test('`listen: true`: one deferred tag, before hub.js, at its own version', () => {
    const html = page({ listen: true });
    const tags = html.match(/<script src="\/wq\/wq-readalong-listen\.js\?v=[0-9a-f]{10}" defer><\/script>/g);
    expect(tags).toHaveLength(1);
    expect(html.indexOf(tags[0])).toBeLessThan(html.indexOf('<script src="/wq/hub.js?v=abc123abcd" defer></script>'));
  });
  test('no `listen` (switch off), or anything but true: no preview script on the page', () => {
    expect(page({})).not.toContain('readalong');
    for (const v of [false, 'true', 1, null, {}]) expect(page({ listen: v })).not.toContain('wq-readalong-listen.js');
  });
  test('the hub\'s own version is unchanged by the preview\'s files (they carry their own)', () => {
    expect(assetVersion()).toMatch(/^[0-9a-f]{10}$/);
    const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'web-quiz.routes.js'), 'utf8');
    const av = src.slice(src.indexOf('function assetVersion()'), src.indexOf('function originOf('));
    expect(av).not.toMatch(/readalong/);
  });
});

describe('the edge forwards this phone (the wq_dv cookie) to the bot on the preview, as on the hub\'s menu', () => {
  const http = require('http');
  const express = require('express');
  const { createWebQuizRouter } = require('../routes/web-quiz.routes');
  const TOKEN = 'eyJrIjoiaCIsImlkcyI6WyJhIl0sImV4cCI6OTk5OTk5OTk5OX0.AbCdEfGhIjKlMnOpQrStUv';
  let srv; let calls;
  const get = (p, cookie) => new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: srv.address().port, path: p, headers: cookie ? { cookie } : {} }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); }).on('error', reject);
  });
  beforeEach(async () => {
    calls = [];
    const app = express();
    app.use(createWebQuizRouter({ botUrl: 'http://bot.test', apiKey: 'k', fetchImpl: async (url, opts) => { calls.push({ url, opts }); return { status: 403, ok: false, headers: { get: () => 'application/json' }, text: async () => '{"error":"other_device"}' }; } }));
    await new Promise((r) => { srv = app.listen(0, r); });
  });
  afterEach(() => new Promise((r) => srv.close(r)));
  test('with the cookie: x-wq-device is the phone; without it: no header (the bot refuses)', async () => {
    expect(await get(`/api/wq/listen/h/${TOKEN}/${PID}?lang=en`, 'wq_dv=FamilyPhoneDeviceRef_1')).toBe(403);
    expect(calls[0].opts.headers['x-wq-device']).toBe('FamilyPhoneDeviceRef_1');
    expect(await get(`/api/wq/listen/h/${TOKEN}/${PID}?lang=en`)).toBe(403);
    expect(calls[1].opts.headers).not.toHaveProperty('x-wq-device');
  });
});
