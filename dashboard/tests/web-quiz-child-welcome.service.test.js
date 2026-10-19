/**
 * The child's first open, "Jugnu says hello" (app_settings web_quiz_child_welcome; the bot's hub answer says
 * `welcome: {v, attempt}`), the page's half (wq-welcome.js over the v3 home, wq-home.js):
 *   step 1 Jugnu, silent (the tap unlocks sound) · 2 who I am · 3 the lands · 4 the Next stop and its Let's go,
 *   a short form (1, 2, 4) for a second child on a phone that already played it, Skip on its own row, a scrim tap does
 *   nothing, the idle end (8 s nudge, 20 s more: the scrim lifts, one 2 s pulse), a Let's go tap before the welcome
 *   mounts is done with no late scrim, the voice only from recorded clips (never the phone's own voice), the lines from
 *   the native read (URDU_READ.md) and their lint. Off (no `welcome`): the home is today's, byte for byte, and no
 *   wq-welcome file is asked for. Invented children only.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const WQ = path.join(__dirname, '..', 'public', 'wq');
const HOME_SRC = fs.readFileSync(path.join(WQ, 'wq-home.js'), 'utf8');
const WSRC = (() => { try { return fs.readFileSync(path.join(WQ, 'wq-welcome.js'), 'utf8'); } catch (_) { return ''; } })();
const WCSS = (() => { try { return fs.readFileSync(path.join(WQ, 'wq-welcome.css'), 'utf8'); } catch (_) { return ''; } })();
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 16);
const KID = '0123456789abcdef';
const TOKEN = 'eyJrIjoiaCIsImlkcyI6WyJhIl0sImV4cCI6OTk5OTk5OTk5OX0.AbCdEfGhIjKlMnOpQrStUv';
const W1 = { v: 1, attempt: 1 };
function boot(lang, extra = {}) {
  return {
    lang, kid: KID, kids: [{ chip: KID, first: 'Zara', animal: 'owl', grade: '3' }], home_v3: 1, brand: 'niete', rt: false,
    teacher: { code: 'MATH01', k: 'kk', topic: 'Fractions' }, again: [], recs: [], challenge: null, lib: { href: '/lib/x' },
    doors: { stories: [], games: [], videos: null }, head: { jar: { fresh: false } }, ...extra,
  };
}

// a small DOM: elements with attributes, classes, listeners, rects; the root parses ids/classes it is given
function mkEl(tag, rect) {
  const e = {
    tag, attrs: {}, cls: new Set(), listeners: {}, children: [], style: {}, _h: '', parentNode: null, rect: rect || { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 },
    setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }, removeAttribute(k) { delete this.attrs[k]; },
    classList: null,
    addEventListener(n, fn, cap) { (this.listeners[n] = this.listeners[n] || []).push({ fn, cap: Boolean(cap) }); },
    removeEventListener(n, fn) { this.listeners[n] = (this.listeners[n] || []).filter((l) => l.fn !== fn); },
    fire(n, ev) { const e2 = ev || {}; e2.preventDefault = e2.preventDefault || (() => {}); e2.stopPropagation = e2.stopPropagation || (() => {}); [...(this.listeners[n] || [])].sort((a, b) => Number(b.cap) - Number(a.cap)).forEach((l) => l.fn.call(this, e2)); },
    appendChild(c) { c.parentNode = this; this.children.push(c); return c; },
    removeChild(c) { this.children = this.children.filter((x) => x !== c); c.parentNode = null; return c; },
    getBoundingClientRect() { return this.rect; }, focus() { this.focused = true; },
    querySelector() { return null; }, querySelectorAll() { return []; },
    get innerHTML() { return this._h; }, set innerHTML(h) { this._h = h; },
  };
  e.classList = { add: (c) => e.cls.add(c), remove: (c) => e.cls.delete(c), contains: (c) => e.cls.has(c), toggle: (c, on) => (on === undefined ? (e.cls.has(c) ? e.cls.delete(c) : e.cls.add(c)) : on ? e.cls.add(c) : e.cls.delete(c)) };
  return e;
}
function page(B, { store = {}, welcome = 'later', muted = false, voiceOk = true, nextTop = 300, tagTop = null, landLeft = 20, nextHref = '/q/MATH01?k=kk', sess = {} } = {}) {
  const timers = [];
  let clock = 1000000;
  const evs = [];
  const posts = [];
  const asked = [];
  const audios = [];
  const body = mkEl('body');
  const next = mkEl('a', { top: nextTop, left: 16, right: 374, bottom: nextTop + 120, width: 358, height: 120 });
  // the look's "Next stop!" tag above the card (wq-adv.js), when a test names where it sits
  const tag = tagTop == null ? null : mkEl('span', { top: tagTop, left: 200, right: 330, bottom: tagTop + 28, width: 130, height: 28 });
  next.querySelector = (sel) => (sel === '.wqa-bub' ? tag : null);
  next.attrs.class = 'wq-next';
  next.attrs['data-tap'] = 'next';
  next.attrs.href = nextHref;
  // the greeting's Jugnu (wq-home.js headHtml: data-tap="jugnu")
  const jug = mkEl('img');
  jug.attrs['data-tap'] = 'jugnu';
  const head = mkEl('header', { top: 0, left: 0, right: 390, bottom: 64, width: 390, height: 64 });
  const lands = ['stories', 'games', 'videos'].map((d, i) => { const x = landLeft + i * 133; const l = mkEl('a', { top: 440, left: x, right: x + 120, bottom: 520, width: 120, height: 80 }); l.attrs['data-door'] = d; return l; });
  const root = mkEl('main');
  root.querySelector = (sel) => (sel === '.wq-next' || sel === '[data-tap="next"]' ? (/class="wq-next"/.test(root._h) ? next : null) : sel === '.wq-hhead' ? head : null);
  root.querySelectorAll = (sel) => (sel === '[data-tap]' ? (/class="wq-next"/.test(root._h) ? [next, jug] : []) : /wqa-stop|wq-door/.test(sel) ? lands : []);
  const ctx = {
    document: {
      documentElement: { lang: B.lang, dir: B.lang === 'ur' ? 'rtl' : 'ltr', classList: { contains: () => false, toggle() {} } },
      head: { appendChild(s) { asked.push(s.src || s.href || ''); if (s.src && /wq-welcome\.js/.test(s.src) && s.ls && s.ls.load) s.ls.load.forEach((f) => f()); } },
      body,
      createElement: (tag) => { const e = mkEl(tag); e.ls = {}; const add = e.addEventListener.bind(e); e.addEventListener = (n, fn, c) => { (e.ls[n] = e.ls[n] || []).push(fn); add(n, fn, c); }; return e; },
      querySelector: () => null, querySelectorAll: () => [], getElementById: () => null, addEventListener() {},
    },
    navigator: { userAgent: 'test' },
    location: { hash: '', search: '', pathname: `/h/${TOKEN}`, assign() {}, reload() {} },
    history: { replaceState() {}, pushState() {} },
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
    sessionStorage: { getItem: (k) => (k in sess ? sess[k] : null), setItem: (k, v) => { sess[k] = String(v); }, removeItem: (k) => { delete sess[k]; } },
    setTimeout: (fn, ms) => { timers.push({ fn, at: clock + (ms || 0) }); return timers.length; }, clearTimeout: (id) => { if (timers[id - 1]) timers[id - 1].fn = null; }, setInterval: () => 0, clearInterval() {},
    addEventListener() {}, removeEventListener() {},
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    fetch: (url, init) => { posts.push({ url, body: init && init.body ? JSON.parse(init.body) : null, keepalive: init && init.keepalive }); return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) }); },
    Audio: function Audio(src) { const a = { src, played: 0, play() { this.played += 1; return voiceOk ? Promise.resolve() : Promise.reject(new Error('404')); }, addEventListener() {} }; audios.push(a); return a; },
    Date: { now: () => clock }, JSON, Math, String, Number, Array, Object, Promise, isFinite, encodeURIComponent, decodeURIComponent, RegExp, Error,
  };
  if (muted) store.wq_snd = '0';
  ctx.innerWidth = 390;
  ctx.innerHeight = 844;
  ctx.window = ctx;
  vm.createContext(ctx);
  if (welcome === 'before' && WSRC) vm.runInContext(WSRC, ctx);
  // wq-welcome.js arrives when the home asks for it ('later'), or never ('never')
  const realHead = ctx.document.head.appendChild;
  ctx.document.head.appendChild = (s) => { if (welcome === 'later' && s.src && /wq-welcome\.js/.test(s.src) && WSRC) { vm.runInContext(WSRC, ctx); } realHead(s); };
  vm.runInContext(HOME_SRC, ctx);
  const hctx = { token: TOKEN, lang: B.lang, ev: (n, p) => evs.push({ n, ...p }), go() {} };
  ctx.WQHOME.mount(root, B, hctx);
  // time moves timer by timer: each fires at its own moment, and what it schedules counts from there
  const run = (ms) => {
    const end = clock + ms;
    for (;;) {
      const due = timers.filter((t) => t.fn && t.at <= end).sort((x, y) => x.at - y.at)[0];
      if (!due) break;
      clock = Math.max(clock, due.at);
      const f = due.fn; due.fn = null; f();
    }
    clock = end;
  };
  const overlay = () => body.children.find((c) => c.attrs.class === 'wqw') || null;
  const tap = (what) => overlay().fire('click', { target: { getAttribute: (k) => (k === 'data-ww' ? what : null) } });
  return { ctx, root, next, jug, sess, tag, lands, body, evs, posts, asked, audios, store, run, overlay, tap, hctx, html: () => root._h, step: () => overlay() && overlay().attrs['data-step'], cap: () => { const m = /<p class="wqw-cap"[^>]*>([\s\S]*?)<\/p>/.exec((overlay() || {})._h || ''); return m ? m[1] : null; } };
}
const COPY = {
  en: { hi: 'Hi! I&#39;m Jugnu. I light the way!', hiShort: 'Hi! I&#39;m Jugnu.', lands: 'Stories, games and videos are all here!', stop: 'Your next stop is ready. Tap &quot;Let&#39;s go!&quot;', nudge: 'Ready? Tap &quot;Let&#39;s go!&quot;', skip: 'Skip' },
  ur: { hi: 'سلام! میں جگنو ہوں۔ میرا کام راستہ روشن کرنا ہے!', hiShort: 'سلام! میں جگنو ہوں۔', lands: 'کہانیاں، کھیل اور ویڈیوز، سب یہاں ہیں!', stop: 'آپ کی اگلی منزل تیار ہے۔ «آئیں چلیں!» دبائیں۔', nudge: 'تیار ہیں؟ «آئیں چلیں!» دبائیں۔', skip: 'چھوڑیں' },
};
const seenKey = `wq.welcome.${KID}`;

// sha of the home's HTML on origin/sandbox before this change (GOLDEN_PRINT=1 prints them)
// written by running this file on origin/sandbox 70fb77c21 with GOLDEN_PRINT=1
const GOLD = { en: '520a7426b9269d35', ur: 'd01503a1b6795f03' };

describe('GOLDEN: no `welcome` (the switch off): today\'s home, nothing more asked for', () => {
  test.each(['en', 'ur'])('%s', (lang) => {
    const p = page(boot(lang), { welcome: 'never' });
    if (process.env.GOLDEN_PRINT) console.log(lang, sha(p.html()));
    expect(sha(p.html())).toBe(GOLD[lang]);
    expect(p.asked.filter((u) => /wq-welcome/.test(u))).toEqual([]);
    expect(p.body.children).toEqual([]);
  });
});

describe('the full welcome (EN and UR)', () => {
  test.each(['en', 'ur'])('%s: 1 silent Jugnu → 2 who I am → 3 the lands → 4 the Next stop; Let\'s go is done', async (lang) => {
    const p = page(boot(lang, { welcome: W1 }));
    expect(p.asked.some((u) => /\/wq\/wq-welcome\.js/.test(u))).toBe(true);
    const o = p.overlay();
    expect(o).toBeTruthy();
    expect(o.attrs.role).toBe('dialog');
    expect(o.attrs['aria-label']).toBe(COPY[lang].hiShort.replace(/&#39;/g, "'"));
    expect(o.attrs.dir).toBe(lang === 'ur' ? 'rtl' : 'ltr');
    expect(p.step()).toBe('1');
    expect(p.cap()).toBe('');
    expect(p.evs).toContainEqual(expect.objectContaining({ n: 'welcome_shown', form: 'full', v: 1, attempt: 1, lang }));
    expect(p.posts).toContainEqual(expect.objectContaining({ url: '/api/wq/welcome', body: { hub: TOKEN, kid: KID, outcome: 'shown' } }));
    p.run(10000);
    expect(p.step()).toBe('1'); // never times out of step 1
    p.tap('jugnu');
    expect(p.step()).toBe('2');
    expect(p.cap()).toBe(COPY[lang].hi);
    p.run(3000);
    expect(p.step()).toBe('3');
    expect(p.cap()).toBe(COPY[lang].lands);
    p.run(4000);
    expect(p.step()).toBe('4');
    expect(p.cap()).toBe(COPY[lang].stop);
    expect(p.next.cls.has('wqw-up')).toBe(true);
    p.next.fire('click', {});
    expect(p.overlay()).toBeNull();
    expect(p.next.cls.has('wqw-up')).toBe(false);
    expect(p.posts).toContainEqual(expect.objectContaining({ body: { hub: TOKEN, kid: KID, outcome: 'done' }, keepalive: true }));
    expect(p.evs).toContainEqual(expect.objectContaining({ n: 'welcome_done', via: 'letsgo' }));
    expect(JSON.parse(p.store[seenKey])).toEqual({ s: 'done', v: 1 });
    expect(p.store['wq.welcome.dev']).toBe('1');
    expect(p.evs.filter((e) => e.n === 'welcome_step').map((e) => e.step)).toEqual([1, 2, 3, 4]);
  });
  test('step 4: a tap inside the Next stop\'s opening is Let\'s go (the home\'s own Next path runs); outside it, nothing', () => {
    const p = page(boot('en', { welcome: W1 }));
    let clicked = 0;
    p.next.click = () => { clicked += 1; p.next.fire('click', {}); };
    p.tap('jugnu');
    p.run(7000);
    p.overlay().fire('click', { target: { getAttribute: () => null }, clientX: 10, clientY: 600 });
    expect(p.overlay()).toBeTruthy();
    p.overlay().fire('click', { target: { getAttribute: () => null }, clientX: 200, clientY: 380 });
    expect(p.overlay()).toBeNull();
    expect(clicked).toBe(1);
    expect(p.evs.filter((e) => e.n === 'welcome_done')).toEqual([expect.objectContaining({ via: 'letsgo' })]);
    expect(p.posts.filter((x) => x.body && x.body.outcome === 'done')).toHaveLength(1);
  });
  test('a scrim tap does nothing; the lands are under the scrim', () => {
    const p = page(boot('en', { welcome: W1 }));
    p.overlay().fire('click', { target: { getAttribute: () => null } });
    expect(p.step()).toBe('1');
    p.lands[0] && p.lands[0].fire('click', {});
    expect(p.overlay()).toBeTruthy();
  });
});

describe('Skip, the idle end and the short form', () => {
  test.each(['en', 'ur'])('%s: Skip is one tap, on its own row under the header (≥ 8 px), at any step: skipped, then one 2 s pulse on the Next stop', (lang) => {
    const p = page(boot(lang, { welcome: W1 }));
    const o = p.overlay();
    expect(o._h).toMatch(new RegExp('<div class="wqw-top" style="top:72px"><button type="button" class="wqw-skip" data-ww="skip"[^>]*>[\\s\\S]*' + COPY[lang].skip + '</span></button></div>'));
    p.tap('jugnu');
    p.tap('skip');
    expect(p.overlay()).toBeNull();
    expect(p.posts).toContainEqual(expect.objectContaining({ body: { hub: TOKEN, kid: KID, outcome: 'skipped' } }));
    expect(p.evs).toContainEqual(expect.objectContaining({ n: 'welcome_skip', at_step: 2 }));
    expect(JSON.parse(p.store[seenKey]).s).toBe('skipped');
    expect(p.next.cls.has('wqw-pulse')).toBe(true);
    p.run(2000);
    expect(p.next.cls.has('wqw-pulse')).toBe(false);
  });
  test.each(['en', 'ur'])('%s: idle at step 4: the nudge at 8 s, then 20 s more: the scrim lifts, done via idle, one pulse', (lang) => {
    const p = page(boot(lang, { welcome: W1 }));
    p.tap('jugnu');
    p.run(7000);
    expect(p.step()).toBe('4');
    p.run(8000);
    expect(p.cap()).toBe(COPY[lang].nudge);
    p.run(19000);
    expect(p.overlay()).toBeTruthy();
    p.run(1000);
    expect(p.overlay()).toBeNull();
    expect(p.evs).toContainEqual(expect.objectContaining({ n: 'welcome_done', via: 'idle' }));
    expect(p.posts).toContainEqual(expect.objectContaining({ body: { hub: TOKEN, kid: KID, outcome: 'done' } }));
    expect(p.next.cls.has('wqw-pulse')).toBe(true);
    p.run(2000);
    expect(p.next.cls.has('wqw-pulse')).toBe(false);
  });
  test.each(['en', 'ur'])('%s: a phone that already played it: the short form (1, 2, 4) with the short hello', (lang) => {
    const p = page(boot(lang, { welcome: W1 }), { store: { 'wq.welcome.dev': '1' } });
    expect(p.evs).toContainEqual(expect.objectContaining({ n: 'welcome_shown', form: 'short' }));
    p.tap('jugnu');
    expect(p.cap()).toBe(COPY[lang].hiShort);
    p.run(3000);
    expect(p.step()).toBe('4');
  });
  test('attempt 2: written done on this phone as it shows; a child already done here: nothing shows (the server is told again)', () => {
    const p = page(boot('en', { welcome: { v: 1, attempt: 2 } }));
    expect(p.overlay()).toBeTruthy();
    expect(JSON.parse(p.store[seenKey])).toEqual({ s: 'done', v: 1 });
    const q = page(boot('en', { welcome: W1 }), { store: { [seenKey]: JSON.stringify({ s: 'skipped', v: 1 }) } });
    expect(q.overlay()).toBeNull();
    expect(q.posts).toContainEqual(expect.objectContaining({ body: { hub: TOKEN, kid: KID, outcome: 'skipped' } }));
  });
});

describe('C3: a Let\'s go tap before the welcome mounts', () => {
  test('is done (on this phone and on the server), and no late scrim', () => {
    const p = page(boot('en', { welcome: W1 }), { welcome: 'never' });
    p.next.fire('click', {});
    expect(JSON.parse(p.store[seenKey])).toEqual({ s: 'done', v: 1 });
    expect(p.posts).toContainEqual(expect.objectContaining({ body: { hub: TOKEN, kid: KID, outcome: 'done' }, keepalive: true }));
    vm.runInContext(WSRC, p.ctx);
    expect(p.ctx.WQW.start(p.root, boot('en', { welcome: W1 }), p.hctx)).toBe(false);
    expect(p.overlay()).toBeNull();
  });
});

describe('the voice: recorded clips only, never before the first tap, never the phone\'s own', () => {
  const VOICE = { v: 1, attempt: 1, voice: '/wq/voice/one/ur/' };
  test('no clips named (today): silent, caption only, no Audio at all', () => {
    const p = page(boot('ur', { welcome: W1 }));
    p.tap('jugnu');
    p.run(8000);
    expect(p.audios).toEqual([]);
    expect(p.ctx.speechSynthesis).toBeUndefined();
  });
  test('clips named: nothing made or played before the tap; after it, each line\'s key under the set\'s path', () => {
    const p = page(boot('ur', { welcome: VOICE }));
    expect(p.audios).toEqual([]);
    p.tap('jugnu');
    p.run(3000);
    p.run(4000);
    expect(p.audios.map((a) => a.src)).toEqual(['/wq/voice/one/ur/welcome-2.mp3', '/wq/voice/one/ur/welcome-3.mp3', '/wq/voice/one/ur/welcome-4.mp3']);
  });
  test('a clip that fails: the caption and the hand carry on to done', async () => {
    const p = page(boot('en', { welcome: VOICE }), { voiceOk: false });
    p.tap('jugnu');
    await Promise.resolve();
    p.run(7000);
    p.next.fire('click', {});
    expect(p.evs).toContainEqual(expect.objectContaining({ n: 'welcome_done', via: 'letsgo' }));
  });
  test('the home\'s sound off: captions only, no Audio', () => {
    const p = page(boot('en', { welcome: VOICE }), { muted: true });
    p.tap('jugnu');
    p.run(7000);
    expect(p.audios).toEqual([]);
    expect(p.cap()).toBe(COPY.en.stop);
  });
});

describe('the words: the native read, linted', () => {
  test('every line is URDU_READ.md\'s final, word for word', () => {
    const ctx = { window: {}, document: {} };
    ctx.window = ctx;
    vm.createContext(ctx);
    vm.runInContext(WSRC, ctx);
    const C = ctx.WQW.COPY;
    const un = (s) => s.replace(/&#39;/g, "'").replace(/&quot;/g, '"');
    for (const l of ['en', 'ur']) for (const k of ['hi', 'hiShort', 'lands', 'stop', 'nudge', 'skip']) expect([l, k, C[l][k]]).toEqual([l, k, un(COPY[l][k])]);
  });
  test('lint: no test word (incl. «کوئز»), no gendered verb about the child or Jugnu', () => {
    const ctx = { window: {}, document: {} };
    ctx.window = ctx;
    vm.createContext(ctx);
    vm.runInContext(WSRC, ctx);
    const C = ctx.WQW.COPY;
    const BAN = /\b(test|exam|quiz)\b|امتحان|ٹیسٹ|کوئز/i;
    const GENDERED = new Set(['سکتے', 'سکتی', 'سکتا', 'گئے', 'گئی', 'گیا', 'آئے', 'آئی', 'آیا', 'کرتا', 'کرتی']);
    for (const l of ['en', 'ur']) {
      for (const s of Object.values(C[l])) {
        expect(s).not.toMatch(BAN);
        const words = String(s).split(/[\s«»!؟۔،.,"?]+/).filter(Boolean);
        for (const w of words) expect([s, w, GENDERED.has(w)]).toEqual([s, w, false]);
      }
    }
  });
});

describe('the look: sizes, the Urdu caption, RTL and reduced motion (wq-welcome.css)', () => {
  const rule = (sel) => { const m = new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\{([^}]*)\\}').exec(WCSS); return m ? m[1] : ''; };
  test('Jugnu ≥ 72 px, Skip ≥ 48 px; the caption within 16 px gutters; nothing scrolls sideways', () => {
    expect(rule('.wqw-jug')).toMatch(/width:72px/);
    expect(rule('.wqw-jug')).toMatch(/height:72px/);
    expect(rule('.wqw-skip')).toMatch(/min-height:48px/);
    expect(rule('.wqw-skip')).toMatch(/min-width:48px/);
    expect(rule('.wqw-cap')).toMatch(/max-width:calc\(100vw - 32px\)/);
    expect(rule('.wqw')).toMatch(/overflow:hidden/);
  });
  test('C1: the Urdu caption may take two balanced lines, line-height ≥ 1.9, never clipped', () => {
    const ur = rule('.wqw[dir=rtl] .wqw-cap');
    expect(ur).toMatch(/line-height:(1\.9|2(\.\d+)?)/);
    expect(rule('.wqw-cap')).toMatch(/text-wrap:balance/);
    expect(rule('.wqw-cap')).not.toMatch(/white-space:nowrap|overflow:hidden|max-height/);
  });
  test('RTL: the hand is mirrored; Skip at the end of its row', () => {
    expect(rule('.wqw[dir=rtl] .wqw-hand')).toMatch(/scaleX\(-1\)/);
    expect(rule('.wqw-top')).toMatch(/justify-content:flex-end/);
  });
  test('reduced motion: no transform animation, opacity only', () => {
    const m = /@media \(prefers-reduced-motion:\s*reduce\)\{([\s\S]*?)\}\s*\}/.exec(WCSS);
    expect(m).toBeTruthy();
    expect(m[1]).toMatch(/animation:none/);
    expect(m[1]).not.toMatch(/transform:(?!none)/);
  });
});

describe('POST /api/wq/welcome (the portal route)', () => {
  const http = require('http');
  const express = require('express');
  const { createWebQuizRouter } = require('../routes/web-quiz.routes');
  const BOT = 'http://bot.test';
  const HUB = 'eyJrIjoiaCIsImlkcyI6WyJhIl19.AbCdEfGhIjKlMnOpQrStUv';
  const jsonRes = (status, b) => ({ status, ok: status >= 200 && status < 300, headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) }, text: async () => JSON.stringify(b) });
  const call = (srv, body, headers = {}) => new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const r = http.request({ host: '127.0.0.1', port: srv.address().port, method: 'POST', path: '/api/wq/welcome', headers: { 'content-type': 'application/json', ...headers } }, (res) => { let out = ''; res.on('data', (c) => { out += c; }); res.on('end', () => resolve({ status: res.statusCode, body: out })); });
    r.on('error', reject); r.write(data); r.end();
  });
  let srv; let calls; let answer;
  beforeEach(async () => {
    calls = []; answer = [200, { ok: true }];
    const app = express();
    app.use(createWebQuizRouter({ botUrl: BOT, apiKey: 'test-internal-key', fetchImpl: async (url, opts) => { calls.push({ url, opts }); return jsonRes(answer[0], answer[1]); } }));
    await new Promise((r) => { srv = app.listen(0, r); });
  });
  afterEach(() => new Promise((r) => srv.close(r)));
  test('reaches the bot\'s /hub/:token/welcome with {kid, outcome} and this phone\'s device; its answer passes through; a bad token never does', async () => {
    const r = await call(srv, { hub: HUB, kid: KID, outcome: 'done' }, { cookie: 'wq_dv=AAAAAAAAAAAAAAAAAAAAAA' });
    expect(r).toEqual({ status: 200, body: JSON.stringify({ ok: true }) });
    expect(calls[0].url).toBe(`${BOT}/api/internal/wq/hub/${HUB}/welcome`);
    expect(JSON.parse(calls[0].opts.body)).toEqual({ kid: KID, outcome: 'done' });
    expect(calls[0].opts.headers['x-wq-device']).toBe('AAAAAAAAAAAAAAAAAAAAAA');
    answer = [404, { error: 'not_found' }];
    expect((await call(srv, { hub: HUB, kid: KID, outcome: 'done' })).status).toBe(404);
    calls = [];
    expect((await call(srv, { hub: 'nope', kid: KID, outcome: 'done' })).status).toBe(401);
    expect(calls).toEqual([]);
  });
});

describe('FT-1 / FT-2 (design-qa DQ68): Skip\'s own row, and the rings inside the 16 px gutters', () => {
  const styleOf = (h, cls) => { const m = new RegExp('class="' + cls + '"[^>]*style="([^"]*)"').exec(h); return m ? Object.fromEntries(m[1].split(';').filter(Boolean).map((x) => x.split(':'))) : null; };
  test.each(['en', 'ur'])('%s: the Next stop and its tag move down while the welcome is up, ≥ 8 px under Skip; back as they were at the end', (lang) => {
    // Skip's row: the header's bottom (64) + 8 = 72, 48 tall, so the card and its tag start at 72 + 48 + 8 = 128 at the earliest
    const p = page(boot(lang, { welcome: W1 }), { nextTop: 110, tagTop: 90 });
    expect(p.next.style.marginTop).toBe('38px');
    p.tap('jugnu');
    p.tap('skip');
    expect(p.next.style.marginTop).toBe('');
    const q = page(boot(lang, { welcome: W1 }), { nextTop: 140 });
    expect(q.next.style.marginTop).toBeUndefined();
  });
  test('the land ring and the Next stop\'s opening keep ≥ 16 px from both screen edges', () => {
    const p = page(boot('en', { welcome: W1 }), { landLeft: 4 });
    p.tap('jugnu');
    p.run(3000);
    const r1 = styleOf(p.overlay()._h, 'wqw-ring');
    expect(parseInt(r1.left, 10)).toBeGreaterThanOrEqual(16);
    p.run(2000);
    const r3 = styleOf(p.overlay()._h, 'wqw-ring');
    expect(parseInt(r3.left, 10) + parseInt(r3.width, 10)).toBeLessThanOrEqual(390 - 16);
    p.run(2000);
    const hole = styleOf(p.overlay()._h, 'wqw-dim wqw-hole');
    expect(parseInt(hole.left, 10)).toBeGreaterThanOrEqual(16);
    expect(parseInt(hole.left, 10) + parseInt(hole.width, 10)).toBeLessThanOrEqual(390 - 16);
  });
});

describe('step 5\'s hint: the page the welcome\'s Let\'s go opens is told (w=1), and nothing else is', () => {
  test.each([['/q/MATH01?k=kk', '/q/MATH01?k=kk&w=1'], ['/c/tok?kid=a&lang=ur&room=story&pid=p1', '/c/tok?kid=a&lang=ur&room=story&pid=p1&w=1'], ['/h/tok?kid=a&lang=en#watch/v1', '/h/tok?kid=a&lang=en&w=1#watch/v1'], ['/s/b1/1', '/s/b1/1?w=1'], ['#videos', '#videos']])('Let\'s go on %s opens %s', (href, want) => {
    const p = page(boot('en', { welcome: W1 }), { nextHref: href });
    p.tap('jugnu');
    p.run(7000);
    p.next.fire('click', {});
    expect(p.next.attrs.href).toBe(want);
  });
  test('Skip and the idle end add nothing; the recorded voice path (when named) rides to that page', () => {
    for (const how of ['skip', 'idle']) {
      const p = page(boot('en', { welcome: W1 }));
      p.tap('jugnu');
      if (how === 'skip') p.tap('skip'); else p.run(40000);
      expect(p.next.attrs.href).toBe('/q/MATH01?k=kk');
    }
    const v = page(boot('ur', { welcome: { v: 1, attempt: 1, voice: '/wq/voice/one/ur/' } }));
    v.tap('jugnu');
    v.run(7000);
    v.next.fire('click', {});
    expect(v.sess['wq.welcome.voice']).toBe('/wq/voice/one/ur/');
    const n = page(boot('ur', { welcome: W1 }));
    n.tap('jugnu');
    n.run(7000);
    n.next.fire('click', {});
    expect(n.sess['wq.welcome.voice']).toBeUndefined();
  });
});

describe('the replay (DESIGN §5): Jugnu in the greeting replays step 4 only, for a child who has had the welcome', () => {
  const R = { v: 1, replay: 1 };
  test.each(['en', 'ur'])('%s: nothing until the greeting\'s Jugnu is tapped; then the Next stop\'s step, about 5 s; nothing written', (lang) => {
    const p = page(boot(lang, { welcome: R }));
    expect(p.asked.filter((u) => /wq-welcome/.test(u))).toEqual([]);
    expect(p.overlay()).toBeNull();
    p.jug.fire('click', {});
    expect(p.overlay()).toBeTruthy();
    expect(p.step()).toBe('4');
    expect(p.cap()).toBe(COPY[lang].stop);
    p.run(5000);
    expect(p.overlay()).toBeNull();
    expect(p.posts).toEqual([]);
    expect(p.store[seenKey]).toBeUndefined();
    expect(p.evs.filter((e) => /^welcome_/.test(e.n))).toEqual([]);
  });
  test('its Let\'s go is the plain Next path (no hint), Skip ends it, and a second tap replays it again', () => {
    const p = page(boot('en', { welcome: R }));
    p.jug.fire('click', {});
    p.tap('skip');
    expect(p.overlay()).toBeNull();
    p.jug.fire('click', {});
    expect(p.overlay()).toBeTruthy();
    p.next.fire('click', {});
    expect(p.overlay()).toBeNull();
    expect(p.next.attrs.href).toBe('/q/MATH01?k=kk');
    expect(p.posts).toEqual([]);
  });
  test('a first-run welcome is never a replay: the greeting\'s Jugnu during it does nothing more', () => {
    const p = page(boot('en', { welcome: W1 }));
    p.jug.fire('click', {});
    expect(p.step()).toBe('1');
  });
});
