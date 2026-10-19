/**
 * The hub page's event batches (public/wq/hub.js with wq-tel.js, both run whole in a vm with a small fake DOM, a
 * fixed clock and fixed random bytes): with the boot flag ev2 (the bot's web_quiz_events_v2), every POST
 * /api/wq/e body carries the hub token `ht` and, once a child is picked, that child's chip `chip`, on the batch,
 * never on an event, through the page-session telemetry (wq-tel.js ids()) and through the hub's own beacon alike.
 * Without ev2 every body is today's, byte for byte (the snapshot was written against the code before the change);
 * with ev2 the events themselves are byte-identical to that, only the two body fields are new.
 * The boot JSON, the bot API (fetch) and the beacon are the faked boundaries.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const WQ = path.join(__dirname, '..', 'public', 'wq');
const HUB = fs.readFileSync(path.join(WQ, 'hub.js'), 'utf8');
const TEL = fs.readFileSync(path.join(WQ, 'wq-tel.js'), 'utf8');
const flush = () => new Promise((r) => setImmediate(r));

const NOW = 1790000000000;
class FixedDate extends Date {
  constructor(...a) { super(...(a.length ? a : [NOW])); }
  static now() { return NOW; }
}

const TOKEN = 'fakehubtoken.NotARealSignature000';
const KIDS = [{ chip: '00000000000000a1', first: 'Sana Testwala', animal: 'owl', grade: '3' }, { chip: '00000000000000a2', first: 'Bilal Testwala', animal: 'lion', grade: '5' }];
const DEV = 'AAAAAAAAAAAAAAAAAAAAAA';
const TEACHER = { code: 'NEWQ01', topic: 'Shapes', subject: 'maths', sent_at: new FixedDate(NOW).toISOString(), k: 'kk1' };

function page(boot, { api = {}, store = {} } = {}) {
  const sent = [];
  const els = {};
  const winL = {};
  const docL = {};
  const assigned = [];
  const el = (sel) => (els[sel] = els[sel] || { sel, listeners: {}, attrs: {}, addEventListener(n, fn) { (this.listeners[n] = this.listeners[n] || []).push(fn); }, fire(n, e) { (this.listeners[n] || []).forEach((fn) => fn.call(this, e || { preventDefault() {} })); }, getAttribute(k) { return this.attrs[k]; } });
  const root = {
    _h: '', attrs: {},
    set innerHTML(h) {
      this._h = h;
      for (const k of Object.keys(els)) delete els[k];
      for (const m of h.matchAll(/<(?:a|button)\b([^>]*)>/g)) {
        const id = /id="([^"]+)"/.exec(m[1]);
        const href = /href="([^"]+)"/.exec(m[1]);
        const data = /data-(chip)="([^"]+)"/.exec(m[1]);
        const sel = id ? `#${id[1]}` : data ? `[data-${data[1]}="${data[2]}"]` : null;
        if (!sel) continue;
        const e = el(sel);
        if (href) e.attrs.href = href[1].replace(/&amp;/g, '&');
        if (data) e.attrs[`data-${data[1]}`] = data[2];
      }
    },
    get innerHTML() { return this._h; },
    setAttribute(k, v) { this.attrs[k] = v; },
    getAttribute(k) { return this.attrs[k]; },
    appendChild() {},
    querySelector(sel) { return els[sel] || null; },
    querySelectorAll(sel) { const k = sel.replace(/^\[|\]$/g, ''); return Object.values(els).filter((e) => e.attrs[k] !== undefined); },
  };
  const ls = new Map(Object.entries(store).map(([k, v]) => [k, JSON.stringify(v)]));
  const ss = new Map();
  const docEl = { attrs: {}, setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return this.attrs[k]; }, classList: { toggle() {}, contains: () => false } };
  const ctx = {
    document: {
      documentElement: docEl, visibilityState: 'visible',
      getElementById: (id) => (id === 'wq' ? root : id === 'boot' ? { textContent: JSON.stringify(boot) } : null),
      createElement: () => ({ setAttribute() {}, textContent: '' }),
      addEventListener: (n, fn) => { (docL[n] = docL[n] || []).push(fn); },
      set cookie(v) {}, get cookie() { return ''; },
    },
    navigator: { userAgent: 'test-agent', sendBeacon: (u, b) => { sent.push({ url: u, body: b.parts[0] }); return true; } },
    history: { replaceState() {} },
    location: { search: '', protocol: 'https:', assign(u) { assigned.push(u); }, reload() {} },
    Blob: function Blob(parts) { this.parts = parts; },
    fetch: (url, init) => {
      if (url === '/api/wq/e') { sent.push({ url, body: init.body }); return Promise.resolve({}); }
      const hit = Object.keys(api).find((k) => url.indexOf(k) >= 0);
      const r = hit ? api[hit] : {};
      return Promise.resolve({ status: 200, ok: true, text: () => Promise.resolve(JSON.stringify(r)) });
    },
    localStorage: { getItem: (k) => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => { ls.set(k, String(v)); } },
    sessionStorage: { getItem: (k) => (ss.has(k) ? ss.get(k) : null), setItem: (k, v) => { ss.set(k, String(v)); } },
    performance: { now: () => 5000 },
    crypto: { getRandomValues: (a) => { for (let i = 0; i < a.length; i += 1) a[i] = (i * 37 + 11) % 256; return a; } },
    setTimeout: () => 0, setInterval: () => 0,
    Date: FixedDate, JSON, Math, String, Number, Array, Object, Promise, Uint8Array, isFinite, encodeURIComponent,
  };
  ctx.window = ctx;
  ctx.addEventListener = (n, fn) => { (winL[n] = winL[n] || []).push(fn); };
  ctx.scrollTo = () => {};
  vm.createContext(ctx);
  vm.runInContext(TEL, ctx);
  vm.runInContext(HUB, ctx);
  return {
    ctx, els, assigned, sent,
    hide() { ctx.document.visibilityState = 'hidden'; (docL.visibilitychange || []).forEach((f) => f({})); ctx.document.visibilityState = 'visible'; (docL.visibilitychange || []).forEach((f) => f({})); },
    pagehide() { (winL.pagehide || []).forEach((f) => f({})); },
    bodies() { return sent.filter((s) => s.url === '/api/wq/e').map((s) => s.body); },
  };
}

// The hub of two children, as a phone walks it: the picker, a pick, the teacher's quiz; with telemetry on (rt) the
// page also goes to the background once before the pick and away at the end, so the queue is sent at each.
async function walk({ rt, ev2, store = { wq_d: DEV } }) {
  const flag = ev2 ? { ev2: true } : {};
  const boot = { view: 'hub', lang: 'en', token: TOKEN, kids: KIDS, kid: null, teacher: null, again: [], recs: [], challenge: null, lib: null, brand: null, ...(rt ? { rt: true } : {}), ...flag };
  const picked = { lang: 'en', kids: KIDS, kid: KIDS[1].chip, teacher: TEACHER, again: [], recs: [], challenge: null, lib: null, brand: null, rt: Boolean(rt), ...flag };
  const p = page(boot, { api: { '/api/wq/hub/': picked }, store });
  if (rt) p.hide();
  p.els[`[data-chip="${KIDS[1].chip}"]`].fire('click');
  await flush(); await flush();
  p.els['#wq-h-teacher'].fire('click');
  p.pagehide();
  return p;
}
// One child, already chosen by the server: the hub itself from the first paint.
async function one({ rt, ev2 }) {
  const boot = { view: 'hub', lang: 'ur', token: TOKEN, kids: [KIDS[0]], kid: KIDS[0].chip, teacher: TEACHER, again: [], recs: [], challenge: null, lib: null, brand: null, ...(rt ? { rt: true } : {}), ...(ev2 ? { ev2: true } : {}) };
  const p = page(boot, { store: { wq_d: DEV } });
  p.els['#wq-h-teacher'].fire('click');
  p.pagehide();
  return p;
}
const parsed = (p) => p.bodies().map((b) => JSON.parse(b));
const without = (b) => { const o = { ...b }; delete o.ht; delete o.chip; return o; };

describe('ev2 absent: every /api/wq/e body is today\'s, byte for byte', () => {
  test.each([['telemetry on', true], ['telemetry off', false]])('two children, a pick, the teacher\'s quiz (%s)', async (_l, rt) => {
    const p = await walk({ rt, ev2: false });
    expect(p.bodies().length).toBeGreaterThan(1);
    expect(p.bodies()).toMatchSnapshot();
  });
  test.each([['telemetry on', true], ['telemetry off', false]])('one child, the hub from the first paint (%s)', async (_l, rt) => {
    const p = await one({ rt, ev2: false });
    expect(p.bodies()).toMatchSnapshot();
  });
});

describe('ev2 on, telemetry on (wq-tel.js ids()): the batch carries ht, and chip once a child is picked', () => {
  test('before the pick ht only; after it ht + the picked chip; no event carries either', async () => {
    const p = await walk({ rt: true, ev2: true });
    const b = parsed(p);
    expect(b.length).toBe(2);
    expect(b[0]).toMatchObject({ ht: TOKEN, dr: DEV });
    expect('chip' in b[0]).toBe(false);
    expect(b[0].events.map((e) => e.n)).toContain('hub_view');
    expect(b[1]).toMatchObject({ ht: TOKEN, chip: KIDS[1].chip, dr: DEV });
    expect(b[1].events.map((e) => e.n)).toContain('hub_pick');
    for (const x of b) for (const e of x.events) { expect('ht' in e || 'chip' in e).toBe(false); expect(JSON.stringify(e)).not.toContain(TOKEN); }
  });
  test('one child chosen by the server: ht + its chip on every batch', async () => {
    const b = parsed(await one({ rt: true, ev2: true }));
    expect(b.length).toBeGreaterThan(0);
    for (const x of b) expect(x).toMatchObject({ ht: TOKEN, chip: KIDS[0].chip });
  });
});

describe('ev2 on, telemetry off (the hub\'s own beacon): the same two fields on its {events} body', () => {
  test('hub_view before the pick: ht only; hub_pick after it: ht + the picked chip', async () => {
    const b = parsed(await walk({ rt: false, ev2: true }));
    const view = b.find((x) => x.events[0].n === 'hub_view');
    const pick = b.find((x) => x.events[0].n === 'hub_pick');
    expect(view).toEqual({ events: [view.events[0]], ht: TOKEN });
    expect(pick).toEqual({ events: [pick.events[0]], ht: TOKEN, chip: KIDS[1].chip });
    for (const x of b) for (const e of x.events) expect('ht' in e || 'chip' in e).toBe(false);
  });
});

describe('ev2 on: the events themselves are byte-identical to ev2 absent; only the body gains ht/chip', () => {
  test.each([['telemetry on', true], ['telemetry off', false]])('two children (%s)', async (_l, rt) => {
    const off = parsed(await walk({ rt, ev2: false }));
    const on = parsed(await walk({ rt, ev2: true }));
    expect(JSON.stringify(on.map((x) => x.events))).toBe(JSON.stringify(off.map((x) => x.events)));
    expect(JSON.stringify(on.map(without))).toBe(JSON.stringify(off));
    expect(on.every((x) => x.ht === TOKEN)).toBe(true);
  });
  test.each([['telemetry on', true], ['telemetry off', false]])('one child (%s)', async (_l, rt) => {
    const off = parsed(await one({ rt, ev2: false }));
    const on = parsed(await one({ rt, ev2: true }));
    expect(JSON.stringify(on.map((x) => x.events))).toBe(JSON.stringify(off.map((x) => x.events)));
    expect(JSON.stringify(on.map(without))).toBe(JSON.stringify(off));
    expect(on.every((x) => x.ht === TOKEN && x.chip === KIDS[0].chip)).toBe(true);
  });
});

describe('fresh profile (nothing stored on the phone) with ev2: the hub token still rides the batch', () => {
  test('no wq_d, no session: ht, and the chip after the pick, on both paths', async () => {
    for (const rt of [true, false]) {
      const b = parsed(await walk({ rt, ev2: true, store: {} }));
      expect(b.length).toBeGreaterThan(0);
      expect(b.every((x) => x.ht === TOKEN)).toBe(true);
      expect(b.some((x) => x.chip === KIDS[1].chip)).toBe(true);
    }
  });
});
