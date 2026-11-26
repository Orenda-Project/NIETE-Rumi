/**
 * The install meter by platform: every install_prompt row carries `platform` (android / ios / desktop / other, from the
 * user agent) and `display_mode` (browser / standalone / minimal-ui / fullscreen), so a daily read can count installs
 * per platform; and the hub logs install_prompt{step:'sw_registered'} once when the page already has a service worker.
 * The step names and their order are unchanged (qfix-reminders-install.service.test.js holds those).
 * Invented children only.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const PLAY_SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'hub-play.js'), 'utf8');
const ANDROID = 'Mozilla/5.0 (Linux; Android 13; SM-A145F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';
const WA = 'Mozilla/5.0 (Linux; Android 13; SM-A145F; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/131.0.0.0 Mobile Safari/537.36 WhatsApp/2.24';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const NOW = Date.parse('2026-11-25T13:00:00Z');
const TODAY = String(Math.floor((NOW + 5 * 3600000) / 86400000));
const PLAY = { first: false, lantern: null, shelf: [], install: true, doors: [] };

// hub-play.js in a page. mode: the display-mode media query that matches (null: none, a plain browser tab).
function page({ ua = ANDROID, mode = null, sw = undefined, early = null } = {}) {
  const winL = {}; const timers = []; const pend = [];
  const box = { innerHTML: '', ls: {}, addEventListener(n, fn) { (box.ls[n] = box.ls[n] || []).push(fn); } };
  const ROOT = { innerHTML: '<div id="wqp-inst"></div>', querySelector: (s) => (s === '#wqp-inst' ? box : null) };
  const win = {
    addEventListener(n, fn) { (winL[n] = winL[n] || []).push(fn); },
    matchMedia: (q) => ({ matches: Boolean(mode) && q === `(display-mode: ${mode})` }),
  };
  if (early) win.__wqBip = early;
  const nav = { userAgent: ua };
  // sw: undefined = no serviceWorker API; null = the API, no registration; an object = a registration
  if (sw !== undefined) nav.serviceWorker = { getRegistration: () => ({ then(ok) { pend.push(() => ok(sw)); } }) };
  const store = { wqp_hv_day: TODAY };
  const ctx = {
    window: win, navigator: nav,
    document: { head: { appendChild() {} }, createElement: () => ({}), visibilityState: 'visible', addEventListener() {} },
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
    setTimeout: (fn) => { timers.push(fn); return timers.length; }, Date: class extends Date { static now() { return NOW; } },
    JSON, Math, String, Number, Array, Object, isFinite, encodeURIComponent, Boolean,
  };
  vm.createContext(ctx);
  vm.runInContext(PLAY_SRC, ctx);
  const evs = [];
  const tick = () => { timers.splice(0).forEach((fn) => fn()); pend.splice(0).forEach((fn) => fn()); };
  return {
    box,
    render() { win.WQPLAY.install({ lang: 'en', play: PLAY }, (n, p) => evs.push([n, p]), ROOT, { h3: true }); tick(); },
    offer(e) { (winL.beforeinstallprompt || []).forEach((fn) => fn(e)); tick(); },
    installed() { (winL.appinstalled || []).forEach((fn) => fn({})); tick(); },
    click(what) { box.ls.click.forEach((fn) => fn({ target: { getAttribute: (k) => (k === 'data-inst' ? what : null) } })); tick(); },
    rows: () => evs.filter(([n]) => n === 'install_prompt').map(([, p]) => p),
  };
}
const bip = (outcome = 'accepted') => ({ preventDefault() {}, prompt() {}, userChoice: { then(fn) { fn({ outcome }); } } });

describe('every install_prompt row says which platform and display mode it came from', () => {
  test('Android Chrome tab: hub, bip_fired, card_shown, add, accepted, installed all carry android / browser', () => {
    const p = page();
    p.render();
    p.offer(bip());
    p.click('add');
    p.installed();
    const rows = p.rows();
    expect(rows.map((r) => r.step)).toEqual(expect.arrayContaining(['hub', 'bip_fired', 'card_shown', 'add', 'accepted', 'installed']));
    rows.forEach((r) => {
      expect(r.platform).toBe('android');
      expect(r.display_mode).toBe('browser');
    });
  });
  test('the view\'s outcome row carries them too', () => {
    const p = page();
    p.render();
    p.offer(bip());
    const out = p.rows().filter((r) => r.step === 'outcome');
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ reason: 'shown', platform: 'android', display_mode: 'browser' });
  });
  test('the installed app (display-mode standalone): hub{app} + outcome{app}, standalone', () => {
    const p = page({ mode: 'standalone' });
    p.render();
    expect(p.rows()).toEqual([
      expect.objectContaining({ step: 'hub', reason: 'app', platform: 'android', display_mode: 'standalone' }),
      expect.objectContaining({ step: 'outcome', reason: 'app', platform: 'android', display_mode: 'standalone' }),
    ]);
  });
  test('minimal-ui is its own display mode', () => {
    const p = page({ mode: 'minimal-ui' });
    p.render();
    expect(p.rows()[0].display_mode).toBe('minimal-ui');
  });
  test('WhatsApp\'s in-app browser on Android: android / browser, src iab', () => {
    const p = page({ ua: WA });
    p.render();
    expect(p.rows()[0]).toMatchObject({ step: 'hub', src: 'iab', platform: 'android', display_mode: 'browser' });
  });
  test('iPhone Safari: ios', () => {
    const p = page({ ua: IPHONE });
    p.render();
    expect(p.rows()[0]).toMatchObject({ platform: 'ios', display_mode: 'browser' });
  });
  test('a desktop browser: desktop', () => {
    const p = page({ ua: DESKTOP });
    p.render();
    expect(p.rows()[0].platform).toBe('desktop');
  });
  test('an unknown user agent: other', () => {
    const p = page({ ua: 'SomeBot/1.0' });
    p.render();
    expect(p.rows()[0].platform).toBe('other');
  });
});

describe('install_prompt{step:sw_registered}: once, only when the page already has a service worker', () => {
  test('a registration: one sw_registered row with the platform marks', () => {
    const p = page({ sw: { scope: '/' } });
    p.render();
    p.render();
    const sw = p.rows().filter((r) => r.step === 'sw_registered');
    expect(sw).toHaveLength(1);
    expect(sw[0]).toMatchObject({ platform: 'android', display_mode: 'browser' });
  });
  test('the API but no registration: no sw_registered row', () => {
    const p = page({ sw: null });
    p.render();
    expect(p.rows().filter((r) => r.step === 'sw_registered')).toEqual([]);
  });
  test('no serviceWorker API at all: no row, nothing thrown', () => {
    const p = page();
    expect(() => p.render()).not.toThrow();
    expect(p.rows().filter((r) => r.step === 'sw_registered')).toEqual([]);
  });
});
