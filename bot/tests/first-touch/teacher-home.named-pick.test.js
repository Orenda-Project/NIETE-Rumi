'use strict';
/**
 * The teacher home's two switched variants, RUN on the page the server builds (the same harness as
 * teacher-home.page-run.test.js, plus a home answer the test releases and a storage stand-in):
 *   quiz_teacher_home_named_item: the top card names what "Send again" sends ("Story: …", "Send this story again");
 *   quiz_teacher_home_early_pick: a grade chip tapped before the home has answered is kept and shown, not lost
 *   behind a false error. Off, each is today's page byte for byte (the shell golden recorded on the base).
 */
process.env.WHATSAPP_BOT_NUMBER = ['1555', '000', '1111'].join('');
jest.mock('../../shared/config/supabase', () => ({}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));

const vm = require('vm');
const Page = require('../../shared/services/first-touch/teacher-home.page');
const { parse } = require('./_mini-dom');

const El = parse('<i></i>').children[0].constructor;
/** The mini DOM's element, with the few things this page also touches (built nodes, events, the message box). */
class PageEl extends El {
  constructor(tag, attrs, parent) { super(tag, attrs || {}, parent || null); this.on = []; this.style = {}; this.scrollHeight = 0; }
  get className() { return this.getAttribute('class') || ''; }
  set className(v) { this.setAttribute('class', v); }
  get rows() { return Number(this.getAttribute('rows')); }
  set rows(v) { this.setAttribute('rows', v); }
  get firstChild() { return this.children[0] || null; }
  appendChild(c) { c.parentNode = this; this.children.push(c); return c; }
  removeChild(c) { this.children = this.children.filter((x) => x !== c); c.parentNode = null; return c; }
  insertAdjacentHTML(where, html) { if (where !== 'beforeend') throw new Error(`unsupported ${where}`); adopt(parse(html)).children.forEach((c) => this.appendChild(c)); }
  addEventListener(type, fn) { this.on.push({ type, fn }); }
  focus() {} select() {} setSelectionRange() {}
}
function adopt(n) { Object.setPrototypeOf(n, PageEl.prototype); n.on = []; n.style = {}; n.scrollHeight = 0; n.children.forEach(adopt); return n; }

const flush = async () => { for (let i = 0; i < 10; i += 1) await new Promise((r) => setImmediate(r)); };

/**
 * Opens the page in `lang` with the home answering `home` (or refusing with `status`, or failing with `status: 'offline'`);
 * `answer(path, body)` answers every other fetch.
 * `shell` = the switches buildShell is given; `hold` keeps the home's answer back until `answerHome()`; `storage` stands in
 * for localStorage. → { q, tap(el), fetches, beacons, location, answerHome }.
 */
async function open(home, { lang = 'en', answer = () => ({}), status = 200, timers = [], clock = null, shell = {}, hold = false, storage = null } = {}) {
  const { html } = Page.buildShell({ token: 'a.b', lang, switchTo: null, ...shell });
  let release = () => {};
  const held = hold ? new Promise((r) => { release = r; }) : null;
  const doc = adopt(parse(html));
  const fetches = [];
  const beacons = [];
  const location = { assigned: [], reloads: 0, reload() { this.reloads += 1; }, set href(v) { this.assigned.push(v); }, get href() { return this.assigned[this.assigned.length - 1] || ''; } };
  class Blob { constructor(parts) { this.text = parts.join(''); } }
  const window = {
    document: {
      getElementById: (id) => doc.querySelector(`#${id}`),
      querySelector: (s) => doc.querySelector(s),
      querySelectorAll: (s) => doc.querySelectorAll(s),
      createElement: (t) => new PageEl(t),
      createTextNode: (t) => Object.assign(new PageEl('#text'), { text: String(t) }),
      execCommand: () => false,
    },
    addEventListener() {},
    scrollTo() {},
    history: { pushState() {}, back() {} },
    location,
    navigator: { sendBeacon: (p, blob) => { beacons.push({ path: p, body: JSON.parse(blob.text) }); return true; } },
    Blob,
    setTimeout(fn, ms) { timers.push(Object.assign(fn, { ms })); },
    fetch: (p, opts = {}) => {
      const body = opts.body ? JSON.parse(opts.body) : undefined;
      fetches.push({ path: p, body });
      const isHome = p.indexOf('/api/th/home?') === 0;
      if (isHome && status === 'offline') return Promise.reject(new TypeError('Failed to fetch'));
      const code = isHome ? status : 200;
      const out = isHome ? home : answer(p, body);
      const res = { ok: code >= 200 && code < 300, status: code, json: () => Promise.resolve(out) };
      return isHome && held ? held.then(() => res) : Promise.resolve(res);
    },
    JSON, String, Array, Object, Promise, Number, Boolean, RegExp,
  };
  if (storage) window.localStorage = { getItem: (k) => (k in storage ? storage[k] : null), setItem: (k, v) => { storage[k] = String(v); } };
  if (clock) window.Date = class extends Date { static now() { return clock.t; } };
  window.window = window;
  const ctx = vm.createContext(window);
  doc.querySelectorAll('script').filter((s) => !s.getAttribute('type')).forEach((s) => vm.runInContext(s.text, ctx));
  await flush();
  const q = (s) => doc.querySelector(s);
  if (status === 200 && !hold) expect(q('#th-main').getAttribute('data-ready')).toBe('1');
  const tap = async (el) => {
    for (let e = el; e; e = e.parentNode) (e.on || []).filter((h) => h.type === 'click').forEach((h) => h.fn({ target: el, preventDefault() {} }));
    await flush();
  };
  const answerHome = async () => { release(); await flush(); };
  return { q, tap, fetches, beacons, location, answerHome };
}


const LIB = (grade) => ({ grade, stories: [{ id: `b${grade}`, title: `Book ${grade}`, href: `/s?book=b${grade}` }], all: '/all' });
const chosen = (p) => p.q('#th-chosen').textContent;
const pressed = (p) => p.q('#th-grades').querySelectorAll('[data-grade]').filter((x) => x.getAttribute('aria-pressed') === 'true').map((x) => x.getAttribute('data-grade'));
const libraryAsks = (p) => p.fetches.filter((f) => f.path.indexOf('/api/th/library?') === 0).map((f) => /[?&]g=(\d)/.exec(f.path)[1]);

describe('switches off: the shell is today\'s, byte for byte', () => {
  // the 18 shapes of today's shell, recorded on the base (the same golden the page-run file holds the page to)
  const crypto = require('crypto');
  const GOLD = require('./__goldens__/teacher-home-shell-off.json');
  const shaOf = (b) => crypto.createHash('sha256').update(`${b.html}\n${b.csp}`).digest('hex');

  test('both switches given as false, and given anything but true → each of the 18 shapes as recorded', () => {
    for (const v of [false, 'true', 1, {}, null]) {
      const now = GOLD.map(({ lang, switchTo, asked }) => ({ lang, switchTo, asked, sha256: shaOf(Page.buildShell({ token: 'a.b-c_D', lang, switchTo, asked, named: v, early: v })) }));
      expect(now).toEqual(GOLD);
    }
  });

  test('the quick-answer page with both switches off is the quick-answer page as it is', () => {
    const o = { token: 'a.b', lang: 'ur', switchTo: null, paged: true };
    expect(Page.buildShell({ ...o, named: false, early: false }).html).toBe(Page.buildShell(o).html);
  });
});

describe('quiz_teacher_home_early_pick: a grade tapped before the home answers', () => {
  const HOME = () => ({ primary: { kind: 'none' }, library: LIB(2) }); // fresh each time: the page writes into it
  const answer = (p) => (p.indexOf('/api/th/library?') === 0 ? LIB(Number(/[?&]g=(\d)/.exec(p)[1])) : {});

  test('ON: the tap is kept: no error line; once the home answers, the tapped grade is asked once, shown and stored', async () => {
    const storage = {};
    const p = await open(HOME(), { hold: true, storage, answer, shell: { early: true } });
    expect(p.q('#th-main').getAttribute('data-ready')).toBeNull(); // the tap lands before the home's data
    await p.tap(p.q('#th-grades').querySelector('[data-grade="3"]'));
    expect(p.q('#th-err').hidden).toBe(true);
    expect(pressed(p)).toEqual(['3']);
    expect(storage['th.grade']).toBe('3');
    expect(libraryAsks(p)).toEqual([]);
    await p.answerHome();
    expect(p.q('#th-main').getAttribute('data-ready')).toBe('1');
    expect(libraryAsks(p)).toEqual(['3']);
    expect(chosen(p)).toBe('Chosen for Grade 3');
    expect(pressed(p)).toEqual(['3']);
    expect(p.q('#th-err').hidden).toBe(true);
    expect(storage['th.grade']).toBe('3');
  });

  test('ON: a tap on the grade the home answers with asks nothing more', async () => {
    const p = await open(HOME(), { hold: true, storage: {}, answer, shell: { early: true } });
    await p.tap(p.q('#th-grades').querySelector('[data-grade="2"]'));
    await p.answerHome();
    expect(libraryAsks(p)).toEqual([]);
    expect(chosen(p)).toBe('Chosen for Grade 2');
    expect(p.q('#th-err').hidden).toBe(true);
  });

  test('ON: two early taps → the last one wins, asked once', async () => {
    const p = await open(HOME(), { hold: true, storage: {}, answer, shell: { early: true } });
    await p.tap(p.q('#th-grades').querySelector('[data-grade="3"]'));
    await p.tap(p.q('#th-grades').querySelector('[data-grade="5"]'));
    await p.answerHome();
    expect(libraryAsks(p)).toEqual(['5']);
    expect(chosen(p)).toBe('Chosen for Grade 5');
  });

  test('ON, the control: a tap after the home answered is today\'s (one library ask, the new grade, no error)', async () => {
    const p = await open(HOME(), { storage: {}, answer, shell: { early: true } });
    await p.tap(p.q('#th-grades').querySelector('[data-grade="4"]'));
    expect(libraryAsks(p)).toEqual(['4']);
    expect(chosen(p)).toBe('Chosen for Grade 4');
    expect(p.q('#th-err').hidden).toBe(true);
  });

  test('ON with the quick answer page (paged): the same, kept and asked once; shown = stored = the tapped grade', async () => {
    const storage = {};
    const p = await open(HOME(), { hold: true, storage, answer, shell: { early: true, paged: true } });
    expect(p.q('#th-main').getAttribute('data-ready')).toBeNull();
    await p.tap(p.q('#th-grades').querySelector('[data-grade="3"]'));
    expect(p.q('#th-err').hidden).toBe(true);
    await p.answerHome();
    expect(libraryAsks(p)).toEqual(['3']);
    expect(chosen(p)).toBe('Chosen for Grade 3');
    expect(storage['th.grade']).toBe('3');
    expect(p.q('#th-err').hidden).toBe(true);
  });

  test('OFF with the quick answer page (paged; today\'s, the record): no error line, but the page shows the home\'s grade while the tapped one is stored', async () => {
    const storage = {};
    const p = await open(HOME(), { hold: true, storage, answer, shell: { paged: true } });
    await p.tap(p.q('#th-grades').querySelector('[data-grade="3"]'));
    await p.answerHome();
    expect(p.q('#th-err').hidden).toBe(true);
    expect(chosen(p)).toBe('Chosen for Grade 2');
    expect(storage['th.grade']).toBe('3'); // the next open shows a grade this one never did
  });

  test('OFF (today, kept as the record of the defect): the early tap shows the error line and the page settles on the home\'s grade', async () => {
    const storage = {};
    const p = await open(HOME(), { hold: true, storage, answer });
    await p.tap(p.q('#th-grades').querySelector('[data-grade="3"]'));
    await p.answerHome();
    expect(p.q('#th-err').hidden).toBe(false);
    expect(chosen(p)).toBe('Chosen for Grade 2');
    expect(storage['th.grade']).toBe('3');
  });
});

describe('quiz_teacher_home_named_item: the top card names what it sends again', () => {
  const MSG = 'Class, read this story';
  const card = (item, extra = {}) => ({ primary: { kind: 'class', played: 4, title: "What's Next?", ...(item ? { item } : {}), again: { id: 'q1' }, send: { message: MSG, wa: 'https://wa.me/?text=x', c: 'c1', sendKind: 'again' }, ...extra }, library: LIB(2) });
  const sub = (p) => p.q('#th-top').querySelector('.th-sub');
  const go = (p) => p.q('#th-top').querySelector('[data-tap="again"]');

  test.each([
    ['en', 'story', 'Story: ', 'Send this story again'],
    ['en', 'quiz', 'Quiz: ', 'Send this quiz again'],
    ['ur', 'story', 'کہانی: ', 'یہ کہانی دوبارہ بھیجیں'],
    ['ur', 'quiz', 'کوئز: ', 'یہ کوئز دوبارہ بھیجیں'],
  ])('ON %s, a %s: the type word before the isolated title, and the button names its object', async (lang, item, word, button) => {
    const p = await open(card(item), { lang, shell: { named: true } });
    expect(sub(p).textContent).toBe(`${word}What's Next?`);
    expect(sub(p).querySelector('bdi').textContent).toBe("What's Next?");
    expect(sub(p).querySelector('bdi').getAttribute('dir')).toBe('auto');
    expect(go(p).textContent).toBe(button);
  });

  test('ON, a reminder link card (no sheet) names its object too', async () => {
    const p = await open(card('story', { again: { href: '/r/remind' }, send: null }), { shell: { named: true } });
    expect(go(p).textContent).toBe('Send this story again');
    expect(go(p).href).toBe('/r/remind');
  });

  test('ON, a card the server did not name (no item) → today\'s words', async () => {
    const p = await open(card(null), { shell: { named: true } });
    expect(sub(p).textContent).toBe("What's Next?");
    expect(go(p).textContent).toBe('Send again');
  });

  test('OFF: the same named card reads as today (the item is ignored)', async () => {
    const p = await open(card('story'));
    expect(sub(p).textContent).toBe("What's Next?");
    expect(go(p).textContent).toBe('Send again');
  });

  test('ON, the tap still opens the sheet with the class message', async () => {
    const p = await open(card('story'), { shell: { named: true } });
    await p.tap(go(p));
    expect(p.q('#th-sheet').hidden).toBe(false);
    expect(p.q('#th-msg').value).toBe(MSG);
  });
});
