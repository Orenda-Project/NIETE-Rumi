/**
 * The child welcome's step 5 (app_settings web_quiz_child_welcome; DESIGN ftue_child §3): the page the welcome's Let's go
 * opened carries w=1 (wq-welcome.js), wq-tel.js (on every page) then loads wq-cue.js, and the pointing hand shows ONCE
 * on that page's own first control (the lesson's play, else its primary, else the first answer) with "Your turn. Tap
 * here!" / «اب آپ کی باری! یہاں دبائیں۔» (URDU_READ final), the voice only from the recorded welcome-5 clip; the w=1
 * leaves the address at once, so a reload or a later visit never shows it again. Without w=1 nothing is asked for and
 * every page is today's, byte for byte (goldens hashed on #3143's branch before this change). Invented children only.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { renderQuizPage, renderHubPage, renderLibPage, renderChallengePage } = require('../routes/web-quiz.routes');

const WQ = path.join(__dirname, '..', 'public', 'wq');
const TEL = fs.readFileSync(path.join(WQ, 'wq-tel.js'), 'utf8');
const CUE = (() => { try { return fs.readFileSync(path.join(WQ, 'wq-cue.js'), 'utf8'); } catch (_) { return ''; } })();
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 16);
const TOKEN = 'eyJrIjoiaCIsImlkcyI6WyJhIl0sImV4cCI6OTk5OTk5OTk5OX0.AbCdEfGhIjKlMnOpQrStUv';

function mkEl(tag, rect) {
  const e = {
    tag, attrs: {}, cls: new Set(), listeners: {}, children: [], style: {}, _h: '', parentNode: null, rect: rect || { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 },
    setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
    addEventListener(n, fn) { (this.listeners[n] = this.listeners[n] || []).push(fn); }, removeEventListener(n, fn) { this.listeners[n] = (this.listeners[n] || []).filter((f) => f !== fn); },
    appendChild(c) { c.parentNode = this; this.children.push(c); return c; }, removeChild(c) { this.children = this.children.filter((x) => x !== c); c.parentNode = null; return c; },
    getBoundingClientRect() { return this.rect; },
    get innerHTML() { return this._h; }, set innerHTML(h) { this._h = h; },
  };
  e.classList = { add: (c) => e.cls.add(c), remove: (c) => e.cls.delete(c), contains: (c) => e.cls.has(c) };
  return e;
}
// a page: `els` names what the page has drawn, by selector (a function: drawn later); `search` its address
function cuePage({ lang = 'en', search = '?k=kk&w=1', pathname = '/q/MATH01', els = {}, sess = {}, store = {}, tel = true, obstacles = [], qsa = {}, vw = 360, vh = 640 } = {}) {
  const timers = [];
  let clock = 0;
  const body = mkEl('body');
  const asked = [];
  const pushed = [];
  const audios = [];
  const replaced = [];
  const docL = {};
  const ctx = {
    document: {
      documentElement: { lang, dir: lang === 'ur' ? 'rtl' : 'ltr', classList: { contains: () => false, add() {}, remove() {} } },
      currentScript: { src: '/wq/wq-tel.js?v=abc123' },
      head: { appendChild: (s) => { asked.push(s.src || s.href || ''); } },
      body,
      createElement: (tag) => mkEl(tag),
      getElementById: (id) => (id === 'boot' ? { textContent: JSON.stringify({ quiz: { lang } }) } : null),
      querySelector: (sel) => { const v = els[sel]; return typeof v === 'function' ? v(clock) : v || null; },
      // everything a child could tap (and the lesson's rows): what the bubble must leave clear
      querySelectorAll: (sel) => (sel in qsa ? qsa[sel] : sel === 'button' || /button/.test(sel) ? obstacles : []),
      addEventListener: (n, fn) => { (docL[n] = docL[n] || []).push(fn); }, removeEventListener: (n, fn) => { docL[n] = (docL[n] || []).filter((f) => f !== fn); },
    },
    location: { search, pathname, hash: '' },
    history: { state: null, replaceState: (st, t, u) => replaced.push(u) },
    navigator: { userAgent: 'test', sendBeacon: () => true },
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
    sessionStorage: { getItem: (k) => (k in sess ? sess[k] : null), setItem: (k, v) => { sess[k] = String(v); }, removeItem: (k) => { delete sess[k]; } },
    setTimeout: (fn, ms) => { timers.push({ fn, at: clock + (ms || 0) }); return timers.length; }, clearTimeout: (id) => { if (timers[id - 1]) timers[id - 1].fn = null; },
    setInterval: () => 0, clearInterval() {}, addEventListener() {}, removeEventListener() {},
    innerWidth: vw, innerHeight: vh, matchMedia: () => ({ matches: false }),
    Audio: function Audio(src) { const a = { src, play() { return Promise.resolve(); } }; audios.push(a); return a; },
    Date: { now: () => clock }, JSON, Math, String, Number, Array, Object, Promise, isFinite, encodeURIComponent, decodeURIComponent, RegExp, Error, URLSearchParams,
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  if (tel) vm.runInContext(TEL, ctx);
  ctx.WQT = Object.assign(ctx.WQT || {}, { push: (e) => { pushed.push(e); return true; } });
  const run = (ms) => {
    const end = clock + ms;
    for (;;) { const d = timers.filter((t) => t.fn && t.at <= end).sort((a, b) => a.at - b.at)[0]; if (!d) break; clock = Math.max(clock, d.at); const f = d.fn; d.fn = null; f(); }
    clock = end;
  };
  const load = () => { if (CUE) vm.runInContext(CUE, ctx); };
  const cue = () => body.children.find((c) => c.attrs.class === 'wqc') || null;
  const cap = () => { const m = /<p class="wqc-cap"[^>]*>([\s\S]*?)<\/p>/.exec((cue() || {})._h || ''); return m ? m[1] : null; };
  const tapAnywhere = () => (docL.pointerdown || []).forEach((fn) => fn({}));
  return { ctx, body, asked, pushed, audios, replaced, run, load, cue, cap, tapAnywhere, sess };
}
const R = (top, left, w, h) => ({ top, left, width: w, height: h, right: left + w, bottom: top + h });
const TURN = { en: 'Your turn. Tap here!', ur: 'اب آپ کی باری! یہاں دبائیں۔' };

describe('wq-tel.js: w=1 asks for wq-cue.js at the page\'s own version; without it, nothing (today\'s page)', () => {
  test('w=1 (also after other keys, before a #fragment)', () => {
    for (const search of ['?w=1', '?k=kk&w=1', '?kid=a&lang=ur&w=1']) expect(cuePage({ search }).asked).toEqual(['/wq/wq-cue.js?v=abc123']);
  });
  test('no w=1 (absent, w=0, w=10, kw=1): nothing asked for, nothing drawn', () => {
    for (const search of ['', '?k=kk', '?w=0', '?w=10', '?kw=1']) {
      const p = cuePage({ search });
      expect([search, p.asked]).toEqual([search, []]);
      expect(p.body.children).toEqual([]);
    }
  });
});

describe('wq-cue.js: the hand once, on the page\'s own first control', () => {
  test.each(['en', 'ur'])('%s quiz page: the question\'s speaker (drawn a moment later), never an answer; the line, the address cleaned, gone on the first tap', (lang) => {
    const opt = mkEl('button', R(300, 16, 328, 64));
    const spk = mkEl('button', R(150, 280, 48, 48));
    const p = cuePage({ lang, els: { '.wq-opt': (t) => (t >= 600 ? opt : null), '#wq-spk': (t) => (t >= 600 ? spk : null) } });
    p.load();
    expect(p.replaced).toEqual(['/q/MATH01?k=kk']);
    expect(p.cue()).toBeNull();
    p.run(900);
    const c = p.cue();
    expect(c).toBeTruthy();
    expect(c.attrs.role).toBe('status');
    expect(c.attrs.dir).toBe(lang === 'ur' ? 'rtl' : 'ltr');
    expect(p.cap()).toBe(TURN[lang]);
    expect(c._h).toMatch(/class="wqc-hand"[^>]*style="top:174px;left:\d+px"/);
    expect(p.pushed).toContainEqual(expect.objectContaining({ n: 'welcome_step', step: 5 }));
    p.tapAnywhere();
    expect(p.cue()).toBeNull();
    p.run(20000);
    expect(p.cue()).toBeNull();
  });
  test('the lesson video page: its ▶ before its primary; a story: its primary', () => {
    const play = mkEl('span', R(250, 148, 64, 64));
    const go = mkEl('button', R(500, 16, 328, 60));
    const v = cuePage({ els: { '.wq-vplay': play, '[data-primary]': go } });
    v.load();
    v.run(300);
    expect(v.cue()._h).toMatch(/class="wqc-hand" style="top:282px/);
    const s = cuePage({ pathname: '/c/tok', search: '?kid=a&room=story&pid=p1&w=1', els: { '[data-primary]': go } });
    s.load();
    s.run(300);
    expect(s.replaced).toEqual(['/c/tok?kid=a&room=story&pid=p1']);
    expect(s.cue()).toBeTruthy();
  });
  test('it fades after 6 s by itself; with nothing to point at in 10 s it shows nothing at all', () => {
    const p = cuePage({ els: { '[data-primary]': mkEl('a', R(300, 16, 328, 60)) } });
    p.load();
    p.run(300);
    expect(p.cue()).toBeTruthy();
    p.run(6000);
    expect(p.cue()).toBeNull();
    const q = cuePage({});
    q.load();
    q.run(12000);
    expect(q.cue()).toBeNull();
    expect(q.replaced).toEqual(['/q/MATH01?k=kk']);
  });
  test('the voice: the recorded welcome-5 clip only when the welcome named its path and the sound is on; never else', () => {
    const el = { '[data-primary]': mkEl('a', R(300, 16, 328, 60)) };
    const a = cuePage({ els: el, sess: { 'wq.welcome.voice': '/wq/voice/one/en/' } });
    a.load(); a.run(300);
    expect(a.audios.map((x) => x.src)).toEqual(['/wq/voice/one/en/welcome-5.mp3']);
    const b = cuePage({ els: el });
    b.load(); b.run(300);
    expect(b.audios).toEqual([]);
    const c = cuePage({ els: el, sess: { 'wq.welcome.voice': '/wq/voice/one/en/' }, store: { wq_snd: '0' } });
    c.load(); c.run(300);
    expect(c.audios).toEqual([]);
    expect(c.ctx.speechSynthesis).toBeUndefined();
  });
  test('the lines: the native read\'s final, linted like the welcome\'s', () => {
    const ctx = { window: {}, document: { documentElement: {} }, location: { search: '' } };
    ctx.window = ctx;
    vm.createContext(ctx);
    vm.runInContext(CUE, ctx);
    expect({ ...ctx.WQCUE.COPY }).toEqual(TURN);
    const GENDERED = new Set(['سکتے', 'سکتی', 'سکتا', 'گئے', 'گئی', 'گیا', 'آئے', 'آئی', 'آیا', 'کرتا', 'کرتی']);
    for (const s of Object.values(TURN)) {
      expect(s).not.toMatch(/\b(test|exam|quiz)\b|امتحان|ٹیسٹ|کوئز/i);
      for (const w of s.split(/[\s«»!؟۔،.,"?]+/).filter(Boolean)) expect(GENDERED.has(w)).toBe(false);
    }
  });
});

// sha of each page's HTML on #3143's branch before this change (GOLDEN_PRINT=1 prints them)
// written on #3143's branch a541baba5 with GOLDEN_PRINT=1
const GOLD = { quiz: 'deb8fd9f918ee397', hub: '65f258426c045b5e', lib: '8368acdd2fd4ae71', ch: '851358daaeb6742a' };
describe('GOLDEN: the four pages a Let\'s go can open render as today, byte for byte', () => {
  test('quiz, hub, library and challenge pages', () => {
    const quiz = { quiz: { id: 'q', code: 'AB12CD', topic: 'Plants', lang: 'en', dir: 'ltr', grade: '3', n: 1, questions: [] }, cls: { label: 'Class 3', teacher: null, chips: [] }, live: {} };
    const got = {
      quiz: sha(renderQuizPage({ payload: quiz, code: 'AB12CD', view: 'quiz', origin: 'https://example.test', assetV: 'v1' })),
      hub: sha(renderHubPage({ payload: { lang: 'en', kids: [], kid: null, brand: 'niete' }, token: TOKEN, origin: 'https://example.test', assetV: 'v1' })),
      lib: sha(renderLibPage({ hub: TOKEN, kid: 'k', lang: 'en', origin: 'https://example.test', assetV: 'v1', brandKey: 'niete' })),
      ch: sha(renderChallengePage({ menu: { lang: 'en' }, token: TOKEN, kid: 'k', origin: 'https://example.test', assetV: 'v1', chV: 'c1', brandKey: 'niete' })),
    };
    if (process.env.GOLDEN_PRINT) console.log(JSON.stringify(got));
    expect(got).toEqual(GOLD);
  });
});

describe('S5-1, S5-2, S5-3 (design-qa, the live walk): a neutral target only, and the bubble over nothing it must not cover', () => {
  // the three first screens a Let's go opens, as the live walk saw them (CSS px): a quiz question (its card with the
  // text and the speaker, three answers), the Jugnu games' "is someone helping you?" ask (a self-report: Jugnu's line
  // and two answers, no speaker), and the lesson video page (the frame with ▶, the lesson's rows, Go to the questions)
  const CAP_H = 60;
  const VIEWS = [['en', 390, 844], ['ur', 360, 740], ['ur', 360, 640], ['en', 360, 640]];
  const box = (top, h, left, w) => R(top, left, w, h);
  function quiz(vw) {
    const card = box(130, 150, 16, vw - 32);
    return { card, text: box(150, 110, 32, vw - 120), spk: box(143, 48, vw - 80, 48), opts: [box(296, 66, 16, vw - 32), box(372, 66, 16, vw - 32), box(448, 66, 16, vw - 32)] };
  }
  function video(vw) {
    const frame = box(170, 200, 16, vw - 32);
    return { frame, play: box(238, 64, vw / 2 - 32, 64), rows: [box(382, 40, 16, vw - 32), box(430, 40, 16, vw - 32), box(478, 40, 16, vw - 32)], go: box(530, 60, 16, vw - 32), say: box(70, 60, 120, vw - 136) };
  }
  const bubbleOf = (p) => {
    const m = /<p class="wqc-cap" style="([^"]*)"/.exec(p.cue()._h);
    const st = Object.fromEntries(m[1].split(';').filter(Boolean).map((x) => x.split(':')));
    const top = 'top' in st ? parseInt(st.top, 10) : p.ctx.innerHeight - parseInt(st.bottom, 10) - CAP_H;
    return { top, bottom: top + CAP_H };
  };
  const handOf = (p) => { const m = /class="wqc-hand" style="top:(\d+)px;left:(\d+)px/.exec(p.cue()._h); return { y: +m[1], x: +m[2] }; };
  const clear = (b, r) => b.bottom <= r.top || b.top >= r.bottom;
  const inside = (pt, r) => pt.x >= r.left && pt.x <= r.right && pt.y >= r.top && pt.y <= r.bottom;
  test.each(VIEWS)('a quiz question, %s %ix%i: the hand on the question\'s speaker, never on an answer; the bubble clear of the question and every answer', (lang, vw, vh) => {
    const L = quiz(vw);
    const el = (r) => mkEl('button', r);
    const opts = L.opts.map(el);
    const p = cuePage({ lang, vw, vh, els: { '.wq-opt': opts[0], '#wq-spk': el(L.spk), '.wq-qcard': el(L.card) }, qsa: { '.wq-opt': opts, '.wq-qcard': [el(L.card)], '.wq-qtext': [el(L.text)], button: [el(L.spk), ...opts] } });
    p.load();
    p.run(300);
    expect(inside(handOf(p), L.spk)).toBe(true);
    for (const o of L.opts) expect(inside(handOf(p), o)).toBe(false);
    const b = bubbleOf(p);
    for (const r of [L.card, L.text, ...L.opts]) expect([r.top, clear(b, r)]).toEqual([r.top, true]);
    expect(b.top).toBeGreaterThanOrEqual(8);
    expect(b.bottom).toBeLessThanOrEqual(vh - 8);
  });
  test.each(VIEWS)('a question with no speaker, %s %ix%i: no hand and no bubble at all (step 5 is skipped)', (lang, vw, vh) => {
    const L = quiz(vw);
    const opts = L.opts.map((r) => mkEl('button', r));
    const p = cuePage({ lang, vw, vh, els: { '.wq-opt': opts[0], '.wq-qcard': mkEl('div', L.card) }, qsa: { '.wq-opt': opts, button: opts } });
    p.load();
    for (const t of [300, 1000, 12000]) { p.run(t); expect([t, p.cue()]).toEqual([t, null]); }
    expect(p.pushed.filter((e) => e.n === 'welcome_step')).toEqual([]);
    expect(p.replaced).toEqual(['/q/MATH01?k=kk']);
  });
  test.each(VIEWS)('the self-report ask ("is someone helping you today?"), %s %ix%i: no hand on either answer, no bubble over its question: step 5 is skipped', (lang, vw, vh) => {
    const ask = mkEl('section', box(0, vh, 0, vw));
    const a1 = mkEl('button', box(300, 60, 16, vw - 32));
    const a2 = mkEl('button', box(372, 60, 16, vw - 32));
    const p = cuePage({ lang, vw, vh, pathname: '/c/tok', search: '?kid=a&lang=' + lang + '&w=1', els: { '[data-screen="help-ask"]': ask, '.wq-btn.wq-go': a1, '.wq-say': mkEl('div', box(120, 110, 110, vw - 126)) }, qsa: { button: [a1, a2] } });
    p.load();
    for (const t of [300, 1000, 12000]) { p.run(t); expect([t, p.cue()]).toEqual([t, null]); }
    expect(p.pushed.filter((e) => e.n === 'welcome_step')).toEqual([]);
    expect(p.replaced).toEqual(['/c/tok?kid=a&lang=' + lang]);
  });
  test.each(VIEWS)('the lesson video page, %s %ix%i: the hand on ▶ (never the scrubber); the bubble clear of the video frame, the buttons and the rows', (lang, vw, vh) => {
    const L = video(vw);
    const el = (r) => mkEl('button', r);
    const p = cuePage({ lang, vw, vh, els: { '.wq-vplay': el(L.play), '.wq-vcover': el(L.frame), '[data-primary]': el(L.go) }, qsa: { '.wq-vbox': [el(L.frame)], video: [el(L.frame)], '.wq-how li': L.rows.map(el), button: [el(L.frame), el(L.go)], '.wq-say': [el(L.say)] } });
    p.load();
    p.run(300);
    expect(inside(handOf(p), L.play)).toBe(true);
    const b = bubbleOf(p);
    for (const r of [L.frame, L.go, ...L.rows]) expect([r.top, clear(b, r)]).toEqual([r.top, true]);
    expect(b.bottom).toBeLessThanOrEqual(vh - 8);
  });
});

describe('step 5\'s clip (#3146): welcome-5 at its folder\'s version', () => {
  test('the path and version the welcome handed over: welcome-5.mp3?v=<hash>', () => {
    const p = cuePage({ lang: 'ur', els: { '[data-primary]': mkEl('a', R(300, 16, 328, 60)) }, sess: { 'wq.welcome.voice': '/wq/voice/welcome/sx-reyna-68567f-ur/', 'wq.welcome.voice_v': 'edb3c4ac' } });
    p.load(); p.run(300);
    expect(p.audios.map((x) => x.src)).toEqual(['/wq/voice/welcome/sx-reyna-68567f-ur/welcome-5.mp3?v=edb3c4ac']);
  });
});
