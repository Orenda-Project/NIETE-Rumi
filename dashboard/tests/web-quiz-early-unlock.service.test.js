/**
 * A new phone's first Home asks for itself from the page's head (app_settings web_quiz_early_unlock, read by the bot in
 * the hub's one settings read; the hub JSON says `early_unlock: true` only when it is on).
 *
 * A phone without the wq_dv cookie gets the locked server render, and hub.js asks the bot again as this phone before it
 * draws the Home. ON, the fast first page's head (sent before the bot answers) starts that same call for such a phone,
 * and hub.js uses it instead of asking once its scripts have run: one hub call, started ~1 s sooner on slow 4G.
 * OFF (no `early_unlock`): every page is today's, byte for byte (golden recorded on sandbox afc19d534 by this file with
 * RECORD=1 on the base, ?v= masked). ON with the wq_dv cookie: today's page too.
 *
 * Route rows: the bot is the network boundary (a fake fetch; held answers released by hand). Page rows: the head's script,
 * wq-tel.js and hub.js run whole in a vm, with fetch, localStorage and the cookie jar as the faked boundaries.
 * No first-party module is mocked.
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const vm = require('vm');
const express = require('express');
const { createWebQuizRouter } = require('../routes/web-quiz.routes');
// Module state (each edge's learned head): reset between tests. Absent before this change: the ON rows then run red.
let EarlyUnlock = null;
try { EarlyUnlock = require('../routes/web-quiz-early-unlock'); } catch (_) { EarlyUnlock = null; }
let HomePre;
try { HomePre = require('../routes/web-quiz-home-preload'); } catch (_) { HomePre = { _reset() {} }; }
const GOLDEN_FILE = path.join(__dirname, 'fixtures', 'early-unlock-off-golden.json');

const BOT = 'http://bot.test';
const KEY = 'test-internal-key';
const TOKEN = 'eyJrIjoiaCIsImlkcyI6WyJhIl0sImV4cCI6OTk5OTk5OTk5OX0.AbCdEfGhIjKlMnOpQrStUv';
const KID = '0123456789abcdef';
const DV = 'SrvMintedDevCookie_-01';

function jsonRes(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) },
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  };
}

// The hub answer as production sends it with its speed and look switches on.
const HUB = (extra = {}) => ({
  lang: 'en', kids: [{ chip: KID, first: 'Asad Testwala', animal: 'owl', grade: '3' }], kid: KID,
  teacher: null, again: [], recs: [], challenge: null, brand: 'niete', rt: false, fast: true, home_pre: true,
  home_v3: true, adv: true, one_button: true, wait_ux: true, wait_hops: true, wait_home: true, play: { first: null },
  ui: extra.lang === 'ur' ? { ur2: true, adv: true } : { adv: true },
  doors: { stories: [{ kind: 'shelf' }], games: [], videos: { watch: true } }, ...extra,
});
// The server render of a phone with no device: locked (the bot's lockedHub), with the hub's switches.
const LOCKED = (extra = {}) => ({ lang: 'en', locked: true, kids: [], kid: null, teacher: null, again: [], recs: [], challenge: null, lib: null, brand: 'niete', rt: false, fast: true, home_pre: true, ...extra });
const ON = { early_unlock: true };

const start = (app) => new Promise((resolve) => { const srv = app.listen(0, () => resolve(srv)); });

function get(srv, p, { onFirstChunk, onChunk, cookie } = {}) {
  return new Promise((resolve, reject) => {
    const headers = { host: 'portal.example', ...(cookie ? { cookie } : {}) };
    const r = http.request({ host: '127.0.0.1', port: srv.address().port, method: 'GET', path: p, headers }, (res) => {
      const chunks = [];
      res.setEncoding('utf8');
      res.on('data', (c) => { chunks.push(c); if (onChunk) onChunk(c); if (chunks.length === 1 && onFirstChunk) onFirstChunk(c); });
      res.on('end', () => resolve({ status: res.statusCode, chunks, body: chunks.join('') }));
    });
    r.on('error', reject);
    r.end();
  });
}

/** A bot whose hub answers come in order; a { hold: true, res } one waits for release(). */
function heldBot(answers) {
  let held = [];
  const asked = [];
  const fetchImpl = (url, init) => {
    asked.push({ url, device: init && init.headers ? init.headers['x-wq-device'] || null : null });
    const body = answers.shift();
    if (body && body.hold) return new Promise((r) => held.push(() => r(body.res)));
    return Promise.resolve(body && body.res ? body.res : body);
  };
  return { fetchImpl, asked, release: () => { const h = held; held = []; h.forEach((f) => f()); } };
}

function build(fetchImpl) {
  const app = express();
  app.set('trust proxy', 1);
  app.use(createWebQuizRouter({ botUrl: BOT, apiKey: KEY, fetchImpl }));
  return app;
}

/** What the page sent while the bot had not answered yet (every chunk until 100 ms after the first), and the whole page. */
async function flushedOpen(srv, bot, p = `/h/${TOKEN}`, opts = {}) {
  let answered = false; let answeredAtFirstChunk = null; let early = '';
  const answer = () => { if (!answered) { answered = true; bot.release(); } };
  const fallback = setTimeout(answer, 400);
  const res = await get(srv, p, {
    ...opts,
    onChunk: (c) => { if (!answered) early += c; },
    onFirstChunk: () => { answeredAtFirstChunk = answered; setTimeout(answer, 100); },
  });
  clearTimeout(fallback);
  return { early, answeredAtFirstChunk, body: res.body };
}

const mask = (s) => s.replace(/\?v=[0-9a-f]{10}m?/g, '?v=V');
const reset = () => { if (EarlyUnlock) EarlyUnlock._reset(); HomePre._reset(); };
const SCRIPT_RX = /<script>\(function\(w,d,t\)\{try\{[\s\S]*?\}\)\(window,document,("[^"]*")\);<\/script>\n/;

/** A teaching open, then a flushed open of a phone with no device (its server render locked), then one with a device. */
async function scenario(lang, extra, { path: p = `/h/${TOKEN}`, kid = {} } = {}) {
  const bot = heldBot([
    jsonRes(200, HUB({ lang, ...extra, ...kid })),
    { hold: true, res: jsonRes(200, LOCKED({ lang, ...extra })) },
    { hold: true, res: jsonRes(200, HUB({ lang, ...extra, ...kid })) },
  ]);
  const srv = await start(build(bot.fetchImpl));
  try {
    const first = await get(srv, p);
    const fresh = await flushedOpen(srv, bot, p);
    const known = await flushedOpen(srv, bot, p, { cookie: `wq_dv=${DV}` });
    expect(fresh.answeredAtFirstChunk).toBe(false);
    expect(known.answeredAtFirstChunk).toBe(false);
    return { first: mask(first.body), freshEarly: mask(fresh.early), fresh: mask(fresh.body), knownEarly: mask(known.early), known: mask(known.body), asked: bot.asked };
  } finally {
    await new Promise((r) => srv.close(r));
  }
}

beforeEach(reset);
afterAll(reset);

describe('web_quiz_early_unlock: the head of a new phone\'s first hub open', () => {
  test('OFF (no `early_unlock`): the first, the flushed (no device) and a known phone\'s hub pages are today\'s, byte for byte (golden), EN and UR', async () => {
    const got = {};
    for (const lang of ['en', 'ur']) {
      const s = await scenario(lang, {});
      got[lang] = { first: s.first, freshEarly: s.freshEarly, fresh: s.fresh, knownEarly: s.knownEarly, known: s.known };
    }
    if (process.env.RECORD === '1') { fs.writeFileSync(GOLDEN_FILE, `${JSON.stringify(got, null, 1)}\n`); return; }
    expect(got).toEqual(JSON.parse(fs.readFileSync(GOLDEN_FILE, 'utf8')));
  });

  test('ON, a phone with no wq_dv cookie: the head sent BEFORE the bot answers starts its hub call, first thing after the viewport, EN and UR', async () => {
    for (const lang of ['en', 'ur']) {
      reset();
      const s = await scenario(lang, ON);
      const m = SCRIPT_RX.exec(s.freshEarly);
      expect(m).not.toBeNull();
      expect(JSON.parse(m[1])).toBe(TOKEN);
      expect(s.freshEarly.indexOf(m[0])).toBe(s.freshEarly.indexOf('<meta name="viewport"') + s.freshEarly.slice(s.freshEarly.indexOf('<meta name="viewport"')).indexOf('\n') + 1);
      expect(s.freshEarly.indexOf(m[0])).toBeLessThan(s.freshEarly.indexOf('<meta name="robots"'));
      expect(s.freshEarly.indexOf(m[0])).toBeLessThan(s.freshEarly.indexOf('/wq/wq.css'));
      // the whole page carries it once, and the server render reached the bot with no device (as today)
      expect(s.fresh.split('window,document,"').length - 1).toBe(1);
      expect(s.asked[1].device).toBe(null);
    }
  });

  test('ON, a phone that has its wq_dv cookie: no early call, and the page is the OFF page byte for byte', async () => {
    const known = async (extra) => {
      reset();
      const bot = heldBot([jsonRes(200, HUB(extra)), { hold: true, res: jsonRes(200, HUB(extra)) }]);
      const srv = await start(build(bot.fetchImpl));
      try {
        await get(srv, `/h/${TOKEN}`);
        const k = await flushedOpen(srv, bot, `/h/${TOKEN}`, { cookie: `wq_dv=${DV}` });
        return { early: mask(k.early), body: mask(k.body), asked: bot.asked };
      } finally {
        await new Promise((r) => srv.close(r));
      }
    };
    const on = await known(ON);
    const off = await known({});
    expect(on.body).not.toMatch(/WQHUB0/);
    expect(on.early).toBe(off.early);
    // the answers differ by the switch's own key only (the bot sends it in the boot JSON)
    expect(on.body.replace(/,"early_unlock":true/g, '')).toBe(off.body);
    expect(on.asked[1].device).toBe(DV);
  });

  test('ON, no wq_dv cookie: the locked render is drawn in the last child\'s shape (the home\'s files and look), still locked, with no name', async () => {
    const s = await scenario('en', ON);
    const boot = JSON.parse(/<script id="boot" type="application\/json">([\s\S]*?)<\/script>/.exec(s.fresh)[1]);
    expect(boot.locked).toBe(true);
    expect(boot.kids).toEqual([]);
    expect(boot.kid).toBe(null);
    expect(boot.home_v3).toBe(true);
    expect(s.fresh).not.toMatch(/Asad/);
    expect(s.fresh).not.toMatch(new RegExp(KID));
    // the home's files are on the page, and the head's adventure look stays (no fix removes it)
    expect(s.fresh).toMatch(/<script src="\/wq\/wq-home\.js\?v=V" defer><\/script>/);
    expect(s.fresh).toMatch(/<link rel="stylesheet" href="\/wq\/wq-home\.css\?v=V">/);
    expect(s.fresh).not.toMatch(/classList\.remove\("wq-adv"\)/);
    expect(s.fresh).toMatch(/<html lang="en" dir="ltr" class="wq-adv">/);
    // OFF, the same locked render is today's: no home files, the look dropped
    reset();
    const off = await scenario('en', {});
    expect(off.fresh).not.toMatch(/<script src="\/wq\/wq-home\.js/);
    expect(off.fresh).toMatch(/classList\.remove\("wq-adv"\)/);
  });

  test('ON with the home in one response (web_quiz_home_inline): the shaped locked render runs the carried wq-home.js, nothing asked from the network', async () => {
    const s = await scenario('en', { ...ON, home_inline: true });
    expect(s.fresh).toMatch(/<script type="text\/x-wq" src="\/wq\/wq-home\.js\?v=V"/);
    const run = JSON.parse(s.fresh.match(/\}\)\}\)\(document,window,(\[[^\]]*\]),"[0-9A-Za-z]+"\)<\/script>/)[1]);
    expect(run.map((u) => u.split('?')[0])).toContain('/wq/wq-home.js');
    expect(s.fresh).not.toMatch(/<script src="\/wq\/wq-home\.js/);
    expect(s.fresh).not.toMatch(/<link rel="stylesheet" href="\/wq\/wq-home\.css/);
  });

  test('ON, the bot\'s own field shape (`home_v3: 1`, as web-quiz-hub-home.js sends it): the new phone\'s locked render still carries the home\'s files, EN and UR', async () => {
    for (const lang of ['en', 'ur']) {
      reset();
      const s = await scenario(lang, ON, { kid: { home_v3: 1 } });
      const boot = JSON.parse(/<script id="boot" type="application\/json">([\s\S]*?)<\/script>/.exec(s.fresh)[1]);
      expect(boot.locked).toBe(true);
      expect(boot.home_v3).toBe(1);
      expect(s.fresh).toMatch(/<script src="\/wq\/wq-home\.js\?v=V" defer><\/script>/);
      expect(s.fresh).toMatch(/<link rel="stylesheet" href="\/wq\/wq-home\.css\?v=V">/);
      // with the home in one response: carried and run, nothing asked from the network after the hub answer
      reset();
      const i = await scenario(lang, { ...ON, home_inline: true }, { kid: { home_v3: 1 } });
      expect(i.fresh).toMatch(/<script type="text\/x-wq" src="\/wq\/wq-home\.js\?v=V"/);
      expect(i.fresh).toMatch(/<link rel="wq-src" href="\/wq\/wq-home\.css\?v=V"><style>/);
      const run = JSON.parse(i.fresh.match(/\}\)\}\)\(document,window,(\[[^\]]*\]),"[0-9A-Za-z]+"\)<\/script>/)[1]);
      expect(run.map((u) => u.split('?')[0])).toContain('/wq/wq-home.js');
      expect(i.fresh).not.toMatch(/<script src="\/wq\/wq-home\.js/);
      expect(i.fresh).not.toMatch(/<link rel="stylesheet" href="\/wq\/wq-home\.css/);
    }
  });

  test('the switch follows the last answer: an answer without it turns the next head off; a locked answer with it turns it on', async () => {
    expect(EarlyUnlock).not.toBeNull();
    const bot = heldBot([
      jsonRes(200, LOCKED(ON)),
      { hold: true, res: jsonRes(200, HUB()) },
      { hold: true, res: jsonRes(200, LOCKED()) },
    ]);
    const srv = await start(build(bot.fetchImpl));
    try {
      await get(srv, `/h/${TOKEN}`);
      expect(SCRIPT_RX.test((await flushedOpen(srv, bot)).early)).toBe(true);
      expect(SCRIPT_RX.test((await flushedOpen(srv, bot)).early)).toBe(false);
    } finally {
      await new Promise((r) => srv.close(r));
    }
  });

  test('a token that could close the script is never written raw', () => {
    expect(EarlyUnlock).not.toBeNull();
    EarlyUnlock.learn({ early_unlock: true });
    const h = EarlyUnlock.head('a</script><b>', { hasDevice: false });
    expect(h).not.toMatch(/a<\/script>/);
    expect(h).toMatch(/"a\\u003c\/script\\u003e\\u003cb\\u003e"/);
    expect(EarlyUnlock.head('x', { hasDevice: true })).toBe('');
    EarlyUnlock.learn({ early_unlock: 'true' });
    expect(EarlyUnlock.head('x', { hasDevice: false })).toBe('');
  });
});

/* ---------------- the page: the head's script, then hub.js ---------------- */

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'hub.js'), 'utf8');
const TEL = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'wq-tel.js'), 'utf8');
const flush = () => new Promise((r) => setImmediate(r));
const BR = { mascot: { en: 'Jugnu', ur: 'جگنو' }, label: { en: 'NIETE', ur: 'NIETE' }, sub: { en: 'FOR STUDENTS', ur: 'FOR STUDENTS' }, name: 'NIETE', mark: { tile: true, svg: '' } };
const PAGE_LOCKED = () => ({ lang: 'en', token: TOKEN, brand: BR, locked: true, kids: [], kid: null, teacher: null, again: [], recs: [], challenge: null, lib: null });

function headScript(token) {
  EarlyUnlock.learn({ early_unlock: true });
  const h = EarlyUnlock.head(token, { hasDevice: false });
  return h.replace(/^<script>/, '').replace(/<\/script>\n$/, '');
}

// One page open: the head's script (when `head`), then wq-tel.js and hub.js, as the browser runs them.
// `failEarly`: the network fails the call the head starts. `store`: localStorage, or 'throws'.
function page({ head = true, headToken = TOKEN, search = '', store = {}, jar = [], failEarly = false } = {}) {
  const fetches = [];
  const cookieJar = jar.slice();
  let phase = 'head';
  const els = {};
  const el = (sel) => (els[sel] = els[sel] || { sel, listeners: {}, attrs: {}, addEventListener(n, fn) { (this.listeners[n] = this.listeners[n] || []).push(fn); }, getAttribute(k) { return this.attrs[k]; } });
  const root = {
    _h: '', attrs: {},
    set innerHTML(h) { this._h = h; for (const k of Object.keys(els)) delete els[k]; for (const m of h.matchAll(/<(?:a|button)\b([^>]*)>/g)) { const id = /id="([^"]+)"/.exec(m[1]); if (id) el(`#${id[1]}`); } },
    get innerHTML() { return this._h; },
    setAttribute(k, v) { this.attrs[k] = v; },
    appendChild() {},
    querySelector(sel) { return els[sel] || null; },
    querySelectorAll() { return []; },
  };
  const classes = new Set();
  const docEl = { attrs: { lang: 'en', dir: 'ltr' }, setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return this.attrs[k]; },
    classList: { toggle(c, on) { if (on) classes.add(c); else classes.delete(c); }, contains: (c) => classes.has(c), add: (c) => classes.add(c), remove: (c) => classes.delete(c) }, get className() { return [...classes].join(' '); } };
  const ls = store === 'throws'
    ? { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('SecurityError'); }, removeItem() {} }
    : { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
  const location = { search, protocol: 'http:', assign() {}, reload() {} };
  const win = { scrollTo() {}, addEventListener() {}, localStorage: ls, location, crypto: require('crypto').webcrypto };
  const ctx = {
    document: { documentElement: docEl, getElementById: (id) => (id === 'wq' ? root : { textContent: JSON.stringify(PAGE_LOCKED()) }), createElement: () => ({ setAttribute() {}, textContent: '' }),
      set cookie(v) { const pair = String(v).split(';')[0]; const name = pair.split('=')[0]; const at = cookieJar.findIndex((c) => c.split('=')[0] === name); if (at >= 0) cookieJar[at] = pair; else cookieJar.push(pair); },
      get cookie() { return cookieJar.join('; '); } },
    window: win,
    navigator: { sendBeacon: () => true },
    history: { replaceState() {} },
    location,
    Blob: function Blob(parts) { this.parts = parts; },
    localStorage: ls,
    Uint8Array,
    setTimeout: () => 0, Date, JSON, Math, String, Number, Array, Object, Promise, isFinite, encodeURIComponent,
  };
  ctx.fetch = (url, init) => {
    fetches.push({ url, init, phase });
    if (failEarly && phase === 'head') return Promise.reject(new TypeError('Failed to fetch'));
    return Promise.resolve({ status: 200, ok: true, text: () => Promise.resolve(JSON.stringify(PAGE_LOCKED())) });
  };
  win.fetch = ctx.fetch;
  vm.createContext(ctx);
  if (head) vm.runInContext(headScript(headToken), ctx);
  phase = 'page';
  vm.runInContext(TEL, ctx);
  vm.runInContext(SRC, ctx);
  const hubCalls = () => fetches.filter((f) => f.url.indexOf('/api/wq/hub/') === 0);
  return { root, store, jar: cookieJar, hubCalls, win };
}

describe('web_quiz_early_unlock: hub.js uses the call the head started', () => {
  test('a brand-new phone: ONE hub call, started by the head with the ref it minted; hub.js draws from its answer', async () => {
    const p = page();
    await flush(); await flush();
    const calls = p.hubCalls();
    expect(calls.map((c) => c.phase)).toEqual(['head']);
    const sent = JSON.parse(calls[0].init.body);
    expect(Object.keys(sent)).toEqual(['device_ref']);
    expect(sent.device_ref).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(JSON.parse(p.store.wq_d)).toBe(sent.device_ref);
    expect(p.jar).toContain(`wq_dv=${sent.device_ref}`);
    expect(calls[0].url).toBe(`/api/wq/hub/${encodeURIComponent(TOKEN)}`);
    expect(calls[0].init.method).toBe('POST');
    // the locked answer (this fake's) drew the locked screen: the head's answer was used, and used once
    expect(p.root.innerHTML).toMatch(/wq-h-new/);
    expect(p.win.WQHUB0).toBe(null);
  });

  test('a phone with a stored ref, and one with only the server\'s cookie: the head sends that ref, hub.js asks nothing more', async () => {
    const STORED = 'StoredRefStoredRef_-02';
    const a = page({ store: { wq_d: JSON.stringify(STORED) } });
    const b = page({ jar: [`wq_dv=${DV}`] });
    await flush(); await flush();
    expect(a.hubCalls().map((c) => [c.phase, JSON.parse(c.init.body).device_ref])).toEqual([['head', STORED]]);
    expect(b.hubCalls().map((c) => [c.phase, JSON.parse(c.init.body).device_ref])).toEqual([['head', DV]]);
    expect(JSON.parse(b.store.wq_d)).toBe(DV);
  });

  test('a link in Urdu (?lang=ur): the head asks with the language, hub.js uses it', async () => {
    const p = page({ search: '?lang=ur' });
    await flush(); await flush();
    const calls = p.hubCalls();
    expect(calls.map((c) => c.phase)).toEqual(['head']);
    expect(JSON.parse(calls[0].init.body).lang).toBe('ur');
  });

  test('the grown-ups\' language tap (?lang=ur&keep=1): nothing early, hub.js asks with keep as today', async () => {
    const p = page({ search: '?lang=ur&keep=1&kid=' + KID });
    await flush(); await flush();
    const calls = p.hubCalls();
    expect(calls.map((c) => c.phase)).toEqual(['page']);
    expect(JSON.parse(calls[0].init.body).keep).toBe(1);
  });

  test('a head call for another token, or a failed one: hub.js asks the network itself, as today', async () => {
    const a = page({ headToken: 'other.token' });
    const b = page({ failEarly: true });
    await flush(); await flush(); await flush();
    expect(a.hubCalls().map((c) => c.phase)).toEqual(['head', 'page']);
    expect(b.hubCalls().map((c) => c.phase)).toEqual(['head', 'page']);
    expect(JSON.parse(b.hubCalls()[1].init.body)).toEqual(JSON.parse(b.hubCalls()[0].init.body));
    expect(b.root.innerHTML).toMatch(/wq-h-new/);
  });

  test('a phone whose storage cannot keep the ref: nothing early (hub.js mints its own, as today)', async () => {
    const p = page({ store: 'throws' });
    await flush(); await flush();
    expect(p.hubCalls().map((c) => c.phase)).toEqual(['page']);
  });

  test('OFF (no head script): hub.js asks once, as today', async () => {
    const p = page({ head: false });
    await flush(); await flush();
    expect(p.hubCalls().map((c) => c.phase)).toEqual(['page']);
    expect(p.win.WQHUB0).toBe(undefined);
  });
});
