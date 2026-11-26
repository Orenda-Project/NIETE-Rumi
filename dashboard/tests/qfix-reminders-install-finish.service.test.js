'use strict';
/**
 * The Android install offered on the quiz finish screen (web_quiz_install_android, decided by the bot: GET
 * /api/wqpush/key answers install_android: true). The reminder card comes first; the install card shows only once the
 * reminder ask is settled (subscribed, Not now, denied, or never shown), never beside it, only in a Chrome tab (not
 * the installed app, not WhatsApp's browser, not iPhone), only once the browser offered it (beforeinstallprompt), and
 * not within 7 days of Not now (the hub card's own snooze, shared). The page links /q/<code>/manifest.webmanifest
 * (start_url /q/<code>?from=hs: link_home opens that child's hub). Steps on the page relay as install_prompt{step,
 * at:'finish'}: bip_fired, card_shown, add, accepted / dismissed, later, installed. Fake DOM; invented values.
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
function page({ ua = UA_CHROME, key = { key: 'BPUBKEYAAAA' }, perm = 'granted', wqt = { on: true }, standalone = false, store = {} } = {}) {
  const tel = [];
  const links = [];
  const posts = [];
  const gets = [];
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
    head: { appendChild(el) { links.push(el); } }, createElement: () => ({}),
    addEventListener(n, fn) { (docL[n] = docL[n] || []).push(fn); },
  };
  const ctx = {
    console, Promise, JSON, Math, Object, Array, String, Number, Boolean, RegExp, Error, encodeURIComponent, decodeURIComponent, Uint8Array,
    Date: class extends Date { static now() { return now; } }, setTimeout, clearTimeout, Intl, atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    location: { host: 'wq.example', protocol: 'https:' }, matchMedia: (q) => ({ matches: standalone && /standalone/.test(q) }),
    navigator: iphone ? { userAgent: ua } : { userAgent: ua, serviceWorker: sw },
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem() {} },
    sessionStorage: { getItem: (k) => (k === 'wq_ps' ? PS : null), setItem() {} },
    document: doc,
    addEventListener(n, fn) { (winL[n] = winL[n] || []).push(fn); },
    fetch: async (url, init) => {
      if (init && init.method === 'POST') { posts.push({ url, body: JSON.parse(init.body), keepalive: init.keepalive }); return { status: 200, json: async () => ({ ok: 1 }) }; }
      gets.push(url);
      return { status: 200, json: async () => key };
    },
  };
  if (!iphone) { ctx.PushManager = function PushManager() {}; ctx.Notification = { permission: 'default', requestPermission: () => (perm === 'pending' ? new Promise(() => {}) : Promise.resolve(perm)) }; }
  if (wqt) ctx.WQT = { ...wqt, push: (e) => { tel.push(e); return true; } };
  ctx.window = ctx; ctx.self = ctx;
  vm.runInNewContext(REMIND_SRC, ctx);
  const slot = { innerHTML: '', onclick: null, setAttribute() {}, removeAttribute() {} };
  return {
    ctx, slot, tel, links, store, gets,
    fire: async (n, e) => { (winL[n] || []).forEach((f) => f(e)); await flush(); },
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
const KEY = 'BPUBKEYAAAA';
const bip = (outcome = 'accepted') => { const e = { prevented: 0, prompted: 0, preventDefault() { e.prevented += 1; }, prompt() { e.prompted += 1; }, userChoice: Promise.resolve({ outcome }) }; return e; };
const inst = (p) => p.tel.filter((e) => e.n === 'install_prompt');
const CARD = { en: ['Put Jugnu on your phone', 'Add', 'Not now'], ur: ['جگنو کو اپنے فون پر رکھیں', 'شامل کریں', 'ابھی نہیں'] };

describe('switch on: after the reminder ask is settled', () => {
  test.each(['en', 'ur'])('subscribed, then the browser offers: the install card (%s), manifest linked once', async (lang) => {
    const p = await mounted({ key: { key: KEY, ask: true, install_android: true } }, { code: 'AB12CD', lang, chips: 1 });
    expect(p.links.filter((l) => l.rel === 'manifest').map((l) => l.href)).toEqual(['/q/AB12CD/manifest.webmanifest']);
    const e = bip();
    await p.fire('beforeinstallprompt', e);
    expect(e.prevented).toBe(1);
    expect(p.slot.innerHTML).not.toContain(CARD[lang][0]); // the reminder ask is still up
    await p.tap('yes');
    CARD[lang].forEach((s) => expect(p.slot.innerHTML).toContain(s));
    expect(inst(p).map((x) => x.step)).toEqual(['bip_fired', 'card_shown']);
    inst(p).forEach((x) => expect(x.at).toBe('finish'));
  });

  test('no reminder ask (outside the canary): the card shows as soon as the browser offers', async () => {
    const p = await mounted({ key: { key: KEY, ask: false, install_android: true } });
    await p.fire('beforeinstallprompt', bip());
    expect(p.slot.innerHTML).toContain('Put Jugnu on your phone');
  });
  test('Add: the browser prompt, accepted, then installed', async () => {
    const p = await mounted({ key: { key: KEY, ask: false, install_android: true } });
    const e = bip('accepted');
    await p.fire('beforeinstallprompt', e);
    await p.tap('inst_add');
    expect(e.prompted).toBe(1);
    await p.fire('appinstalled', {});
    expect(inst(p).map((x) => x.step)).toEqual(['bip_fired', 'card_shown', 'add', 'accepted', 'installed']);
    expect(p.slot.innerHTML).toBe('');
  });
  test('Add then dismissed: dismissed', async () => {
    const p = await mounted({ key: { key: KEY, ask: false, install_android: true } });
    await p.fire('beforeinstallprompt', bip('dismissed'));
    await p.tap('inst_add');
    expect(inst(p).map((x) => x.step)).toContain('dismissed');
  });
  test('Not now on the card: later, snoozed 7 days (the hub card\'s key)', async () => {
    const p = await mounted({ key: { key: KEY, ask: false, install_android: true } });
    await p.fire('beforeinstallprompt', bip());
    await p.tap('inst_later');
    expect(inst(p).map((x) => x.step)).toContain('later');
    expect(Number(p.store.wqp_inst_later)).toBeGreaterThan(0);
    expect(p.slot.innerHTML).toBe('');
  });
});

describe('no card', () => {
  test('switch off (no field): no manifest, no card, no install rows', async () => {
    const p = await mounted({ key: { key: KEY, ask: false } });
    await p.fire('beforeinstallprompt', bip());
    expect(p.links).toEqual([]);
    expect(p.slot.innerHTML).not.toContain('Put Jugnu on your phone');
    expect(inst(p)).toEqual([]);
  });
  test('the installed app (standalone): no manifest, no card', async () => {
    const p = await mounted({ key: { key: KEY, ask: false, install_android: true }, standalone: true });
    await p.fire('beforeinstallprompt', bip());
    expect(p.links).toEqual([]);
    expect(p.slot.innerHTML).not.toContain('Put Jugnu on your phone');
  });
  test('snoozed within 7 days: no card', async () => {
    const p = await mounted({ key: { key: KEY, ask: false, install_android: true }, store: { wqp_inst_later: String(TUE - 86400000) } });
    await p.fire('beforeinstallprompt', bip());
    expect(p.slot.innerHTML).not.toContain('Put Jugnu on your phone');
  });
  test('WhatsApp\'s browser: no card', async () => {
    const p = await mounted({ ua: UA_WA, key: { key: KEY, ask: true, install_android: true } });
    await p.fire('beforeinstallprompt', bip());
    expect(p.slot.innerHTML).not.toContain('Put Jugnu on your phone');
  });
  test('the browser never offers: no card', async () => {
    const p = await mounted({ key: { key: KEY, ask: false, install_android: true } });
    expect(p.slot.innerHTML).not.toContain('Put Jugnu on your phone');
  });
});

// The reminder's answer stays on screen: the install card is a second section under it. A child who just said
// Not now (to the ask, or to the primer) sees no install card in that tap; it comes on the next finish page.
const OFF = { en: 'Reminders are off in this browser.', ur: 'اس براؤزر میں یاد دہانی بند ہے۔' };
const sections = (h) => (h.match(/<section/g) || []).length;
describe('the install card sits under the reminder\'s answer', () => {
  test.each(['en', 'ur'])('denied (%s): the off line stays, the card is a second section under it', async (lang) => {
    const p = await mounted({ key: { key: KEY, ask: true, install_android: true }, perm: 'denied' }, { code: 'AB12CD', lang, chips: 1 });
    await p.fire('beforeinstallprompt', bip());
    await p.tap('yes');
    const h = p.slot.innerHTML;
    expect(h).toContain(OFF[lang]);
    expect(h).toContain(CARD[lang][0]);
    expect(h.indexOf(OFF[lang])).toBeLessThan(h.indexOf(CARD[lang][0]));
    expect(sections(h)).toBe(2);
  });
  test('subscribed: the done line stays above the card', async () => {
    const p = await mounted({ key: { key: KEY, ask: true, install_android: true } });
    await p.fire('beforeinstallprompt', bip());
    await p.tap('yes');
    expect(p.slot.innerHTML).toContain('Done. Jugnu will remind you tomorrow evening.');
    expect(sections(p.slot.innerHTML)).toBe(2);
  });
  test('Not now on the card, or Add: the card goes, the off line stays', async () => {
    for (const act of ['inst_later', 'inst_add']) {
      const p = await mounted({ key: { key: KEY, ask: true, install_android: true }, perm: 'denied' });
      await p.fire('beforeinstallprompt', bip());
      await p.tap('yes');
      await p.tap(act);
      expect(p.slot.innerHTML).toContain(OFF.en);
      expect(p.slot.innerHTML).not.toContain('Put Jugnu on your phone');
      expect(sections(p.slot.innerHTML)).toBe(1);
    }
  });
});

describe('Not now: no install card in that tap; it comes on the next finish page', () => {
  test('Not now on the ask: no card, no card_shown', async () => {
    const p = await mounted({ key: { key: KEY, ask: true, install_android: true } });
    await p.fire('beforeinstallprompt', bip());
    await p.tap('later');
    expect(p.slot.innerHTML).not.toContain('Put Jugnu on your phone');
    expect(inst(p).map((x) => x.step)).toEqual(['bip_fired']);
  });
  test('Not now on the primer: no card, no card_shown', async () => {
    const p = await mounted({ key: { key: KEY, ask: true, primer: true, install_android: true } });
    await p.fire('beforeinstallprompt', bip());
    await p.tap('yes');
    await p.tap('primer_back');
    expect(p.slot.innerHTML).not.toContain('Put Jugnu on your phone');
    expect(inst(p).map((x) => x.step)).toEqual(['bip_fired']);
  });
  test.each([['wq_rm_later', 3600e3], ['wq_rm_asked', 86400e3]])('the next finish page (%s set): the card, and no ask', async (k, ago) => {
    const p = await mounted({ key: { key: KEY, ask: true, install_android: true }, store: { [k]: String(TUE - ago) } });
    expect(p.gets).toHaveLength(1);
    await p.fire('beforeinstallprompt', bip());
    expect(p.slot.innerHTML).toContain('Put Jugnu on your phone');
    expect(p.steps().filter((b) => b.step === 'shown')).toEqual([]);
    expect(inst(p).map((x) => x.step)).toEqual(['bip_fired', 'card_shown']);
  });
  test('the next finish page, switch off: no card, no ask', async () => {
    const p = await mounted({ key: { key: KEY, ask: true }, store: { wq_rm_later: String(TUE - 3600e3) } });
    await p.fire('beforeinstallprompt', bip());
    expect(p.slot.innerHTML).toBe('');
    expect(p.steps()).toEqual([]);
  });
  test.each([['WhatsApp', { ua: UA_WA }], ['iPhone', { ua: UA_IPHONE }], ['installed app', { standalone: true }],
    ['card snoozed', { store: { wqp_inst_later: String(TUE - 86400e3) } }]])('a snoozed ask in %s: no key read at all (as today)', async (_n, o) => {
    const store = { wq_rm_later: String(TUE - 3600e3), ...(o.store || {}) };
    const p = await mounted({ key: { key: KEY, ask: true, install_android: true }, ...o, store });
    expect(p.gets).toEqual([]);
  });
});
