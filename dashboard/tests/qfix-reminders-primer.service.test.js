'use strict';
/**
 * The permission primer (web_quiz_push_primer, decided by the bot: GET /api/wqpush/key answers primer: true).
 *  - With it, our Yes does NOT call the browser's permission prompt: one screen says the phone will ask next, with
 *    an "OK" button and "Not now"; the prompt fires only inside that OK tap (the child's own gesture).
 *  - Steps: primer_shown when the screen is drawn, primer_go on OK, primer_back on Not now (snoozed like later).
 *  - Without primer (absent, false, or anything else) the Yes asks the browser at once, exactly as today.
 *  - granted / denied carry prompt_ms (how long the browser's permission step took), primer or not.
 * Fake DOM; invented values.
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
  if (!iphone) { ctx.PushManager = function PushManager() {}; ctx.Notification = { permission: 'default', requestPermission: () => { ctx.asked = (ctx.asked || 0) + 1; return perm === 'pending' ? new Promise(() => {}) : Promise.resolve(perm); } }; }
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
const KEY = 'BPUBKEYAAAA';
const PRIMER = {
  en: ['One more step', 'Your phone will ask about reminders next. Choose Allow.', 'OK', 'Not now'],
  ur: ['بس ایک قدم اور', 'اب آپ کا فون یاد دہانی کے بارے میں پوچھے گا۔ وہاں اجازت دیں۔', 'ٹھیک ہے', 'ابھی نہیں'],
};

describe('primer on', () => {
  test.each(['en', 'ur'])('Yes draws the primer (%s) and does not ask the browser yet', async (lang) => {
    const p = await mounted({ key: { key: KEY, ask: true, primer: true } }, { code: 'AB12CD', lang, chips: 1 });
    await p.tap('yes');
    PRIMER[lang].forEach((s) => expect(p.slot.innerHTML).toContain(s));
    expect(p.ctx.asked || 0).toBe(0);
    expect(only(p, 'yes')).toHaveLength(1);
    expect(only(p, 'primer_shown')).toHaveLength(1);
  });
  test('OK asks the browser inside its own tap, then the usual granted → subscribed', async () => {
    const p = await mounted({ key: { key: KEY, ask: true, primer: true } });
    await p.tap('yes');
    await p.tap('primer_go');
    expect(p.ctx.asked).toBe(1);
    expect(only(p, 'primer_go')).toHaveLength(1);
    expect(only(p, 'granted')).toHaveLength(1);
    expect(only(p, 'subscribed')).toHaveLength(1);
  });
  test('Not now on the primer: primer_back, the card goes, the browser is never asked', async () => {
    const p = await mounted({ key: { key: KEY, ask: true, primer: true } });
    await p.tap('yes');
    await p.tap('primer_back');
    expect(only(p, 'primer_back')).toHaveLength(1);
    expect(p.slot.innerHTML).toBe('');
    expect(p.ctx.asked || 0).toBe(0);
  });
  test('a denial after the primer still posts denied with perm', async () => {
    const p = await mounted({ key: { key: KEY, ask: true, primer: true }, perm: 'denied' });
    await p.tap('yes');
    await p.tap('primer_go');
    expect(only(p, 'denied')[0]).toMatchObject({ step: 'denied', perm: 'denied' });
  });
});

describe('primer off: today exactly', () => {
  test.each([[{}], [{ primer: false }], [{ primer: 'true' }]])('key %j: Yes asks the browser at once, no primer step', async (extra) => {
    const p = await mounted({ key: { key: KEY, ask: true, ...extra } });
    await p.tap('yes');
    expect(p.ctx.asked).toBe(1);
    expect(p.steps().filter((b) => /^primer_/.test(b.step))).toEqual([]);
    expect(only(p, 'granted')).toHaveLength(1);
  });
});

describe('prompt_ms on the browser\'s answer', () => {
  test.each([['granted', 'granted'], ['denied', 'denied'], ['default', 'denied']])('perm %s → %s carries a whole prompt_ms', async (perm, step) => {
    const p = await mounted({ key: { key: KEY, ask: true }, perm });
    await p.tap('yes');
    const row = only(p, step)[0];
    expect(Number.isInteger(row.prompt_ms)).toBe(true);
    expect(row.prompt_ms).toBeGreaterThanOrEqual(0);
  });
});

describe('primer, then arm b\'s retry', () => {
  test('after OK and a closed prompt, Yes asks the browser at once (one primer per page)', async () => {
    const p = await mounted({ key: { key: KEY, ask: true, ask_v: 'b', primer: true }, perm: 'default' });
    await p.tap('yes');
    await p.tap('primer_go');
    await p.tap('yes');
    expect(only(p, 'primer_shown')).toHaveLength(1);
    expect(p.ctx.asked).toBe(2);
  });
});
