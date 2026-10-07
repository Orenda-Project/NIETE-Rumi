/**
 * The kid hub page script (public/wq/hub.js), run whole in a vm with a small fake DOM:
 * the boot JSON and the bot API (fetch) are the faked boundaries, the script is the
 * shipped file. Covers the copy (gender-neutral Urdu), the sibling pick and its
 * failures, a page restored from the back/forward cache, and robustness to a sparse row.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'hub.js'), 'utf8');
const flush = () => new Promise((r) => setImmediate(r));

function page(boot, { api = {}, store = {} } = {}) {
  const els = {};
  const winL = {};
  const assigned = [];
  let reloaded = 0;
  const el = (sel) => (els[sel] = els[sel] || { sel, listeners: {}, attrs: {}, addEventListener(n, fn) { (this.listeners[n] = this.listeners[n] || []).push(fn); }, fire(n, e) { (this.listeners[n] || []).forEach((fn) => fn(e || { preventDefault() {} })); }, getAttribute(k) { return this.attrs[k]; } });
  const root = {
    _h: '', attrs: {},
    set innerHTML(h) {
      this._h = h;
      for (const k of Object.keys(els)) delete els[k];
      // Every element with an id or a data-* hook becomes a fake element the test can tap.
      for (const m of h.matchAll(/<(?:a|button)\b([^>]*)>/g)) {
        const id = /id="([^"]+)"/.exec(m[1]);
        const href = /href="([^"]+)"/.exec(m[1]);
        const data = /data-(chip|again|rec)="([^"]+)"/.exec(m[1]);
        const sel = id ? `#${id[1]}` : data ? `[data-${data[1]}="${data[2]}"]` : null;
        if (!sel) continue;
        const e = el(sel);
        if (href) e.attrs.href = href[1].replace(/&amp;/g, '&');
        if (data) e.attrs[`data-${data[1]}`] = data[2];
      }
    },
    get innerHTML() { return this._h; },
    setAttribute(k, v) { this.attrs[k] = v; },
    appendChild(t) { toasts.push(t.textContent); },
    querySelector(sel) { return els[sel] || null; },
    querySelectorAll(sel) { const k = sel.replace(/^\[|\]$/g, ''); return Object.values(els).filter((e) => e.attrs[k] !== undefined); },
  };
  const toasts = [];
  const fetches = [];
  const cookies = [];
  const ctx = {
    document: { getElementById: (id) => (id === 'wq' ? root : { textContent: JSON.stringify(boot) }), createElement: () => ({ setAttribute() {}, textContent: '' }),
      set cookie(v) { cookies.push(v); }, get cookie() { return cookies.join('; '); } },
    window: { scrollTo() {}, addEventListener(n, fn) { (winL[n] = winL[n] || []).push(fn); } },
    navigator: { sendBeacon: () => true },
    history: { replaceState() {} },
    location: { assign(u) { assigned.push(u); }, reload() { reloaded += 1; } },
    Blob: function Blob() {},
    fetch: (url, init) => {
      fetches.push({ url, init });
      const hit = Object.keys(api).find((k) => url.indexOf(k) >= 0);
      const r = hit ? api[hit] : {};
      const status = (r && r.__status) || 200;
      return Promise.resolve({ status, ok: status < 300, text: () => Promise.resolve(JSON.stringify(r)) });
    },
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
    setTimeout: () => 0, Date, JSON, Math, String, Number, Array, Object, Promise, isFinite, encodeURIComponent,
  };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  return { cookies, store, root, els, toasts, fetches, assigned, html: () => root._h, moment: () => root.attrs['data-m'], win: winL, reloads: () => reloaded };
}

const KIDS = [{ chip: '0000000000000001', first: 'ثنا', animal: 'owl', grade: '3' }, { chip: '0000000000000002', first: 'بلال', animal: 'lion', grade: '5' }];
const TOKEN = 'eyJrIjoiaCJ9.AbCdEfGhIjKlMnOpQrStUv';
const BR = { mascot: { en: 'Jugnu', ur: 'جگنو' }, label: { en: 'NIETE', ur: 'NIETE' }, sub: { en: 'FOR STUDENTS', ur: 'FOR STUDENTS' }, name: 'NIETE', mark: { tile: true, svg: '' } };
const boot = (extra = {}) => ({ lang: 'ur', token: TOKEN, brand: BR, kids: KIDS, kid: null, teacher: null, again: [], recs: [], challenge: null, lib: null, ...extra });

test('Urdu "who is playing" is gender-neutral: «کس کی باری ہے؟», never the masculine «کون کھیل رہا ہے؟»', () => {
  const p = page(boot());
  expect(p.moment()).toBe('H1');
  expect(p.html()).toContain('کس کی باری ہے؟');
  expect(p.html()).not.toContain('رہا');
});

test('a sibling pick whose hub link has expired (401) reloads, so the server shows the closed page, never "No internet"', async () => {
  const p = page(boot(), { api: { '/api/wq/hub/': { __status: 401, error: 'bad_token' } } });
  p.els['[data-chip="0000000000000001"]'].fire('click');
  await flush(); await flush();
  expect(p.reloads()).toBe(1);
  expect(p.toasts).toEqual([]);
});

test('a page restored from the back/forward cache after a recommendation tap is live again (not stuck on "Opening…")', async () => {
  const rec = { vid: 'v1', title: 'Quarters', chapter: 'Fractions', subject: 'Maths', grade: '3' };
  const p = page(boot({ kids: [KIDS[0]], kid: KIDS[0].chip, recs: [rec] }), { api: { '/videos/start': { code: 'ABC123', k: 'k1' } } });
  p.els['[data-rec="0"]'].fire('click');
  await flush(); await flush();
  expect(p.assigned).toEqual(['/q/ABC123?k=k1']);
  expect(p.moment()).toBe('H2-go');
  (p.win.pageshow || []).forEach((fn) => fn({ persisted: true }));
  expect(p.moment()).toBe('H2');
  p.els['[data-rec="0"]'].fire('click');
  await flush(); await flush();
  expect(p.assigned).toHaveLength(2);
});

test('a play-again row without a best score still renders; every quiz link is URL-encoded', () => {
  const p = page(boot({ lang: 'en', kids: [KIDS[0]], kid: KIDS[0].chip,
    teacher: { code: 'NEWQ01', topic: 'Shapes', subject: 'maths', sent_at: new Date().toISOString(), k: 'a+b/c' },
    again: [{ code: 'MATH01', topic: 'Fractions', subject: 'Maths', tries: 1, last_at: '', k: 'x y' }] }));
  expect(p.moment()).toBe('H2');
  expect(p.els['[data-again="0"]'].attrs.href).toBe('/q/MATH01?again=1&k=x%20y');
  expect(p.els['#wq-h-teacher'].attrs.href).toBe('/q/NEWQ01?k=a%2Bb%2Fc');
});

test('Urdu: the "sent N days ago" count is isolated, so the number keeps its place', () => {
  const p = page(boot({ kids: [KIDS[0]], kid: KIDS[0].chip,
    teacher: { code: 'NEWQ01', topic: 'اشکال', subject: 'maths', sent_at: new Date(Date.now() - 3 * 86400000).toISOString(), k: 'k' } }));
  expect(p.html()).toMatch(/<bdi>3<\/bdi> دن پہلے بھیجا گیا/);
});

/* ---------------- a forwarded hub link names nobody (the server binds the link to the first phone) ---------------- */
const LOCKED = (extra = {}) => ({ lang: 'en', token: TOKEN, brand: BR, locked: true, kids: [], kid: null, teacher: null, again: [], recs: [], challenge: null, lib: null, ...extra });
const DEV = 'DevRefDevRefDevRef_-01';

test('server render (no device): the page asks the bot again WITH this phone\'s device_ref (body, not URL), then shows its children', async () => {
  const p = page(LOCKED(), { store: { wq_d: JSON.stringify(DEV) }, api: { '/api/wq/hub/': { lang: 'en', kids: [KIDS[0]], kid: KIDS[0].chip, teacher: null, again: [], recs: [] } } });
  await flush(); await flush();
  const call = p.fetches.find((f) => f.url.indexOf('/api/wq/hub/') === 0);
  expect(call.init.method).toBe('POST');
  expect(call.url).not.toContain(DEV);
  expect(JSON.parse(call.init.body)).toMatchObject({ device_ref: DEV });
  expect(p.moment()).toBe('H2');
  expect(p.html()).toContain('ثنا');
});

test('a phone with no device_ref yet mints one (22 url-safe chars), keeps it where the quiz page reads it, and sends it', async () => {
  const p = page(LOCKED(), { api: { '/api/wq/hub/': LOCKED() } });
  await flush(); await flush();
  const sent = JSON.parse(p.fetches.find((f) => f.url.indexOf('/api/wq/hub/') === 0).init.body).device_ref;
  expect(sent).toMatch(/^[A-Za-z0-9_-]{22}$/);
  expect(JSON.parse(p.store.wq_d)).toBe(sent);
});

test('another phone (still locked): NO name, the neutral "ask the child" screen, and a "someone else / new player" path', async () => {
  const p = page(LOCKED(), { store: { wq_d: JSON.stringify(DEV) }, api: { '/api/wq/hub/': LOCKED() } });
  await flush(); await flush();
  expect(p.moment()).toBe('H-lock');
  expect(p.html()).toContain('Ask the child this link was sent to to open it');
  expect(p.html()).not.toMatch(/ثنا|بلال|data-chip|\/q\//);
  p.els['#wq-h-new'].fire('click');
  expect(p.moment()).toBe('H-new');
  expect(p.html()).toContain('/quiz');
  expect(p.assigned).toEqual([]);
});

test('Urdu lock screen: gender-neutral (no «رہا/رہی», no «بیٹا/بیٹی»), the same two moments', async () => {
  const p = page(LOCKED({ lang: 'ur' }), { store: { wq_d: JSON.stringify(DEV) }, api: { '/api/wq/hub/': LOCKED({ lang: 'ur' }) } });
  await flush(); await flush();
  expect(p.moment()).toBe('H-lock');
  expect(p.html()).not.toMatch(/رہا|رہی|بیٹا|بیٹی/);
  p.els['#wq-h-new'].fire('click');
  expect(p.html()).not.toMatch(/رہا|رہی|بیٹا|بیٹی/);
});

test('a sibling pick also carries the device_ref, in the body', async () => {
  const p = page(boot(), { store: { wq_d: JSON.stringify(DEV) }, api: { '/api/wq/hub/': { lang: 'ur', kids: KIDS, kid: KIDS[1].chip } } });
  p.els['[data-chip="0000000000000002"]'].fire('click');
  await flush(); await flush();
  const call = p.fetches.find((f) => f.url.indexOf('/api/wq/hub/') === 0);
  expect(call.init.method).toBe('POST');
  expect(JSON.parse(call.init.body)).toEqual({ kid: KIDS[1].chip, device_ref: DEV });
  expect(p.moment()).toBe('H2');
});

test('the phone\'s device_ref is also written to the wq_dv cookie (path /, 30 days, Lax), so the challenge and library pages carry it', async () => {
  const p = page(LOCKED(), { store: { wq_d: JSON.stringify(DEV) }, api: { '/api/wq/hub/': LOCKED() } });
  await flush();
  const c = p.cookies.find((x) => x.indexOf('wq_dv=') === 0);
  expect(c).toBeDefined();
  expect(c).toContain('wq_dv=' + DEV);
  expect(c).toMatch(/path=\//);
  expect(c).toMatch(/max-age=2592000/);
  expect(c).toMatch(/samesite=lax/i);
});
