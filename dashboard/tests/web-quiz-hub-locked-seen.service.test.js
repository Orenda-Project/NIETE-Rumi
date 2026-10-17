/**
 * A locked hub that already saw this phone (web_quiz_fast on). The edge renders the hub with the phone's wq_dv cookie;
 * when the bot still answers "locked" (this phone has not played as any of the link's children), asking the bot again
 * from the page with the same device_ref can only answer "locked" again: one more bot round trip (≈ 1.2 s on Slow 4G)
 * before the child sees the screen. The edge marks such a render `dv: 1` (fast on only), and hub.js shows the locked
 * screen at once when the phone's stored ref IS the cookie the edge used. Any other case asks again, as today: a first
 * open (no cookie at render), a stored ref that differs from the cookie, no mark (the switch off).
 * public/wq/hub.js runs whole in a vm with a small fake DOM; the bot's JSON over fetch is the boundary.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { hubBootPayload } = require('../routes/web-quiz.routes');

const HUB_SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'hub.js'), 'utf8');
const TOKEN = 'tok.tok';
const REF = 'AbCdEfGhIjKlMnOpQrStUv';
const OTHER = 'ZyXwVuTsRqPoNmLkJiHgFe';

function open({ boot, cookie = '', stored = null }) {
  const timers = [];
  const calls = [];
  const root = { _h: '', attrs: {}, set innerHTML(h) { this._h = h; }, get innerHTML() { return this._h; }, setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k]; }, querySelector: () => null, querySelectorAll: () => [], appendChild() {} };
  const doc = {
    documentElement: { setAttribute() {}, classList: { toggle() {}, contains: () => false } }, cookie,
    getElementById: (id) => (id === 'wq' ? root : id === 'boot' ? { textContent: JSON.stringify(boot) } : null),
    querySelector: (sel) => (/hub\.js/.test(sel) ? { getAttribute: () => '/wq/hub.js?v=abc123' } : null),
    createElement: (tag) => ({ tag, listeners: {}, setAttribute(k, v) { this[k] = v; }, addEventListener(n, fn) { (this.listeners[n] = this.listeners[n] || []).push(fn); } }),
    head: { appendChild() {} },
  };
  const ctx = {
    document: doc,
    navigator: { userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/130.0 Mobile Safari/537.36', sendBeacon: () => true },
    history: { replaceState() {} },
    location: { search: '', protocol: 'https:', host: 'wq.example.test', assign() {}, reload() {} },
    Blob: function Blob() {},
    fetch: (url, init) => { calls.push({ url, body: init && init.body }); return Promise.resolve({ status: 200, ok: true, text: () => Promise.resolve(JSON.stringify({ lang: 'en', locked: true, kids: [] })) }); },
    localStorage: { getItem: (k) => (k === 'wq_d' && stored ? JSON.stringify(stored) : null), setItem() {} },
    setTimeout: (fn) => { timers.push(fn); return timers.length; },
    Date, JSON, Math, String, Number, Array, Object, Promise, isFinite, encodeURIComponent, Uint8Array,
  };
  ctx.window = ctx;
  ctx.window.scrollTo = () => {};
  ctx.window.addEventListener = () => {};
  vm.createContext(ctx);
  vm.runInContext(HUB_SRC, ctx);
  const flush = async () => { for (let i = 0; i < 6; i++) { await Promise.resolve(); while (timers.length) timers.shift()(); } };
  const hubAsks = () => calls.filter((c) => /\/api\/wq\/hub\//.test(String(c.url)));
  return { root, flush, hubAsks };
}

const LOCKED = { lang: 'en', token: TOKEN, brand: null, locked: true, kids: [], fast: true };

describe('the page: a locked render that already used this phone is not asked again', () => {
  test('dv:1 and the stored ref is the cookie: the locked screen at once, no second hub call', async () => {
    const p = open({ boot: { ...LOCKED, dv: 1 }, cookie: `wq_dv=${REF}`, stored: REF });
    await p.flush();
    expect(p.hubAsks()).toHaveLength(0);
    expect(p.root.getAttribute('data-m')).toBe('H-lock');
  });
  test.each([
    ['no mark (the switch off)', { boot: LOCKED, cookie: `wq_dv=${REF}`, stored: REF }],
    ['first open: no stored ref', { boot: { ...LOCKED, dv: 1 }, cookie: `wq_dv=${REF}`, stored: null }],
    ['the stored ref differs from the cookie the edge used', { boot: { ...LOCKED, dv: 1 }, cookie: `wq_dv=${REF}`, stored: OTHER }],
    ['no cookie on the page', { boot: { ...LOCKED, dv: 1 }, cookie: '', stored: REF }],
  ])('%s: asks the bot again as this phone, as today', async (_n, o) => {
    const p = open(o);
    await p.flush();
    expect(p.hubAsks()).toHaveLength(1);
    expect(p.root.getAttribute('data-m')).toBe('H-lock');
  });
});

describe('the edge: the dv mark', () => {
  const req = (cookie) => ({ get: (h) => (h === 'cookie' ? cookie : undefined) });
  test('fast on, locked, the phone sent its cookie: dv:1 added, nothing else changed', () => {
    const body = { ...LOCKED };
    expect(hubBootPayload(body, req(`a=b; wq_dv=${REF}`))).toEqual({ ...body, dv: 1 });
  });
  test.each([
    ['the switch off', { ...LOCKED, fast: undefined }, `wq_dv=${REF}`],
    ['not locked', { ...LOCKED, locked: false, kids: [{ chip: 'c' }] }, `wq_dv=${REF}`],
    ['no cookie', LOCKED, ''],
    ['a malformed cookie', LOCKED, 'wq_dv=short'],
  ])('%s: the same object, untouched', (_n, body, cookie) => {
    expect(hubBootPayload(body, req(cookie))).toBe(body);
  });
});
