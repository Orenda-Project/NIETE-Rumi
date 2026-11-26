'use strict';
/**
 * The reminder ask says how a sitting ended, so a read can split "left" from "stayed and passed":
 *  - the first answer after `shown` (yes / later / escape) carries `dwell_ms`, how long the ask was up; the steps after
 *    it (granted, subscribed, a second escape, copy) carry nothing new;
 *  - the page going away (visibilitychange → hidden, or pagehide) while the ask is up and unanswered posts ONE
 *    `gone` step with `dwell_ms` (once per sitting: a second hide, or a hide after any answer, posts nothing);
 *  - no ask drawn (a class phone, outside the canary, iPhone, a browser with no push) → no `gone`, ever;
 *  - after Yes, `denied` says which answer it was: perm 'denied' (Block) or 'default' (the prompt was closed), and the
 *    page going away while Chrome's prompt is still unanswered posts ONE `gone` with after 'yes' (no dwell_ms: the
 *    ask's dwell went on the yes step). perm 'pending' below = a prompt that never answers.
 * Fake DOM with a hand-driven clock and page lifecycle; invented values.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const REMIND_SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'wq-remind.js'), 'utf8');
const UA_CHROME = 'Mozilla/5.0 (Linux; Android 13; SM-A145F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';
const UA_WA = 'Mozilla/5.0 (Linux; Android 13; SM-A145F; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/131.0.0.0 Mobile Safari/537.36 WhatsApp/2.24.1';
const UA_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const TUE = Date.parse('2025-11-25T10:00:00Z');
const PS = 'k3j9x0a1b2c4';
const flush = async () => { for (let i = 0; i < 16; i += 1) await new Promise((r) => setImmediate(r)); };

/** The result screen's ask. ua: the phone; key: GET /api/wqpush/key's answer; perm: the browser's answer to Allow. */
function page({ ua = UA_CHROME, key = { key: 'BPUBKEYAAAA' }, perm = 'granted', wqt = { on: true } } = {}) {
  const posts = [];
  const winL = {};
  const docL = {};
  let now = TUE;
  const sub = { endpoint: 'https://push.example/abc', toJSON() { return { endpoint: this.endpoint, keys: { p256dh: 'p', auth: 'a' } }; } };
  const reg = { pushManager: { subscribe: async () => sub, getSubscription: async () => null } };
  const sw = { getRegistrations: async () => [], getRegistration: async () => reg, register: async () => reg, ready: Promise.resolve(reg) };
  const iphone = ua === UA_IPHONE;
  const doc = {
    visibilityState: 'visible',
    getElementById: () => null, querySelector: () => null,
    addEventListener(n, fn) { (docL[n] = docL[n] || []).push(fn); },
  };
  const ctx = {
    console, Promise, JSON, Math, Object, Array, String, Number, Boolean, RegExp, Error, encodeURIComponent, decodeURIComponent, Uint8Array,
    Date: class extends Date { static now() { return now; } }, setTimeout, clearTimeout, Intl, atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    location: { host: 'wq.example', protocol: 'https:' }, matchMedia: () => ({ matches: false }),
    navigator: iphone ? { userAgent: ua } : { userAgent: ua, serviceWorker: sw },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    sessionStorage: { getItem: (k) => (k === 'wq_ps' ? PS : null), setItem() {} },
    document: doc,
    addEventListener(n, fn) { (winL[n] = winL[n] || []).push(fn); },
    fetch: async (url, init) => {
      if (init && init.method === 'POST') { posts.push({ url, body: JSON.parse(init.body), keepalive: init.keepalive }); return { status: 200, json: async () => ({ ok: 1 }) }; }
      return { status: 200, json: async () => key };
    },
  };
  if (!iphone) { ctx.PushManager = function PushManager() {}; ctx.Notification = { permission: 'default', requestPermission: () => (perm === 'pending' ? new Promise(() => {}) : Promise.resolve(perm)) }; }
  if (wqt) ctx.WQT = wqt;
  ctx.window = ctx; ctx.self = ctx;
  vm.runInNewContext(REMIND_SRC, ctx);
  const slot = { innerHTML: '', onclick: null, setAttribute() {}, removeAttribute() {} };
  return {
    ctx, slot,
    wait: (ms) => { now += ms; },
    tap: async (act) => { slot.onclick({ target: { closest: () => ({ getAttribute: (a) => (a === 'data-act' ? act : null) }) }, preventDefault() {} }); await flush(); },
    hide: async () => { doc.visibilityState = 'hidden'; (docL.visibilitychange || []).forEach((f) => f({})); await flush(); },
    show: async () => { doc.visibilityState = 'visible'; (docL.visibilitychange || []).forEach((f) => f({})); await flush(); },
    pagehide: async () => { (winL.pagehide || []).forEach((f) => f({ persisted: false })); await flush(); },
    steps: () => posts.filter((p) => p.url === '/api/wqpush/e').map((p) => p.body),
    posts,
  };
}
async function mounted(opts, ctx = { code: 'AB12CD', lang: 'en', chips: 1 }, mode = 'mount') {
  const p = page(opts);
  if (mode === 'landing') p.ctx.WQREMIND.landing(p.slot, ctx); else p.ctx.WQREMIND.mount(p.slot, ctx);
  await flush();
  return p;
}
const only = (p, step) => p.steps().filter((b) => b.step === step);

describe('dwell_ms: the first answer after the ask is drawn', () => {
  test('Yes 4.2 s after the ask: yes carries dwell_ms 4200; granted and subscribed carry none', async () => {
    const p = await mounted();
    p.wait(4200);
    await p.tap('yes');
    expect(p.steps()).toEqual([
      { step: 'shown', lang: 'en', src: 'result', ps: PS },
      { step: 'yes', lang: 'en', src: 'result', ps: PS, dwell_ms: 4200 },
      { step: 'granted', lang: 'en', src: 'result', ps: PS, prompt_ms: 0 }, // prompt_ms: the harness clock stands still
      { step: 'subscribed', lang: 'en', src: 'result', ps: PS },
    ]);
  });
  test('Not now 1.5 s after the ask: later carries dwell_ms 1500', async () => {
    const p = await mounted();
    p.wait(1500);
    await p.tap('later');
    expect(only(p, 'later')).toEqual([{ step: 'later', lang: 'en', src: 'result', ps: PS, dwell_ms: 1500 }]);
  });
  test('WhatsApp\'s browser: the first escape carries dwell_ms, the second and Copy link carry none', async () => {
    const p = await mounted({ ua: UA_WA });
    p.wait(3000);
    await p.tap('how');
    p.wait(2000);
    await p.tap('escape');
    await p.tap('copy');
    expect(p.steps()).toEqual([
      { step: 'shown', lang: 'en', src: 'result', iab: true, ps: PS },
      { step: 'escape', lang: 'en', src: 'result', iab: true, ps: PS, how: 'menu', dwell_ms: 3000 },
      { step: 'escape', lang: 'en', src: 'result', iab: true, ps: PS, how: 'intent' },
      { step: 'copy', lang: 'en', src: 'result', iab: true, ps: PS, how: 'copy' },
    ]);
  });
  test('denied: yes carries dwell_ms, denied carries none', async () => {
    const p = await mounted({ perm: 'denied' });
    p.wait(800);
    await p.tap('yes');
    expect(p.steps().map((b) => [b.step, b.dwell_ms])).toEqual([['shown', undefined], ['yes', 800], ['denied', undefined]]);
  });
});

describe('gone: the page went away with the ask up and unanswered', () => {
  test('hidden 7 s after the ask: one gone step with dwell_ms 7000, posted keepalive', async () => {
    const p = await mounted();
    p.wait(7000);
    await p.hide();
    expect(only(p, 'gone')).toEqual([{ step: 'gone', lang: 'en', src: 'result', ps: PS, dwell_ms: 7000 }]);
    expect(p.posts.find((x) => x.body.step === 'gone').keepalive).toBe(true);
  });
  test('pagehide alone (no visibilitychange first): one gone step', async () => {
    const p = await mounted();
    p.wait(2500);
    await p.pagehide();
    expect(only(p, 'gone')).toEqual([{ step: 'gone', lang: 'en', src: 'result', ps: PS, dwell_ms: 2500 }]);
  });
  test('once per sitting: hidden, back, hidden again, then pagehide → still one gone', async () => {
    const p = await mounted();
    p.wait(1000);
    await p.hide();
    await p.show();
    p.wait(1000);
    await p.hide();
    await p.pagehide();
    expect(only(p, 'gone')).toHaveLength(1);
  });
  test('back after gone and taps Yes: yes is logged, with no dwell_ms (the ask was already counted as left)', async () => {
    const p = await mounted();
    p.wait(1000);
    await p.hide();
    await p.show();
    await p.tap('yes');
    expect(only(p, 'yes')).toEqual([{ step: 'yes', lang: 'en', src: 'result', ps: PS }]);
  });
  test('visible → visible is not a hide', async () => {
    const p = await mounted();
    await p.show();
    expect(only(p, 'gone')).toEqual([]);
  });
  test.each(['yes', 'later'])('answered (%s) then the page goes: no gone', async (act) => {
    const p = await mounted();
    await p.tap(act);
    await p.hide();
    await p.pagehide();
    expect(only(p, 'gone')).toEqual([]);
  });
  test('WhatsApp\'s browser: Open in Chrome then the page goes: no gone', async () => {
    const p = await mounted({ ua: UA_WA });
    await p.tap('escape');
    await p.hide();
    expect(only(p, 'gone')).toEqual([]);
  });
  test('WhatsApp\'s browser, no tap: gone carries iab', async () => {
    const p = await mounted({ ua: UA_WA });
    p.wait(900);
    await p.hide();
    expect(only(p, 'gone')).toEqual([{ step: 'gone', lang: 'en', src: 'result', iab: true, ps: PS, dwell_ms: 900 }]);
  });
  test('the /remind landing: gone says src landing', async () => {
    const p = await mounted({ wqt: null }, { code: 'AB12CD', lang: 'ur' }, 'landing');
    p.wait(600);
    await p.hide();
    expect(only(p, 'gone')).toEqual([{ step: 'gone', lang: 'ur', src: 'landing', dwell_ms: 600 }]);
  });
  test.each([
    ['a class phone (4+ chips)', {}, { code: 'AB12CD', lang: 'en', chips: 4 }],
    ['outside the canary (ask:false)', { key: { key: 'BPUBKEYAAAA', ask: false } }, undefined],
    ['an iPhone (the Add to Home Screen line, not an ask)', { ua: UA_IPHONE }, undefined],
  ])('%s: the page goes, no gone', async (_n, opts, ctx) => {
    const p = await mounted(opts, ctx);
    p.wait(5000);
    await p.hide();
    await p.pagehide();
    expect(only(p, 'gone')).toEqual([]);
    expect(p.steps().some((b) => 'dwell_ms' in b)).toBe(false);
  });
});

describe('after Yes: which "no" it was, and a page that went with the prompt still up', () => {
  test.each([['denied', 'denied'], ['default', 'default']])('the browser answers %s: denied carries perm %s', async (perm, want) => {
    const p = await mounted({ perm });
    await p.tap('yes');
    expect(only(p, 'denied')).toEqual([{ step: 'denied', lang: 'en', src: 'result', ps: PS, perm: want, prompt_ms: 0 }]);
  });
  test('granted: no perm anywhere, and no gone after it', async () => {
    const p = await mounted();
    await p.tap('yes');
    await p.hide();
    await p.pagehide();
    expect(p.steps().some((b) => 'perm' in b || 'after' in b)).toBe(false);
    expect(only(p, 'gone')).toEqual([]);
  });
  test('denied, then the page goes: no gone', async () => {
    const p = await mounted({ perm: 'denied' });
    await p.tap('yes');
    await p.hide();
    expect(only(p, 'gone')).toEqual([]);
  });
  test('Yes, the prompt never answers, the page is hidden: one gone with after yes, keepalive, no dwell_ms', async () => {
    const p = await mounted({ perm: 'pending' });
    p.wait(3000);
    await p.tap('yes');
    p.wait(9000);
    await p.hide();
    await p.pagehide();
    expect(p.steps()).toEqual([
      { step: 'shown', lang: 'en', src: 'result', ps: PS },
      { step: 'yes', lang: 'en', src: 'result', ps: PS, dwell_ms: 3000 },
      { step: 'gone', lang: 'en', src: 'result', ps: PS, after: 'yes' },
    ]);
    expect(p.posts.find((x) => x.body.step === 'gone').keepalive).toBe(true);
  });
  test('pagehide alone with the prompt up: one gone with after yes', async () => {
    const p = await mounted({ perm: 'pending' });
    await p.tap('yes');
    await p.pagehide();
    expect(only(p, 'gone')).toEqual([{ step: 'gone', lang: 'en', src: 'result', ps: PS, after: 'yes' }]);
  });
  test('the /remind landing: after-yes gone says src landing', async () => {
    const p = await mounted({ wqt: null, perm: 'pending' }, { code: 'AB12CD', lang: 'ur' }, 'landing');
    await p.tap('yes');
    await p.hide();
    expect(only(p, 'gone')).toEqual([{ step: 'gone', lang: 'ur', src: 'landing', after: 'yes' }]);
  });
});
