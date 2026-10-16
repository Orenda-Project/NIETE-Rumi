'use strict';
/**
 * A minimal DOM for running the maker page's REAL inline scripts in a `vm` context (no jsdom in node_modules).
 * It parses the server's own well-formed HTML into elements and supports exactly what those scripts touch:
 * getElementById, querySelector(All) with compound simple selectors (tag, #id, .class, [attr], [attr=v],
 * [attr="v"]) and comma lists, closest, attributes, `hidden`, `disabled`, `textContent`, `id`, document/window
 * click listeners, history.pushState, scrollTo, a recording `fetch`, and `navigator.sendBeacon` (absent).
 * Only the browser boundary is faked; the scripts run unchanged.
 */
const vm = require('vm');

const VOID = new Set(['meta', 'link', 'input', 'br', 'img', 'hr']);
const RAW = new Set(['script', 'style']);
const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

class El {
  constructor(tag, attrs, parent) { this.tagName = tag.toUpperCase(); this.attrs = attrs; this.parentNode = parent; this.children = []; this.text = ''; }
  getAttribute(n) { return Object.prototype.hasOwnProperty.call(this.attrs, n) ? this.attrs[n] : null; }
  setAttribute(n, v) { this.attrs[n] = String(v); }
  removeAttribute(n) { delete this.attrs[n]; }
  hasAttribute(n) { return Object.prototype.hasOwnProperty.call(this.attrs, n); }
  get id() { return this.getAttribute('id') || ''; }
  get hidden() { return this.hasAttribute('hidden'); }
  set hidden(v) { if (v) this.setAttribute('hidden', ''); else this.removeAttribute('hidden'); }
  get disabled() { return this.hasAttribute('disabled'); }
  set disabled(v) { if (v) this.setAttribute('disabled', ''); else this.removeAttribute('disabled'); }
  get textContent() { return this.text + this.children.map((c) => c.textContent).join(''); }
  set textContent(v) { this.children = []; this.text = String(v); }
  /** Element descendants in document order (text nodes skipped). */
  descendants() { return this.children.filter((c) => c.tagName !== '#TEXT').flatMap((c) => [c, ...c.descendants()]); }
  matches(sel) { return sel.split(',').map((s) => s.trim()).some((s) => matchCompound(this, s)); }
  closest(sel) { let e = this; while (e && e.tagName) { if (e.matches(sel)) return e; e = e.parentNode; } return null; }
  querySelectorAll(sel) { return this.descendants().filter((e) => e.matches(sel)); }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
}

function matchCompound(el, s) {
  const parts = s.match(/^[a-z0-9]+|#[\w-]+|\.[\w-]+|\[[^\]]+\]/gi) || [];
  if (parts.join('') !== s) throw new Error(`mini-dom: unsupported selector "${s}"`);
  return parts.every((p) => {
    if (p[0] === '#') return el.id === p.slice(1);
    if (p[0] === '.') return (el.getAttribute('class') || '').split(/\s+/).includes(p.slice(1));
    if (p[0] === '[') {
      const m = /^\[([\w-]+)(?:=("([^"]*)"|'([^']*)'|([^\]]*)))?\]$/.exec(p);
      if (!m) throw new Error(`mini-dom: unsupported attribute selector "${p}"`);
      if (!el.hasAttribute(m[1])) return false;
      if (m[2] === undefined) return true;
      const want = m[3] !== undefined ? m[3] : (m[4] !== undefined ? m[4] : m[5]);
      return el.getAttribute(m[1]) === want;
    }
    return el.tagName === p.toUpperCase();
  });
}

function parse(html) {
  const root = new El('#root', {}, null);
  let cur = root;
  const rx = /<!--[\s\S]*?-->|<!doctype[^>]*>|<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^\s=>]+(?:="[^"]*")?)*)\s*>|([^<]+)/gi;
  let m;
  while ((m = rx.exec(html))) {
    if (m[4] !== undefined) { cur.children.push(Object.assign(new El('#text', {}, cur), { text: decode(m[4]) })); continue; }
    if (!m[2]) continue;
    const tag = m[2].toLowerCase();
    if (m[1]) { if (cur.parentNode) cur = cur.parentNode; continue; }
    const attrs = {};
    (m[3] || '').replace(/([^\s=]+)(?:="([^"]*)")?/g, (_, k, v) => { attrs[k] = v === undefined ? '' : decode(v); return ''; });
    const el = new El(tag, attrs, cur);
    cur.children.push(el);
    if (RAW.has(tag)) {
      const end = html.indexOf(`</${tag}>`, rx.lastIndex);
      el.text = html.slice(rx.lastIndex, end);
      rx.lastIndex = end + tag.length + 3;
    } else if (!VOID.has(tag)) cur = el;
  }
  return root;
}
/**
 * Loads the page and runs every inline <script> (not the JSON block) in document order.
 * → { doc, posts: [{ path, body }], click(el), q(sel), all(sel) }.
 */
function loadPage(html) {
  const doc = parse(html);
  const posts = [];
  const docListeners = [];
  const winListeners = [];
  const document = {
    getElementById: (id) => doc.querySelector(`#${id}`),
    querySelector: (s) => doc.querySelector(s),
    querySelectorAll: (s) => doc.querySelectorAll(s),
    addEventListener: (type, fn) => { if (type === 'click') docListeners.push(fn); },
  };
  const window = {
    document,
    addEventListener: (type, fn) => winListeners.push({ type, fn }),
    scrollTo: () => {},
    history: { pushState: () => {} },
    navigator: {},
    fetch: (path, opts) => {
      posts.push({ path, body: JSON.parse(opts.body), keepalive: opts.keepalive });
      return Promise.resolve({ ok: true, status: 204, json: () => Promise.resolve({}) });
    },
    JSON, String, Array, Object, Promise, Number, Boolean, RegExp,
  };
  window.window = window;
  window.history = window.history;
  const ctx = vm.createContext(window);
  for (const s of doc.querySelectorAll('script')) {
    if (s.getAttribute('type')) continue;
    vm.runInContext(s.text, ctx);
  }
  const click = (el) => { const e = { target: el, preventDefault() {} }; docListeners.forEach((fn) => fn(e)); };
  return { doc, posts, click, q: (s) => doc.querySelector(s), all: (s) => doc.querySelectorAll(s), window };
}

module.exports = { loadPage, parse };
