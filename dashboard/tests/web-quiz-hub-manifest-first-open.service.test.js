/**
 * The hub's install manifest on a child's FIRST open (fresh profile: no cookies, so the server render is the locked
 * one and renderHubPage leaves `<link rel="manifest">` out). When the unlock brings `play.install`, hub.js adds the
 * same link the server writes (/h/<token>/manifest.webmanifest, ?kid=<16-hex chip> when known), once. Nothing with
 * install false or absent, and no second link when the page already has one. public/wq/hub.js (+ hub-play.js) run
 * whole in a vm with a small fake DOM; the bot's JSON over fetch is the boundary. Invented children only.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { renderHubPage } = require('../routes/web-quiz.routes');

const WQ = path.join(__dirname, '..', 'public', 'wq');
const HUB_SRC = fs.readFileSync(path.join(WQ, 'hub.js'), 'utf8');
const PLAY_SRC = fs.readFileSync(path.join(WQ, 'hub-play.js'), 'utf8');
const BOOTS = require('./fixtures/hub-play-boots.json');

const TOKEN = 'tok.tok';
const CHIP = BOOTS.done.kid;
const PLAY = (install) => ({ first: false, lantern: null, install, doors: [], shelf: [] });

function firstOpen(answer, { serverLink = null } = {}) {
  const head = [];
  if (serverLink) head.push({ tag: 'link', rel: 'manifest', href: serverLink, server: true });
  const timers = [];
  const root = { _h: '', attrs: {}, set innerHTML(h) { this._h = h; }, get innerHTML() { return this._h; }, setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k]; }, querySelector: () => null, querySelectorAll: () => [], appendChild() {} };
  const ctx = {
    document: {
      documentElement: { setAttribute() {}, classList: { toggle() {}, contains: () => false } }, cookie: '',
      getElementById: (id) => (id === 'wq' ? root : id === 'boot' ? { textContent: JSON.stringify({ lang: 'en', token: TOKEN, brand: null, locked: true, kids: [] }) } : null),
      querySelector: (sel) => {
        if (/hub\.js/.test(sel)) return { getAttribute: () => '/wq/hub.js?v=abc123' };
        if (/^link\[rel=["']?manifest["']?\]$/.test(sel)) return head.find((e) => e.tag === 'link' && e.rel === 'manifest') || null;
        return null;
      },
      createElement: (tag) => ({ tag, listeners: {}, setAttribute(k, v) { this[k] = v; }, addEventListener(n, fn) { (this.listeners[n] = this.listeners[n] || []).push(fn); } }),
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
  vm.runInContext(HUB_SRC, ctx);
  const flush = async () => { for (let i = 0; i < 6; i++) { await Promise.resolve(); while (timers.length) timers.shift()(); } };
  const manifests = () => head.filter((e) => e.tag === 'link' && e.rel === 'manifest');
  const playArrives = async () => {
    vm.runInContext(PLAY_SRC, ctx);
    head.filter((e) => e.tag === 'script' && /hub-play\.js/.test(e.src || '')).forEach((s) => (s.listeners.load || []).forEach((fn) => fn()));
    await flush();
  };
  return { head, flush, manifests, playArrives };
}
// The href the server writes for the same hub (renderHubPage with this payload), read out of its HTML.
function serverHref(payload) {
  const html = renderHubPage({ payload, token: TOKEN, origin: 'https://wq.example.test', assetV: 'abc123' });
  const m = /<link rel="manifest" href="([^"]+)">/.exec(html);
  return m ? m[1] : null;
}

describe('first open (locked render), then `play.install` from the unlock', () => {
  test('exactly one manifest link, the server\'s href (with ?kid=<chip>), still one after the hub redraws', async () => {
    const answer = { ...BOOTS.done, play: PLAY(true) };
    const p = firstOpen(answer);
    await p.flush();
    expect(p.manifests().map((e) => e.href)).toEqual([`/h/${TOKEN}/manifest.webmanifest?kid=${CHIP}`]);
    expect(p.manifests()[0].href).toBe(serverHref(answer));
    await p.playArrives();
    expect(p.manifests()).toHaveLength(1);
  });
  test('a chip that is not 16 hex: the link without ?kid, as the server writes it', async () => {
    const answer = { ...BOOTS.done, kid: 'not-a-chip', kids: [{ ...BOOTS.done.kids[0], chip: 'not-a-chip' }], play: PLAY(true) };
    const p = firstOpen(answer);
    await p.flush();
    expect(p.manifests().map((e) => e.href)).toEqual([`/h/${TOKEN}/manifest.webmanifest`]);
    expect(p.manifests()[0].href).toBe(serverHref(answer));
  });
  test.each([['install false', PLAY(false)], ['install absent', { first: false, doors: [], shelf: [] }], ['no play', undefined]])('%s: no manifest link', async (_n, play) => {
    const p = firstOpen({ ...BOOTS.done, ...(play ? { play } : {}) });
    await p.flush();
    expect(p.manifests()).toHaveLength(0);
    if (play) await p.playArrives();
    expect(p.manifests()).toHaveLength(0);
  });
  test('the page already has a manifest link: no second one', async () => {
    const p = firstOpen({ ...BOOTS.done, play: PLAY(true) }, { serverLink: `/h/${TOKEN}/manifest.webmanifest?kid=${CHIP}` });
    await p.flush();
    expect(p.manifests()).toHaveLength(1);
    expect(p.manifests()[0].server).toBe(true);
  });
});
