/**
 * Jugnu's Book tile on a child's first hub open (public/wq/hub.js + hub-play.js + wq-book.js, run whole in a vm
 * with a small string-backed fake DOM; the bot's JSON over fetch is the boundary). The locked server render
 * unlocks to a hub with `book_on` (and `play` / `bind`), and the hub is drawn again while wq-book.js is still
 * loading (the Jugnu corner and the keep-my-place card each redraw it when they arrive). When wq-book.js then
 * lands: ONE `.wq-bk-hub`, ONE #wq-bk-open, its click handler on it; and every lazy script hub.js asked for
 * (hub-play.js, wq-bind.js, wq-book.js) is one tag with ONE load listener. Invented children only.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const WQ = path.join(__dirname, '..', 'public', 'wq');
const HUB_SRC = fs.readFileSync(path.join(WQ, 'hub.js'), 'utf8');
const PLAY_SRC = fs.readFileSync(path.join(WQ, 'hub-play.js'), 'utf8');
const BOOK_SRC = fs.readFileSync(path.join(WQ, 'wq-book.js'), 'utf8');
const BOOTS = require('./fixtures/hub-play-boots.json');

const PLAY = { first: false, lantern: null, install: false, doors: [], shelf: [{ id: 'numbers', nx: 'seen' }] };
const BIND = { offer: true, hub: 'tok.tok' };
const count = (s, needle) => s.split(needle).length - 1;

// The opening tag a simple selector (.class or #id) names, and where its element ends (same-tag depth count).
function find(html, sel, from) {
  const re = sel[0] === '#'
    ? new RegExp('<([a-z]+)\\b[^>]*\\bid="' + sel.slice(1) + '"[^>]*>', 'g')
    : new RegExp('<([a-z]+)\\b[^>]*\\bclass="(?:[^"]*\\s)?' + sel.slice(1) + '(?:\\s[^"]*)?"[^>]*>', 'g');
  re.lastIndex = from || 0;
  const m = re.exec(html);
  if (!m) return null;
  const tag = m[1];
  const tok = new RegExp('<' + tag + '\\b|</' + tag + '>', 'g');
  tok.lastIndex = m.index + m[0].length;
  let depth = 1;
  let t;
  while ((t = tok.exec(html))) {
    depth += t[0][1] === '/' ? -1 : 1;
    if (depth === 0) return { start: m.index, openEnd: m.index + m[0].length, end: t.index + t[0].length };
  }
  return { start: m.index, openEnd: m.index + m[0].length, end: html.length };
}

function firstOpen(answer) {
  const head = [];
  const fetches = [];
  const timers = [];
  let cache = {};
  const root = {
    _h: '', attrs: {},
    set innerHTML(h) { this._h = h; cache = {}; }, get innerHTML() { return this._h; },
    setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k]; }, appendChild() {},
    querySelector(sel) {
      if (!/^[.#][\w-]+$/.test(sel) || !find(this._h, sel)) return null;
      return (cache[sel] = cache[sel] || elFor(sel));
    },
    querySelectorAll(sel) {
      if (!/^[.#][\w-]+$/.test(sel)) return [];
      const out = [];
      let at = 0;
      let f;
      while ((f = find(root._h, sel, at))) { out.push(elFor(sel, out.length, root._h.slice(f.start, f.end))); at = f.end; }
      return out;
    },
  };
  // An element in the string: listeners of its own, insertAdjacentHTML / removeChild splice the string, as the
  // browser does; a removed element's listeners go with it.
  // From querySelectorAll, an element keeps its own markup (snap), so removing several in a row takes each one out.
  function elFor(sel, nth = 0, snap = null) {
    const at = () => { let f = null; let from = 0; for (let i = 0; i <= nth; i++) { f = find(root._h, sel, from); if (!f) return null; from = f.end; } return f; };
    const el = {
      sel, listeners: {}, hidden: false,
      addEventListener(n, fn) { (this.listeners[n] = this.listeners[n] || []).push(fn); },
      fire(n, e) { (this.listeners[n] || []).forEach((fn) => fn.call(this, e || { preventDefault() {} })); },
      getAttribute: (k) => { const f = at(); const m = f && new RegExp('\\b' + k + '="([^"]*)"').exec(root._h.slice(f.start, f.openEnd)); return m ? m[1] : null; },
      insertAdjacentHTML(pos, h) {
        const f = at();
        const i = pos === 'afterend' ? f.end : pos === 'beforebegin' ? f.start : pos === 'afterbegin' ? f.openEnd : f.end - (root._h.slice(0, f.end).length - root._h.slice(0, f.end).lastIndexOf('</'));
        root._h = root._h.slice(0, i) + h + root._h.slice(i);
      },
    };
    el.parentNode = { removeChild: () => { const i = snap ? root._h.indexOf(snap) : -1; const f = snap ? (i >= 0 ? { start: i, end: i + snap.length } : null) : at(); if (f) { root._h = root._h.slice(0, f.start) + root._h.slice(f.end); cache = {}; } } };
    el.remove = () => el.parentNode.removeChild(el);
    return el;
  }
  const ctx = {
    document: {
      documentElement: { setAttribute() {}, classList: { toggle() {}, contains: () => false } }, cookie: '',
      getElementById: (id) => (id === 'wq' ? root : id === 'boot' ? { textContent: JSON.stringify({ lang: 'en', token: 'tok.tok', brand: null, locked: true, kids: [] }) } : head.find((e) => e.id === id) || null),
      querySelector: (sel) => (/hub\.js/.test(sel) ? { getAttribute: () => '/wq/hub.js?v=abc123' } : null),
      createElement: (tag) => ({ tag, listeners: {}, setAttribute() {}, addEventListener(n, fn) { (this.listeners[n] = this.listeners[n] || []).push(fn); } }),
      head: { appendChild: (el) => head.push(el) },
    },
    navigator: { userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/130.0 Mobile Safari/537.36', sendBeacon: () => true },
    history: { replaceState() {} },
    location: { search: '', protocol: 'https:', host: 'wq.example.test', assign() {}, reload() {} },
    Blob: function Blob() {},
    fetch: (url, o) => {
      fetches.push(String(url));
      const body = /\/book\//.test(String(url)) ? { name: 'Zara', lamps: {}, class_lights: { shown: false } } : answer;
      return Promise.resolve({ status: 200, ok: true, json: () => Promise.resolve(body), text: () => Promise.resolve(JSON.stringify(body)) });
    },
    localStorage: { getItem: () => null, setItem() {} },
    setTimeout: (fn) => { timers.push(fn); return timers.length; },
    Date, JSON, Math, String, Number, Array, Object, Promise, isFinite, encodeURIComponent, Uint8Array,
  };
  ctx.window = ctx;
  ctx.window.scrollTo = () => {};
  ctx.window.addEventListener = () => {};
  vm.createContext(ctx);
  vm.runInContext(HUB_SRC, ctx);
  const flush = async () => { for (let i = 0; i < 6; i++) { await Promise.resolve(); while (timers.length) timers.shift()(); } };
  const script = (re) => head.filter((e) => e.tag === 'script' && re.test(e.src || ''));
  const arrive = async (re, src) => { if (src) vm.runInContext(src, ctx); script(re).forEach((s) => (s.listeners.load || []).forEach((fn) => fn())); await flush(); };
  return { ctx, head, fetches, root, html: () => root._h, flush, script, arrive };
}

// Every lazy script hub.js asked for: one tag each, one load listener on it, at hub.js's ?v=.
function oneEach(p, names) {
  names.forEach((n) => {
    const s = p.script(new RegExp('/wq/' + n + '\\.js'));
    expect(s.map((e) => e.src)).toEqual(['/wq/' + n + '.js?v=abc123']);
    expect((s[0].listeners.load || []).length).toBe(1);
  });
}
function oneTile(p) {
  expect(count(p.html(), 'class="wq-bk-hub"')).toBe(1);
  expect(count(p.html(), 'id="wq-bk-open"')).toBe(1);
  const tile = p.root.querySelector('#wq-bk-open');
  expect((tile.listeners.click || []).length).toBe(1);
  return tile;
}

describe('first open with the Book on: the hub drawn again before wq-book.js arrives', () => {
  test.each(['en', 'ur'])('%s: drawn twice (the Jugnu corner arrives first): one tile, wired', async (lang) => {
    const p = firstOpen({ ...BOOTS.done, lang, play: PLAY, book_on: true });
    await p.flush();
    await p.arrive(/hub-play\.js/, PLAY_SRC);
    expect(p.html()).toContain('data-shelf="1"');
    oneEach(p, ['hub-play', 'wq-book']);
    await p.arrive(/wq-book\.js/, BOOK_SRC);
    const tile = oneTile(p);
    tile.fire('click');
    await p.flush();
    expect(p.fetches.filter((u) => /\/book\//.test(u))).toHaveLength(1);
  });
  test.each(['en', 'ur'])('%s: drawn three times (the Jugnu corner, then the keep card): one tile, wired', async (lang) => {
    const p = firstOpen({ ...BOOTS.done, lang, play: PLAY, bind: BIND, book_on: true });
    await p.flush();
    await p.arrive(/hub-play\.js/, PLAY_SRC);
    p.ctx.WQBIND = { card() {}, t: () => ({}), chipExtra: () => '' };
    await p.arrive(/wq-bind\.js/);
    expect(p.html()).toContain('id="wq-bind-slot"');
    expect(p.head.filter((e) => e.tag === 'link').map((e) => e.href)).toEqual(['/wq/wq-bind.css?v=abc123', '/wq/wq-book.css?v=abc123']);
    expect(p.script(/wq-book\.js/)[0].id).toBe('wq-bk-js');
    await p.arrive(/wq-book\.js/, BOOK_SRC);
    const tile = oneTile(p);
    oneEach(p, ['hub-play', 'wq-bind', 'wq-book']);
    tile.fire('click');
    await p.flush();
    expect(p.fetches.filter((u) => /\/book\//.test(u))).toHaveLength(1);
  });
  test('hubLine called twice on the same hub (any late caller): still one tile, the newest one wired', async () => {
    const p = firstOpen({ ...BOOTS.done, book_on: true });
    await p.flush();
    await p.arrive(/wq-book\.js/, BOOK_SRC);
    p.ctx.WQBOOK.hubLine({ ...BOOTS.done, book_on: true }, { root: p.root, token: 'tok.tok', lang: 'en', ev() {}, back() {} });
    oneTile(p);
  });
  test('the hub drawn again after wq-book.js arrived: one tile, nothing loaded again', async () => {
    const p = firstOpen({ ...BOOTS.done, play: PLAY, book_on: true });
    await p.flush();
    await p.arrive(/wq-book\.js/, BOOK_SRC);
    oneTile(p);
    await p.arrive(/hub-play\.js/, PLAY_SRC);
    oneTile(p);
    oneEach(p, ['hub-play', 'wq-book']);
  });
});
