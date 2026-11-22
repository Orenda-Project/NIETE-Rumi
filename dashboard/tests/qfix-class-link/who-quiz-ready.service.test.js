/**
 * "Whose turn?" on the standing link (/j/<code>, public/wq/class-link.js) draws the "Quiz ready" badge on the chip of
 * each child the bot marks { round: true } (tonight's class quiz is waiting; PLAN §11 A12/A14, take A), in the
 * page's language, and on no other chip. With nobody marked (the switch off) the step is exactly as before.
 * The real page from the real edge router; the page's script runs in a vm; the bot is faked at the network boundary.
 */
const http = require('http');
const vm = require('vm');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const { createWebQuizRouter } = require('../../routes/web-quiz.routes');

const CLIENT = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'wq', 'class-link.js'), 'utf8');
const BOT = 'http://bot.test';
const KEY = 'test-internal-key';
const CODE = 'KZ7QW3MNPX';


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


const KIDS = [
  { chip: 'ch-zara', first: 'Zara', animal: 'cat', round: true },
  { chip: 'ch-ali', first: 'Ali', animal: 'dog' },
];
const chipHtml = (html, chip) => {
  const m = new RegExp(`<button[^>]*data-chip="${chip}"[^>]*>([\\s\\S]*?)</button>`).exec(html);
  return m ? m[1] : null;
};

test('EN: the marked child\'s chip carries "Quiz ready"; the other chip does not', async () => {
  const { html } = await openLink({ lang: 'en', arrive: { ok: true, step: 'who', s: 'st', kids: KIDS } });
  expect(chipHtml(html, 'ch-zara')).toContain('Quiz ready');
  expect(chipHtml(html, 'ch-zara')).toMatch(/class="wq-chip wq-cl-ready"/);
  expect(chipHtml(html, 'ch-ali')).not.toContain('wq-cl-ready');
});

test('UR: the badge is «کوئز تیار»', async () => {
  const { html } = await openLink({ lang: 'ur', arrive: { ok: true, step: 'who', s: 'st', kids: KIDS } });
  expect(chipHtml(html, 'ch-zara')).toContain('کوئز تیار');
  expect(html).not.toContain('Quiz ready');
});

test('nobody marked: no badge anywhere', async () => {
  const { html } = await openLink({ lang: 'en', arrive: { ok: true, step: 'who', s: 'st', kids: KIDS.map(({ round, ...k }) => k) } });
  expect(html).not.toContain('wq-cl-ready');
  expect(chipHtml(html, 'ch-zara')).toContain('Zara');
});

test('the badge lifts copy.v2.json qfix_class_link.quiz_ready byte for byte and leaves the chip its own size (>= 48 px)', async () => {
  const DECK = require('../../../bot/shared/config/copy.v2.json');
  for (const lang of ['en', 'ur']) {
    const { html } = await openLink({ lang, arrive: { ok: true, step: 'who', s: 'st', kids: KIDS } });
    expect(chipHtml(html, 'ch-zara')).toContain(`<span class="wq-chip wq-cl-ready">${DECK['qfix_class_link.quiz_ready'][lang]}</span>`);
    // the marked chip is the same button as an unmarked one (same classes); the badge sits inside it
    const tag = (chip) => new RegExp(`<button([^>]*)data-chip="${chip}"`).exec(html)[1];
    expect(tag('ch-zara')).toBe(tag('ch-ali'));
  }
  // no rule for the badge or its wrapper sizes the chip or takes the badge out of the flow (wq.css)
  const css = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'wq', 'wq.css'), 'utf8');
  const rules = [...css.matchAll(/([^{}]*\.wq-cl-(?:nm|ready)[^{}]*)\{([^}]*)\}/g)];
  expect(rules.length).toBeGreaterThan(0);
  for (const [, sel, body] of rules) {
    expect(sel).not.toMatch(/\.wq-kid/);
    expect(body).not.toMatch(/(^|;)\s*(min-height|max-height|height|position|pointer-events)\s*:/);
  }
  // the chip's own floor stays the big chip's 72 px
  expect(css).toMatch(/\.wq-kid-big\{min-height:72px/);
});
