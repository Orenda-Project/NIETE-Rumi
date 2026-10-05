/**
 * Shared harness for the web quiz page tests (public/wq/wq.js + wq.css).
 *
 * Runs the WHOLE shipped page in a vm with a small fake DOM (no jsdom in this package), so each
 * test executes the real render code. The only change to the source is one line that hands the
 * screen functions back to the test.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const WQ = path.join(__dirname, '..', 'public', 'wq');
const SRC = fs.readFileSync(path.join(WQ, 'wq.js'), 'utf8');
const CSS = fs.readFileSync(path.join(WQ, 'wq.css'), 'utf8');
const TAIL = '  else landing();\n})();';

function fakeEl(sel) {
  return {
    sel, listeners: {}, attrs: {}, style: {}, textContent: '', parentNode: null,
    addEventListener(n, fn) { (this.listeners[n] = this.listeners[n] || []).push(fn); },
    fire(n, e) { (this.listeners[n] || []).forEach((fn) => fn(e || {})); },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return this.attrs[k]; },
    removeAttribute(k) { delete this.attrs[k]; },
    appendChild() {}, removeChild() {}, pause() { this.paused = true; },
    play() { this.played = (this.played || 0) + 1; return Promise.resolve(); },
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    focus() {},
  };
}

function page({ lang = 'ur', cls = { label: 'Class 3-B', teacher: 'Ms Testwala', chips: [] }, store = {}, video = null, board = null, me = null, topic = 'Plants' } = {}) {
  const els = {};
  const root = fakeEl('#wq');
  root.innerHTML = '';
  root.querySelector = (sel) => {
    if (!els[sel]) els[sel] = fakeEl(sel);
    return els[sel];
  };
  root.querySelectorAll = () => [];
  const boot = {
    textContent: JSON.stringify({
      code: 'TEST', cls, live: {}, video,
      quiz: { code: 'TEST', lang, topic, grade: 3, questions: [{ qid: 'q1', text: 'a?', options: [{ slot: 'A', text: 'x' }], correct_slot: 'A' }] },
    }),
  };
  const ls = new Map(Object.entries(store).map(([k, v]) => [k, JSON.stringify(v)]));
  const fetches = [];
  const ctx = {
    console,
    document: {
      getElementById: (id) => (id === 'boot' ? boot : id === 'wq' ? root : null),
      createElement: () => fakeEl('new'), addEventListener() {}, body: fakeEl('body'), visibilityState: 'visible',
    },
    location: { search: '', origin: 'https://example.test' },
    navigator: { userAgent: 'test' },
    localStorage: { setItem: (k, v) => ls.set(k, String(v)), getItem: (k) => (ls.has(k) ? ls.get(k) : null), removeItem: (k) => ls.delete(k) },
    fetch: (url, init) => {
      fetches.push({ url, init });
      const body = (url.indexOf('/board/') >= 0 && board) || (url.endsWith('/me') && me) || {};
      return Promise.resolve({ status: 200, ok: true, text: () => Promise.resolve(JSON.stringify(body)) });
    },
    URLSearchParams,
    setInterval: () => 0, setTimeout: () => 0, clearTimeout() {},
    scrollTo() {}, addEventListener() {},
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(SRC.replace(TAIL, '  else landing();\n  window.__wq = { who: who, card: card, board: board, video: video, isThisYou: isThisYou, history: history };\n})();'), ctx);
  return { ctx, root, els, fetches, wq: ctx.__wq, html: () => root.innerHTML };
}
const flush = () => new Promise((r) => setImmediate(r));
module.exports = { page, rule, flush, SRC, CSS, TAIL };

function rule(selector) {
  const i = CSS.indexOf(`\n${selector}{`);
  if (i < 0) return null;
  return CSS.slice(i + selector.length + 2, CSS.indexOf('}', i));
}

