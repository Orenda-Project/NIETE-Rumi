/**
 * The hub's order when the last quiz is finished (`play.first`): the Jugnu card (.wqp-jug, hub-play.js) leads and
 * the keep-my-place card (#wq-bind-slot, wq-bind.js mounted by hub.js) comes after it, on every hub open: a
 * returning one (both scripts on the page) and a child's first open (both lazy-loaded, either arriving first, and
 * the hub drawn again later). public/wq/hub.js + hub-play.js run whole in a vm with a small fake DOM; the bot's JSON
 * over fetch is the boundary. GOLDEN: with `play.first` false, or with no `bind`, the hub is the base's, byte for
 * byte (fixtures/hub-keep-after-jug-golden.json was written by the base's hub.js/hub-play.js with
 * KEEP_JUG_GOLDEN_WRITE=1). Invented children only.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const WQ = path.join(__dirname, '..', 'public', 'wq');
const HUB_SRC = fs.readFileSync(path.join(WQ, 'hub.js'), 'utf8');
const PLAY_SRC = fs.readFileSync(path.join(WQ, 'hub-play.js'), 'utf8');
const BOOTS = require('./fixtures/hub-play-boots.json');
const FIX = path.join(__dirname, 'fixtures', 'hub-keep-after-jug-golden.json');

const PLAY = (first) => ({ first, lantern: null, install: false, doors: [], shelf: [] });
const BIND = { offer: true, hub: 'tok.tok' };
const WQBIND = () => ({ card() {}, t: () => ({}), chipExtra: () => '' });

// loaded: the scripts already on the page when hub.js runs (a returning open); otherwise both are lazy-loaded.
function open(answer, { loaded = false } = {}) {
  const head = [];
  const timers = [];
  const root = { _h: '', attrs: {}, set innerHTML(h) { this._h = h; }, get innerHTML() { return this._h; }, setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k]; }, querySelector: () => null, querySelectorAll: () => [], appendChild() {} };
  const ctx = {
    document: {
      documentElement: { setAttribute() {}, classList: { toggle() {}, contains: () => false } }, cookie: '',
      getElementById: (id) => (id === 'wq' ? root : id === 'boot' ? { textContent: JSON.stringify({ lang: 'en', token: 'tok.tok', brand: null, locked: true, kids: [] }) } : null),
      querySelector: (sel) => (/hub\.js/.test(sel) ? { getAttribute: () => '/wq/hub.js?v=abc123' } : null),
      createElement: (tag) => ({ tag, listeners: {}, setAttribute() {}, addEventListener(n, fn) { (this.listeners[n] = this.listeners[n] || []).push(fn); } }),
      head: { appendChild: (el) => head.push(el) },
    },
    navigator: { userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/130.0 Mobile Safari/537.36', sendBeacon: () => true },
    history: { replaceState() {} },
    location: { search: '', protocol: 'https:', host: 'wq.example.test', assign() {}, reload() {} },
    Blob: function Blob() {},
    fetch: () => Promise.resolve({ status: 200, ok: true, text: () => Promise.resolve(JSON.stringify(answer)) }),
    localStorage: { getItem: () => null, setItem() {} },
    setTimeout: (fn) => { timers.push(fn); return timers.length; },
    Date, JSON, Math, String, Number, Array, Object, Promise, isFinite, encodeURIComponent, Uint8Array,
  };
  ctx.window = ctx;
  ctx.window.scrollTo = () => {};
  ctx.window.addEventListener = () => {};
  vm.createContext(ctx);
  if (loaded) { vm.runInContext(PLAY_SRC, ctx); ctx.WQBIND = WQBIND(); }
  vm.runInContext(HUB_SRC, ctx);
  const flush = async () => { for (let i = 0; i < 6; i++) { await Promise.resolve(); while (timers.length) timers.shift()(); } };
  const arrive = async (re) => {
    if (/hub-play/.test(String(re))) vm.runInContext(PLAY_SRC, ctx); else ctx.WQBIND = WQBIND();
    head.filter((e) => e.tag === 'script' && re.test(e.src || '')).forEach((s) => (s.listeners.load || []).forEach((fn) => fn()));
    await flush();
  };
  return { html: () => root._h, flush, arrive };
}
function keepAfterJug(html) {
  const jug = html.indexOf('wqp-jug');
  const slot = html.indexOf('id="wq-bind-slot"');
  expect(jug).toBeGreaterThan(0);
  expect(slot).toBeGreaterThan(jug);
  expect(html.split('id="wq-bind-slot"')).toHaveLength(2);
}

describe('`play.first` with `bind`: the Jugnu card leads, the keep card after it', () => {
  test.each(['en', 'ur'])('%s: a returning open (both scripts on the page)', async (lang) => {
    const p = open({ ...BOOTS.done, lang, play: PLAY(true), bind: BIND }, { loaded: true });
    await p.flush();
    keepAfterJug(p.html());
  });
  test.each(['en', 'ur'])('%s: first open, hub-play.js arrives first, then wq-bind.js (the late redraw keeps it after)', async (lang) => {
    const p = open({ ...BOOTS.done, lang, play: PLAY(true), bind: BIND });
    await p.flush();
    expect(p.html()).not.toContain('wq-bind-slot');
    await p.arrive(/hub-play\.js/);
    expect(p.html()).toContain('wqp-jug');
    await p.arrive(/wq-bind\.js/);
    keepAfterJug(p.html());
    await p.arrive(/hub-play\.js/);
    keepAfterJug(p.html());
  });
  test.each(['en', 'ur'])('%s: first open, wq-bind.js arrives first, then hub-play.js', async (lang) => {
    const p = open({ ...BOOTS.done, lang, play: PLAY(true), bind: BIND });
    await p.flush();
    await p.arrive(/wq-bind\.js/);
    expect(p.html()).toContain('id="wq-bind-slot"');
    await p.arrive(/hub-play\.js/);
    keepAfterJug(p.html());
  });
});

// GOLDEN: everything else stays today's hub, byte for byte.
const CASES = {
  'first false, bind, returning': [{ ...BOOTS.open, play: PLAY(false), bind: BIND }, { loaded: true }],
  'first false, bind, ur, returning': [{ ...BOOTS.open, lang: 'ur', play: PLAY(false), bind: BIND }, { loaded: true }],
  'first false (done), bind, returning': [{ ...BOOTS.done, play: PLAY(false), bind: BIND }, { loaded: true }],
  'first true, no bind, returning': [{ ...BOOTS.done, play: PLAY(true) }, { loaded: true }],
  'first true, no bind, ur, returning': [{ ...BOOTS.done, lang: 'ur', play: PLAY(true) }, { loaded: true }],
  'bind, no play, returning': [{ ...BOOTS.done, bind: BIND }, { loaded: true }],
};
describe('GOLDEN: `play.first` false, or no `bind`: the base hub', () => {
  const got = {};
  test.each(Object.keys(CASES))('%s', async (name) => {
    const p = open(...CASES[name]);
    await p.flush();
    got[name] = p.html();
    if (process.env.KEEP_JUG_GOLDEN_WRITE !== '1') expect(p.html()).toBe(JSON.parse(fs.readFileSync(FIX, 'utf8'))[name]);
  });
  afterAll(() => { if (process.env.KEEP_JUG_GOLDEN_WRITE === '1') fs.writeFileSync(FIX, `${JSON.stringify(got, null, 1)}\n`); });
});
