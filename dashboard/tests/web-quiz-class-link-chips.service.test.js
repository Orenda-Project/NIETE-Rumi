/**
 * The class link's teacher step (/j/<code>, public/wq/class-link.js): two teachers whose names share a long prefix
 * must not print as the same chip. At 360 px "Samina Testwala — Teacher A" and "... — Teacher B" both cut to
 * "Samina Testw…" under the big chip's one-line ellipsis; the teacher chip wraps to a second line instead (the
 * technique the polished Urdu chips already use), so the word that tells them apart is on screen.
 *
 * A fresh profile (no storage) opens the real /j/<code> page from the real edge router; the page's own script runs
 * in a vm and its steps go through the real edge routes. The bot is the network boundary (a fake fetch). The chip's
 * style is the cascade of the shipped wq.css (postcss) over the chip's real ancestors, at 360 x 740.
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const vm = require('vm');
const crypto = require('crypto');
const express = require('express');
const postcss = require('postcss');
const selectorParser = require('postcss-selector-parser');
const { createWebQuizRouter } = require('../routes/web-quiz.routes');

const BOT = 'http://bot.test';
const KEY = 'test-internal-key';
const CODE = 'KZ7QW3MNPX';
const CSS = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'wq.css'), 'utf8');
const CLIENT = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'class-link.js'), 'utf8');
const VIEW = { width: 360, height: 740 };
const PROPS = ['white-space', 'text-overflow', 'overflow', 'overflow-wrap'];
const INHERITED = new Set(['white-space', 'overflow-wrap']);
const INITIAL = { 'white-space': 'normal', 'text-overflow': 'clip', overflow: 'visible', 'overflow-wrap': 'normal' };

// the Urdu short-name teacher step as the page draws it at sandbox (captured on the unchanged CSS; markup never depends on it)
const UR_SHORT = '<section class="wq-screen"><img class="wq-jugnu" src="/wq/jugnu/hello.webp" alt="" width="96" height="96"><h1>ٹیچر کا نام دبائیں</h1>'
  + '<div class="wq-kids-big"><button class="wq-kid wq-kid-big" data-tk="tk-a"><bdi>Amna</bdi></button></div></section>';
const TWO = [{ tk: 'tk-a', name: 'Samina Testwala — Teacher A' }, { tk: 'tk-b', name: 'Samina Testwala — Teacher B' }];

// ---- the edge, with the bot faked ----
function jsonRes(status, body) {
  return { status, ok: status >= 200 && status < 300, headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) }, text: async () => JSON.stringify(body) };
}
function start(app) { return new Promise((resolve) => { const srv = app.listen(0, () => resolve(srv)); }); }
function req(srv, method, p, body) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const r = http.request({ host: '127.0.0.1', port: srv.address().port, method, path: p,
      headers: { host: 'quiz.example.org', ...(data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}) } }, (res) => {
      let out = '';
      res.on('data', (c) => { out += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: out }));
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}
function edge({ lang, arrive }) {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, body: opts && opts.body ? JSON.parse(opts.body) : null });
    if (url.startsWith(`${BOT}/api/internal/wq/cl/${CODE}`)) return jsonRes(200, { lang });
    if (url === `${BOT}/api/internal/wq/cl/arrive`) return jsonRes(200, arrive);
    return jsonRes(404, { error: 'not_found' });
  };
  const app = express();
  app.set('trust proxy', 1);
  app.use(createWebQuizRouter({ botUrl: BOT, apiKey: KEY, fetchImpl, canonicalBase: '' }));
  return { app, calls };
}

/** A fresh profile opens /j/<code>: the real page, then its own script, whose fetches go to the real edge. */
async function openLink({ lang, arrive }) {
  const e = edge({ lang, arrive });
  const srv = await start(e.app);
  try {
    const page = await req(srv, 'GET', `/j/${CODE}`);
    expect(page.status).toBe(200);
    const boot = JSON.parse(page.body.match(/<script id="boot" type="application\/json">([\s\S]*?)<\/script>/)[1]);
    const htmlTag = page.body.match(/<html([^>]*)>/)[1];
    const root = { innerHTML: page.body.match(/<main id="wq"[^>]*>([\s\S]*?)<\/main>/)[1], querySelectorAll: () => [] };
    const store = new Map(); // a fresh profile: nothing stored
    let done;
    const settled = new Promise((r) => { done = r; });
    const ctx = {
      document: { getElementById: (id) => (id === 'wq' ? root : id === 'boot' ? { textContent: JSON.stringify(boot) } : null) },
      localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) },
      location: { href: `https://quiz.example.org/j/${CODE}` },
      fetch: async (url, opts) => {
        const r = await req(srv, opts.method, url, JSON.parse(opts.body));
        setTimeout(done, 20);
        return { ok: r.status >= 200 && r.status < 300, json: async () => JSON.parse(r.body) };
      },
    };
    ctx.window = { crypto: crypto.webcrypto };
    vm.createContext(ctx);
    vm.runInContext(CLIENT, ctx);
    await settled;
    return { htmlTag, html: root.innerHTML, calls: e.calls, store };
  } finally {
    await new Promise((r) => srv.close(r));
  }
}

// ---- a small HTML tree (the page's own markup: tags, attributes, text) ----
const VOID = new Set(['img', 'input', 'br', 'meta', 'link']);
function attrsOf(s) {
  const a = {};
  s.replace(/([a-zA-Z_:][-a-zA-Z0-9_:]*)(?:="([^"]*)")?/g, (m, k, v) => { a[k] = v === undefined ? '' : v; return m; });
  return a;
}
function tree(htmlTagAttrs, inner) {
  const html = { tag: 'html', attrs: attrsOf(htmlTagAttrs), children: [], parent: null };
  const body = { tag: 'body', attrs: {}, children: [], parent: html };
  const main = { tag: 'main', attrs: { id: 'wq', class: 'wq-app' }, children: [], parent: body };
  html.children.push(body); body.children.push(main);
  let cur = main;
  const rx = /<(\/?)([a-zA-Z0-9]+)([^>]*)>|([^<]+)/g;
  let m;
  while ((m = rx.exec(inner))) {
    if (m[4] !== undefined) { cur.children.push({ text: m[4] }); continue; }
    if (m[1]) { cur = cur.parent; continue; }
    const el = { tag: m[2].toLowerCase(), attrs: attrsOf(m[3]), children: [], parent: cur };
    cur.children.push(el);
    if (!VOID.has(el.tag)) cur = el;
  }
  return html;
}
function all(node, pred, out = []) {
  for (const c of node.children || []) { if (c.tag && pred(c)) out.push(c); all(c, pred, out); }
  return out;
}
const textOf = (n) => (n.text !== undefined ? n.text : (n.children || []).map(textOf).join(''));
const classes = (el) => (el.attrs.class || '').split(/\s+/).filter(Boolean);

// ---- the cascade of wq.css over an element ----
function matchesCompound(nodes, el) {
  for (const n of nodes) {
    if (n.type === 'tag' && n.value.toLowerCase() !== el.tag) return false;
    if (n.type === 'class' && !classes(el).includes(n.value)) return false;
    if (n.type === 'id' && el.attrs.id !== n.value) return false;
    if (n.type === 'attribute') {
      if (!(n.attribute in el.attrs)) return false;
      if (n.operator === '=' && el.attrs[n.attribute] !== n.value) return false;
      if (n.operator && n.operator !== '=') return false;
    }
    if (n.type === 'pseudo') {
      if (n.value !== ':not') return false; // :hover, ::before, ... : not the element at rest
      if (n.nodes.some((s) => matchesCompound(s.nodes, el))) return false;
    }
  }
  return true;
}
function matches(sel, el) {
  // compounds right to left, with the combinator before each
  const parts = [[]];
  const combs = [];
  sel.nodes.forEach((n) => { if (n.type === 'combinator') { combs.push(n.value.trim() || ' '); parts.push([]); } else parts[parts.length - 1].push(n); });
  const walk = (i, node) => {
    if (!node || !node.tag || !matchesCompound(parts[i], node)) return false;
    if (i === 0) return true;
    const c = combs[i - 1];
    if (c === '>') return walk(i - 1, node.parent);
    if (c === ' ') { for (let p = node.parent; p && p.tag; p = p.parent) if (walk(i - 1, p)) return true; return false; }
    return false; // + and ~ are not used on these chips
  };
  return walk(parts.length - 1, el);
}
function specificity(sel) {
  let a = 0; let b = 0; let c = 0;
  sel.walk((n) => {
    if (n.type === 'id') a += 1;
    else if (n.type === 'class' || n.type === 'attribute' || (n.type === 'pseudo' && n.value !== ':not' && !n.value.startsWith('::'))) b += 1;
    else if (n.type === 'tag' || (n.type === 'pseudo' && n.value.startsWith('::'))) c += 1;
  });
  return a * 1e6 + b * 1e3 + c;
}
function mediaOn(params) {
  return params.split(',').some((q) => {
    const feats = [...q.matchAll(/\(([a-z-]+)\s*:\s*([^)]+)\)/g)];
    if (!feats.length) return /^\s*(all|screen)\s*$/.test(q);
    return feats.every(([, f, v]) => {
      const px = parseFloat(v);
      if (f === 'max-width') return VIEW.width <= px;
      if (f === 'min-width') return VIEW.width >= px;
      if (f === 'max-height') return VIEW.height <= px;
      if (f === 'min-height') return VIEW.height >= px;
      return false; // prefers-reduced-motion and the like: off on the render this test models
    });
  });
}
const RULES = (() => {
  const out = [];
  let order = 0;
  postcss.parse(CSS).walkRules((rule) => {
    for (let p = rule.parent; p && p.type !== 'root'; p = p.parent) {
      if (p.type === 'atrule' && (p.name !== 'media' || !mediaOn(p.params))) return;
    }
    const decls = {};
    rule.each((d) => { if (d.type === 'decl' && PROPS.includes(d.prop)) decls[d.prop] = { value: d.value, important: Boolean(d.important) }; });
    if (!Object.keys(decls).length) return;
    selectorParser((root) => { root.each((sel) => out.push({ sel, spec: specificity(sel), order: order++, decls, text: String(sel).trim() })); }).processSync(rule.selector);
  });
  return out;
})();
function computed(el) {
  if (!el || !el.tag) return { ...INITIAL };
  const parent = computed(el.parent);
  const win = {};
  RULES.filter((r) => matches(r.sel, el)).forEach((r) => {
    Object.entries(r.decls).forEach(([p, d]) => {
      const rank = [d.important ? 1 : 0, r.spec, r.order];
      const cur = win[p];
      if (!cur || rank[0] > cur.rank[0] || (rank[0] === cur.rank[0] && (rank[1] > cur.rank[1] || (rank[1] === cur.rank[1] && rank[2] > cur.rank[2])))) win[p] = { value: d.value, rank };
    });
  });
  const out = {};
  PROPS.forEach((p) => { out[p] = win[p] ? win[p].value : INHERITED.has(p) ? parent[p] : INITIAL[p]; });
  return out;
}

function chipNames(view, sel) {
  const doc = tree(view.htmlTag, view.html);
  return all(doc, (el) => el.tag === 'button' && sel(el)).map((b) => all(b, (e) => e.tag === 'bdi')[0]);
}

describe('the teacher step on a fresh profile', () => {
  test('two teachers sharing a long prefix: each chip shows its whole name (wraps), never one ellipsis line', async () => {
    const v = await openLink({ lang: 'en', arrive: { step: 'teacher', s: 'st1', teachers: TWO } });
    // a fresh profile: the page minted its device_ref and sent it in the body only; no preview token
    const arrive = v.calls.find((c) => c.url === `${BOT}/api/internal/wq/cl/arrive`);
    expect(arrive.body.device_ref).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(arrive.body.jt).toBeUndefined();
    expect(v.htmlTag).toContain('lang="en"');
    const bdis = chipNames(v, (b) => 'data-tk' in b.attrs);
    expect(bdis.map(textOf)).toEqual(TWO.map((t) => t.name));
    for (const bdi of bdis) {
      const s = computed(bdi);
      expect(s['white-space']).not.toBe('nowrap');
      expect(s['text-overflow']).not.toBe('ellipsis');
      expect(s.overflow).not.toBe('hidden');
      expect(s['overflow-wrap']).toBe('anywhere'); // a long single word breaks inside the chip, never past its edge
    }
  });

  test('golden: a short teacher name\'s chip markup is unchanged', async () => {
    const v = await openLink({ lang: 'en', arrive: { step: 'teacher', s: 'st1', teachers: [{ tk: 'tk-a', name: 'Amna' }] } });
    expect(v.html).toBe('<section class="wq-screen"><img class="wq-jugnu" src="/wq/jugnu/hello.webp" alt="" width="96" height="96"><h1>Tap your teacher&#39;s name</h1>'
      + '<div class="wq-kids-big"><button class="wq-kid wq-kid-big" data-tk="tk-a"><bdi>Amna</bdi></button></div></section>');
  });
});

describe('golden: everything but the teacher chip keeps its style', () => {
  const BEFORE_CHILD = { 'white-space': 'nowrap', 'text-overflow': 'ellipsis', overflow: 'hidden', 'overflow-wrap': 'normal' };
  test('child chips ("Whose turn?" and "Is your name here?") keep the one-line ellipsis', async () => {
    const who = await openLink({ lang: 'en', arrive: { step: 'who', s: 'st1', kids: [{ chip: 'c1', first: 'Asha', animal: 'owl' }] } });
    const here = await openLink({ lang: 'en', arrive: { step: 'chips', s: 'st1', kids: [{ chip: 'c2', first: 'Bilal' }] } });
    for (const v of [who, here]) {
      const bdis = chipNames(v, (b) => 'data-chip' in b.attrs);
      expect(bdis).toHaveLength(1);
      expect(computed(bdis[0])).toEqual(BEFORE_CHILD);
    }
  });

  test('golden: a short teacher name\'s chip markup in Urdu is unchanged', async () => {
    const v = await openLink({ lang: 'ur', arrive: { step: 'teacher', s: 'st1', teachers: [{ tk: 'tk-a', name: 'Amna' }] } });
    expect(v.html).toBe(UR_SHORT);
  });
});

describe('the teacher step in Urdu (lang=ur, dir=rtl)', () => {
  test('two teachers sharing a long prefix: the plain and the polished Urdu chip both wrap, never one ellipsis line', async () => {
    const v = await openLink({ lang: 'ur', arrive: { step: 'teacher', s: 'st1', teachers: TWO } });
    expect(v.htmlTag).toContain('lang="ur"');
    expect(v.htmlTag).toContain('dir="rtl"');
    const plain = chipNames(v, (b) => 'data-tk' in b.attrs);
    const polished = chipNames({ ...v, htmlTag: ' lang="ur" dir="rtl" class="wq-ur2"' }, (b) => 'data-tk' in b.attrs);
    for (const bdis of [plain, polished]) {
      // the Latin name stays inside its own <bdi> (direction isolated in the RTL chip), as the child chips do
      expect(bdis.map(textOf)).toEqual(TWO.map((t) => t.name));
      for (const bdi of bdis) {
        expect(computed(bdi)).toEqual({ 'white-space': 'normal', 'text-overflow': 'clip', overflow: 'visible', 'overflow-wrap': 'anywhere' });
      }
    }
  });

  test('Urdu child chips keep the one-line ellipsis (plain look)', async () => {
    const who = await openLink({ lang: 'ur', arrive: { step: 'who', s: 'st1', kids: [{ chip: 'c1', first: 'Asha', animal: 'owl' }] } });
    const bdis = chipNames(who, (b) => 'data-chip' in b.attrs);
    expect(bdis).toHaveLength(1);
    expect(computed(bdis[0])).toEqual({ 'white-space': 'nowrap', 'text-overflow': 'ellipsis', overflow: 'hidden', 'overflow-wrap': 'normal' });
  });
});
