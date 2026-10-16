/**
 * A storybook link on the hub without the v3 home (public/wq/hub.js): a class link a teacher sent lands on
 * /h/<token>?from=link#story/<id>. With the stories switch on (the boot's `stories.on`, web_quiz_stories) and the v3
 * home off, hub.js fetches the stories reader (wq-stories.js/.css) once, at its own ?v=, hands it the hub's child, and
 * the reader opens the book itself; leaving the book (its Back sets #stories, its Home clears the hash) draws the hub
 * again. With the switch off, a #story/ hash changes nothing: today's hub, byte for byte, no script, no listener.
 * Run whole in a vm with the string-backed fake DOM of the Book tests. Invented children only.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const WQ = path.join(__dirname, '..', 'public', 'wq');
const HUB_SRC = fs.readFileSync(path.join(WQ, 'hub.js'), 'utf8');
const BOOTS = require('./fixtures/hub-play-boots.json');
const ON = { on: true };

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

function open({ hash = '', boot, routes = {}, listen = false }) {
  const answer = {};
  const head = [];
  const fetches = [];
  const timers = [];
  const replaced = [];
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
      getElementById: (id) => (id === 'wq' ? root : id === 'boot' ? { textContent: JSON.stringify(boot) } : head.find((e) => e.id === id) || null),
      querySelector: (sel) => (/hub\.js/.test(sel) ? { getAttribute: () => '/wq/hub.js?v=abc123' } : /readalong-listen\.js/.test(sel) && listen ? { getAttribute: () => '/wq/wq-readalong-listen.js?v=def456' } : null),
      createElement: (tag) => ({ tag, listeners: {}, setAttribute() {}, addEventListener(n, fn) { (this.listeners[n] = this.listeners[n] || []).push(fn); } }),
      head: { appendChild: (el) => head.push(el) },
    },
    navigator: { userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/130.0 Mobile Safari/537.36', sendBeacon: () => true },
    history: { replaceState(s, t, u) { replaced.push(u); ctx.location.hash = ''; } },
    location: { pathname: '/h/tok.tok', search: '', hash, protocol: 'https:', host: 'wq.example.test', assign() {}, reload() {} },
    Blob: function Blob() {},
    fetch: (url, o) => {
      fetches.push(String(url));
      let r = { status: 200, body: answer };
      for (const [rx, fn] of Object.entries(routes)) if (new RegExp(rx).test(String(url))) r = fn(String(url));
      return Promise.resolve({ status: r.status, ok: r.status < 300, json: () => Promise.resolve(r.body), text: () => Promise.resolve(JSON.stringify(r.body)) });
    },
    localStorage: { getItem: () => null, setItem() {} },
    setTimeout: (fn) => { timers.push(fn); return timers.length; },
    Date, JSON, Math, String, Number, Array, Object, Promise, isFinite, encodeURIComponent, Uint8Array,
  };
  ctx.window = ctx;
  ctx.window.scrollTo = () => {};
  const wl = {};
  ctx.window.addEventListener = (n, fn) => { (wl[n] = wl[n] || []).push(fn); };
  vm.createContext(ctx);
  // the edge loads hub.js deferred
  vm.runInContext(HUB_SRC, ctx);
  const flush = async () => { for (let i = 0; i < 6; i++) { await Promise.resolve(); while (timers.length) timers.shift()(); } };
  const script = (re) => head.filter((e) => e.tag === 'script' && re.test(e.src || ''));
  const arrive = async (re, src) => { if (src) vm.runInContext(src, ctx); script(re).forEach((s) => (s.listeners.load || []).forEach((fn) => fn())); await flush(); };
  return { ctx, head, fetches, root, html: () => root._h, flush, script, arrive, replaced, wl };
}


const hash = (p, h) => { p.ctx.location.hash = h; (p.wl.hashchange || []).slice().forEach((fn) => fn({})); };
const plainHub = async (boot) => { const p = open({ boot, listen: false }); await p.flush(); return p.html(); };
const css = (p) => p.head.filter((e) => e.rel === 'stylesheet' && /wq-stories/.test(e.href || ''));

describe('stories on, the v3 home off: a #story/ link opens the reader on the hub', () => {
  test.each(['en', 'ur'])('%s: a class link (#story/<id>) fetches the reader once, at hub.js\'s ?v=, with the hub\'s child; the hub stays drawn under it', async (lang) => {
    const boot = { ...BOOTS.done, lang, stories: ON };
    const p = open({ hash: '#story/bk1', boot, listen: false });
    p.ctx.location.search = '?from=link';
    await p.flush();
    expect(p.script(/wq-stories\.js/).map((e) => e.src)).toEqual(['/wq/wq-stories.js?v=abc123']);
    expect(css(p).map((e) => e.href)).toEqual(['/wq/wq-stories.css?v=abc123']);
    expect(p.ctx.WQSTORIES_CTX).toEqual({ token: BOOTS.done.token, kid: BOOTS.done.kid, lang });
    expect(p.html()).toBe(await plainHub(boot));
  });
  test('no hash: nothing fetched; a tap that sets #story/ later fetches it once, however often the hash moves', async () => {
    const boot = { ...BOOTS.done, lang: 'en', stories: ON };
    const p = open({ boot, listen: false });
    await p.flush();
    expect(p.script(/wq-stories/)).toHaveLength(0);
    hash(p, '#story/bk1');
    await p.flush();
    expect(p.script(/wq-stories\.js/)).toHaveLength(1);
    p.ctx.WQSTORIES = {};   // the reader arrived; it routes its own hashes from here
    hash(p, '#story/bk1/p2');
    hash(p, '#story/bk2');
    await p.flush();
    expect(p.script(/wq-stories\.js/)).toHaveLength(1);
  });
  test.each(['', '#stories'])('leaving the book (hash "%s") draws the hub again', async (h) => {
    const boot = { ...BOOTS.done, lang: 'en', stories: ON };
    const p = open({ hash: '#story/bk1', boot, listen: false });
    await p.flush();
    p.ctx.WQSTORIES = {};
    p.root.innerHTML = '<div class="wqs">a book page</div>';   // what the reader painted
    hash(p, h);
    await p.flush();
    expect(p.html()).toBe(await plainHub(boot));
  });
  test('a hash that is not a story never redraws the hub or fetches the reader', async () => {
    const boot = { ...BOOTS.done, lang: 'en', stories: ON };
    const p = open({ boot, listen: false });
    await p.flush();
    p.root.innerHTML = '<div id="other">x</div>';
    hash(p, '#book');
    await p.flush();
    expect(p.html()).toBe('<div id="other">x</div>');
    expect(p.script(/wq-stories/)).toHaveLength(0);
  });
  test('the v3 home on: hub.js leaves the reader to the home (only wq-home.js is asked for)', async () => {
    const p = open({ hash: '#story/bk1', boot: { ...BOOTS.done, lang: 'en', stories: ON, home_v3: true }, listen: false });
    await p.flush();
    expect(p.script(/wq-home\.js/)).toHaveLength(1);
    expect(p.script(/wq-stories/)).toHaveLength(0);
    expect(p.ctx.WQSTORIES_CTX).toBeUndefined();
  });
  test('no child on the hub (the picker): nothing fetched', async () => {
    const p = open({ hash: '#story/bk1', boot: { ...BOOTS.done, lang: 'en', stories: ON, kid: null }, listen: false });
    await p.flush();
    expect(p.script(/wq-stories/)).toHaveLength(0);
  });
});

describe('the switch off: a #story/ hash is today\'s hub, byte for byte', () => {
  test.each([undefined, {}, { on: false }])('stories %p: same page, same scripts, same calls, no listener', async (stories) => {
    const boot = { ...BOOTS.done, lang: 'en', ...(stories === undefined ? {} : { stories }) };
    const off = open({ hash: '#story/bk1', boot, listen: false });
    off.ctx.location.search = '?from=link';
    await off.flush();
    const plain = open({ boot: { ...BOOTS.done, lang: 'en' }, listen: false });
    await plain.flush();
    expect(off.html()).toBe(plain.html());
    expect(off.head).toEqual(plain.head);
    expect(off.fetches).toEqual(plain.fetches);
    expect(off.wl.hashchange).toBeUndefined();
    expect(off.ctx.WQSTORIES_CTX).toBeUndefined();
  });
});
