/**
 * The "Keep my place" card (public/wq/wq-bind.js), run whole in a vm with a small fake DOM: the bot API (fetch),
 * localStorage/sessionStorage and the page's event function are the faked boundaries; the script is the shipped file.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'wq-bind.js'), 'utf8');
const flush = () => new Promise((r) => setImmediate(r));

function load({ api = {}, local = {}, session = {} } = {}) {
  const fetches = [];
  const opened = [];
  const winL = {};
  const docL = {};
  const store = (o) => ({ getItem: (k) => (k in o ? o[k] : null), setItem: (k, v) => { o[k] = String(v); }, removeItem: (k) => { delete o[k]; } });
  const ctx = {
    window: { addEventListener(n, fn) { (winL[n] = winL[n] || []).push(fn); }, open(u) { opened.push(u); } },
    document: { visibilityState: 'visible', addEventListener(n, fn) { (docL[n] = docL[n] || []).push(fn); } },
    localStorage: store(local), sessionStorage: store(session),
    location: { assign(u) { opened.push(u); } },
    fetch: (url, init) => {
      fetches.push({ url, init });
      const key = `${(init && init.method) || 'GET'} ${url.replace(/\?.*$/, '')}`;
      const body = typeof api[key] === 'function' ? api[key](url, init) : api[key];
      return Promise.resolve({ status: 200, ok: true, text: () => Promise.resolve(JSON.stringify(body || {})) });
    },
    Date, JSON, Promise, encodeURIComponent, setTimeout, console,
  };
  ctx.window.window = ctx.window;
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  return { B: ctx.window.WQBIND, fetches, opened, local, session, focus: () => (winL.focus || []).forEach((f) => f()) };
}
function mount() {
  const els = {};
  return {
    els,
    _h: '',
    set innerHTML(h) {
      this._h = h;
      for (const k of Object.keys(els)) delete els[k];
      for (const m of h.matchAll(/data-b="([^"]+)"(?:[^>]*href="([^"]+)")?/g)) {
        els[m[1]] = { href: m[2] && m[2].replace(/&amp;/g, '&'), l: [], addEventListener(n, fn) { this.l.push(fn); }, click() { this.l.forEach((f) => f({ preventDefault() {} })); } };
      }
    },
    get innerHTML() { return this._h; },
    querySelector(sel) { const m = /data-b="([^"]+)"/.exec(sel); return m ? els[m[1]] || null : null; },
  };
}
const ctxOf = (x = {}) => {
  const evs = [];
  return { evs, c: { hub: 'h.tok', kid: '0123456789abcdef', first: 'Zara', lang: 'ur', ev: (n, p) => evs.push([n, p]), ...x } };
};

test('the card: Urdu copy, bind_offered{surface:hub, w:p} once per view; never on a practice hub', () => {
  const p = load();
  const m = mount();
  const { evs, c } = ctxOf();
  expect(p.B.card(m, c)).toBe(true);
  expect(m.innerHTML).toContain('اپنی جگہ واٹس ایپ پر محفوظ کریں');
  expect(m.innerHTML).toContain('<bdi dir="ltr" class="wqb-chip">/quiz</bdi>');
  p.B.card(m, c);
  expect(evs).toEqual([['bind_offered', { surface: 'hub', w: 'p' }]]);
  expect(load().B.card(mount(), ctxOf({ practice: true }).c)).toBe(false);
});

test('Not now hides the card for 7 days', () => {
  const p = load();
  const m = mount();
  p.B.card(m, ctxOf().c);
  m.els.later.click();
  expect(m.innerHTML).toBe('');
  expect(Number(p.local.wq_bind_later)).toBeGreaterThan(Date.now() + 6.9 * 86400e3);
  expect(p.B.card(mount(), ctxOf().c)).toBe(false);
});

test('Keep my place -> the confirm sheet (name, notice, STOP chip, nothing preselected) -> Yes mints -> Send opens wa.me, bind_sent', async () => {
  const p = load({ api: { 'POST /api/wq/bind/mint': { ok: true, code: 'JUGNU-7KQ2X', href: 'https://wa.me/923000000000?text=x' } } });
  const m = mount();
  const { evs, c } = ctxOf();
  p.B.card(m, c);
  m.els.keep.click();
  expect(m.innerHTML).toContain('⁨Zara⁩، کیا یہ آپ ہیں؟');
  expect(m.innerHTML).toContain('جگنو یہ فون نمبر ⁨Zara⁩ کے نام کے ساتھ محفوظ کرے گا');
  expect(m.innerHTML).toContain('<bdi dir="ltr" class="wqb-chip">STOP</bdi>');
  expect(m.innerHTML).not.toMatch(/checked|aria-pressed="true"|autofocus/);
  m.els.yes.click();
  await flush(); await flush();
  expect(JSON.parse(p.fetches[0].init.body)).toEqual({ hub: 'h.tok', kid: '0123456789abcdef', lang: 'ur' });
  expect(JSON.parse(p.session.wq_bind)).toEqual({ code: 'JUGNU-7KQ2X', kid: '0123456789abcdef' });
  expect(m.els.send.href).toBe('https://wa.me/923000000000?text=x');
  m.els.send.click();
  expect(evs.map((e) => e[0])).toEqual(['bind_offered', 'bind_sent']);
});

test('a refusal shows its page message', async () => {
  const p = load({ api: { 'POST /api/wq/bind/mint': { ok: false, refused: 'max_phones' } } });
  const m = mount();
  p.B.card(m, ctxOf().c);
  m.els.keep.click();
  m.els.yes.click();
  await flush(); await flush();
  expect(m.innerHTML).toContain('اس فون پر پہلے ہی چار بچوں کی جگہ محفوظ ہے۔');
});

test('focus return: bound -> Saved ✓ + Undo; Undo erases, says so, hides the card 7 days', async () => {
  const p = load({ session: { wq_bind: JSON.stringify({ code: 'JUGNU-7KQ2X', kid: '0123456789abcdef' }) },
    api: { 'GET /api/wq/bind/status': { state: 'bound' }, 'POST /api/wq/bind/undo': { ok: true } } });
  const m = mount();
  p.B.card(m, ctxOf().c);
  p.focus();
  await flush(); await flush();
  expect(p.fetches[0].url).toBe('/api/wq/bind/status?code=JUGNU-7KQ2X');
  expect(m.innerHTML).toContain('محفوظ ہو گیا ✓');
  expect(m.innerHTML).toContain('یہ آپ کے گھر کا فون نہیں؟');
  m.els.undo.click();
  await flush(); await flush();
  expect(p.fetches[p.fetches.length - 1].url).toBe("/api/wq/bind/undo");
  expect(JSON.parse(p.fetches[p.fetches.length - 1].init.body)).toEqual({ code: "JUGNU-7KQ2X" });
  expect(m.innerHTML).toContain('ہٹا دیا گیا۔ یہ فون نمبر اب محفوظ نہیں۔');
  expect(Number(p.local.wq_bind_later)).toBeGreaterThan(Date.now());
  expect(p.session.wq_bind).toBeUndefined();
});

test('focus return: pending shows nothing new; expired asks again', async () => {
  const st = { s: 'pending' };
  const p = load({ session: { wq_bind: JSON.stringify({ code: 'JUGNU-7KQ2X', kid: 'k' }) }, api: { 'GET /api/wq/bind/status': () => ({ state: st.s }) } });
  const m = mount();
  p.B.card(m, ctxOf({ lang: 'en' }).c);
  const before = m.innerHTML;
  p.focus(); await flush(); await flush();
  expect(m.innerHTML).toBe(before);
  st.s = 'expired';
  p.focus(); await flush(); await flush();
  expect(m.innerHTML).toContain('That took too long. Tap Keep my place again.');
});
