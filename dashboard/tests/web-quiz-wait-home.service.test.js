/**
 * Home drawn at once on a return to the hub in the same tab (app_settings web_quiz_wait_home; the bot's hub answer says
 * `wait_home: true`, only with the designed wait on; the edge learns it from the last hub answer, like the bar).
 *   - hub.js keeps Home as the child last saw it (this hub, this tab: sessionStorage), when the page is left from Home
 *     and a little after Home is drawn; never a door, a story or a locked or practice hub.
 *   - On, the streamed page's early frame carries one small inline script: a kept Home for this hub (under 10 minutes
 *     old, the same language, the same child) is drawn at once, inert, with the bar still running. When the hub answer
 *     lands, hub.js draws the real Home over it and makes it live again. A new stamp shows from that answer.
 *   - Off: nothing is kept, nothing is added, every page is today's.
 * The edge is served with a stood-in bot; the scripts run in a vm over a small fake DOM. Invented children only.
 */
const fs = require('fs');
const http = require('http');
const path = require('path');
const vm = require('vm');
const express = require('express');
const { createWebQuizRouter } = require('../routes/web-quiz.routes');
const WaitUx = require('../routes/web-quiz-wait-ux');

const TOKEN = 'eyJrIjoiaCIsImlkcyI6WyJhIl0sImV4cCI6OTk5OTk5OTk5OX0.AbCdEfGhIjKlMnOpQrStUv';
const KID = '0000000000000001';
const KID2 = '0000000000000002';
const HUBANS = (extra = {}) => ({ lang: 'en', token: TOKEN, kids: [{ chip: KID, first: 'Zara Testwala', animal: 'owl', grade: '3' }], kid: KID, rt: false, ...extra });
const jsonRes = (status, body) => ({ status, ok: status < 400, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
const get = (srv, p) => new Promise((res, rej) => {
  http.get({ port: srv.address().port, path: p, headers: { 'accept-language': 'en' } }, (r) => { let b = ''; r.on('data', (c) => { b += c; }); r.on('end', () => res(b)); }).on('error', rej);
});
async function serve(answers, fn) {
  const q = answers.slice();
  const app = express();
  app.use(createWebQuizRouter({ botUrl: 'http://bot.test', apiKey: 'k', fetchImpl: async () => jsonRes(200, q.length > 1 ? q.shift() : q[0]), logEvent: () => {} }));
  const srv = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  try { return await fn(srv); } finally { await new Promise((r) => srv.close(r)); }
}
const inline = (html) => (html.match(/<script>\(function\(d,w\)\{try\{var s=w\.sessionStorage[\s\S]*?<\/script>/g) || []);

describe('the edge learns the switch from the hub answer', () => {
  test('on: the next streamed page carries the kept-Home script once, after the frame and before the boot JSON', async () => {
    await serve([HUBANS({ fast: true, wait_ux: true, wait_home: true })], async (srv) => {
      await get(srv, `/h/${TOKEN}`);
      const html = await get(srv, `/h/${TOKEN}`);
      expect(inline(html)).toHaveLength(1);
      expect(html.indexOf(inline(html)[0])).toBeGreaterThan(html.indexOf('</main>'));
      expect(html.indexOf(inline(html)[0])).toBeLessThan(html.indexOf('<script id="boot"'));
      expect(inline(html)[0]).toContain(JSON.stringify(`wq_home:${TOKEN}`));
    });
  });
  test.each([['wait_home without wait_ux', { wait_home: true }], ['wait_ux alone', { wait_ux: true }], ['wait_home not true', { wait_ux: true, wait_home: 'true' }]])('%s: no script', async (_n, extra) => {
    await serve([HUBANS({ fast: true, ...extra })], async (srv) => {
      await get(srv, `/h/${TOKEN}`);
      const html = await get(srv, `/h/${TOKEN}`);
      expect(html).not.toContain('wq_home:');
    });
  });
  test('on, the same page with and without it differs only by the script', async () => {
    let on; let off;
    await serve([HUBANS({ fast: true, wait_ux: true, wait_home: true })], async (srv) => { await get(srv, `/h/${TOKEN}`); on = await get(srv, `/h/${TOKEN}`); });
    await serve([HUBANS({ fast: true, wait_ux: true })], async (srv) => { await get(srv, `/h/${TOKEN}`); off = await get(srv, `/h/${TOKEN}`); });
    const port = (h) => h.replace(/localhost:\d+/g, 'localhost:0');
    expect(port(on.replace(`${inline(on)[0]}\n`, '').replace(/,"wait_home":true/, ''))).toBe(port(off));
  });
});

// ── the early script, in a vm ─────────────────────────────────────────────────────────────────────
function early({ kept, search = '', lang = 'en', store = true, pre = [] } = {}) {
  const head = [];
  const html = { c: new Set(['wq-x', ...pre]), attrs: {}, setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return this.attrs[k] == null ? null : this.attrs[k]; } };
  html.classList = { add: (c) => html.c.add(c), remove: (c) => html.c.delete(c), contains: (c) => html.c.has(c) };
  const main = { _h: '<div class="wq-boot"></div>', attrs: {}, set innerHTML(h) { this._h = h; }, get innerHTML() { return this._h; }, setAttribute(k, v) { this.attrs[k] = v; } };
  const ss = { getItem: (k) => (k === `wq_home:${TOKEN}` && kept ? JSON.stringify(kept) : null) };
  const ctx = {
    document: { documentElement: html, getElementById: (id) => (id === 'wq' ? main : null), createElement: (tag) => ({ tag }), head: { appendChild: (x) => head.push(x) } },
    window: { location: { search }, get sessionStorage() { if (!store) throw new Error('blocked'); return ss; } },
    Date, JSON,
  };
  ctx.window.document = ctx.document;
  vm.createContext(ctx);
  vm.runInContext(WaitUx.homeTag(TOKEN, lang, 'v123').replace(/^<script>|<\/script>$/g, ''), ctx);
  return { head, html, main };
}
const KEPT = (extra = {}) => ({ t: Date.now() - 60000, l: 'en', k: KID, one: true, c: ['wq-1b'], h: '<section class="wq-screen" data-m="home">Hi Zara Testwala!</section>', ...extra });

describe('the early script draws a kept Home', () => {
  test('fresh, same language, one child: drawn at once, inert and busy, the home look loaded, the bar kept running', () => {
    const p = early({ kept: KEPT() });
    expect(p.main.innerHTML).toBe('<section class="wq-screen" data-m="home">Hi Zara Testwala!</section><div class="wq-boot" hidden></div>');
    expect(p.main.attrs).toEqual({ inert: '', 'aria-busy': 'true' });
    expect(p.html.c.has('wq-cached')).toBe(true);
    expect(p.html.c.has('wq-1b')).toBe(true);
    expect(p.html.attrs['data-wqc']).toBe('wq-1b'); // what it added, so the real draw can take it off again
    expect(p.head.find((x) => x.tag === 'link')).toMatchObject({ rel: 'stylesheet', href: '/wq/wq-home.css?v=v123' });
    expect(p.head.find((x) => x.tag === 'style').textContent).toMatch(/html\.wq-cached #wq\{pointer-events:none\}/);
  });
  test('only the one-button look is carried; any other kept class is not added (the head guesses the rest)', () => {
    const p = early({ kept: KEPT({ c: ['wq-1b', 'wq-adv', 'wq-zz'] }) });
    expect([...p.html.c].sort()).toEqual(['wq-1b', 'wq-cached', 'wq-x']);
  });
  test('a look class the page already had is not recorded (the real draw never takes it off)', () => {
    const p = early({ kept: KEPT(), pre: ['wq-1b'] });
    expect(p.html.attrs['data-wqc']).toBe('');
  });
  test('the link names the same child: drawn', () => {
    expect(early({ kept: KEPT({ one: false }), search: `?kid=${KID}&from=home` }).html.c.has('wq-cached')).toBe(true);
  });
  test.each([
    ['older than 10 minutes', { kept: KEPT({ t: Date.now() - 11 * 60000 }) }],
    ['another language', { kept: KEPT({ l: 'ur' }) }],
    ['the link names another child', { kept: KEPT(), search: `?kid=${KID2}` }],
    ['a family of two, no child in the link', { kept: KEPT({ one: false }) }],
    ['nothing kept', { kept: null }],
    ['no markup', { kept: KEPT({ h: null }) }],
    ['storage blocked', { kept: KEPT(), store: false }],
  ])('%s: nothing drawn, the frame stays', (_n, o) => {
    const p = early(o);
    expect(p.main.innerHTML).toBe('<div class="wq-boot"></div>');
    expect(p.main.attrs).toEqual({});
    expect(p.html.c.has('wq-cached')).toBe(false);
    expect(p.head).toEqual([]);
  });
  test('an Urdu page reads an Urdu Home only', () => {
    expect(early({ kept: KEPT({ l: 'ur' }), lang: 'ur' }).html.c.has('wq-cached')).toBe(true);
    expect(early({ kept: KEPT(), lang: 'ur' }).html.c.has('wq-cached')).toBe(false);
  });
});

// ── hub.js: keeps Home, and makes the kept one live again ────────────────────────────────────────
const HUB_SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'hub.js'), 'utf8');
const TEL = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'wq-tel.js'), 'utf8');
const HOME = { home_v3: 1, doors: { stories: [], games: [], videos: null }, head: { dots: 0, today: false, jar: null } };
const boot = (extra = {}) => ({ lang: 'en', token: TOKEN, brand: null, kids: [{ chip: KID, first: 'Zara Testwala', animal: 'owl', grade: '3' }], kid: KID, teacher: null, again: [], recs: [], challenge: null, lib: null, ...HOME, ...extra });
function hubPage(b, { hash = '', cached = false, added = [] } = {}) {
  const root = { _h: cached ? '<section>old</section><div class="wq-boot" hidden></div>' : '', attrs: cached ? { inert: '', 'aria-busy': 'true' } : {},
    set innerHTML(h) { this._h = h; }, get innerHTML() { return this._h; },
    setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k]; }, removeAttribute(k) { delete this.attrs[k]; },
    appendChild() {}, querySelector: () => null, querySelectorAll: () => [] };
  const cls = new Set(['wq-adv', ...(cached ? ['wq-cached'] : []), ...added]);
  const hattrs = cached ? { 'data-wqc': added.join(' ') } : {};
  const listeners = {};
  const timers = [];
  const stored = {};
  const loc = { search: '', hash, pathname: `/h/${TOKEN}`, protocol: 'https:', assign() {}, reload() {} };
  const mounted = [];
  const win = { scrollTo() {}, addEventListener(n, fn) { (listeners[n] = listeners[n] || []).push(fn); },
    WQHOME: { mount: (r) => { mounted.push({ inert: 'inert' in r.attrs, cached: cls.has('wq-cached') }); r.innerHTML = '<section class="wq-screen" data-m="home">Hi Zara Testwala! 3 stamps</section>'; } } };
  const ctx = {
    document: {
      documentElement: { setAttribute(k, v) { hattrs[k] = String(v); }, getAttribute(k) { return hattrs[k] == null ? null : hattrs[k]; }, removeAttribute(k) { delete hattrs[k]; },
        classList: { toggle() {}, contains: (c) => cls.has(c), add: (c) => cls.add(c), remove: (c) => cls.delete(c) }, get className() { return [...cls].join(' '); } },
      getElementById: (id) => (id === 'wq' ? root : { textContent: JSON.stringify(b) }), createElement: () => ({ setAttribute() {}, addEventListener() {}, textContent: '' }),
      querySelector: () => null, head: { appendChild() {} }, cookie: '',
    },
    window: win, navigator: { sendBeacon: () => true }, history: { replaceState() {} }, location: loc, Blob: function Blob() {},
    fetch: () => Promise.resolve({ status: 200, ok: true, text: () => Promise.resolve('{}') }),
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    sessionStorage: { getItem: (k) => stored[k] || null, setItem: (k, v) => { stored[k] = v; }, removeItem: (k) => { delete stored[k]; } },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, Date, JSON, Math, String, Number, Array, Object, Promise, isFinite, encodeURIComponent, Uint8Array,
  };
  vm.createContext(ctx);
  vm.runInContext(TEL, ctx);
  vm.runInContext(HUB_SRC, ctx);
  const leave = () => (listeners.pagehide || []).forEach((fn) => fn({}));
  const kept = () => (stored[`wq_home:${TOKEN}`] ? JSON.parse(stored[`wq_home:${TOKEN}`]) : null);
  return { root, cls, hattrs, timers, stored, leave, kept, loc, mounted };
}

describe('hub.js keeps Home for this tab (switch on)', () => {
  test('left from Home: Home as drawn is kept with its language, child, one-child flag and look', () => {
    const p = hubPage(boot({ wait_home: true }));
    p.leave();
    const k = p.kept();
    expect(k).toMatchObject({ l: 'en', k: KID, one: true, c: [], h: '<section class="wq-screen" data-m="home">Hi Zara Testwala! 3 stamps</section>' });
    expect(Date.now() - k.t).toBeLessThan(5000);
  });
  test('a little after Home is drawn it is kept too (a child who leaves from a door)', () => {
    const p = hubPage(boot({ wait_home: true }));
    const t = p.timers.find((x) => x.ms === 2500);
    expect(t).toBeTruthy();
    t.fn();
    expect(p.kept()).not.toBeNull();
  });
  test.each([
    ['a door open', boot({ wait_home: true }), { hash: '#games' }],
    ['a teacher preview', boot({ wait_home: true, practice: 1 }), {}],
    ['switch off', boot(), {}],
    ['wait_home not true', boot({ wait_home: 1 }), {}],
  ])('%s: nothing kept', (_n, b, o) => {
    const p = hubPage(b, o);
    p.leave();
    p.timers.forEach((t) => t.fn());
    expect(p.stored).toEqual({});
  });
  test('the page left while the kept Home still shows (the answer never came): the old copy is not kept again', () => {
    const p = hubPage(boot({ wait_home: true }));
    p.cls.add('wq-cached');
    p.leave();
    expect(p.stored).toEqual({});
  });
});

describe('a look switched off since the copy was kept: the real draw takes its class off (a rollback takes)', () => {
  test('kept with wq-1b, the answer has no one_button: wq-1b is gone after the real draw, and the next leave keeps none', () => {
    const p = hubPage(boot({ wait_home: true }), { cached: true, added: ['wq-1b'] });
    expect(p.cls.has('wq-1b')).toBe(false);
    expect(p.hattrs).not.toHaveProperty('data-wqc');
    p.leave();
    expect(p.kept().c).toEqual([]);
  });
  test('kept with wq-1b, the answer still says one_button: it stays, and is kept again', () => {
    const p = hubPage(boot({ wait_home: true, one_button: true }), { cached: true, added: ['wq-1b'] });
    expect(p.cls.has('wq-1b')).toBe(true);
    p.leave();
    expect(p.kept().c).toEqual(['wq-1b']);
  });
  test('a class the early script did not add is never taken off', () => {
    const p = hubPage(boot({ wait_home: true }), { cached: true, added: [] });
    p.cls.add('wq-1b');
    expect(p.cls.has('wq-adv')).toBe(true);
  });
});

describe('hub.js draws the real Home over a kept one', () => {
  test('the kept Home is live again before the real one is drawn: not inert, not busy, no wq-cached', () => {
    const p = hubPage(boot({ wait_home: true }), { cached: true });
    expect(p.mounted).toEqual([{ inert: false, cached: false }]);
    expect(p.root.attrs).not.toHaveProperty('inert');
    expect(p.root.attrs).not.toHaveProperty('aria-busy');
    expect(p.root.innerHTML).toContain('3 stamps');
  });
  test('a hub that answers with no child (a family picker) also clears it', () => {
    const p = hubPage(boot({ wait_home: true, kid: null, kids: [{ chip: KID, first: 'Zara Testwala', animal: 'owl' }, { chip: KID2, first: 'Ali Testwala', animal: 'lion' }] }), { cached: true });
    expect(p.cls.has('wq-cached')).toBe(false);
    expect(p.root.attrs).not.toHaveProperty('inert');
  });
});
