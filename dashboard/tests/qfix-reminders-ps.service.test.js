'use strict';
/**
 * The reminder ask and its worker send this page load's telemetry session id (`ps`), so a funnel read can drop QA
 * walks by joining page_start.ua. wq-tel.js keeps the id in sessionStorage as wq_ps, only while
 * web_quiz_rich_telemetry is on (window.WQT.on); the ask (wq-remind.js) reads it there:
 *  - telemetry on and a 12-character id: every step, the subscribe body and the context kept for the worker carry ps;
 *  - telemetry off, no wq-tel at all (the /remind landing), no id, or any other shape: every body is exactly today's;
 *  - the worker (sw.js) adds the kept ps to its delivered, opened and re-subscribe posts; nothing kept, nothing added.
 * Fake DOM, fake worker scope, fake IndexedDB; invented values.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const REMIND_SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'wq-remind.js'), 'utf8');
const SW_SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'sw.js'), 'utf8');
const UA_CHROME = 'Mozilla/5.0 (Linux; Android 13; SM-A145F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';
const TUE = Date.parse('2025-11-25T10:00:00Z');
const PS = 'k3j9x0a1b2c4';
const flush = async () => { for (let i = 0; i < 16; i += 1) await new Promise((r) => setImmediate(r)); };
const omitPs = (o) => { const c = { ...o }; delete c.ps; return c; };

/** One object store ('kv') per fake database; put/get settle on the next turn, like the real one. */
function fakeIdb(store = {}) {
  return {
    store,
    open() {
      const req = {};
      const db = {
        createObjectStore() {},
        transaction() {
          const tx = {};
          tx.objectStore = () => ({
            put(v, k) { store[k] = JSON.parse(JSON.stringify(v)); setImmediate(() => tx.oncomplete && tx.oncomplete()); },
            get(k) { const g = {}; setImmediate(() => { g.result = store[k]; if (g.onsuccess) g.onsuccess(); }); return g; },
          });
          return tx;
        },
      };
      setImmediate(() => { req.result = db; if (req.onsuccess) req.onsuccess(); });
      return req;
    },
  };
}

/** The result screen's ask, Chrome on Android, permission granted. wqt: window.WQT (null = no wq-tel on the page); ps: wq_ps (null = none). */
function page({ wqt = { on: true }, ps = PS } = {}) {
  const posts = [];
  const idb = fakeIdb();
  const sub = { endpoint: 'https://push.example/abc', toJSON() { return { endpoint: this.endpoint, keys: { p256dh: 'p', auth: 'a' } }; } };
  const reg = { pushManager: { subscribe: async () => sub, getSubscription: async () => null } };
  const sw = { getRegistrations: async () => [], getRegistration: async () => reg, register: async () => reg, ready: Promise.resolve(reg) };
  const ss = ps === null ? {} : { wq_ps: ps };
  const ctx = {
    console, Promise, JSON, Math, Object, Array, String, Number, Boolean, RegExp, Error, encodeURIComponent, decodeURIComponent, Uint8Array,
    Date: class extends Date { static now() { return TUE; } }, setTimeout, clearTimeout, Intl, atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    location: { host: 'wq.example', protocol: 'https:' }, navigator: { userAgent: UA_CHROME, serviceWorker: sw }, matchMedia: () => ({ matches: false }),
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    sessionStorage: { getItem: (k) => (Object.prototype.hasOwnProperty.call(ss, k) ? ss[k] : null), setItem() {} },
    document: { getElementById: () => null, querySelector: () => null },
    indexedDB: idb,
    fetch: async (url, init) => {
      if (init && init.method === 'POST') { posts.push({ url, body: JSON.parse(init.body) }); return { status: 200, json: async () => ({ ok: 1 }) }; }
      return { status: 200, json: async () => ({ key: 'BPUBKEYAAAA' }) };
    },
    PushManager: function PushManager() {}, Notification: { permission: 'default', requestPermission: async () => 'granted' },
  };
  if (wqt) ctx.WQT = wqt;
  ctx.window = ctx; ctx.self = ctx;
  vm.runInNewContext(REMIND_SRC, ctx);
  const slot = { innerHTML: '', onclick: null, setAttribute() {}, removeAttribute() {} };
  const tap = async (act) => { slot.onclick({ target: { closest: () => ({ getAttribute: (a) => (a === 'data-act' ? act : null) }) }, preventDefault() {} }); await flush(); };
  return {
    ctx, slot, tap, idb,
    steps: () => posts.filter((p) => p.url === '/api/wqpush/e').map((p) => p.body),
    subscribeBody: () => (posts.find((p) => p.url === '/api/wqpush/subscribe') || {}).body,
  };
}
async function yes(opts) {
  const p = page(opts);
  p.ctx.WQREMIND.mount(p.slot, { code: 'AB12CD', lang: 'en', chips: 1 });
  await flush();
  await p.tap('yes');
  return p;
}

describe('the ask (wq-remind.js)', () => {
  test('telemetry on, an id: every step carries ps, and only ps is new', async () => {
    const on = await yes();
    const off = await yes({ wqt: { on: false } });
    expect(on.steps().map((b) => b.step)).toEqual(['shown', 'yes', 'granted', 'subscribed']);
    expect(on.steps().every((b) => b.ps === PS)).toBe(true);
    expect(on.steps().map(omitPs)).toEqual(off.steps());
  });
  test('telemetry on, an id: the subscribe body carries ps, and only ps is new', async () => {
    const on = await yes();
    const off = await yes({ wqt: { on: false } });
    expect(on.subscribeBody().ps).toBe(PS);
    expect(omitPs(on.subscribeBody())).toEqual(off.subscribeBody());
  });
  test('telemetry on, an id: the context kept for the worker holds ps', async () => {
    const on = await yes();
    expect(on.idb.store.ctx).toEqual({ key: 'BPUBKEYAAAA', code: 'AB12CD', lang: 'en', ps: PS });
  });
  test.each([
    ['telemetry off (a stale id from an earlier page in the tab)', { wqt: { on: false } }],
    ['no wq-tel on the page (the /remind landing)', { wqt: null }],
    ['telemetry on, no id', { ps: null }],
    ['an upper-case id', { ps: 'K3J9X0A1B2C4' }],
    ['a short id', { ps: 'k3j9x0' }],
    ['a long id', { ps: 'k3j9x0a1b2c45' }],
    ['markup', { ps: '<b>k3j9</b>x' }],
  ])('%s: no body carries ps, and the kept context is exactly {key, code, lang}', async (_n, opts) => {
    const p = await yes(opts);
    expect(p.steps().length).toBe(4);
    expect(p.steps().some((b) => 'ps' in b)).toBe(false);
    expect(Object.keys(p.subscribeBody()).sort()).toEqual(['chips', 'code', 'lang', 'sub', 'tz']);
    expect(p.idb.store.ctx).toEqual({ key: 'BPUBKEYAAAA', code: 'AB12CD', lang: 'en' });
  });
});

describe('the worker (sw.js)', () => {
  function worker(kept) {
    const ls = {};
    const log = [];
    const sub = { endpoint: 'https://push.example/new', toJSON() { return { endpoint: this.endpoint, keys: { p256dh: 'p', auth: 'a' } }; } };
    const self = {
      addEventListener(n, fn) { ls[n] = fn; },
      registration: { showNotification: async () => {}, pushManager: { getSubscription: async () => sub, subscribe: async () => sub } },
      clients: { claim: async () => {}, openWindow: async () => null },
      skipWaiting() {},
    };
    const ctx = { self, fetch: async (p, init) => { log.push([p, JSON.parse(init.body)]); return { ok: true }; }, Promise, JSON, String, Uint8Array, atob, indexedDB: fakeIdb(kept ? { ctx: kept } : {}) };
    vm.createContext(ctx);
    vm.runInContext(SW_SRC, ctx);
    const fire = async (name, e) => { let w; ls[name]({ ...e, waitUntil(p) { w = p; } }); await w; await flush(); return log; };
    return {
      push: (d) => fire('push', { data: { json: () => d } }),
      click: () => fire('notificationclick', { action: '', notification: { close() {}, data: { url: '/q/AB12CD?from=push' } } }),
      change: () => fire('pushsubscriptionchange', { oldSubscription: { endpoint: 'https://push.example/old' }, newSubscription: sub }),
    };
  }
  const REM = { t: 'Jugnu', b: 'A quiz is waiting for you.', url: '/q/AB12CD?from=push', tag: 'jugnu-remind', lang: 'en' };
  const KEPT = { key: 'BPUBKEYAAAA', code: 'AB12CD', lang: 'en' };

  test('kept ps: delivered carries it', async () => {
    expect(await worker({ ...KEPT, ps: PS }).push(REM)).toEqual([['/api/wqpush/delivered', { tag: 'jugnu-remind', shown: true, ps: PS }]]);
  });
  test('kept ps: opened carries it', async () => {
    expect(await worker({ ...KEPT, ps: PS }).click()).toEqual([['/api/wqpush/opened', { endpoint: 'https://push.example/new', ps: PS }]]);
  });
  test('kept ps: the re-subscribe carries it', async () => {
    const log = await worker({ ...KEPT, ps: PS }).change();
    expect(log).toHaveLength(1);
    expect(log[0][0]).toBe('/api/wqpush/subscribe');
    expect(log[0][1]).toEqual({ sub: { endpoint: 'https://push.example/new', keys: { p256dh: 'p', auth: 'a' } }, code: 'AB12CD', lang: 'en', rotate_from: 'https://push.example/old', ps: PS });
  });
  test.each([
    ['nothing kept', null],
    ['kept by an older page (no ps)', KEPT],
    ['a bad kept ps', { ...KEPT, ps: 'K3J9X0A1B2C4' }],
  ])('%s: delivered and opened are exactly today\'s', async (_n, kept) => {
    expect(await worker(kept).push(REM)).toEqual([['/api/wqpush/delivered', { tag: 'jugnu-remind', shown: true }]]);
    expect(await worker(kept).click()).toEqual([['/api/wqpush/opened', { endpoint: 'https://push.example/new' }]]);
  });
  test('kept without ps: the re-subscribe is exactly today\'s', async () => {
    const log = await worker(KEPT).change();
    expect(log[0][1]).toEqual({ sub: { endpoint: 'https://push.example/new', keys: { p256dh: 'p', auth: 'a' } }, code: 'AB12CD', lang: 'en', rotate_from: 'https://push.example/old' });
  });
  test('the test push still posts nothing', async () => {
    expect(await worker({ ...KEPT, ps: PS }).push({ ...REM, test: true })).toEqual([]);
  });
});
