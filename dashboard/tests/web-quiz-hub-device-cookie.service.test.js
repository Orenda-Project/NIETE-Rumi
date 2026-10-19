/**
 * The kid hub page script (public/wq/hub.js) and the wq_dv device cookie the server may already
 * have given this phone. hub.js and wq-tel.js run whole in a vm; the bot API (fetch), localStorage
 * and the cookie jar are the faked boundaries. A phone with no stored ref but a valid wq_dv adopts
 * that cookie (one device to the server); a stored ref always wins; any other cookie shape is
 * ignored and a ref is minted as before.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'hub.js'), 'utf8');
const TEL = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'wq-tel.js'), 'utf8');
const flush = () => new Promise((r) => setImmediate(r));
const REF_RX = /^[A-Za-z0-9_-]{22}$/;

// jar: the cookies the browser already holds for this site ("name=value"), preset by the test.
// writes: every document.cookie assignment, as the page made it.
function page(boot, { api = {}, store = {}, jar = [] } = {}) {
  const writes = [];
  const fetches = [];
  const cookieJar = jar.slice();
  const els = {};
  const el = (sel) => (els[sel] = els[sel] || { sel, listeners: {}, attrs: {}, addEventListener(n, fn) { (this.listeners[n] = this.listeners[n] || []).push(fn); }, fire(n, e) { (this.listeners[n] || []).forEach((fn) => fn(e || { preventDefault() {} })); }, getAttribute(k) { return this.attrs[k]; } });
  const root = {
    _h: '', attrs: {},
    set innerHTML(h) {
      this._h = h;
      for (const k of Object.keys(els)) delete els[k];
      for (const m of h.matchAll(/<(?:a|button)\b([^>]*)>/g)) {
        const id = /id="([^"]+)"/.exec(m[1]);
        if (id) el(`#${id[1]}`);
      }
    },
    get innerHTML() { return this._h; },
    setAttribute(k, v) { this.attrs[k] = v; },
    appendChild() {},
    querySelector(sel) { return els[sel] || null; },
    querySelectorAll() { return []; },
  };
  const classes = new Set();
  const docEl = { attrs: { lang: 'en', dir: 'ltr' }, setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return this.attrs[k]; },
    classList: { toggle(c, on) { if (on) classes.add(c); else classes.delete(c); }, contains: (c) => classes.has(c), add: (c) => classes.add(c), remove: (c) => classes.delete(c) }, get className() { return [...classes].join(' '); } };
  const ctx = {
    document: { documentElement: docEl, getElementById: (id) => (id === 'wq' ? root : { textContent: JSON.stringify(boot) }), createElement: () => ({ setAttribute() {}, textContent: '' }),
      set cookie(v) {
        writes.push(v);
        const pair = String(v).split(';')[0];
        const name = pair.split('=')[0];
        const at = cookieJar.findIndex((c) => c.split('=')[0] === name);
        if (at >= 0) cookieJar[at] = pair; else cookieJar.push(pair);
      },
      get cookie() { return cookieJar.join('; '); } },
    window: { scrollTo() {}, addEventListener() {} },
    navigator: { sendBeacon: () => true },
    history: { replaceState() {} },
    location: { search: '', protocol: 'http:', assign() {}, reload() {} },
    Blob: function Blob(parts) { this.parts = parts; },
    fetch: (url, init) => {
      fetches.push({ url, init });
      const hit = Object.keys(api).find((k) => url.indexOf(k) >= 0);
      const r = hit ? api[hit] : {};
      return Promise.resolve({ status: 200, ok: true, text: () => Promise.resolve(JSON.stringify(r)) });
    },
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
    setTimeout: () => 0, Date, JSON, Math, String, Number, Array, Object, Promise, isFinite, encodeURIComponent,
  };
  vm.createContext(ctx);
  vm.runInContext(TEL, ctx);
  vm.runInContext(SRC, ctx);
  const hubCall = () => fetches.find((f) => f.url.indexOf('/api/wq/hub/') === 0);
  return { writes, store, jar: cookieJar, hubCall, sent: () => JSON.parse(hubCall().init.body).device_ref };
}

const TOKEN = 'eyJrIjoiaCJ9.AbCdEfGhIjKlMnOpQrStUv';
const BR = { mascot: { en: 'Jugnu', ur: 'جگنو' }, label: { en: 'NIETE', ur: 'NIETE' }, sub: { en: 'FOR STUDENTS', ur: 'FOR STUDENTS' }, name: 'NIETE', mark: { tile: true, svg: '' } };
// The server render with no device: the page asks the bot again as this phone (deviceRef runs on open).
const LOCKED = () => ({ lang: 'en', token: TOKEN, brand: BR, locked: true, kids: [], kid: null, teacher: null, again: [], recs: [], challenge: null, lib: null });
const API = () => ({ '/api/wq/hub/': LOCKED() });
const DV = 'SrvMintedDevCookie_-01';
const STORED = 'StoredRefStoredRef_-02';
const KEEP = (d) => 'wq_dv=' + d + '; path=/; max-age=2592000; samesite=lax';
const dvWrites = (p) => p.writes.filter((w) => w.indexOf('wq_dv=') === 0);

test('a fresh profile with a server-minted wq_dv cookie: the hub adopts it (the hub POST carries it, localStorage keeps it, the cookie is rewritten with the same value)', async () => {
  const p = page(LOCKED(), { api: API(), jar: ['wq_dv=' + DV] });
  await flush(); await flush();
  expect(p.sent()).toBe(DV);
  expect(JSON.parse(p.store.wq_d)).toBe(DV);
  const w = dvWrites(p);
  expect(w.length).toBeGreaterThan(0);
  expect(w[w.length - 1].indexOf(KEEP(DV))).toBe(0);
  expect(p.jar).toEqual(['wq_dv=' + DV]);
});

describe('a malformed wq_dv is ignored: a new ref is minted as today', () => {
  const cases = [
    ['short', 'short'],
    ['23 chars', DV + 'x'],
    ['a dot, padded to 22', 'has.a.dotAAAAAAAAAAAAA'],
  ];
  test.each(cases)('%s', async (_name, bad) => {
    const p = page(LOCKED(), { api: API(), jar: ['wq_dv=' + bad] });
    await flush(); await flush();
    const sent = p.sent();
    expect(sent).toMatch(REF_RX);
    expect(sent).not.toBe(bad);
    expect(JSON.parse(p.store.wq_d)).toBe(sent);
    const w = dvWrites(p);
    expect(w[w.length - 1].indexOf(KEEP(sent))).toBe(0);
  });
});

test('a page with a stored ref is byte-identical: the stored ref wins over a different wq_dv cookie', async () => {
  const p = page(LOCKED(), { api: API(), store: { wq_d: JSON.stringify(STORED) }, jar: ['wq_dv=' + DV] });
  await flush(); await flush();
  expect(p.sent()).toBe(STORED);
  expect(p.store.wq_d).toBe(JSON.stringify(STORED));
  expect(dvWrites(p)).toEqual([KEEP(STORED)]);
});

test('no store, no cookie: a mint as today', async () => {
  const p = page(LOCKED(), { api: API() });
  await flush(); await flush();
  const sent = p.sent();
  expect(sent).toMatch(REF_RX);
  expect(JSON.parse(p.store.wq_d)).toBe(sent);
  expect(dvWrites(p)).toEqual([KEEP(sent)]);
});

test('a cookie header with other cookies around it', async () => {
  const p = page(LOCKED(), { api: API(), jar: ['a=1', 'wq_dv=' + DV, 'b=2'] });
  await flush(); await flush();
  expect(p.sent()).toBe(DV);
  expect(JSON.parse(p.store.wq_d)).toBe(DV);
  expect(dvWrites(p)).toEqual([KEEP(DV)]);
});
