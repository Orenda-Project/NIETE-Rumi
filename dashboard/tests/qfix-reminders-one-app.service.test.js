'use strict';
/**
 * One Jugnu app on a phone, whichever door installed it. The hub card (GET /h/<token>/manifest.webmanifest) and the
 * finish card (GET /q/<code>/manifest.webmanifest) carry the same manifest id '/wq/jugnu', so Chrome treats an app
 * installed from either door as the same app and never offers the other. A hub app installed before the hub manifest
 * had an id keeps its old id (Chrome does not move it), so the page remembers on this origin that the phone has the
 * app: localStorage wq_app = '1' on appinstalled and whenever a page runs as the installed app. While it is set, the
 * finish card is not drawn (one install_prompt step 'had_app' says so); storage trouble draws the card as before.
 * Fake DOM; invented values.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const http = require('http');
const express = require('express');
const R = require('../routes/web-quiz.routes');

const REMIND_SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'wq-remind.js'), 'utf8');
const PLAY_SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'hub-play.js'), 'utf8');
const UA_CHROME = 'Mozilla/5.0 (Linux; Android 13; SM-A145F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';
const TOKEN = 'eyJrIjoiaCIsImlkcyI6WyJhIl0sImV4cCI6OTk5OTk5OTk5OX0.AbCdEfGhIjKlMnOpQrStUv';
const KEY = 'BPUBKEYAAAA';
const FINISH_MANIFEST = "{\"name\":\"Jugnu\",\"short_name\":\"Jugnu\",\"display\":\"standalone\",\"background_color\":\"#ffffff\",\"theme_color\":\"#ffffff\",\"icons\":[{\"src\":\"/wq/jugnu/hello.webp\",\"sizes\":\"200x200\",\"type\":\"image/webp\",\"purpose\":\"any\"}],\"id\":\"/wq/jugnu\",\"start_url\":\"/q/AB12CD?from=hs\",\"scope\":\"/\"}";
const flush = async () => { for (let i = 0; i < 16; i += 1) await new Promise((r) => setImmediate(r)); };

describe('both doors carry one manifest id', () => {
  let srv;
  beforeAll(async () => {
    const app = express();
    app.use(R.createWebQuizRouter({ botUrl: 'http://bot.test', apiKey: 'k', fetchImpl: async () => { throw new Error('no bot call expected'); } }));
    srv = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  });
  afterAll(() => new Promise((r) => srv.close(r)));
  const get = (p) => new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: srv.address().port, path: p }, (res) => { let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => resolve({ status: res.statusCode, body: b })); }).on('error', reject);
  });

  test('the hub manifest has id /wq/jugnu; start_url and scope are unchanged', async () => {
    const m = JSON.parse((await get(`/h/${TOKEN}/manifest.webmanifest?kid=0000000000000001`)).body);
    expect(m).toMatchObject({ id: '/wq/jugnu', start_url: `/h/${TOKEN}?from=hs&kid=0000000000000001`, scope: '/' });
  });
  test('the hub door and the finish door give the same id', async () => {
    const hub = JSON.parse((await get(`/h/${TOKEN}/manifest.webmanifest`)).body);
    const fin = JSON.parse((await get('/q/AB12CD/manifest.webmanifest')).body);
    expect(hub.id).toBe(fin.id);
    expect(fin).toMatchObject({ id: '/wq/jugnu', start_url: '/q/AB12CD?from=hs', scope: '/' });
  });
  // lead-review 161809: the finish door's manifest is byte-unchanged (the body served on sandbox ec137fcdbe).
  test('the finish manifest is byte-unchanged', async () => {
    expect((await get('/q/AB12CD/manifest.webmanifest')).body).toBe(FINISH_MANIFEST);
  });
});

/** The quiz finish screen with the install card's switch on (no reminder ask), as in the finish-card tests. */
function finish({ store = {}, standalone = false, broken = false } = {}) {
  const tel = [];
  const winL = {};
  const reg = { pushManager: { subscribe: async () => null, getSubscription: async () => null } };
  const ls = broken
    ? { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem() {} }
    : { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem() {} };
  const ctx = {
    console, Promise, JSON, Math, Object, Array, String, Number, Boolean, RegExp, Error, encodeURIComponent, decodeURIComponent, Uint8Array,
    Date, setTimeout, clearTimeout, Intl, atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    location: { host: 'wq.example', protocol: 'https:' }, matchMedia: (q) => ({ matches: standalone && /standalone/.test(q) }),
    navigator: { userAgent: UA_CHROME, serviceWorker: { getRegistrations: async () => [], getRegistration: async () => reg, register: async () => reg, ready: Promise.resolve(reg) } },
    localStorage: ls,
    sessionStorage: { getItem: () => null, setItem() {} },
    document: { visibilityState: 'visible', getElementById: () => null, querySelector: () => null, head: { appendChild() {} }, createElement: () => ({}), addEventListener() {} },
    addEventListener(n, fn) { (winL[n] = winL[n] || []).push(fn); },
    fetch: async (url, init) => (init && init.method === 'POST' ? { status: 200, json: async () => ({ ok: 1 }) } : { status: 200, json: async () => ({ key: KEY, ask: false, install_android: true }) }),
    PushManager: function PushManager() {}, Notification: { permission: 'default', requestPermission: () => Promise.resolve('default') },
    WQT: { on: true, push: (e) => { tel.push(e); return true; } },
  };
  ctx.window = ctx; ctx.self = ctx;
  vm.runInNewContext(REMIND_SRC, ctx);
  const slot = { innerHTML: '', onclick: null, setAttribute() {}, removeAttribute() {} };
  return {
    slot, store, winL,
    steps: () => tel.filter((e) => e.n === 'install_prompt').map((e) => e.step),
    mount: async () => { ctx.WQREMIND.mount(slot, { code: 'AB12CD', lang: 'en', chips: 1 }); await flush(); },
    fire: async (n, e) => { (winL[n] || []).forEach((f) => f(e)); await flush(); },
  };
}
const bip = () => ({ preventDefault() {}, prompt() {}, userChoice: Promise.resolve({ outcome: 'accepted' }) });

describe('the finish card on a phone that has the app', () => {
  test('wq_app set: the browser offers, no card, one had_app step', async () => {
    const p = finish({ store: { wq_app: '1' } });
    await p.mount();
    await p.fire('beforeinstallprompt', bip());
    await p.fire('beforeinstallprompt', bip());
    expect(p.slot.innerHTML).not.toContain('Put Jugnu on your phone');
    expect(p.steps().filter((s) => s === 'had_app')).toEqual(['had_app']);
    expect(p.steps()).not.toContain('card_shown');
  });
  test('wq_app not set: the card as before', async () => {
    const p = finish();
    await p.mount();
    await p.fire('beforeinstallprompt', bip());
    expect(p.slot.innerHTML).toContain('Put Jugnu on your phone');
    expect(p.steps()).not.toContain('had_app');
  });
  test('storage unreadable: the card as before', async () => {
    const p = finish({ broken: true });
    await p.mount();
    await p.fire('beforeinstallprompt', bip());
    expect(p.slot.innerHTML).toContain('Put Jugnu on your phone');
  });
  test('installed from the finish card: wq_app is set', async () => {
    const p = finish();
    await p.mount();
    await p.fire('beforeinstallprompt', bip());
    await p.fire('appinstalled', {});
    expect(p.store.wq_app).toBe('1');
  });
  test('the quiz page running as the installed app: wq_app is set', async () => {
    const p = finish({ standalone: true });
    await p.mount();
    expect(p.store.wq_app).toBe('1');
  });
});

describe('the hub remembers the app', () => {
  const NOW = Date.parse('2026-10-15T21:00:00Z');
  function hub({ store = {}, standalone = false } = {}) {
    const winL = {}; const timers = [];
    const box = { innerHTML: '', addEventListener() {} };
    const ROOT = { innerHTML: '<div id="wqp-inst" class="wq-inst"></div>', querySelector: (s) => (s === '#wqp-inst' ? box : null) };
    const ctx = {
      window: { addEventListener(n, fn) { (winL[n] = winL[n] || []).push(fn); }, matchMedia: (q) => ({ matches: standalone && /standalone/.test(q) }) },
      navigator: { userAgent: UA_CHROME }, document: { head: { appendChild() {} }, createElement: () => ({}) },
      localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
      setTimeout: (fn) => { timers.push(fn); return timers.length; }, Date: class extends Date { static now() { return NOW; } },
      JSON, Math, String, Number, Array, Object, isFinite, encodeURIComponent,
    };
    vm.createContext(ctx);
    vm.runInContext(PLAY_SRC, ctx);
    ctx.window.WQPLAY.install({ lang: 'en', play: { install: true, doors: ['install'] } }, () => {}, ROOT, { h3: true });
    while (timers.length) timers.shift()();
    return { store, fire: (n, e) => (winL[n] || []).forEach((f) => f(e)) };
  }
  test('installed from the hub card: wq_app is set', () => {
    const h = hub();
    expect(h.store.wq_app).toBeUndefined();
    h.fire('appinstalled', {});
    expect(h.store.wq_app).toBe('1');
  });
  test('the hub running as the installed app (an old hub app too): wq_app is set', () => {
    expect(hub({ standalone: true }).store.wq_app).toBe('1');
  });
});
