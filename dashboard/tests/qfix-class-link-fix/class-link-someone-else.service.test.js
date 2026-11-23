/**
 * The class link's "Whose turn?" (/j/<code>, public/wq/class-link.js) on a shared phone: when the bot's answer carries
 * an `other` teacher step, the page draws a "someone else" button under the remembered children; tapping it shows that
 * teacher step (no round trip), and a teacher tap from there posts that step's own token. The button is a full-size
 * button (>= 48 px tall at 360 x 740 in every look the page can wear), worded as the hub's own "Whose turn?" does it
 * (copy.v2.json jg.who.someone_else).
 *
 * The real /j/<code> page from the real edge router; its own script runs in a vm, its fetches go through the real edge
 * routes, and the bot is the network boundary (a fake fetch). The button's size is the cascade of the shipped wq.css.
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const vm = require('vm');
const crypto = require('crypto');
const express = require('express');
const postcss = require('postcss');
const selectorParser = require('postcss-selector-parser');
const { createWebQuizRouter } = require('../../routes/web-quiz.routes');

const BOT = 'http://bot.test';
const KEY = 'test-internal-key';
const CODE = 'KZ7QW3MNPX';
const WQ = path.join(__dirname, '..', '..', 'public', 'wq');
const CSS = fs.readFileSync(path.join(WQ, 'wq.css'), 'utf8');
const CLIENT = fs.readFileSync(path.join(WQ, 'class-link.js'), 'utf8');
const COPY = require('../../../bot/shared/config/copy.v2.json');

const OTHER = { step: 'teacher', s: 'st-other', teachers: [{ tk: 'tk-a', name: 'Rabia Testwala' }, { tk: 'tk-b', name: 'Imran Testwala' }] };
const WHO = { step: 'who', s: 'st-who', kids: [{ chip: 'c1', first: 'Hina', animal: 'owl' }], other: OTHER };
const LETTER = { step: 'letter', script: 'latin', letters: ['A', 'B'], s: 'st-letter' };

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

/** The page, opened on a phone; `click(selector)` taps the first button the page drew that matches. */
async function openLink({ lang, arrive }) {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, body: opts && opts.body ? JSON.parse(opts.body) : null });
    if (url.startsWith(`${BOT}/api/internal/wq/cl/${CODE}`)) return jsonRes(200, { lang });
    if (url === `${BOT}/api/internal/wq/cl/arrive`) return jsonRes(200, arrive);
    if (url === `${BOT}/api/internal/wq/cl/teacher`) return jsonRes(200, LETTER);
    return jsonRes(404, { error: 'not_found' });
  };
  const app = express();
  app.set('trust proxy', 1);
  app.use(createWebQuizRouter({ botUrl: BOT, apiKey: KEY, fetchImpl, canonicalBase: '' }));
  const srv = await start(app);
  const page = await req(srv, 'GET', `/j/${CODE}`);
  expect(page.status).toBe(200);
  const boot = JSON.parse(page.body.match(/<script id="boot" type="application\/json">([\s\S]*?)<\/script>/)[1]);
  const htmlTag = page.body.match(/<html([^>]*)>/)[1];
  // Every button the page draws (its own markup): its attributes, and the click listeners the page added to it.
  let buttons = [];
  const root = {
    _html: '',
    get innerHTML() { return this._html; },
    set innerHTML(v) {
      this._html = v;
      buttons = [...v.matchAll(/<button([^>]*)>/g)].map((m) => {
        const attrs = {};
        m[1].replace(/([a-zA-Z_:][-a-zA-Z0-9_:]*)(?:="([^"]*)")?/g, (x, k, val) => { attrs[k] = val === undefined ? '' : val; return x; });
        return { attrs, fns: [], getAttribute: (k) => (k in attrs ? attrs[k] : null), addEventListener(t, fn) { if (t === 'click') this.fns.push(fn); } };
      });
    },
    querySelectorAll: (sel) => buttons.filter((b) => (sel[0] === '#' ? b.attrs.id === sel.slice(1) : sel[0] === '[' ? sel.slice(1, -1) in b.attrs : false)),
  };
  let pending = 0;
  const settle = () => new Promise((r) => { const tick = () => (pending ? setTimeout(tick, 5) : setTimeout(r, 20)); tick(); });
  const ctx = {
    document: { getElementById: (id) => (id === 'wq' ? root : id === 'boot' ? { textContent: JSON.stringify(boot) } : null) },
    localStorage: { getItem: () => null, setItem: () => {} },
    location: { href: `https://quiz.example.org/j/${CODE}` },
    fetch: async (url, opts) => {
      pending += 1;
      try {
        const r = await req(srv, opts.method, url, JSON.parse(opts.body));
        return { ok: r.status >= 200 && r.status < 300, json: async () => JSON.parse(r.body) };
      } finally { pending -= 1; }
    },
  };
  ctx.window = { crypto: crypto.webcrypto };
  vm.createContext(ctx);
  vm.runInContext(CLIENT, ctx);
  await settle();
  return {
    htmlTag,
    calls,
    html: () => root.innerHTML,
    buttons: () => buttons,
    click: async (sel) => { const b = root.querySelectorAll(sel)[0]; expect(b).toBeTruthy(); b.fns.forEach((fn) => fn()); await settle(); },
    close: () => new Promise((r) => srv.close(r)),
  };
}

// ---- the cascade of wq.css for a button's min-height / height (the button's real ancestors) ----
const PROPS = ['min-height', 'height'];
const VIEW = { width: 360, height: 740 };
const ROOT_VARS = (() => {
  const vars = {};
  postcss.parse(CSS).walkRules((r) => { if (r.selector.trim() === ':root' && r.parent.type === 'root') r.walkDecls((d) => { if (d.prop.startsWith('--')) vars[d.prop] = d.value.trim(); }); });
  return vars;
})();
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
      return false;
    });
  });
}
const classes = (el) => (el.attrs.class || '').split(/\s+/).filter(Boolean);
function matchesCompound(nodes, el) {
  for (const n of nodes) {
    if (n.type === 'tag' && n.value.toLowerCase() !== el.tag) return false;
    if (n.type === 'universal') continue;
    if (n.type === 'class' && !classes(el).includes(n.value)) return false;
    if (n.type === 'id' && el.attrs.id !== n.value) return false;
    if (n.type === 'attribute') {
      if (!(n.attribute in el.attrs)) return false;
      if (n.operator === '=' && el.attrs[n.attribute] !== n.value) return false;
      if (n.operator === '*=' && !String(el.attrs[n.attribute]).includes(n.value)) return false;
      if (n.operator && n.operator !== '=' && n.operator !== '*=') return false;
    }
    if (n.type === 'pseudo') {
      if (n.value !== ':not') return false;
      if (n.nodes.some((s) => matchesCompound(s.nodes, el))) return false;
    }
  }
  return true;
}
function matches(sel, el) {
  const parts = [[]];
  const combs = [];
  sel.nodes.forEach((n) => { if (n.type === 'combinator') { combs.push(n.value.trim() || ' '); parts.push([]); } else parts[parts.length - 1].push(n); });
  const walk = (i, node) => {
    if (!node || !node.tag || !matchesCompound(parts[i], node)) return false;
    if (i === 0) return true;
    const c = combs[i - 1];
    if (c === '>') return walk(i - 1, node.parent);
    if (c === ' ') { for (let p = node.parent; p && p.tag; p = p.parent) if (walk(i - 1, p)) return true; return false; }
    return false;
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
const RULES = (() => {
  const out = [];
  let order = 0;
  postcss.parse(CSS).walkRules((rule) => {
    for (let p = rule.parent; p && p.type !== 'root'; p = p.parent) if (p.type === 'atrule' && (p.name !== 'media' || !mediaOn(p.params))) return;
    const decls = {};
    rule.each((d) => { if (d.type === 'decl' && PROPS.includes(d.prop)) decls[d.prop] = { value: d.value, important: Boolean(d.important) }; });
    if (!Object.keys(decls).length) return;
    selectorParser((r) => { r.each((sel) => { if (!/::?(hover|active|focus|before|after|disabled)/.test(String(sel))) out.push({ sel, spec: specificity(sel), order: order++, decls }); }); }).processSync(rule.selector);
  });
  return out;
})();
const px = (v) => {
  if (!v) return 0;
  const s = String(v).trim().replace(/var\((--[a-z0-9-]+)\)/gi, (m, k) => ROOT_VARS[k] || '0');
  return /^[\d.]+px$/.test(s) ? parseFloat(s) : 0;
};
/** The rendered height floor of a button: max(min-height, height) as the cascade resolves them. */
function heightFloor(htmlAttrs, buttonAttrs) {
  const html = { tag: 'html', attrs: htmlAttrs, parent: null };
  const body = { tag: 'body', attrs: {}, parent: html };
  const main = { tag: 'main', attrs: { id: 'wq', class: 'wq-app' }, parent: body };
  const section = { tag: 'section', attrs: { class: 'wq-screen' }, parent: main };
  const el = { tag: 'button', attrs: buttonAttrs, parent: section };
  const win = {};
  RULES.filter((r) => matches(r.sel, el)).forEach((r) => {
    Object.entries(r.decls).forEach(([p, d]) => {
      const rank = [d.important ? 1 : 0, r.spec, r.order];
      const cur = win[p];
      if (!cur || rank[0] > cur.rank[0] || (rank[0] === cur.rank[0] && (rank[1] > cur.rank[1] || (rank[1] === cur.rank[1] && rank[2] > cur.rank[2])))) win[p] = { value: d.value, rank };
    });
  });
  return Math.max(px(win['min-height'] && win['min-height'].value), px(win.height && win.height.value));
}

describe('"Whose turn?" on a shared phone', () => {
  test.each(['en', 'ur'])('%s: a "someone else" button under the children opens the teacher step, and a teacher tap posts its token', async (lang) => {
    const v = await openLink({ lang, arrive: WHO });
    try {
      const other = v.buttons().find((b) => b.attrs.id === 'wq-cl-other');
      expect(other).toBeTruthy();
      expect(v.html()).toContain(`>${COPY['jg.who.someone_else'][lang].replace(/'/g, '&#39;')}</button>`);
      // the children first, the door for someone else after them
      expect(v.html().indexOf('data-chip="c1"')).toBeLessThan(v.html().indexOf('id="wq-cl-other"'));
      const arrives = v.calls.filter((c) => c.url.endsWith('/cl/arrive')).length;
      await v.click('#wq-cl-other');
      // the teacher step, drawn from the answer the page already holds (no new arrive)
      expect(v.calls.filter((c) => c.url.endsWith('/cl/arrive')).length).toBe(arrives);
      expect(v.buttons().filter((b) => 'data-tk' in b.attrs).map((b) => b.attrs['data-tk'])).toEqual(['tk-a', 'tk-b']);
      expect(v.buttons().some((b) => 'data-chip' in b.attrs)).toBe(false);
      await v.click('[data-tk]');
      const t = v.calls.find((c) => c.url === `${BOT}/api/internal/wq/cl/teacher`);
      expect(t.body).toMatchObject({ code: CODE, s: 'st-other', tk: 'tk-a' });
      expect(v.buttons().filter((b) => 'data-l' in b.attrs).map((b) => b.attrs['data-l'])).toEqual(['A', 'B']);
    } finally { await v.close(); }
  });

  test('the button is at least 48 px tall in every look the page can wear', async () => {
    const v = await openLink({ lang: 'en', arrive: WHO });
    try {
      const other = v.buttons().find((b) => b.attrs.id === 'wq-cl-other');
      expect(other).toBeTruthy();
      for (const html of [{ lang: 'en' }, { lang: 'ur', dir: 'rtl' }, { lang: 'en', class: 'wq-1b' }, { lang: 'ur', dir: 'rtl', class: 'wq-1b' },
        { lang: 'ur', dir: 'rtl', class: 'wq-ur2' }, { lang: 'ur', dir: 'rtl', class: 'wq-ur2 wq-1b' }]) {
        expect(heightFloor(html, other.attrs)).toBeGreaterThanOrEqual(48);
      }
    } finally { await v.close(); }
  });

  test('golden: with no `other` in the answer, "Whose turn?" is drawn exactly as before', async () => {
    const v = await openLink({ lang: 'en', arrive: { ...WHO, other: null } });
    try {
      expect(v.html()).toBe('<section class="wq-screen"><img class="wq-jugnu" src="/wq/jugnu/hello.webp" alt="" width="96" height="96"><h1>Whose turn?</h1>'
        + '<div class="wq-kids-big"><button class="wq-kid wq-kid-big" data-chip="c1"><span class="wq-ani" aria-hidden="true">🦉</span><bdi>Hina</bdi></button></div></section>');
    } finally { await v.close(); }
  });
});
