/**
 * The join screen keeps a grade tap made before its script has loaded (quiz_join_early_tap). The chips are drawn and
 * look tappable while join.js (deferred) is still loading; a child's first tap in that window used to vanish: no chip
 * pressed, no grade sent, "Let's go!" stayed grey. With the switch on, a tiny inline keeper (it runs before the chips
 * exist) presses the tapped chip at once and keeps its grade; join.js replays that tap exactly once when it binds.
 * Switch off: the page is today's, byte for byte, and join.js does nothing new.
 *
 * The keeper and join.js run in a small stand-in for the browser (one document, capture and bubble click listeners).
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { renderJoinPage, EARLY_TAP } = require('../routes/quiz-join.routes');

const JOIN_JS = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'join.js'), 'utf8');
const GOLDEN = require('./__golden__/quiz-join-page-off.json');
const keeperSource = () => /^<script>([\s\S]*)<\/script>$/.exec(EARLY_TAP)[1];

function el(id, attrs0 = {}, extra = {}) {
  const attrs = { ...attrs0 };
  return { id, hidden: false, disabled: false, value: '', innerHTML: '', textContent: '', listeners: {}, attrs,
    setAttribute(k, v) { attrs[k] = String(v); }, getAttribute(k) { return k in attrs ? attrs[k] : null; },
    removeAttribute(k) { delete attrs[k]; },
    addEventListener(t, f) { this.listeners[t] = f; }, focus() {}, ...extra };
}

/** A join page in the stand-in: five chips, the name, "Let's go!". The keeper runs at once when `keeper` is true. */
function page({ keeper = true } = {}) {
  const els = {};
  ['jn-name', 'jn-notice', 'jn-go', 'jn-out', 'jn-n1', 'jn-n2'].forEach((id) => { els[id] = el(id); });
  els.boot = el('boot', {}, { textContent: JSON.stringify({ view: 'join', t: 'tok', lang: 'en', practice: false, copy: { noticeSave: 'S {n}', noticeReadings: 'R {n}' } }) });
  const chips = [1, 2, 3, 4, 5].map((g) => {
    const c = el(null, { 'data-tap': 'grade', 'data-grade': String(g), 'aria-pressed': 'false', class: 'chip' });
    c.closest = (sel) => (sel === '[data-tap=grade]' || sel === '[data-tap]' ? c : null);
    return c;
  });
  const root = el('html');
  const listeners = [];
  const posts = [];
  function XMLHttpRequest() { this.open = (m, p) => { this.path = p; }; this.setRequestHeader = () => {}; this.send = (b) => { posts.push({ path: this.path, body: JSON.parse(b) }); }; }
  const document = {
    cookie: '', head: { appendChild() {} }, documentElement: root,
    getElementById: (id) => els[id] || null,
    querySelectorAll: (sel) => (sel === '.chip' ? chips : []),
    querySelector: (sel) => { const m = /^\.chip\[data-grade="(\d)"\]$/.exec(sel); return m ? chips[Number(m[1]) - 1] : null; },
    createElement: () => ({}),
    addEventListener: (t, f, capture) => { if (t === 'click') listeners.push({ f, capture: capture === true }); },
  };
  const store = new Map();
  const window = { crypto: { getRandomValues: (a) => { for (let i = 0; i < a.length; i++) a[i] = i * 7; return a; } } };
  const ctx = { document, window, XMLHttpRequest, location: { protocol: 'https:', replace() {}, href: '' }, setTimeout: () => 0,
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v) } };
  vm.createContext(ctx);
  if (keeper) vm.runInContext(keeperSource(), ctx);
  // a tap: capture listeners first, then bubble ones, as a browser dispatches a click that reaches the document
  const tap = (grade) => {
    const target = chips[grade - 1];
    listeners.filter((l) => l.capture).concat(listeners.filter((l) => !l.capture)).forEach((l) => l.f({ target }));
  };
  const loadScript = () => vm.runInContext(JOIN_JS, ctx);
  const pressed = () => chips.map((c) => c.getAttribute('aria-pressed') === 'true');
  const grades = () => posts.filter((p) => p.path === '/api/wq/join/grade').map((p) => p.body.grade);
  const type = (v) => { els['jn-name'].value = v; els['jn-name'].listeners.input(); };
  return { els, root, tap, loadScript, pressed, grades, type, posts };
}

describe('the join page with quiz_join_early_tap', () => {
  test('switch off (or not passed): the page is today\'s, byte for byte', () => {
    for (const [k, args] of Object.entries(GOLDEN.cases)) {
      expect([k, renderJoinPage(args)]).toEqual([k, GOLDEN.pages[k]]);
      expect([k, renderJoinPage({ ...args, earlyTap: false })]).toEqual([k, GOLDEN.pages[k]]);
    }
  });

  test('switch on: the keeper is the page\'s first script, before the chips, and is the only change', () => {
    for (const [k, args] of Object.entries(GOLDEN.cases)) {
      const html = renderJoinPage({ ...args, earlyTap: true });
      const at = html.indexOf(EARLY_TAP);
      expect(at).toBeGreaterThan(-1);
      expect(at).toBeLessThan(html.indexOf('class="chip"'));
      expect(at).toBeLessThan(html.indexOf('<script id="boot"'));
      expect(html.replace(`${EARLY_TAP}\n`, '')).toBe(GOLDEN.pages[k]);
    }
    expect(Buffer.byteLength(EARLY_TAP)).toBeLessThan(400);
  });

  test('the edge passes the bot\'s earlyTap through, and only a literal true turns it on', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'quiz-join.routes.js'), 'utf8');
    expect(src).toContain('earlyTap: out.body.earlyTap === true');
  });
});

describe('a grade tapped before join.js has bound', () => {
  test('the chip is pressed at once, and once join.js binds the tap is replayed: one grade sent, "Let\'s go!" opens with a name', () => {
    const p = page();
    p.tap(3);
    expect(p.pressed()).toEqual([false, false, true, false, false]);
    expect(p.root.getAttribute('data-early')).toBe('3');
    expect(p.posts).toHaveLength(0);
    p.loadScript();
    expect(p.grades()).toEqual([3]);
    expect(p.pressed()).toEqual([false, false, true, false, false]);
    expect(p.root.getAttribute('data-early')).toBeNull();
    expect(p.els['jn-go'].disabled).toBe(true);
    p.type('Sara');
    expect(p.els['jn-go'].disabled).toBe(false);
  });

  test('two taps before it binds: the last one (the chip shown pressed) is the one sent, once', () => {
    const p = page();
    p.tap(2);
    p.tap(4);
    expect(p.pressed()).toEqual([false, false, false, true, false]);
    p.loadScript();
    expect(p.grades()).toEqual([4]);
  });

  test('after join.js binds, taps are join.js\'s alone: one grade per tap, nothing kept', () => {
    const p = page();
    p.tap(1);
    p.loadScript();
    p.tap(5);
    expect(p.grades()).toEqual([1, 5]);
    expect(p.root.getAttribute('data-early')).toBeNull();
    expect(p.pressed()).toEqual([false, false, false, false, true]);
  });

  test('no tap before it binds: join.js sends nothing at load', () => {
    const p = page();
    p.loadScript();
    expect(p.posts).toHaveLength(0);
    p.tap(2);
    expect(p.grades()).toEqual([2]);
  });

  test('switch off (no keeper on the page): a tap before join.js is not replayed, as today', () => {
    const p = page({ keeper: false });
    p.tap(3);
    p.loadScript();
    expect(p.posts).toHaveLength(0);
    expect(p.pressed()).toEqual([false, false, false, false, false]);
  });

  test('a kept value that is not a grade is ignored', () => {
    const p = page();
    p.root.setAttribute('data-early', '9');
    p.loadScript();
    expect(p.posts).toHaveLength(0);
  });
});
