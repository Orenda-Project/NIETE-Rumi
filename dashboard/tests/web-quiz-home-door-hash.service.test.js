/**
 * The child home (web_quiz_home_v3): a link that names a door (#stories, #games, #videos) opens that door on every
 * way into the hub page — cold, from a card's Next or Home (?from=home / ?from=door, ?kid=), and after a sibling pick.
 * hub.js tidies the address on those paths (history.replaceState); the door's hash is kept, so the home routes it.
 * An unknown hash, and the hub without the home, are today's. Runs the shipped hub.js in a vm; the address bar is
 * faked as a browser keeps it (replaceState changes location.search and location.hash).
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'hub.js'), 'utf8');
const TEL = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'wq-tel.js'), 'utf8');
const flush = () => new Promise((r) => setImmediate(r));

const TOKEN = 'eyJrIjoiaCJ9.AbCdEfGhIjKlMnOpQrStUv';
const KIDS = [{ chip: '0000000000000001', first: 'Sana', animal: 'owl', grade: '3' }, { chip: '0000000000000002', first: 'Bilal', animal: 'lion', grade: '5' }];
const HOME = { home_v3: 1, doors: { stories: [], games: [], videos: null }, head: { dots: 0, today: false, jar: null } };
const boot = (lang, extra = {}) => ({ lang, token: TOKEN, brand: null, kids: KIDS, kid: KIDS[0].chip, teacher: null, again: [], recs: [], challenge: null, lib: null, ...HOME, ...extra });

function page(b, { search = '', hash = '', api = {} } = {}) {
  const els = {};
  const el = (sel) => (els[sel] = els[sel] || { sel, listeners: {}, attrs: {}, addEventListener(n, fn) { (this.listeners[n] = this.listeners[n] || []).push(fn); }, fire(n, e) { (this.listeners[n] || []).forEach((fn) => fn(e || { preventDefault() {} })); }, getAttribute(k) { return this.attrs[k]; } });
  const root = {
    _h: '', attrs: {},
    set innerHTML(h) {
      this._h = h;
      for (const k of Object.keys(els)) delete els[k];
      for (const m of h.matchAll(/<(?:a|button)\b([^>]*)>/g)) {
        const data = /data-(chip)="([^"]+)"/.exec(m[1]);
        if (data) el(`[data-chip="${data[2]}"]`).attrs['data-chip'] = data[2];
      }
    },
    get innerHTML() { return this._h; },
    setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k]; },
    appendChild() {},
    querySelector(sel) { return els[sel] || null; },
    querySelectorAll(sel) { const k = sel.replace(/^\[|\]$/g, ''); return Object.values(els).filter((e) => e.attrs[k] !== undefined); },
  };
  const loc = { search, hash, pathname: `/h/${TOKEN}`, protocol: 'https:', assign() {}, reload() {} };
  const urls = [];
  const history = { replaceState(st, t, u) { urls.push(u); const m = /^([^?#]*)(\?[^#]*)?(#.*)?$/.exec(String(u)); loc.pathname = m[1]; loc.search = m[2] || ''; loc.hash = m[3] || ''; } };
  const mounted = [];
  const win = { scrollTo() {}, addEventListener() {}, WQHOME: { mount: (r, B) => mounted.push({ hash: loc.hash, kid: B.kid }) } };
  const ctx = {
    document: {
      documentElement: { setAttribute() {}, getAttribute() { return null; }, classList: { toggle() {}, contains: () => false, add() {}, remove() {} } },
      getElementById: (id) => (id === 'wq' ? root : { textContent: JSON.stringify(b) }), createElement: () => ({ setAttribute() {}, addEventListener() {}, textContent: '' }),
      querySelector: () => null, head: { appendChild() {} }, cookie: '',
    },
    window: win, navigator: { sendBeacon: () => true }, history, location: loc, Blob: function Blob(parts) { this.parts = parts; },
    fetch: (url) => {
      const hit = Object.keys(api).find((k) => url.indexOf(k) >= 0);
      const r = hit ? api[hit] : {};
      return Promise.resolve({ status: 200, ok: true, text: () => Promise.resolve(JSON.stringify(r)) });
    },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    setTimeout: () => 0, Date, JSON, Math, String, Number, Array, Object, Promise, isFinite, encodeURIComponent, Uint8Array,
  };
  vm.createContext(ctx);
  vm.runInContext(TEL, ctx);
  vm.runInContext(SRC, ctx);
  return { mounted, urls, loc, els, html: () => root._h };
}

describe.each(['en', 'ur'])('%s: a door hash opens that door on every way in (home on)', (lang) => {
  test.each(['#stories', '#games', '#videos'])('cold open with %s: the home routes it', (h) => {
    const p = page(boot(lang), { hash: h });
    expect(p.mounted).toEqual([{ hash: h, kid: KIDS[0].chip }]);
  });
  test.each(['#stories', '#games', '#videos'])('a card\'s Next (?kid=…&from=home%s): the address is tidied, the door\'s hash kept', (h) => {
    const p = page(boot(lang), { search: `?kid=${KIDS[0].chip}&from=home`, hash: h });
    expect(p.urls).toEqual([`/h/${TOKEN}${h}`]);
    expect(p.mounted).toEqual([{ hash: h, kid: KIDS[0].chip }]);
  });
  test('the quiz card\'s door (?from=door#games): kept too', () => {
    const p = page(boot(lang), { search: '?from=door', hash: '#games' });
    expect(p.mounted[0].hash).toBe('#games');
  });
  test('a sibling pick (no child on the boot): the picked child\'s home opens the door', async () => {
    const p = page(boot(lang, { kid: null }), { hash: '#stories', api: { [`hub/${TOKEN}`]: boot(lang, { kid: KIDS[1].chip }) } });
    expect(p.mounted).toEqual([]);
    p.els[`[data-chip="${KIDS[1].chip}"]`].fire('click');
    await flush(); await flush();
    expect(p.mounted).toEqual([{ hash: '#stories', kid: KIDS[1].chip }]);
    expect(p.urls[p.urls.length - 1]).toBe(`/h/${TOKEN}?kid=${KIDS[1].chip}#stories`);
  });
  test('an unknown hash on ?from=home: dropped as today (the home)', () => {
    const p = page(boot(lang), { search: '?from=home', hash: '#nope' });
    expect(p.urls).toEqual([`/h/${TOKEN}`]);
    expect(p.mounted).toEqual([{ hash: '', kid: KIDS[0].chip }]);
  });
});

test('home off (no home_v3): ?from=home#stories tidies the address exactly as today', () => {
  const b = boot('en');
  delete b.home_v3;
  const p = page(b, { search: '?from=home', hash: '#stories' });
  expect(p.urls).toEqual([`/h/${TOKEN}`]);
  expect(p.mounted).toEqual([]);
});
