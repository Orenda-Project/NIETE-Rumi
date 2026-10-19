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
function cuePage({ lang = 'en', search = '?k=kk&w=1', pathname = '/q/MATH01', hash = '', els = {}, sess = {}, store = {}, tel = true, obstacles = [], qsa = {}, vw = 360, vh = 640 } = {}) {
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
    location: { search, pathname, hash },
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
  // the bubble's rect (it spans the page between its 16 px gutters) and the distance between two rects (0 when they meet)
  const bubbleRect = (p, vw) => ({ ...bubbleOf(p), left: 16, right: vw - 16 });
  const dist = (a, b) => Math.max(0, b.top - a.bottom, a.top - b.bottom, b.left - a.right, a.left - b.right);
  const near = (b, target, others) => {
    const d = dist(b, target);
    return [d <= 24, others.every((o) => d < dist(b, o))];
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
    for (const r of [L.text, ...L.opts]) expect([r.top, clear(b, r)]).toEqual([r.top, true]);
    expect(b.top).toBeGreaterThanOrEqual(8);
    expect(b.bottom).toBeLessThanOrEqual(vh - 8);
    // S5-4: right next to the speaker (≤ 24 px), and nearer to it than to any answer
    expect(near(bubbleRect(p, vw), L.spk, L.opts)).toEqual([true, true]);
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
    for (const r of [L.go, ...L.rows]) expect([r.top, clear(b, r)]).toEqual([r.top, true]);
    expect(b.top).toBeGreaterThanOrEqual(8);
    expect(b.bottom).toBeLessThanOrEqual(vh - 8);
    // S5-4: right next to ▶ (≤ 24 px; over the frame's edge only as far as that takes), nearer to it than to Go to the questions
    expect(near(bubbleRect(p, vw), L.play, [L.go])).toEqual([true, true]);
    const into = Math.max(0, Math.min(b.bottom, L.frame.bottom) - Math.max(b.top, L.frame.top));
    expect(into).toBeLessThanOrEqual(Math.max(0, L.play.top - L.frame.top - 8 - 24) + CAP_H);
  });
});

describe('step 5\'s clip (#3146): welcome-5 at its folder\'s version', () => {
  test('the path and version the welcome handed over: welcome-5.mp3?v=<hash>', () => {
    const p = cuePage({ lang: 'ur', els: { '[data-primary]': mkEl('a', R(300, 16, 328, 60)) }, sess: { 'wq.welcome.voice': '/wq/voice/welcome/sx-reyna-68567f-ur/', 'wq.welcome.voice_v': 'edb3c4ac' } });
    p.load(); p.run(300);
    expect(p.audios.map((x) => x.src)).toEqual(['/wq/voice/welcome/sx-reyna-68567f-ur/welcome-5.mp3?v=edb3c4ac']);
  });
});

describe('S5-3 on every video surface, and S5-5 (design-qa, the live walk)', () => {
  const CAP_H = 60;
  const bubbleOf = (p) => {
    const m = /<p class="wqc-cap" style="([^"]*)"/.exec(p.cue()._h);
    const st = Object.fromEntries(m[1].split(';').filter(Boolean).map((x) => x.split(':')));
    return { top: parseInt(st.top, 10), bottom: parseInt(st.top, 10) + CAP_H, left: 16, right: p.ctx.innerWidth - 16 };
  };
  const handOf = (p) => { const m = /class="wqc-hand" style="top:(\d+)px;left:(\d+)px/.exec(p.cue()._h); return { y: +m[1], x: +m[2] }; };
  const inside = (pt, r) => pt.x >= r.left && pt.x <= r.right && pt.y >= r.top && pt.y <= r.bottom;
  const dist = (a, b) => Math.max(0, b.top - a.bottom, a.top - b.bottom, b.left - a.right, a.left - b.right);
  test.each([['en', 390, 844], ['ur', 360, 740], ['ur', 360, 640]])('the Videos tab\'s inline player (#watch), %s %ix%i: its ▶ once the player is in, never the loading frame', (lang, vw, vh) => {
    const frame = R(110, 16, vw - 32, (vw - 32) * 9 / 16);
    const play = R(frame.top + frame.height / 2 - 42, vw / 2 - 42, 84, 84);
    const skel = mkEl('div', R(110, 16, vw - 32, 300));
    const ready = (t) => t >= 900;
    // the home is drawn first (its Next stop is a primary), the #watch player over it a moment later
    const homeNext = mkEl('a', R(120, 16, vw - 32, 260));
    const p = cuePage({ lang, vw, vh, pathname: '/h/tok', search: '?kid=a&w=1', hash: '#watch/aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaaa', els: {
      '.wq-btn.wq-go': (t) => (t < 300 ? homeNext : null),
      '[data-primary]': (t) => (t < 300 ? homeNext : ready(t) ? mkEl('button', play) : skel), '[aria-busy="true"]': (t) => (t >= 300 && !ready(t) ? skel : null), '.wq-vskel': (t) => (t >= 300 && !ready(t) ? skel : null),
      '.wq-vplay': (t) => (ready(t) ? mkEl('button', play) : null), '.wq-vbox': (t) => (ready(t) ? mkEl('div', frame) : skel),
    }, qsa: { '.wq-vbox': [mkEl('div', frame)], video: [mkEl('div', frame)], button: [mkEl('button', play)] } });
    p.load();
    p.run(600);
    expect(p.cue()).toBeNull(); // neither the home under it nor the loading frame is a target
    p.run(900);
    expect(inside(handOf(p), play)).toBe(true);
    expect(dist(bubbleOf(p), play)).toBeLessThanOrEqual(24);
  });
  test.each([['en', 390, 844], ['ur', 360, 740]])('a native player alone (no ▶ of the page\'s own), %s %ix%i: the frame\'s centre', (lang, vw, vh) => {
    const frame = R(150, 16, vw - 32, 200);
    const p = cuePage({ lang, vw, vh, els: { video: mkEl('video', frame) }, qsa: { video: [mkEl('video', frame)] } });
    p.load();
    p.run(300);
    const h = handOf(p);
    expect(Math.abs(h.y - (frame.top + frame.height / 2))).toBeLessThanOrEqual(34);
    expect(Math.abs(h.x - (frame.left + frame.width / 2))).toBeLessThanOrEqual(40);
  });
  test.each([['ur', 360, 740], ['ur', 360, 640], ['en', 390, 844]])('S5-5, the lesson page, %s %ix%i: the bubble covers the heading over the frame fully or not at all, still within 24 px of ▶', (lang, vw, vh) => {
    const head = R(140, 16, vw - 32, 50); // «سبق دیکھیں (اختیاری)»
    const frame = R(200, 16, vw - 32, 200);
    const play = R(262, vw / 2 - 38, 76, 76);
    const p = cuePage({ lang, vw, vh, els: { '.wq-vplay': mkEl('span', play), '.wq-vcover': mkEl('button', frame) }, qsa: { h2: [mkEl('h2', head)], '.wq-vbox': [mkEl('div', frame)], button: [mkEl('button', frame)] } });
    p.load();
    p.run(300);
    const b = bubbleOf(p);
    const o = Math.max(0, Math.min(b.bottom, head.bottom) - Math.max(b.top, head.top));
    expect([o === 0 || o >= head.height]).toEqual([true]);
    expect(dist(b, play)).toBeLessThanOrEqual(24);
  });
});

describe('S5-6 (design-qa, the live walk): never a second bubble over a speech line or an instruction; clear of chips', () => {
  const CAP_H = 60;
  const bubbleOf = (p) => {
    const m = /<p class="wqc-cap" style="([^"]*)"/.exec(p.cue()._h);
    if (!m) return null;
    const st = Object.fromEntries(m[1].split(';').filter(Boolean).map((x) => x.split(':')));
    return { top: parseInt(st.top, 10), bottom: parseInt(st.top, 10) + CAP_H, left: 16, right: p.ctx.innerWidth - 16 };
  };
  const handOf = (p) => { const m = /class="wqc-hand" style="top:(\d+)px;left:(\d+)px/.exec(p.cue()._h); return { y: +m[1], x: +m[2] }; };
  const inside = (pt, r) => pt.x >= r.left && pt.x <= r.right && pt.y >= r.top && pt.y <= r.bottom;
  const dist = (a, b) => Math.max(0, b.top - a.bottom, a.top - b.bottom, b.left - a.right, a.left - b.right);
  test.each([['en', 390, 844], ['ur', 360, 740]])('the quiz\'s who-is-playing screen, %s %ix%i: the hand on Jugnu, no bubble; Jugnu\'s own line stays in full view', (lang, vw, vh) => {
    // «آج کس کی باری ہے؟»: Jugnu (the target) with his line «اپنا نام دبائیں۔» beside him, the children's names below
    const say = mkEl('div', R(120, 120, vw - 136, 70));
    const jugBox = mkEl('div', R(110, 16, vw - 32, 100));
    const img = mkEl('span', R(116, 16, 92, 92));
    jugBox.querySelector = (sel) => (sel === '.wq-say' ? say : null);
    img.closest = (sel) => (/wq-jug/.test(sel) ? jugBox : null);
    const kid = mkEl('button', R(300, 16, vw - 32, 64));
    const p = cuePage({ lang, vw, vh, els: { '[data-primary]': img }, qsa: { '.wq-say': [say], button: [kid] } });
    p.load();
    p.run(300);
    expect(p.cue()).toBeTruthy();
    expect(inside(handOf(p), R(116, 16, 92, 92))).toBe(true);
    expect(bubbleOf(p)).toBeNull();
  });
  test.each([['en', 390, 844], ['ur', 360, 740]])('the same screen as the page draws it, %s %ix%i: Jugnu\'s live loop (a video in his picture), no primary button: the hand on him, no bubble', (lang, vw, vh) => {
    // the who-is-playing screen with a child on the phone has no primary: the cue lands on Jugnu's own loop video
    const say = mkEl('div', R(93, 16, vw - 182, 98));
    const jugBox = mkEl('div', R(72, 16, vw - 32, 140));
    const vid = mkEl('video', R(72, vw - 156, 140, 140));
    jugBox.querySelector = (sel) => (sel === '.wq-say' ? say : null);
    vid.closest = (sel) => (sel === '.wq-jug' ? jugBox : null);
    const kid = mkEl('button', R(330, 16, vw - 32, 64));
    const p = cuePage({ lang, vw, vh, els: { video: vid }, qsa: { '.wq-say': [say], button: [kid] } });
    p.load();
    p.run(300);
    expect(p.cue()).toBeTruthy();
    expect(inside(handOf(p), vid.rect)).toBe(true);
    expect(bubbleOf(p)).toBeNull();
  });
  test.each([['en', 390, 844], ['ur', 360, 740], ['ur', 360, 640]])('any target: the bubble never lies on a speech line or an instruction, %s %ix%i', (lang, vw, vh) => {
    // a primary with Jugnu's line right above it and an instruction line right below it
    const go = mkEl('button', R(300, 16, vw - 32, 60));
    const say = mkEl('div', R(220, 120, vw - 136, 64));
    const sub = mkEl('p', R(372, 16, vw - 32, 40));
    const p = cuePage({ lang, vw, vh, els: { '[data-primary]': go }, qsa: { '.wq-say': [say], '.wq-sub': [sub], button: [go] } });
    p.load();
    p.run(300);
    const b = bubbleOf(p);
    if (b) for (const r of [say.rect, sub.rect]) expect([r.top, b.bottom <= r.top || b.top >= r.bottom]).toEqual([r.top, true]);
  });
  // S5-7: the Videos tab's player (#watch) with the lesson's title right under it: the bubble covers a text block
  // (a heading, a title, a chip, a line) fully or not at all, and clears it rather than covers it when both are in reach
  const cut = (b, r) => { const o = Math.max(0, Math.min(b.bottom, r.bottom) - Math.max(b.top, r.top)); return o > 0 && o < r.bottom - r.top; };
  const watchPage = (lang, vw, vh, titleAt, titleH) => {
    // as the page draws it: the tab's heading «ویڈیوز» and Home over the player, the title under it
    const head = R(24, 92, vw - 124, 61);
    const home = R(30, 16, 48, 48);
    const frame = R(113, 16, vw - 32, Math.round((vw - 32) * 9 / 16));
    const play = R(frame.top + frame.height / 2 - 42, vw / 2 - 42, 84, 84);
    const title = mkEl('p', R(titleAt(frame, play), 16, vw - 32, titleH)); // «ہم آواز الفاظ»
    const p = cuePage({ lang, vw, vh, pathname: '/h/tok', search: '?kid=a&w=1', hash: '#watch/aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      els: { '.wq-vplay': mkEl('button', play), '[data-primary]': mkEl('button', play), '.wq-vbox': mkEl('div', frame) },
      qsa: { h2: [mkEl('h2', head)], '.wq-vbox': [mkEl('div', frame)], '.wq-vtitle': [title], button: [mkEl('button', play)], 'a[href]': [mkEl('a', home)] } });
    p.load();
    p.run(300);
    return { p, play, title: title.rect };
  };
  test.each([['ur', 360, 740], ['ur', 360, 640], ['en', 390, 844]])('S5-7, #watch %s %ix%i: the lesson title under the player is never half covered; the bubble still within 24 px of ▶', (lang, vw, vh) => {
    const { p, play, title } = watchPage(lang, vw, vh, (f) => f.bottom + 26, 34);
    const b = bubbleOf(p);
    expect(inside(handOf(p), play)).toBe(true);
    expect(b).toBeTruthy();
    expect([title.top, cut(b, title)]).toEqual([title.top, false]);
    expect(dist(b, play)).toBeLessThanOrEqual(24);
  });
  test.each([['ur', 360, 740], ['en', 390, 844]])('S5-7, %s %ix%i: clearing a text block wins over covering it when both are within 24 px', (lang, vw, vh) => {
    // a primary with another button right over it (so the bubble goes below) and a thin caption 10 px under it: the
    // bubble 8 px down would swallow the caption whole, 20 px down clears it
    const go = mkEl('button', R(300, 16, vw - 32, 60));
    const back = mkEl('button', R(250, 16, vw - 32, 44));
    const caption = mkEl('p', R(370, 16, vw - 32, 8));
    const p = cuePage({ lang, vw, vh, els: { '[data-primary]': go }, qsa: { p: [caption], button: [go, back] } });
    p.load();
    p.run(300);
    const b = bubbleOf(p);
    expect(b).toBeTruthy();
    expect(Math.max(0, Math.min(b.bottom, caption.rect.bottom) - Math.max(b.top, caption.rect.top))).toBe(0);
    expect(dist(b, go.rect)).toBeLessThanOrEqual(24);
  });
  test.each([['ur', 360, 740], ['ur', 360, 640], ['en', 390, 844]])('the lesson door\'s «دیکھ لیا ✓» chip, %s %ix%i: the bubble keeps clear of it (≥ 4 px), still within 24 px of ▶', (lang, vw, vh) => {
    const frame = R(200, 16, vw - 32, 200);
    const play = R(230, vw / 2 - 38, 76, 76);
    const chip = mkEl('span', R(208, vw - 160, 140, 34));
    const p = cuePage({ lang, vw, vh, els: { '.wq-vplay': mkEl('span', play), '.wq-vcover': mkEl('button', frame) }, qsa: { '.wq-vwatched': [chip], '.wq-vbox': [mkEl('div', frame)], button: [mkEl('button', frame)] } });
    p.load();
    p.run(300);
    const b = bubbleOf(p);
    expect(b).toBeTruthy();
    expect(dist(b, chip.rect)).toBeGreaterThanOrEqual(4);
    expect(dist(b, play)).toBeLessThanOrEqual(24);
  });
});
