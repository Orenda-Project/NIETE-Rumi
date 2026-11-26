'use strict';
/**
 * The ask's second wording (web_quiz_push_ask_v2, decided by the bot): GET /api/wqpush/key may answer ask_v 'a' | 'b'.
 *  - 'b' on the result screen (or under the class link's chips): the head "Jugnu's evening reminder", the line
 *    "Weekdays, by 6 pm", then 🔔 "Yes, remind us" and "Not now" — one row more than today, no names, no chips;
 *  - 'a', no ask_v, or anything else: the card is byte-identical to today;
 *  - every step the card posts carries the arm it was given (ask_v); with no arm, no ask_v (today exactly);
 *  - the /remind landing keeps its own question and never carries an arm.
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
const KEY = 'BPUBKEYAAAA';
const ASK_B = {
  en: ['Jugnu&#39;s evening reminder', 'Weekdays, by 6 pm', 'Yes, remind us', 'Not now'],
  ur: ['جگنو کی شام کی یاد دہانی', 'پیر سے جمعہ، شام ۶ بجے تک', 'ہاں، یاد دلائیں', 'ابھی نہیں'],
};
const today = async (ctx) => (await mounted({ key: { key: KEY } }, ctx)).slot.innerHTML;

describe('arm a, or no arm: the card is today\'s, byte for byte', () => {
  test.each([['en', 'result'], ['ur', 'result'], ['en', 'class_link']])('%s %s: ask_v a draws the same bytes as no ask_v', async (lang, src) => {
    const ctx = { code: 'AB12CD', lang, chips: 1, src };
    const base = await today(ctx);
    expect(base).toContain('data-act="yes"');
    expect((await mounted({ key: { key: KEY, ask_v: 'a' } }, ctx)).slot.innerHTML).toBe(base);
    expect((await mounted({ key: { key: KEY, ask_v: 'c' } }, ctx)).slot.innerHTML).toBe(base);
  });
  test('no arm: no step carries ask_v', async () => {
    const p = await mounted({ key: { key: KEY } });
    await p.tap('yes');
    expect(p.steps().length).toBeGreaterThan(2);
    expect(p.steps().some((b) => 'ask_v' in b)).toBe(false);
  });
  test('arm a: every step carries ask_v a', async () => {
    const p = await mounted({ key: { key: KEY, ask_v: 'a' } });
    await p.tap('yes');
    expect(p.steps().map((b) => [b.step, b.ask_v])).toEqual([['shown', 'a'], ['yes', 'a'], ['granted', 'a'], ['subscribed', 'a']]);
  });
  test('an unknown arm is no arm', async () => {
    const p = await mounted({ key: { key: KEY, ask_v: 'B' } });
    expect(p.steps().some((b) => 'ask_v' in b)).toBe(false);
  });
});

describe('arm b: the framing words', () => {
  test.each(['en', 'ur'])('%s: head, when, Yes and Not now; no names, no chips, not today\'s title', async (lang) => {
    const p = await mounted({ key: { key: KEY, ask_v: 'b' } }, { code: 'AB12CD', lang, chips: 1 });
    const h = p.slot.innerHTML;
    for (const s of ASK_B[lang]) expect(h).toContain(s);
    expect(h).toContain('data-act="yes"');
    expect(h).toContain('data-act="later"');
    expect(h).not.toContain(p.ctx.WQREMIND.T[lang].remindTitle);
    expect(h).not.toContain(p.ctx.WQREMIND.T[lang].remindTitleMon);
    // one row more than today: today's title + row, b's head + when line + row
    const base = await today({ code: 'AB12CD', lang, chips: 1 });
    const rows = (x) => (x.match(/<h2|<p |<div /g) || []).length;
    expect(rows(h)).toBe(rows(base) + 1);
  });
  test('every step carries ask_v b, and the Yes path is today\'s', async () => {
    const p = await mounted({ key: { key: KEY, ask_v: 'b' } });
    p.wait(2000);
    await p.tap('yes');
    expect(p.steps()).toEqual([
      { step: 'shown', lang: 'en', src: 'result', ps: PS, ask_v: 'b' },
      { step: 'yes', lang: 'en', src: 'result', ps: PS, ask_v: 'b', dwell_ms: 2000 },
      { step: 'granted', lang: 'en', src: 'result', ps: PS, ask_v: 'b', prompt_ms: 0 }, // the harness clock stands still
      { step: 'subscribed', lang: 'en', src: 'result', ps: PS, ask_v: 'b' },
    ]);
  });
  test('Not now and gone carry the arm', async () => {
    const p = await mounted({ key: { key: KEY, ask_v: 'b' } });
    await p.tap('later');
    const q = await mounted({ key: { key: KEY, ask_v: 'b' } });
    await q.hide();
    expect(only(p, 'later')[0].ask_v).toBe('b');
    expect(only(q, 'gone')[0].ask_v).toBe('b');
  });
  test('the class link mount draws b too', async () => {
    const p = await mounted({ key: { key: KEY, ask_v: 'b' } }, { code: 'AB12CD', lang: 'en', chips: 2, src: 'class_link' });
    expect(p.slot.innerHTML).toContain('Yes, remind us');
    expect(only(p, 'shown')).toEqual([{ step: 'shown', lang: 'en', src: 'class_link', ps: PS, ask_v: 'b' }]);
  });
  test('the /remind landing keeps its own question and carries no arm', async () => {
    const a = await mounted({ wqt: null, key: { key: KEY } }, { code: 'AB12CD', lang: 'ur' }, 'landing');
    const b = await mounted({ wqt: null, key: { key: KEY, ask_v: 'b' } }, { code: 'AB12CD', lang: 'ur' }, 'landing');
    expect(b.slot.innerHTML).toBe(a.slot.innerHTML);
    expect(b.steps().some((x) => 'ask_v' in x)).toBe(false);
  });
});

describe('arm b, after Yes the prompt was CLOSED (perm default): the browser blocked nothing, so the card says so', () => {
  const RETRY = { en: 'Tap Yes again and choose Allow', ur: 'دوبارہ ہاں دبائیں، پھر اجازت دیں' };
  test.each(['en', 'ur'])('%s: one true line, Yes still there, no "reminders are off"', async (lang) => {
    const p = await mounted({ key: { key: KEY, ask_v: 'b' }, perm: 'default' }, { code: 'AB12CD', lang, chips: 1 });
    await p.tap('yes');
    const h = p.slot.innerHTML;
    expect(h).toContain(RETRY[lang]);
    expect(h).toContain('data-act="yes"');
    expect(h).toContain(ASK_B[lang][2]);
    expect(h).not.toContain(p.ctx.WQREMIND.T[lang].remindDenied);
    expect(only(p, 'denied')).toEqual([{ step: 'denied', lang, src: 'result', ps: PS, ask_v: 'b', perm: 'default', prompt_ms: 0 }]);
  });
  test('Yes again, Allow this time: granted and subscribed, the done line', async () => {
    const p = await mounted({ key: { key: KEY, ask_v: 'b' }, perm: 'default' });
    await p.tap('yes');
    expect(p.slot.innerHTML).toContain('data-act="yes"'); // the button is really there to tap again
    p.ctx.Notification.requestPermission = () => Promise.resolve('granted');
    await p.tap('yes');
    expect(p.steps().map((b) => b.step)).toEqual(['shown', 'yes', 'denied', 'yes', 'granted', 'subscribed']);
    expect(p.slot.innerHTML).toContain(p.ctx.WQREMIND.T.en.remindDone);
  });
  test('arm b, Block (perm denied): today\'s "reminders are off" line', async () => {
    const p = await mounted({ key: { key: KEY, ask_v: 'b' }, perm: 'denied' });
    await p.tap('yes');
    expect(p.slot.innerHTML).toContain(p.ctx.WQREMIND.T.en.remindDenied);
    expect(p.slot.innerHTML).not.toContain('data-act="yes"');
  });
  test.each([['arm a', { key: KEY, ask_v: 'a' }], ['no arm', { key: KEY }]])('%s, prompt closed: today\'s screen exactly', async (_n, key) => {
    const p = await mounted({ key, perm: 'default' });
    await p.tap('yes');
    const q = await mounted({ key, perm: 'denied' });
    await q.tap('yes');
    expect(p.slot.innerHTML).toBe(q.slot.innerHTML);
    expect(p.slot.innerHTML).toContain(p.ctx.WQREMIND.T.en.remindDenied);
  });
});
