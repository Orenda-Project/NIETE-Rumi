/**
 * "Keep my place": a way back from every outcome on the page (web_quiz_bind_way_back; the bot's status answer carries
 * `wb: true` only with the switch on). public/wq/wq-bind.js run whole in a vm with a small fake DOM, the same harness as
 * web-quiz-bind-card.service.test.js: the bot API (fetch), the two storages and the event function are faked.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'wq-bind.js'), 'utf8');
const TEL = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'wq-tel.js'), 'utf8');
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
  // wq-tel.js first, as on the hub page (its WQT.nowrap holds «واٹس ایپ» on one line).
  vm.runInContext(TEL, ctx);
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

const KEPT = { wq_bind: JSON.stringify({ code: 'JUGNU-7KQ2X', kid: '0123456789abcdef' }) };
const focusWith = async (status, lang = 'en', extraApi = {}) => {
  const p = load({ session: { ...KEPT }, api: { 'GET /api/wq/bind/status': status, ...extraApi } });
  const m = mount();
  p.B.card(m, ctxOf({ lang }).c);
  const before = m.innerHTML;
  p.focus(); await flush(); await flush();
  return { p, m, before };
};

describe('switch on (wb): no outcome leaves a dead card', () => {
  test('a refusal the page has no line for (code used / unknown / child gone) → "not saved just now" and Yes again, which mints anew', async () => {
    for (const reason of ['code_used', 'code_unknown', 'child_unknown']) {
      const { p, m } = await focusWith({ state: 'refused', reason, wb: true }, 'en',
        { 'POST /api/wq/bind/mint': { ok: true, code: 'JUGNU-8MR3Y', href: 'https://wa.me/920000000000?text=y' } });
      expect(m.innerHTML).toContain("Your place wasn&#39;t saved just now. Please tap again.");
      expect(m.els.yes).toBeTruthy();
      expect(p.session.wq_bind).toBeUndefined();
      m.els.yes.click(); await flush(); await flush();
      expect(m.els.send.href).toBe('https://wa.me/920000000000?text=y');
      expect(JSON.parse(p.session.wq_bind).code).toBe('JUGNU-8MR3Y');
    }
  });

  test('expired → the "took too long" line WITH the Keep my place button, which opens the confirm sheet (EN, UR)', async () => {
    for (const [lang, line, isYou] of [['en', 'That took too long. Tap Keep my place again.', 'Zara, is this you?'], ['ur', 'اس میں دیر ہو گئی۔ دوبارہ «میری جگہ محفوظ کریں» دبائیں۔', '⁨Zara⁩، کیا یہ آپ ہیں؟']]) {
      const { m } = await focusWith({ state: 'expired', wb: true }, lang);
      expect(m.innerHTML).toContain(line);
      expect(m.els.keep).toBeTruthy();
      m.els.keep.click();
      expect(m.innerHTML).toContain(isYou);
    }
  });

  test('the refusals with a line keep it (teacher\'s phone, four children)', async () => {
    const t = await focusWith({ state: 'refused', reason: 'teacher_phone', wb: true });
    expect(t.m.innerHTML).toContain('This is a teacher&#39;s phone, so a child&#39;s place is not saved on it.');
    const f = await focusWith({ state: 'refused', reason: 'max_kids', wb: true });
    expect(f.m.innerHTML).toContain('This phone already keeps four children&#39;s places.');
  });
});

describe('goldens: no `wb` in the answer (switch off) → today\'s page, byte for byte', () => {
  test('a refusal with no line leaves the card exactly as it was', async () => {
    for (const reason of ['code_used', 'code_unknown', 'child_unknown']) {
      const { m, before } = await focusWith({ state: 'refused', reason });
      expect(m.innerHTML).toBe(before);
    }
  });

  test('expired → the line alone (no button), as today', async () => {
    const { m } = await focusWith({ state: 'expired' });
    expect(m.innerHTML).toBe('<div class="wqb-card" dir="ltr"><p class="wqb-msg" role="status">That took too long. Tap Keep my place again.</p></div>');
  });
});
