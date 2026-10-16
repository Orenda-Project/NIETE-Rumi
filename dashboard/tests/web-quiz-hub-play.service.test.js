/**
 * The hub's Jugnu corner on the page (public/wq/hub-play.js with public/wq/hub.js, both run whole in a vm with a
 * small fake DOM) and on the edge (renderHubPage): the Jugnu card first when the last quiz is finished, Continue
 * first while it is open, door_shown{hub_first} once per view with its slot, the lantern line and the shelf's NEW
 * tags, and the golden: with no `play` from the server, the hub page and its HTML are the base's, byte for byte
 * (fixtures/hub-play-golden.json was rendered by the base's hub.js and renderHubPage on the same boot).
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const http = require('http');
const express = require('express');
const { renderHubPage, createWebQuizRouter } = require('../routes/web-quiz.routes');

const HUB_SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'hub.js'), 'utf8');
const PLAY_SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'hub-play.js'), 'utf8');
const TEL_SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'wq-tel.js'), 'utf8');
const GOLDEN = require('./fixtures/hub-play-golden.json');
const BOOTS = require('./fixtures/hub-play-boots.json');

const CHROME_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';
const WA_UA = 'Mozilla/5.0 (Linux; Android 14; SM-A145F Build/UP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0 Mobile Safari/537.36 WhatsApp/2.24.21.80 WA4A/2.24.21.80';
// The page's clock, fixed: the boots' teacher card says how many days ago its quiz was sent (sent_at 6 Oct 10:00Z), so a
// golden taken against the real clock moves every day. 15 Oct 21:00Z is when the goldens were taken (9 days).
const NOW = Date.parse('2026-10-15T21:00:00Z');
class FixedDate extends Date {
  constructor(...a) { super(...(a.length ? a : [NOW])); }
  static now() { return NOW; }
}

function page(boot, { play = true, store = {}, ua = CHROME_UA, standalone = false } = {}) {
  const assigned = [];
  const beacons = [];
  const els = {};
  const timers = [];
  const winL = {};
  const el = (sel, attrs) => (els[sel] = els[sel] || { sel, listeners: {}, attrs: attrs || {}, addEventListener(n, fn) { (this.listeners[n] = this.listeners[n] || []).push(fn); }, fire(n, ev) { (this.listeners[n] || []).forEach((fn) => fn.call(this, ev || { preventDefault() {} })); }, getAttribute(k) { return this.attrs[k]; } });
  const root = {
    _h: '', attrs: {},
    set innerHTML(h) {
      this._h = h;
      for (const k of Object.keys(els)) delete els[k];
      for (const m of h.matchAll(/<(?:a|button|p|div)\b([^>]*)>/g)) {
        const attrs = {};
        for (const a of m[1].matchAll(/([a-z-]+)="([^"]*)"/g)) attrs[a[1]] = a[2].replace(/&amp;/g, '&');
        const sel = attrs.id ? `#${attrs.id}` : attrs['data-shelf'] ? `[data-shelf="${attrs['data-shelf']}"]` : attrs['data-chip'] ? `[data-chip="${attrs['data-chip']}"]` : null;
        if (sel) el(sel, attrs);
      }
    },
    get innerHTML() { return this._h; },
    setAttribute(k, v) { this.attrs[k] = v; },
    appendChild() {},
    querySelector(sel) { return els[sel] || null; },
    querySelectorAll(sel) { const k = sel.replace(/^\[|\]$/g, ''); return Object.values(els).filter((e) => e.attrs[k] !== undefined); },
  };
  const docEl = { attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, classList: { toggle() {}, contains: () => false } };
  const ctx = {
    document: { documentElement: docEl, head: { appendChild() {} }, getElementById: (id) => (id === 'wq' ? root : { textContent: JSON.stringify(boot) }), createElement: () => ({ setAttribute() {}, textContent: '' }), cookie: '' },
    window: { scrollTo() {}, addEventListener(n, fn) { (winL[n] = winL[n] || []).push(fn); }, matchMedia: (q) => ({ matches: standalone && /standalone/.test(q) }) },
    navigator: { userAgent: ua, sendBeacon: (u, b) => { beacons.push(...JSON.parse(b.parts[0]).events); return true; } },
    history: { replaceState() {} },
    location: { search: '', protocol: 'https:', host: 'wq.example.test', assign(u) { assigned.push(u); }, reload() {} },
    Blob: function Blob(parts) { this.parts = parts; },
    fetch: () => Promise.resolve({ status: 200, ok: true, text: () => Promise.resolve('{}') }),
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
    setTimeout: (fn) => { timers.push(fn); return timers.length; },
    Date: FixedDate, JSON, Math, String, Number, Array, Object, Promise, isFinite, encodeURIComponent,
  };
  vm.createContext(ctx);
  // wq-tel.js first, as on every page the edge renders (the pages' link helper WQT.withLang).
  vm.runInContext(TEL_SRC, ctx);
  // The edge loads hub-play.js before hub.js (both deferred) only when the boot carries `play`.
  if (play) vm.runInContext(PLAY_SRC, ctx);
  vm.runInContext(HUB_SRC, ctx);
  const tick = () => { while (timers.length) timers.shift()(); };
  tick();
  return { beacons, html: () => root._h, els, tick, win: winL, store, assigned, doors: () => beacons.filter((e) => /^door_/.test(e.n)) };
}

describe('GOLDEN: no `play` from the server', () => {
  test.each(Object.keys(BOOTS))('hub page HTML string-equal to the base (%s)', (name) => {
    const p = page(BOOTS[name], { play: false });
    expect(p.html()).toBe(GOLDEN.page[name]);
    expect(p.doors()).toEqual([]);
  });

  test('renderHubPage HTML string-equal to the base: no hub-play script, no manifest', () => {
    const html = renderHubPage({ payload: BOOTS.done, token: 'tok.tok', origin: 'https://wq.example.test', assetV: 'v1' });
    expect(html).toBe(GOLDEN.edge);
    expect(html).not.toContain('hub-play.js');
    expect(html).not.toContain('manifest');
  });

  test('`play` present: the edge loads hub-play.js before hub.js; the manifest only with install on', () => {
    const on = renderHubPage({ payload: { ...BOOTS.done, play: { first: true, install: false, doors: [] } }, token: 'tok.tok', origin: 'https://wq.example.test', assetV: 'v1' });
    expect(on.indexOf('/wq/hub-play.js?v=v1')).toBeGreaterThan(0);
    expect(on.indexOf('/wq/hub-play.js')).toBeLessThan(on.indexOf('/wq/hub.js'));
    expect(on).not.toContain('manifest');
    const inst = renderHubPage({ payload: { ...BOOTS.done, play: { first: false, install: true, doors: [] } }, token: 'tok.tok', origin: 'https://wq.example.test', assetV: 'v1' });
    expect(inst).toContain('<link rel="manifest" href="/h/tok.tok/manifest.webmanifest?kid=0000000000000001">');
  });

  test('`play` present but nothing on for this view (first false, no lantern, no shelf): the hub HTML is still the base\'s', () => {
    const p = page({ ...BOOTS.open, play: { first: false, lantern: null, shelf: null, install: false, doors: [] } });
    expect(p.html()).toBe(GOLDEN.page.open);
  });
});

describe('events-only (web_quiz_events_v2 alone): the base hub plus the event wiring', () => {
  test.each(['done', 'open', 'classic'])('%s: HTML string-equal to the base; only door_shown{hub_first} is sent', (name) => {
    const p = page({ ...BOOTS[name], play: { first: false, lantern: null, shelf: null, install: false, doors: ['hub_first'] } });
    expect(p.html()).toBe(GOLDEN.page[name]);
    expect(p.doors()).toEqual([expect.objectContaining({ n: 'door_shown', door: 'hub_first', surface: 'hub' })]);
  });
});

describe('Jugnu first (web_quiz_hub_challenge_first)', () => {
  test('last quiz finished + first -> the Jugnu card is the first card; its tile is not repeated', () => {
    const p = page({ ...BOOTS.done, play: { first: true, lantern: null, shelf: null, install: false, doors: [] } });
    const h = p.html();
    expect(h.indexOf('id="wq-h-ch"')).toBeGreaterThan(0);
    expect(h.indexOf('id="wq-h-ch"')).toBeLessThan(h.indexOf('wq-hlast'));
    expect(h.match(/id="wq-h-ch"/g)).toHaveLength(1);
  });

  test('last quiz open -> Continue stays first (the base order)', () => {
    const p = page({ ...BOOTS.open, play: { first: false, lantern: null, shelf: null, install: false, doors: ['hub_first'] } });
    const h = p.html();
    expect(h.indexOf('wq-hlast')).toBeLessThan(h.indexOf('id="wq-h-ch"'));
  });

  test('door_shown{hub_first} once per view with the slot: 1 when first, its place otherwise; door_tap on tap', () => {
    const first = page({ ...BOOTS.done, play: { first: true, lantern: null, shelf: null, install: false, doors: ['hub_first'] } });
    expect(first.doors()).toEqual([expect.objectContaining({ n: 'door_shown', door: 'hub_first', surface: 'hub', slot: 1 })]);
    // A re-render of the same view (the back/forward cache) does not count it again.
    first.win.pageshow.forEach((fn) => fn({ persisted: true }));
    first.tick();
    expect(first.doors().filter((e) => e.n === 'door_shown')).toHaveLength(1);
    first.els['#wq-h-ch'].fire('click');
    expect(first.doors().filter((e) => e.n === 'door_tap')).toEqual([expect.objectContaining({ door: 'hub_first', surface: 'hub', slot: 1 })]);

    // Last quiz open: the last card, then the Jugnu tile -> slot 2.
    const later = page({ ...BOOTS.open, play: { first: false, lantern: null, shelf: null, install: false, doors: ['hub_first'] } });
    expect(later.doors()).toEqual([expect.objectContaining({ n: 'door_shown', door: 'hub_first', slot: 2 })]);
  });

  test('events_v2 off (no hub_first door): the order still changes, nothing is sent', () => {
    const p = page({ ...BOOTS.done, play: { first: true, lantern: null, shelf: null, install: false, doors: [] } });
    expect(p.doors()).toEqual([]);
  });
});

describe('lantern + shelf', () => {
  const play = (lantern, shelf, doors = ['hub_first', 'next', 'tomorrow', 'shelf']) => ({ first: true, lantern, shelf, install: false, doors });

  test('trail: one line, no count; door_shown{next, nx:trail}', () => {
    const p = page({ ...BOOTS.done, play: play({ kind: 'trail', stops: 2 }, null) });
    expect(p.html()).toContain('Games are waiting for you on the Trail.');
    expect(p.html()).not.toMatch(/\b2\b[^"]*Trail/);
    expect(p.doors()).toContainEqual(expect.objectContaining({ n: 'door_shown', door: 'next', nx: 'trail' }));
  });

  test('new story: its title, a link into Story Time; tomorrow: shown only; all seen (Monday)', () => {
    const s = page({ ...BOOTS.done, play: play({ kind: 'story', title: 'The Kite', pid: 'p-1' }, null) });
    expect(s.html()).toContain('A new story is here: The Kite');
    expect(s.els['#wqp-next'].attrs.href).toContain('&room=story&pid=p-1');
    const t = page({ ...BOOTS.done, play: play({ kind: 'numbers', day: 'tomorrow' }, null) });
    expect(t.html()).toContain('Tomorrow: a new story');
    expect(t.doors()).toContainEqual(expect.objectContaining({ n: 'door_shown', door: 'tomorrow' }));
    // copy.v2.json v2.1 jg.lantern.tomorrow: the Urdu line ends with «۔» like the other lantern states
    expect(page({ ...BOOTS.done, lang: 'ur', play: play({ kind: 'numbers', day: 'tomorrow' }, null) }).html()).toContain('کل نئی کہانی آئے گی۔');
    const m = page({ ...BOOTS.done, play: play({ kind: 'numbers', day: 'monday' }, null) });
    expect(m.html()).toContain('Next story arrives on Monday. Until then, play numbers with Jugnu.');
    const n = page({ ...BOOTS.done, play: play({ kind: 'day', day: null }, null) });
    expect(n.html()).toContain('Numbers with Jugnu');
    expect(n.html()).not.toContain('Monday');
  });

  test('shelf: NEW only on an unseen story, never on numbers; door_shown{shelf, pid, nx, slot} per tile, door_tap on tap', () => {
    const p = page({ ...BOOTS.done, play: play(null, [{ id: 'week_story', pid: 'p-new', nx: 'new' }, { id: 'listen', pid: 'p-old', nx: 'seen' }, { id: 'numbers', nx: 'seen' }]) });
    const h = p.html();
    expect(h).toContain('<p class="wqp-label">Jugnu today</p>');
    expect(h).not.toContain('wq-hlabel">Jugnu today');
    expect(h.match(/wqp-new/g)).toHaveLength(1);
    expect(h.indexOf('wqp-new')).toBeLessThan(h.indexOf('This week'));
    const shown = p.doors().filter((e) => e.door === 'shelf');
    expect(shown).toEqual([
      expect.objectContaining({ n: 'door_shown', slot: 1, pid: 'p-new', nx: 'new' }),
      expect.objectContaining({ n: 'door_shown', slot: 2, pid: 'p-old', nx: 'seen' }),
      expect.objectContaining({ n: 'door_shown', slot: 3, nx: 'seen' }),
    ]);
    p.els['[data-shelf="1"]'].fire('click');
    expect(p.doors().filter((e) => e.n === 'door_tap')).toEqual([expect.objectContaining({ door: 'shelf', pid: 'p-new', nx: 'new', slot: 1 })]);
  });

  test('Urdu: the lantern and the shelf in Urdu', () => {
    const p = page({ ...BOOTS.done, lang: 'ur', play: play({ kind: 'trail', stops: 1 }, [{ id: 'numbers', nx: 'seen' }]) });
    expect(p.html()).toContain('جگنو کے راستے پر ایک کھیل آپ کا انتظار کر رہا ہے۔');
    expect(p.html()).toContain('آج جگنو کے ساتھ');
  });

  const INST = { first: true, lantern: null, shelf: [{ id: 'numbers', nx: 'seen' }], install: true, doors: ['hub_first', 'install'] };
  const SEEN_TODAY = () => ({ wqp_hv_day: String(Math.floor((Date.now() + 5 * 3600000) / 86400000)) });
  const offer = (p, outcome = 'accepted') => {
    const e = { prevented: 0, prompted: 0, preventDefault() { this.prevented += 1; }, prompt() { this.prompted += 1; }, userChoice: Promise.resolve({ outcome }) };
    p.win.beforeinstallprompt.forEach((fn) => fn(e));
    return e;
  };
  const card = (p) => String(p.els['#wqp-inst'].innerHTML || '');

  test('install card: hidden until the browser offers the install; its slot sits after the shelf, below the Jugnu card', () => {
    const p = page({ ...BOOTS.done, play: INST }, { store: SEEN_TODAY() });
    const h = p.html();
    expect(h.indexOf('id="wqp-inst"')).toBeGreaterThan(h.indexOf('wqp-shelf'));
    expect(h.indexOf('id="wqp-inst"')).toBeGreaterThan(h.indexOf('id="wq-h-ch"'));
    expect(card(p)).toBe('');
    expect(p.doors().filter((e) => e.door === 'install')).toEqual([]);
  });

  test('install card: shown once offered (not the day\'s first view): EN copy, door_shown{install, slot}; Add -> prompt -> accepted -> door_tap', async () => {
    const p = page({ ...BOOTS.done, play: INST }, { store: SEEN_TODAY() });
    const e = offer(p);
    expect(e.prevented).toBe(1);
    expect(card(p)).toContain('Add Jugnu to your home screen');
    expect(card(p)).toContain('>Add<');
    expect(card(p)).toContain('>Not now<');
    expect(p.doors()).toContainEqual(expect.objectContaining({ n: 'door_shown', door: 'install', surface: 'hub', slot: 3 }));
    p.els['#wqp-inst'].fire('click', { target: { getAttribute: (k) => (k === 'data-inst' ? 'add' : null) } });
    expect(e.prompted).toBe(1);
    await new Promise((r) => setImmediate(r));
    expect(p.doors().filter((x) => x.n === 'door_tap')).toEqual([expect.objectContaining({ door: 'install', surface: 'hub' })]);
    expect(card(p)).toBe('');
  });

  test('install card: never in the day\'s first hub view', () => {
    const p = page({ ...BOOTS.done, play: INST });
    offer(p);
    expect(card(p)).toBe('');
    expect(p.store.wqp_hv_day).toBeDefined();
  });

  test('install card: "Not now" hides it for 7 days', () => {
    const p = page({ ...BOOTS.done, play: INST }, { store: SEEN_TODAY() });
    offer(p);
    p.els['#wqp-inst'].fire('click', { target: { getAttribute: (k) => (k === 'data-inst' ? 'later' : null) } });
    expect(card(p)).toBe('');
    const again = page({ ...BOOTS.done, play: INST }, { store: { ...SEEN_TODAY(), wqp_inst_later: p.store.wqp_inst_later } });
    offer(again);
    expect(card(again)).toBe('');
    const later = page({ ...BOOTS.done, play: INST }, { store: { ...SEEN_TODAY(), wqp_inst_later: String(Date.now() - 8 * 86400000) } });
    offer(later);
    expect(card(later)).toContain('Add Jugnu');
  });

  test('install card in Urdu: the ruled copy', () => {
    const p = page({ ...BOOTS.done, lang: 'ur', play: INST }, { store: SEEN_TODAY() });
    offer(p);
    expect(card(p)).toContain('جگنو کو اپنی ہوم اسکرین پر لگائیں');
    expect(card(p)).toContain('>لگائیں<');
    expect(card(p)).toContain('>ابھی نہیں<');
  });

  // No card in the in-app browser: the device differs in the system browser (the hub would lock); a signed hand-over is pending.
  test('WhatsApp in-app browser (WA4A): no card, even if an install event fired; no listener, nothing sent', () => {
    const p = page({ ...BOOTS.done, play: INST }, { store: SEEN_TODAY(), ua: WA_UA });
    p.tick();
    expect(card(p)).toBe('');
    expect(p.win.beforeinstallprompt).toBeUndefined();
    expect(p.doors().filter((e) => e.door === 'install')).toEqual([]);
    expect(p.assigned).toEqual([]);
  });

  test('Chrome: no card until beforeinstallprompt', () => {
    const p = page({ ...BOOTS.done, play: INST }, { store: SEEN_TODAY(), ua: CHROME_UA });
    p.tick();
    expect(card(p)).toBe('');
    offer(p);
    expect(card(p)).toContain('Add Jugnu');
  });

  test('installed (standalone): no card, even with the event', () => {
    const p = page({ ...BOOTS.done, play: INST }, { store: SEEN_TODAY(), ua: WA_UA, standalone: true });
    p.tick();
    expect(p.win.beforeinstallprompt).toBeUndefined();
    expect(card(p)).toBe('');
  });

  test('install switch off: no slot, no listener, the golden stands', () => {
    const p = page({ ...BOOTS.done, play: { ...INST, install: false } }, { store: SEEN_TODAY() });
    expect(p.html()).not.toContain('wqp-inst');
    expect(p.win.beforeinstallprompt).toBeUndefined();
  });
});

describe('the install manifest (per child, from the edge)', () => {
  const TOKEN = 'eyJrIjoiaCIsImlkcyI6WyJhIl0sImV4cCI6OTk5OTk5OTk5OX0.AbCdEfGhIjKlMnOpQrStUv';
  let srv;
  beforeAll(async () => {
    const app = express();
    app.use(createWebQuizRouter({ botUrl: 'http://bot.test', apiKey: 'k', fetchImpl: async () => { throw new Error('no bot call expected'); } }));
    srv = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  });
  afterAll(() => new Promise((r) => srv.close(r)));
  const get = (p) => new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: srv.address().port, path: p }, (res) => { let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'], body: b })); }).on('error', reject);
  });

  test('start_url is this hub with ?from=hs (the home-screen route) and the child; a bad token is 404', async () => {
    const r = await get(`/h/${TOKEN}/manifest.webmanifest?kid=0000000000000001`);
    expect(r.status).toBe(200);
    expect(r.type).toMatch(/application\/manifest\+json/);
    const m = JSON.parse(r.body);
    expect(m).toMatchObject({ name: 'Jugnu', display: 'standalone', start_url: `/h/${TOKEN}?from=hs&kid=0000000000000001`, scope: '/' });
    expect((await get('/h/not-a-token/manifest.webmanifest')).status).toBe(404);
  });
});

describe('hub_open route value: /h/<token>?from=… rides to the bot as src', () => {
  const TOKEN = 'eyJrIjoiaCIsImlkcyI6WyJhIl0sImV4cCI6OTk5OTk5OTk5OX0.AbCdEfGhIjKlMnOpQrStUv';
  let srv; const calls = [];
  beforeAll(async () => {
    const app = express();
    const body = JSON.stringify(BOOTS.done);
    app.use(createWebQuizRouter({ botUrl: 'http://bot.test', apiKey: 'k', fetchImpl: async (url) => { calls.push(url); return { status: 200, ok: true, headers: { get: () => 'application/json' }, text: async () => body }; } }));
    srv = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  });
  afterAll(() => new Promise((r) => srv.close(r)));
  const get = (p) => new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: srv.address().port, path: p }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); }).on('error', reject);
  });

  test('from=class_link (and every EVENTS row-3 value) is passed as src', async () => {
    calls.length = 0;
    for (const v of ['class_link', 'card', 'home', 'door', 'wa', 'link', 'hs', 'guest', 'friend']) await get(`/h/${TOKEN}?from=${v}`);
    const hub = calls.filter((u) => u.includes('/api/internal/wq/hub/'));
    expect(hub[0]).toMatch(new RegExp(`/hub/${TOKEN}\\?src=class_link$`));
    expect(hub.map((u) => u.split('src=')[1])).toEqual(['class_link', 'card', 'home', 'door', 'wa', 'link', 'hs', 'guest', 'friend']);
    calls.length = 0;
  });

  test('door / hs / card are passed; anything else and no from leave the bot call as today', async () => {
    await get(`/h/${TOKEN}?from=door`);
    await get(`/h/${TOKEN}?from=hs&kid=0000000000000001`);
    await get(`/h/${TOKEN}?from=evil`);
    await get(`/h/${TOKEN}`);
    const hub = calls.filter((u) => u.includes('/api/internal/wq/hub/'));
    expect(hub[0]).toMatch(new RegExp(`/hub/${TOKEN}\\?src=door$`));
    expect(hub[1]).toMatch(new RegExp(`/hub/${TOKEN}\\?kid=0000000000000001&src=hs$`));
    expect(hub[2]).toMatch(new RegExp(`/hub/${TOKEN}$`));
    expect(hub[3]).toMatch(new RegExp(`/hub/${TOKEN}$`));
  });
});

// A child's FIRST hub open has no wq_dv cookie yet, so the server render gets the locked payload (no `play`) and
// the edge leaves hub-play.js out; hub.js then unlocks over POST and gets `play`. The corner must still draw: hub.js
// loads hub-play.js itself (at its own ?v=) and draws the hub again once it arrives, as it does for the Book.
describe('first open: the locked server render, then `play` from the unlock', () => {
  const PLAY = { first: false, lantern: null, install: false, doors: [], shelf: [{ id: 'week_story', nx: 'new', pid: 'en.read.1.story01' }, { id: 'numbers', nx: 'seen' }] };
  function firstOpen(answer, { playLoaded = false } = {}) {
    const head = [];
    const root = { _h: '', attrs: {}, set innerHTML(h) { this._h = h; }, get innerHTML() { return this._h; }, setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k]; }, querySelector: () => null, querySelectorAll: () => [], appendChild() {} };
    const timers = [];
    const ctx = {
      document: {
        documentElement: { setAttribute() {}, classList: { toggle() {}, contains: () => false } }, cookie: '',
        getElementById: (id) => (id === 'wq' ? root : id === 'boot' ? { textContent: JSON.stringify({ lang: 'en', token: 'tok.tok', brand: null, locked: true, kids: [] }) } : head.find((e) => e.id === id) || null),
        querySelector: (sel) => (/hub\.js/.test(sel) ? { getAttribute: () => '/wq/hub.js?v=abc123' } : null),
        createElement: (tag) => ({ tag, l: {}, setAttribute() {}, addEventListener(n, fn) { this.l[n] = fn; } }),
        head: { appendChild: (el) => head.push(el) },
      },
      navigator: { userAgent: CHROME_UA, sendBeacon: () => true },
      history: { replaceState() {} },
      location: { search: '', protocol: 'https:', host: 'wq.example.test', assign() {}, reload() {} },
      Blob: function Blob() {},
      fetch: () => Promise.resolve({ status: 200, ok: true, text: () => Promise.resolve(JSON.stringify(answer)) }),
      localStorage: { getItem: () => null, setItem() {} },
      setTimeout: (fn) => { timers.push(fn); return timers.length; },
      Date, JSON, Math, String, Number, Array, Object, Promise, isFinite, encodeURIComponent, Uint8Array,
    };
    ctx.window = ctx;
    ctx.window.scrollTo = () => {};
    ctx.window.addEventListener = () => {};
    vm.createContext(ctx);
    if (playLoaded) vm.runInContext(PLAY_SRC, ctx);
    vm.runInContext(HUB_SRC, ctx);
    const flush = async () => { for (let i = 0; i < 6; i++) { await Promise.resolve(); while (timers.length) timers.shift()(); } };
    return { ctx, head, html: () => root._h, flush };
  }
  test('hub-play.js is loaded at hub.js\'s ?v= and the shelf draws once it arrives', async () => {
    const p = firstOpen({ ...BOOTS.done, play: PLAY });
    await p.flush();
    const s = p.head.filter((e) => e.tag === 'script' && /hub-play\.js/.test(e.src || ''));
    expect(s.map((e) => e.src)).toEqual(['/wq/hub-play.js?v=abc123']);
    expect(p.html()).not.toContain('data-shelf');
    vm.runInContext(PLAY_SRC, p.ctx);
    s[0].l.load();
    await p.flush();
    expect(p.html()).toContain('data-shelf="1"');
    expect(p.html()).toContain('&amp;room=story&amp;pid=en.read.1.story01');
  });
  test('hub-play.js already on the page: drawn at once, nothing loaded', async () => {
    const p = firstOpen({ ...BOOTS.done, play: PLAY }, { playLoaded: true });
    await p.flush();
    expect(p.head.filter((e) => /hub-play/.test(e.src || ''))).toHaveLength(0);
    expect(p.html()).toContain('data-shelf="1"');
  });
  // The keep-my-place card (wq-bind.js, web_quiz_phone_bind): the same first-open gap (the edge's bindTags decides
  // before the device is known). hub.js loads wq-bind.js/.css itself when `bind` arrives without WQBIND.
  test('`bind` from the unlock: wq-bind.css/.js loaded at hub.js\'s ?v=, and the slot drawn once it arrives', async () => {
    const p = firstOpen({ ...BOOTS.done, bind: { offer: true, hub: 'tok.tok' } });
    await p.flush();
    const css = p.head.filter((e) => /wq-bind\.css/.test(e.href || ''));
    const js = p.head.filter((e) => e.tag === 'script' && /wq-bind\.js/.test(e.src || ''));
    expect(css.map((e) => e.href)).toEqual(['/wq/wq-bind.css?v=abc123']);
    expect(js.map((e) => e.src)).toEqual(['/wq/wq-bind.js?v=abc123']);
    expect(p.html()).not.toContain('wq-bind-slot');
    const cards = [];
    p.ctx.WQBIND = { card: (slot, o) => cards.push(o.kid), t: () => ({}), chipExtra: () => '' };
    js[0].l.load();
    await p.flush();
    expect(p.html()).toContain('id="wq-bind-slot"');
    expect(cards.length).toBe(1);
  });
  // Both lazy loads on one first open (`play` and `bind` from the unlock): one hub-play.js, one wq-bind.css, one
  // wq-bind.js, each at hub.js's ?v=; the hub drawn again when either arrives asks for nothing more.
  function bothStamped(p) {
    // hub-play.js adds its own <style> once it runs; only the scripts and stylesheets hub.js asked for count here.
    const tags = p.head.filter((e) => e.tag === 'script' || e.tag === 'link').map((e) => e.tag + ' ' + (e.tag === 'link' ? e.rel + ' ' + e.href : e.src));
    expect(tags).toEqual(['script /wq/hub-play.js?v=abc123', 'link stylesheet /wq/wq-bind.css?v=abc123', 'script /wq/wq-bind.js?v=abc123']);
  }
  test('`play` and `bind` on a first open: each loaded exactly once at hub.js\'s ?v=; hub-play.js arriving first redraws, nothing more loaded', async () => {
    const p = firstOpen({ ...BOOTS.done, play: PLAY, bind: { offer: true, hub: 'tok.tok' } });
    await p.flush();
    bothStamped(p);
    vm.runInContext(PLAY_SRC, p.ctx);
    p.head[0].l.load();
    await p.flush();
    expect(p.html()).toContain('data-shelf="1"');
    bothStamped(p);
    p.ctx.WQBIND = { card() {}, t: () => ({}), chipExtra: () => '' };
    p.head[2].l.load();
    await p.flush();
    expect(p.html()).toContain('id="wq-bind-slot"');
    bothStamped(p);
  });
  test('`play` and `bind` on a first open: wq-bind.js arriving first redraws, nothing more loaded', async () => {
    const p = firstOpen({ ...BOOTS.done, play: PLAY, bind: { offer: true, hub: 'tok.tok' } });
    await p.flush();
    bothStamped(p);
    p.ctx.WQBIND = { card() {}, t: () => ({}), chipExtra: () => '' };
    p.head[2].l.load();
    await p.flush();
    expect(p.html()).toContain('id="wq-bind-slot"');
    expect(p.html()).not.toContain('data-shelf');
    bothStamped(p);
  });
  test('no `bind` in the unlock answer: wq-bind is never loaded', async () => {
    const p = firstOpen({ ...BOOTS.done, play: PLAY }, { playLoaded: true });
    await p.flush();
    expect(p.head.filter((e) => /wq-bind/.test((e.src || '') + (e.href || '')))).toHaveLength(0);
  });
  test('no `play` in the unlock answer: nothing loaded', async () => {
    const p = firstOpen({ ...BOOTS.done });
    await p.flush();
    expect(p.head).toHaveLength(0);
    expect(p.html()).not.toContain('data-shelf');
  });
});
