/**
 * The join page's own script (public/wq/join.js), run in a small stand-in for the browser: a page without the join
 * markup stays quiet; "Are you <name>?" offers EVERY same-named child the server names; "Let's go!" opens only for a
 * name the server accepts (letters of any script, a space, an apostrophe or a hyphen; ≤ 20 characters; ≤ 2 words).
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'join.js'), 'utf8');

function el(id, extra = {}) {
  const attrs = {};
  return { id, hidden: false, disabled: false, value: '', innerHTML: '', textContent: '', listeners: {},
    setAttribute(k, v) { attrs[k] = String(v); }, getAttribute(k) { return k in attrs ? attrs[k] : null },
    addEventListener(t, f) { this.listeners[t] = f; }, focus() {}, ...extra };
}

function run({ markup = true, boot = { view: 'join', t: 'tok', lang: 'en', practice: false, copy: { isYou: 'Are you {n}?', yesMe: "Yes, it's me", diff: "I'm a different {n}", noticeSave: 'S {n}', noticeReadings: 'R {n}' } } } = {}) {
  const els = {};
  if (markup) ['jn-name', 'jn-notice', 'jn-go', 'jn-out', 'jn-n1', 'jn-n2'].forEach((id) => { els[id] = el(id); });
  els.boot = el('boot', { textContent: JSON.stringify(boot) });
  const posts = [];
  let click = null;
  function XMLHttpRequest() { this.open = (m, p) => { this.path = p; }; this.setRequestHeader = () => {}; this.send = (b) => { posts.push({ path: this.path, body: JSON.parse(b), xhr: this }); }; }
  const document = {
    cookie: '', head: { appendChild() {} },
    getElementById: (id) => els[id] || null,
    querySelectorAll: () => [],
    createElement: () => ({}),
    addEventListener: (t, f) => { if (t === 'click') click = f; },
  };
  const store = new Map();
  const window = { crypto: { getRandomValues: (a) => { for (let i = 0; i < a.length; i++) a[i] = i * 7; return a; } } };
  const ctx = { document, window, XMLHttpRequest, location: { protocol: 'https:', replace() {}, href: '' }, setTimeout: () => 0,
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v) } };
  vm.runInNewContext(SRC, ctx);
  const tap = (attrs) => click({ target: { closest: () => ({ getAttribute: (k) => (k in attrs ? attrs[k] : null) }) } });
  const type = (v) => { els['jn-name'].value = v; els['jn-name'].listeners.input(); };
  return { els, posts, tap, type };
}

describe('join.js', () => {
  test('loaded on a page without the join markup: no error, no request', () => {
    let page;
    expect(() => { page = run({ markup: false }); }).not.toThrow();
    expect(page.posts).toHaveLength(0);
  });

  test('"Are you <name>?" offers every same-named child the server names, then "a different one"', () => {
    const p = run();
    p.tap({ 'data-tap': 'grade', 'data-grade': '3' });
    p.type('Sara');
    p.tap({ 'data-tap': 'go' });
    const join = p.posts.find((x) => x.path === '/api/wq/join');
    join.xhr.status = 200;
    join.xhr.responseText = JSON.stringify({ ask: 'is_this_you', kids: [{ chip: 'c1', first: 'Sara', animal: 'owl' }, { chip: 'c2', first: 'Sara', animal: 'cat' }] });
    join.xhr.onload();
    const html = p.els['jn-out'].innerHTML;
    expect(html.match(/data-tap="same"/g)).toHaveLength(2);
    expect(html).toContain('data-chip="c1"');
    expect(html).toContain('data-chip="c2"');
    expect(html.match(/data-tap="new"/g)).toHaveLength(1);
    // told apart by the animal the home shows for each
    expect(html).toContain('data-chip="c1">🦉 Yes, it&#39;s me</button>');
    expect(html).toContain('data-chip="c2">🐱 Yes, it&#39;s me</button>');
  });

  test('"Let\'s go!" opens exactly for the names the server accepts', () => {
    const p = run();
    p.tap({ 'data-tap': 'grade', 'data-grade': '2' });
    const opens = (v) => { p.type(v); return p.els['jn-go'].disabled === false; };
    ['Sara', 'Ali Raza', "D'Souza", 'Mary-Jane', 'سارہ', 'عائشہ بی'].forEach((n) => expect([n, opens(n)]).toEqual([n, true]));
    ['Sara!', 'Sara.', 'A1', 'Ali Raza Khan', 'x'.repeat(21), 'سارہ٣', '@sara', ' '].forEach((n) => expect([n, opens(n)]).toEqual([n, false]));
  });
});
