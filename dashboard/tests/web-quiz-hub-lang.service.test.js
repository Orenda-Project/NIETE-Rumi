/**
 * One language for the whole round trip: every link the quiz page and the hub mint into another page carries
 * lang=<the language the child sees> (one helper, WQT.withLang in wq-tel.js, the one script every page loads
 * first), and the edge forwards a whitelisted ?lang on /h/<token> to the bot (which honours it only under
 * web_quiz_challenge_v2). The shipped page scripts run whole in a vm; the bot is the network boundary (a fake fetch).
 */
const fs = require('fs');
const http = require('http');
const path = require('path');
const vm = require('vm');
const express = require('express');
const { page, flush } = require('./wq-page-harness');
const { createWebQuizRouter } = require('../routes/web-quiz.routes');

const WQ = path.join(__dirname, '..', 'public', 'wq');
const TEL = fs.readFileSync(path.join(WQ, 'wq-tel.js'), 'utf8');
const HUB = fs.readFileSync(path.join(WQ, 'hub.js'), 'utf8');
const PLAY = fs.readFileSync(path.join(WQ, 'hub-play.js'), 'utf8');
const CARD = fs.readFileSync(path.join(WQ, 'wq-card.js'), 'utf8');
const TOKEN = 'eyJrIjoiaCJ9.AbCdEfGhIjKlMnOpQrStUv';

// wq-tel.js alone, as a page without the telemetry switch loads it.
function tel(boot = {}) {
  const ctx = { document: { getElementById: () => ({ textContent: JSON.stringify(boot) }), addEventListener() {}, visibilityState: 'visible' },
    navigator: { userAgent: 'test' }, setInterval: () => 0, setTimeout: () => 0, addEventListener() {}, fetch: () => Promise.resolve({}) };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(TEL, ctx);
  return ctx.WQT;
}

describe('WQT.withLang (wq-tel.js): the one helper', () => {
  const w = tel().withLang;
  test('adds lang to a link with or without a query, and replaces one already there', () => {
    expect(w('/h/tok.abc?from=door', 'ur')).toBe('/h/tok.abc?from=door&lang=ur');
    expect(w('/h/tok.abc', 'en')).toBe('/h/tok.abc?lang=en');
    expect(w('/c/t?kid=k1&lang=en&home=1', 'ur')).toBe('/c/t?kid=k1&lang=ur&home=1');
    expect(w('/c/t?lang=ur', 'en')).toBe('/c/t?lang=en');
  });
  test('the library\'s own l= is not lang=: kept, and lang= is added', () => {
    expect(w('/lib/t?kid=c&l=ur', 'ur')).toBe('/lib/t?kid=c&l=ur&lang=ur');
  });
  test('only en|ur: anything else leaves the link as it was', () => {
    expect(w('/h/t?from=door', 'fr')).toBe('/h/t?from=door');
    expect(w('/h/t?from=door', undefined)).toBe('/h/t?from=door');
    expect(w('/h/t?from=door', 'ur&x=1')).toBe('/h/t?from=door');
  });
  test('a fragment stays last', () => {
    expect(w('/h/t?from=door#top', 'ur')).toBe('/h/t?from=door&lang=ur#top');
  });
  test('there with the telemetry switch on too', () => {
    expect(typeof tel({ rt: true, view: 'hub' }).withLang).toBe('function');
  });
});

// The quiz page: the door, the old class link's hub, and the Jugnu card, through the one helper.
const CHILD = { first: 'Zara', chip: 'c1', animal: 'owl' };
const RESULT = { card: { first: 'Zara', animal: 'owl', correct: 3, total: 5, stars: 3 }, challenge_code: 'CHAL12', score: { correct: 3, total: 5 } };
const store = (result, extra = {}) => ({ wq_s_TEST: { st: 's1', child: CHILD, answers: {}, queue: [], result, vdone: true, ...extra } });
// Every call to the helper, recorded (the real helper still answers).
function spyHelper(ctx) {
  const calls = [];
  const real = ctx.WQT.withLang;
  ctx.WQT.withLang = (h, l) => { calls.push([h, l]); return real(h, l); };
  return calls;
}

describe('the quiz page', () => {
  test.each([['ur'], ['en']])('the results card\'s door opens the hub in the page\'s language (%s)', async (lang) => {
    const p = page({ lang, store: store({ ...RESULT, hub_door: true }), api: { hubdoor: { href: '/h/tok.abc' } } });
    const calls = spyHelper(p.ctx);
    p.els['#wq-hubdoor'].fire('click');
    await flush(); await flush();
    expect(p.hist.assigned).toEqual([`/h/tok.abc?from=door&lang=${lang}`]);
    expect(calls).toEqual([['/h/tok.abc?from=door', lang]]);
  });

  test('an old, finished class link goes to the child\'s hub in the page\'s language', async () => {
    const finished = { wq_s_TEST: { st: 's1', child: CHILD, answers: {}, queue: [], result: RESULT, vdone: true }, wq_kids: [CHILD], wq_d: 'dddddddddddddddddddddd' };
    const p = page({ lang: 'ur', store: finished, bootExtra: { link_home: true }, api: { '/api/wq/linkhome': { home: '/h/abc.def?from=link' } } });
    await flush(); await flush();
    expect(p.hist.assigned).toEqual(['/h/abc.def?from=link&lang=ur']);
  });

  test('the Jugnu card\'s Play carries the language through the same helper', async () => {
    const HREF = '/c/tok.abc?kid=k1&via=quiz_card';
    const p = page({ lang: 'ur', store: store({ ...RESULT, hub_door: true, jugnu_card: true }), api: { hubdoor: { href: HREF } } });
    const calls = spyHelper(p.ctx);
    vm.runInContext(CARD, p.ctx);
    p.wq.card();
    p.els['#wq-jc-go'].fire('click');
    p.els['#wq-jc-play'].fire('click');
    await flush(); await flush();
    expect(p.hist.assigned).toEqual([`${HREF}&lang=ur`]);
    expect(calls).toEqual([[HREF, 'ur']]);
  });
});

// The hub page: wq-tel.js, then (with `play`) hub-play.js, then hub.js, as the edge's template loads them.
function hubPage(boot, { search = '', api = {}, play = false, before = null } = {}) {
  const els = {};
  const assigned = [];
  const replaced = [];
  const fetches = [];
  const root = {
    _h: '', attrs: {},
    set innerHTML(h) {
      this._h = h;
      for (const k of Object.keys(els)) delete els[k];
      for (const m of h.matchAll(/<(?:a|button)\b([^>]*)>/g)) {
        const id = /id="([^"]+)"/.exec(m[1]);
        const data = /data-(chip)="([^"]+)"/.exec(m[1]);
        const sel = id ? `#${id[1]}` : data ? `[data-chip="${data[2]}"]` : null;
        if (!sel) continue;
        const e = (els[sel] = { listeners: {}, attrs: {}, addEventListener(n, fn) { (this.listeners[n] = this.listeners[n] || []).push(fn); },
          fire(n) { (this.listeners[n] || []).forEach((fn) => fn({ preventDefault() {} })); }, getAttribute(k) { return this.attrs[k]; } });
        const href = /href="([^"]+)"/.exec(m[1]);
        if (href) e.attrs.href = href[1].replace(/&amp;/g, '&');
        if (data) e.attrs['data-chip'] = data[2];
      }
    },
    get innerHTML() { return this._h; },
    setAttribute(k, v) { this.attrs[k] = v; },
    appendChild() {},
    querySelector(sel) { return els[sel] || null; },
    querySelectorAll(sel) { const k = sel.replace(/^\[|\]$/g, ''); return Object.values(els).filter((e) => e.attrs[k] !== undefined); },
  };
  const docEl = { setAttribute() {}, classList: { toggle() {}, contains: () => false } };
  const ctx = {
    document: { documentElement: docEl, getElementById: (id) => (id === 'wq' ? root : { textContent: JSON.stringify(boot) }),
      createElement: () => ({ setAttribute() {}, textContent: '', style: {} }), head: { appendChild() {} }, cookie: '', querySelector: () => null },
    navigator: { sendBeacon: () => true },
    history: { replaceState(s, t, u) { replaced.push(u); } },
    location: { search, protocol: 'https:', assign(u) { assigned.push(u); }, reload() {} },
    Blob: function Blob() {},
    fetch: (url, init) => {
      fetches.push({ url, init });
      const hit = Object.keys(api).find((k) => url.indexOf(k) >= 0);
      return Promise.resolve({ status: 200, ok: true, text: () => Promise.resolve(JSON.stringify(hit ? api[hit] : {})) });
    },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    setTimeout: () => 0, Date, JSON, Math, String, Number, Array, Object, Promise, isFinite, encodeURIComponent, Uint8Array,
  };
  ctx.window = ctx;
  ctx.window.scrollTo = () => {};
  ctx.window.addEventListener = () => {};
  ctx.window.crypto = { getRandomValues: (a) => a };
  vm.createContext(ctx);
  vm.runInContext(TEL, ctx);
  if (before) before(ctx);
  if (play) vm.runInContext(PLAY, ctx);
  vm.runInContext(HUB, ctx);
  return { els, assigned, replaced, fetches, html: () => root._h, ctx };
}
const KIDS = [{ chip: '0000000000000001', first: 'Sana', animal: 'owl', grade: '3' }, { chip: '0000000000000002', first: 'Bilal', animal: 'lion', grade: '5' }];
const BR = { mascot: { en: 'Jugnu', ur: 'جگنو' }, label: { en: 'B', ur: 'B' }, sub: { en: 'S', ur: 'S' }, name: 'B', mark: { tile: true, svg: '' } };
const hubBoot = (extra = {}) => ({ lang: 'ur', token: TOKEN, brand: BR, kids: [KIDS[0]], kid: KIDS[0].chip, teacher: null, again: [], recs: [],
  challenge: { on: true }, lib: { href: `/lib/${TOKEN}?kid=${KIDS[0].chip}&l=ur` }, ...extra });
// The links the hub mints into another page of its own family (the challenge, the library, the hub itself).
const minted = (h) => [...h.matchAll(/href="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, '&')).filter((u) => /^\/(c|lib|h)\//.test(u));
// The language a link carries: lang=, or the library's own l= (the bot mints it from the same hub language, and the
// edge's /lib route reads l= or lang=), so the library link stays the bot's string, byte for byte.
const carries = (u, lang) => new RegExp(`[?&]${/^\/lib\//.test(u) ? '(lang|l)' : 'lang'}=${lang}(&|$)`).test(u);

describe('the hub page', () => {
  test.each([
    ['today\'s hub', {}, false],
    ['the home page with the Home button', { home_v: 1, nav_home: true, last: null }, false],
    ['no teacher quiz (the library button in the empty card)', { teacher: null }, false],
    ['the Jugnu corner (hub-play.js)', { home_v: 1, play: { first: true, lantern: null, shelf: null, install: false, doors: [] } }, true],
  ])('GOLDEN every minted href carries the hub\'s language: %s', (_n, extra, play) => {
    for (const lang of ['ur', 'en']) {
      const p = hubPage(hubBoot({ lang, lib: { href: `/lib/${TOKEN}?kid=${KIDS[0].chip}&l=${lang}` }, ...extra }), { play });
      const links = minted(p.html());
      expect(links.length).toBeGreaterThan(1);
      for (const u of links) expect([u, carries(u, lang)]).toEqual([u, true]);
    }
  });

  test('the challenge link goes through the helper and is today\'s string; the library link is the bot\'s, unchanged', () => {
    const p = hubPage(hubBoot({ lang: 'ur', home_v: 1, nav_home: true }));
    expect(p.els['#wq-h-ch'].attrs.href).toBe(`/c/${TOKEN}?kid=${KIDS[0].chip}&lang=ur&home=1`);
    expect(p.els['#wq-h-lib'].attrs.href).toBe(`/lib/${TOKEN}?kid=${KIDS[0].chip}&l=ur&home=1`);
    let calls = [];
    hubPage(hubBoot({ lang: 'en' }), { before: (ctx) => { calls = spyHelper(ctx); } });
    expect(calls).toContainEqual([`${encodeURIComponent(TOKEN)}?kid=${KIDS[0].chip}`, 'en']);
  });

  test('opened with ?lang=ur: a sibling pick asks the bot in that language, and the address keeps it', async () => {
    const p = hubPage(hubBoot({ lang: 'ur', kids: KIDS, kid: null }), { search: '?from=door&lang=ur', api: { '/api/wq/hub/': { lang: 'ur', kids: KIDS, kid: KIDS[1].chip, again: [], recs: [] } } });
    expect(p.replaced).toEqual([`/h/${TOKEN}?lang=ur`]);
    p.els['[data-chip="0000000000000002"]'].fire('click');
    await flush(); await flush();
    const call = p.fetches.find((f) => f.url.indexOf('/api/wq/hub/') >= 0);
    expect(JSON.parse(call.init.body)).toMatchObject({ kid: KIDS[1].chip, lang: 'ur' });
    expect(p.replaced[1]).toBe(`/h/${TOKEN}?kid=${KIDS[1].chip}&lang=ur`);
  });

  test('GOLDEN opened without ?lang (or with a value that is not en|ur): the pick\'s body and the address are today\'s', async () => {
    for (const search of ['?from=door', '?from=door&lang=fr']) {
      const p = hubPage(hubBoot({ lang: 'ur', kids: KIDS, kid: null }), { search, api: { '/api/wq/hub/': { lang: 'ur', kids: KIDS, kid: KIDS[1].chip, again: [], recs: [] } } });
      expect(p.replaced).toEqual([`/h/${TOKEN}`]);
      p.els['[data-chip="0000000000000002"]'].fire('click');
      await flush(); await flush();
      const call = p.fetches.find((f) => f.url.indexOf('/api/wq/hub/') >= 0);
      expect(Object.keys(JSON.parse(call.init.body)).sort()).toEqual(['device_ref', 'kid']);
      expect(p.replaced[1]).toBe(`/h/${TOKEN}?kid=${KIDS[1].chip}`);
    }
  });
});

// The edge: /h/<token>?lang= reaches the bot only as en|ur; without it the bot call is today's.
describe('the edge forwards a whitelisted lang on /h/<token>', () => {
  const BOT = 'http://bot.test';
  const ETOKEN = 'eyJrIjoiaCIsImlkcyI6WyJhIl0sImV4cCI6OTk5OTk5OTk5OX0.AbCdEfGhIjKlMnOpQrStUv';
  let srv; let calls; let body;
  beforeEach(async () => {
    calls = [];
    body = { lang: 'ur', kids: [{ chip: '0123456789abcdef', first: 'Sana', animal: 'owl', grade: '3' }], kid: '0123456789abcdef', teacher: null, again: [], recs: [], challenge: null, lib: null, brand: 'niete' };
    const app = express();
    app.use(createWebQuizRouter({ botUrl: BOT, apiKey: 'k', fetchImpl: async (url) => { calls.push(url); return { status: 200, ok: true, headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) }, text: async () => JSON.stringify(body) }; } }));
    await new Promise((r) => { srv = app.listen(0, r); });
  });
  afterEach(() => new Promise((r) => srv.close(r)));
  const get = (p) => new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: srv.address().port, path: p }, (res) => { let o = ''; res.on('data', (c) => { o += c; }); res.on('end', () => resolve({ status: res.statusCode, body: o })); }).on('error', reject);
  });
  test.each([
    [`?from=door&lang=ur`, `?src=door&lang=ur`],
    [`?lang=en`, `?lang=en`],
    [`?kid=0123456789abcdef&from=link&lang=ur`, `?kid=0123456789abcdef&src=link&lang=ur`],
    [`?from=door&lang=fr`, `?src=door`],
    [`?from=door&lang=ur%26x%3D1`, `?src=door`],
    [`?from=door`, `?src=door`],
    [``, ``],
  ])('GET /h/<token>%s -> bot /hub/<token>%s', async (q, botQ) => {
    const r = await get(`/h/${ETOKEN}${q}`);
    expect(r.status).toBe(200);
    expect(calls).toEqual([`${BOT}/api/internal/wq/hub/${ETOKEN}${botQ}`]);
  });
  test('the page wears the language the bot answered', async () => {
    body.lang = 'ur';
    expect((await get(`/h/${ETOKEN}?lang=ur`)).body).toMatch(/<html lang="ur" dir="rtl">/);
  });
});

// The helper lives in wq-tel.js now: a change to it alone must change every page's ?v= (no old cached helper).
describe('the asset version hashes wq-tel.js', () => {
  afterEach(() => jest.restoreAllMocks());
  test('a change to wq-tel.js alone changes the version', () => {
    const { assetVersion } = require('../routes/web-quiz.routes');
    const before = assetVersion();
    const real = fs.readFileSync;
    jest.spyOn(fs, 'readFileSync').mockImplementation((p, ...a) => (path.basename(String(p)) === 'wq-tel.js' ? Buffer.from('changed') : real(p, ...a)));
    expect(assetVersion()).not.toBe(before);
  });
});
