/**
 * The add-to-home-screen card on the child home (web_quiz_install_prompt, default OFF; the hub's `play.install`):
 * the old hub drew its slot (hub-play.js WQPLAY.top), the v3 home (wq-home.js) had none, so the switch changed nothing.
 *  - the v3 home draws the slot under the Next tile (the trail goes between them) and above My class, never above Next;
 *  - mount hands the slot to hub-play.js (WQPLAY.install), loading that script alone when the page has not got it;
 *  - hub-play fills it with the shared buttons (wq-btn wq-go "Add" + wq-btn wq-soft "Not now"), EN + UR, after the
 *    browser's beforeinstallprompt, never in the day's first view;
 *  - switch off (no `play.install`): no slot, the home is today's (the goldens in the class-doors and remember tests).
 * Invented children only.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HOME_SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'wq-home.js'), 'utf8');
const PLAY_SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'hub-play.js'), 'utf8');
const TOKEN = 'eyJrIjoiaCIsImlkcyI6WyJhIl0sImV4cCI6OTk5OTk5OTk5OX0.AbCdEfGhIjKlMnOpQrStUv';
const KID = '0123456789abcdef';
const HOME = {
  lang: 'en', kids: [{ chip: KID, first: 'Zara', animal: 'owl', grade: '3' }], kid: KID, teacher: null, again: [], recs: [], challenge: { on: true }, lib: null,
  home_v3: 1, doors: { stories: [{ kind: 'passage', id: 'en.read.1.k07', fresh: true, title: 'The red kite' }], games: [{ kind: 'numbers' }], videos: null },
  head: { dots: 2, today: false, jar: { fresh: true } },
  class_doors: { class: '/q/MATH01/class?k=kk', schools: '/q/MATH01/schools?k=kk' },
};
const PLAY = { first: false, lantern: null, shelf: [], install: true, doors: ['install'] };
const CHROME_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';

function homePage({ play = null } = {}) {
  const added = [];
  const root = { innerHTML: '', setAttribute() {}, querySelectorAll: () => [], appendChild() {}, querySelector(sel) { return sel === '#wqp-inst' && /id="wqp-inst"/.test(root.innerHTML) ? { id: 'wqp-inst' } : null; } };
  const win = { addEventListener() {}, scrollTo() {} };
  if (play) win.WQPLAY = play;
  const mkEl = (tag) => { const e = { tag, ls: {}, setAttribute(k, v) { e[k] = v; }, addEventListener(n, fn) { (e.ls[n] = e.ls[n] || []).push(fn); } }; return e; };
  const document = { querySelector: () => null, createElement: mkEl, head: { appendChild(e) { added.push(e); } } };
  vm.runInNewContext(HOME_SRC, { window: win, document, navigator: {}, location: { hash: '', pathname: '/h/x', search: '' }, fetch: () => new Promise(() => {}), localStorage: { getItem: () => null, setItem() {} }, setTimeout, clearTimeout, Date, JSON, Math, String, Number, Array, Object, encodeURIComponent, RegExp, Promise });
  return { H: win.WQHOME, win, root, added, mount(B, lang = 'en') { win.WQHOME.mount(root, B, { token: TOKEN, lang, ev() {} }); } };
}

describe('the v3 home draws the install card\'s slot', () => {
  test.each(['en', 'ur'])('%s: under the Next tile, above My class and the grown-ups hold', (lang) => {
    const h = homePage().H.html({ ...HOME, play: PLAY }, { token: TOKEN, lang });
    expect(h).toContain('<div id="wqp-inst" class="wq-inst"></div>');
    expect(h.indexOf('class="wq-next')).toBeLessThan(h.indexOf('id="wqp-inst"'));
    expect(h.indexOf('id="wqp-inst"')).toBeLessThan(h.indexOf('class="wq-social'));
    expect(h.indexOf('id="wqp-inst"')).toBeLessThan(h.indexOf('class="wq-grown'));
  });
  test('switch off (no play.install) or a coach\'s preview: no slot, the markup is today\'s', () => {
    const p = homePage();
    expect(p.H.html({ ...HOME, play: { ...PLAY, install: false } }, { token: TOKEN, lang: 'en' })).toBe(p.H.html(HOME, { token: TOKEN, lang: 'en' }));
    expect(p.H.html({ ...HOME, play: PLAY, practice: true, grade: 3 }, { token: TOKEN, lang: 'en' })).not.toContain('wqp-inst');
  });
});

describe('mount hands the slot to hub-play.js', () => {
  test('WQPLAY on the page: install(B, ev, root, {h3}) at once', () => {
    const calls = [];
    const p = homePage({ play: { install: (...a) => calls.push(a) } });
    p.mount({ ...HOME, play: PLAY });
    expect(calls.length).toBe(1);
    expect(calls[0][2]).toBe(p.root);
    expect(calls[0][3]).toEqual({ h3: true });
  });
  test('WQPLAY not on the page: hub-play.js alone is asked for (no stylesheet), then install', () => {
    const p = homePage();
    p.mount({ ...HOME, play: PLAY });
    const s = p.added.filter((e) => e.tag === 'script' && /\/wq\/hub-play\.js/.test(e.src || ''));
    expect(s.length).toBe(1);
    expect(p.added.filter((e) => e.tag === 'link' && /hub-play/.test(e.href || ''))).toEqual([]);
    const calls = [];
    p.win.WQPLAY = { install: (...a) => calls.push(a) };
    s[0].ls.load.forEach((fn) => fn());
    expect(calls.length).toBe(1);
    expect(calls[0][3]).toEqual({ h3: true });
  });
  test('no slot (switch off): nothing asked, nothing called', () => {
    const calls = [];
    const p = homePage({ play: { install: (...a) => calls.push(a) } });
    p.mount(HOME);
    expect(calls).toEqual([]);
    expect(p.added.filter((e) => /hub-play/.test(e.src || ''))).toEqual([]);
  });
});

describe('hub-play fills the v3 slot with the shared buttons', () => {
  const NOW = Date.parse('2026-10-15T21:00:00Z');
  const today = String(Math.floor((NOW + 5 * 3600000) / 86400000));
  function playPage(store) {
    const winL = {}; const timers = [];
    const box = { innerHTML: '', ls: {}, addEventListener(n, fn) { (box.ls[n] = box.ls[n] || []).push(fn); } };
    const ROOT = { innerHTML: '<div id="wqp-inst" class="wq-inst"></div>', querySelector: (s) => (s === '#wqp-inst' ? box : null) };
    const ctx = {
      window: { addEventListener(n, fn) { (winL[n] = winL[n] || []).push(fn); }, matchMedia: () => ({ matches: false }) },
      navigator: { userAgent: CHROME_UA }, document: { head: { appendChild() {} }, createElement: () => ({}) },
      localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
      setTimeout: (fn) => { timers.push(fn); return timers.length; }, Date: class extends Date { static now() { return NOW; } },
      JSON, Math, String, Number, Array, Object, isFinite, encodeURIComponent,
    };
    vm.createContext(ctx);
    vm.runInContext(PLAY_SRC, ctx);
    const evs = [];
    return { box, winL, evs, run(lang) { ctx.window.WQPLAY.install({ lang, play: PLAY }, (n, p) => evs.push([n, p]), ROOT, { h3: true }); while (timers.length) timers.shift()(); } };
  }
  const offer = (p) => (p.winL.beforeinstallprompt || []).forEach((fn) => fn({ preventDefault() {}, prompt() {} }));

  test.each([
    ['en', 'Add Jugnu to your home screen', 'Add', 'Not now'],
    ['ur', 'جگنو کو اپنی ہوم اسکرین پر لگائیں', 'لگائیں', 'ابھی نہیں'],
  ])('%s: the card has the app icon and two soft buttons, Add tinted (Next stop stays the one loud button)', (lang, title, add, later) => {
    const p = playPage({ wqp_hv_day: today });
    p.run(lang);
    expect(p.box.innerHTML).toBe('');
    offer(p);
    expect(p.box.innerHTML).toContain(title);
    expect(p.box.innerHTML).toMatch(new RegExp(`<button type="button" class="wq-btn wq-soft wq-itint wqp-add" data-inst="add">${add}</button>`));
    expect(p.box.innerHTML).not.toContain('wq-go');
    expect(p.box.innerHTML).toMatch(/<div class="wq-ihead"><img class="wq-iicon" src="\/wq\/jugnu\/hello\.webp" alt="" width="48" height="48"><b>/);
    expect(p.box.innerHTML).toMatch(new RegExp(`<button type="button" class="wq-btn wq-soft wqp-later" data-inst="later">${later}</button>`));
    expect(p.evs).toContainEqual(['door_shown', expect.objectContaining({ door: 'install', surface: 'hub' })]);
  });
  test('the day\'s first view: no card even when offered', () => {
    const p = playPage({});
    p.run('en');
    offer(p);
    expect(p.box.innerHTML).toBe('');
  });
});

describe('the install card\'s look (wq-home.css)', () => {
  const CSS = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'wq-home.css'), 'utf8');
  test('Add is tinted, not the loud primary: its own fill, ink label and ledge', () => {
    const m = CSS.match(/html \.wq-icard \.wq-btn\.wq-itint\{([^}]*)\}/);
    expect(m).not.toBeNull();
    expect(m[1]).toMatch(/background:var\(--tint/);
    expect(m[1]).toMatch(/--edge:/);
  });
  test('Add and Not now are one height: both the second kind (--btn-h2), no height of their own', () => {
    expect(CSS).not.toMatch(/\.wq-icard[^{]*\{([^}]*;)?height:/);
  });
  test('the app icon is a small rounded tile next to the title', () => {
    expect(CSS).toMatch(/\.wq-ihead\{display:flex;align-items:center/);
    expect(CSS).toMatch(/\.wq-iicon\{[^}]*width:48px;height:48px[^}]*border-radius/);
  });
});
