/**
 * The install card on the child home children get (the v3 home, wq-home.js, under the adventure look; app_settings
 * web_quiz_install_prompt, the hub's `play.install`): its slot sits right after the Next stop — so the look's trail
 * (wq-adv.js dress: inserted right after the Next stop) comes first — and above My class / My school, never above the
 * Next stop. It fills with the existing card's words (hub-play.js jg.install.*) once the browser offers the install,
 * under the existing rules (never the day's first view, 7 days after "Not now", never in an in-app browser or an
 * installed app), with the shared button system (one primary "Add", one ghost "Not now"); "Add" opens the browser's
 * own prompt. Switch off: the home is byte-identical to the base (goldens hashed on origin/sandbox). Invented children.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const WQ = path.join(__dirname, '..', 'public', 'wq');
const HOME_SRC = fs.readFileSync(path.join(WQ, 'wq-home.js'), 'utf8');
const PLAY_SRC = fs.readFileSync(path.join(WQ, 'hub-play.js'), 'utf8');
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 16);
const CHROME_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';
const WA_UA = 'Mozilla/5.0 (Linux; Android 14; SM-A145F Build/UP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0 Mobile Safari/537.36 WhatsApp/2.24.21.80 WA4A/2.24.21.80';
const NOW = Date.parse('2026-10-15T21:00:00Z');
class FixedDate extends Date {
  constructor(...a) { super(...(a.length ? a : [NOW])); }
  static now() { return NOW; }
}
const SEEN_TODAY = () => ({ wqp_hv_day: String(Math.floor((NOW + 5 * 3600000) / 86400000)) });
const KID = '0123456789abcdef';
const TOKEN = 'eyJrIjoiaCIsImlkcyI6WyJhIl0sImV4cCI6OTk5OTk5OTk5OX0.AbCdEfGhIjKlMnOpQrStUv';
const INST = { first: false, lantern: null, shelf: null, install: true, doors: ['install'] };
function boot(lang, extra = {}) {
  return {
    lang, kid: KID, kids: [{ chip: KID, first: 'Zara', animal: 'owl', grade: '3' }], home_v3: 1, brand: 'niete', rt: false,
    teacher: { code: 'MATH01', k: 'kk', topic: 'Fractions' }, again: [], recs: [], challenge: null, lib: { href: '/lib/x' },
    class_doors: { class: '/q/MATH01/class', schools: '/q/MATH01/schools' },
    doors: { stories: [], games: [], videos: null }, ...extra,
  };
}

// The page in a vm: wq-home.js (and hub-play.js when `play` is there, before or after the home paints).
function home(B, { store = {}, ua = CHROME_UA, standalone = false, play = 'before' } = {}) {
  const els = {};
  const winL = {};
  const timers = [];
  const evs = [];
  const el = (sel, attrs) => (els[sel] = els[sel] || { sel, listeners: {}, attrs: attrs || {}, innerHTML: '', addEventListener(n, fn) { (this.listeners[n] = this.listeners[n] || []).push(fn); }, fire(n, e) { (this.listeners[n] || []).forEach((fn) => fn.call(this, e || { preventDefault() {} })); }, getAttribute(k) { return this.attrs[k]; }, setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; }, querySelector: () => null, querySelectorAll: () => [] });
  const root = {
    _h: '', attrs: {},
    set innerHTML(h) {
      this._h = h;
      for (const k of Object.keys(els)) delete els[k];
      for (const m of h.matchAll(/<(?:a|button|p|div|section|nav|footer)\b([^>]*)>/g)) {
        const attrs = {};
        for (const a of m[1].matchAll(/([a-z-]+)="([^"]*)"/g)) attrs[a[1]] = a[2].replace(/&amp;/g, '&');
        if (attrs.id) el(`#${attrs.id}`, attrs);
      }
    },
    get innerHTML() { return this._h; },
    setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k]; },
    appendChild() {}, insertAdjacentHTML() {},
    querySelector(sel) { return els[sel] || null; },
    querySelectorAll() { return []; },
  };
  const ctx = {
    document: { documentElement: { lang: B.lang, classList: { contains: () => false, toggle() {} } }, head: { appendChild() {} }, body: { appendChild() {} }, createElement: () => ({ setAttribute() {}, addEventListener() {}, style: {} }), querySelector: () => null, querySelectorAll: () => [], getElementById: () => null, addEventListener() {} },
    navigator: { userAgent: ua },
    location: { hash: '', search: '', pathname: `/h/${TOKEN}`, assign() {}, reload() {} },
    history: { replaceState() {}, pushState() {} },
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    setTimeout: (fn) => { timers.push(fn); return timers.length; }, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    addEventListener(n, fn) { (winL[n] = winL[n] || []).push(fn); }, removeEventListener() {},
    matchMedia: (q) => ({ matches: standalone && /standalone/.test(q), addEventListener() {} }),
    fetch: () => new Promise(() => {}),
    Date: FixedDate, JSON, Math, String, Number, Array, Object, Promise, isFinite, encodeURIComponent, decodeURIComponent, RegExp, Error,
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  if (B.play && play === 'before') vm.runInContext(PLAY_SRC, ctx);
  vm.runInContext(HOME_SRC, ctx);
  ctx.WQHOME.mount(root, B, { token: TOKEN, lang: B.lang, ev: (n, p) => evs.push({ n, ...p }), go() {} });
  if (B.play && play === 'after') vm.runInContext(PLAY_SRC, ctx);
  const tick = () => { while (timers.length) timers.shift()(); };
  tick();
  const offer = () => {
    const e = { prevented: 0, prompted: 0, preventDefault() { this.prevented += 1; }, prompt() { this.prompted += 1; }, userChoice: Promise.resolve({ outcome: 'accepted' }) };
    (winL.beforeinstallprompt || []).forEach((fn) => fn(e));
    return e;
  };
  return { ctx, html: () => root._h, els, offer, tick, store, evs, card: () => String((els['#wqp-inst'] || {}).innerHTML || ''), winL };
}
const COPY = {
  en: { title: 'Add Jugnu to your home screen', add: 'Add', later: 'Not now' },
  ur: { title: 'جگنو کو اپنی ہوم اسکرین پر لگائیں', add: 'لگائیں', later: 'ابھی نہیں' },
};

// sha of the home's HTML on origin/sandbox before this change (GOLDEN_PRINT=1 prints them)
// written by running this file on origin/sandbox 87d375df9 with GOLDEN_PRINT=1
const GOLD = { 'en.noplay': 'e166858726b223f4', 'en.play_no_install': 'e166858726b223f4', 'ur.noplay': '42ccd45af4e77e94', 'ur.play_no_install': '42ccd45af4e77e94' };

describe('GOLDEN: switch off, the home is today\'s byte for byte', () => {
  test('no play, play without install, and play.install false — EN and UR', () => {
    const h = home(boot('en')).html();
    expect(h).toContain('class="wq-next"');
    expect(h).toContain('class="wq-social"');
    const got = {};
    for (const lang of ['en', 'ur']) {
      got[`${lang}.noplay`] = sha(home(boot(lang)).html());
      got[`${lang}.play_no_install`] = sha(home(boot(lang, { play: { ...INST, install: false, doors: [] } })).html());
    }
    if (process.env.GOLDEN_PRINT) console.log(JSON.stringify(got));
    expect(got).toEqual(GOLD);
  });
});

describe('switch on: the slot on the v3 home', () => {
  test.each(['en', 'ur'])('%s: right after the Next stop (where the look\'s trail goes first), above My class; never above the Next stop', (lang) => {
    const h = home(boot(lang, { play: INST })).html();
    const slot = h.indexOf('<div id="wqp-inst" data-look="v3"></div>');
    expect(slot).toBeGreaterThan(0);
    const nextEnd = h.indexOf('</a>', h.indexOf('class="wq-next"')) + 4;
    expect(slot).toBe(nextEnd);
    expect(slot).toBeLessThan(h.indexOf('class="wq-social"'));
    // and it is the only thing that moved: the slot taken out is the switch-off home
    expect(h.replace('<div id="wqp-inst" data-look="v3"></div>', '')).toBe(home(boot(lang, { play: { ...INST, install: false, doors: [] } })).html());
  });
});

describe('switch on: the card fills under the existing rules, with the shared buttons', () => {
  test.each(['en', 'ur'])('%s: hidden until the browser offers it; then the existing words, one primary Add and one ghost Not now; Add opens the prompt', async (lang) => {
    const p = home(boot(lang, { play: INST }), { store: SEEN_TODAY() });
    expect(p.card()).toBe('');
    const e = p.offer();
    expect(e.prevented).toBe(1);
    const c = p.card();
    expect(c).toContain(COPY[lang].title);
    expect(c).toMatch(new RegExp('<button type="button" class="wq-btn wq-go" data-inst="add">' + COPY[lang].add + '</button>'));
    expect(c).toMatch(new RegExp('<button type="button" class="wq-btn wq-ghost" data-inst="later">' + COPY[lang].later + '</button>'));
    expect(c).not.toMatch(/wqp-add|wqp-later/);
    expect(p.evs).toContainEqual(expect.objectContaining({ n: 'door_shown', door: 'install', surface: 'hub' }));
    p.els['#wqp-inst'].fire('click', { target: { getAttribute: (k) => (k === 'data-inst' ? 'add' : null) } });
    expect(e.prompted).toBe(1);
    expect(p.card()).toBe('');
    await new Promise((r) => setImmediate(r));
    expect(p.evs).toContainEqual(expect.objectContaining({ n: 'door_tap', door: 'install', surface: 'hub' }));
  });
  test('the Jugnu corner\'s script arriving after the home painted still fills the slot', () => {
    const p = home(boot('en', { play: INST }), { store: SEEN_TODAY(), play: 'after' });
    p.offer();
    expect(p.card()).toContain(COPY.en.title);
  });
  test('never the day\'s first view; "Not now" hides it for 7 days', () => {
    const first = home(boot('en', { play: INST }));
    first.offer();
    expect(first.card()).toBe('');
    const p = home(boot('en', { play: INST }), { store: SEEN_TODAY() });
    p.offer();
    p.els['#wqp-inst'].fire('click', { target: { getAttribute: (k) => (k === 'data-inst' ? 'later' : null) } });
    expect(p.card()).toBe('');
    const again = home(boot('en', { play: INST }), { store: { ...SEEN_TODAY(), wqp_inst_later: p.store.wqp_inst_later } });
    again.offer();
    expect(again.card()).toBe('');
  });
  test('WhatsApp\'s in-app browser or the installed app: no listener, no card', () => {
    for (const o of [{ ua: WA_UA }, { standalone: true }]) {
      const p = home(boot('en', { play: INST }), { store: SEEN_TODAY(), ...o });
      expect(p.winL.beforeinstallprompt).toBeUndefined();
      expect(p.card()).toBe('');
    }
  });
});
