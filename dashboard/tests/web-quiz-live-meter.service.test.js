/**
 * The live reading meter (public/wq/wq-pace.js; the bot names its variant as `pace` under app_settings
 * web_quiz_live_meter, and the edge loads the file with data-meter). It rises with every word read right and falls
 * gently in a pause; never a number. Where it is loaded it takes the glow's place: on a story page (mount) and on the
 * Challenge's reading screen (the trail), keeping its state when the screen redraws. Not loaded ⇒ today's glow.
 * Only the browser and the network are faked.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const H = require('./wqc-page-harness');
const { ok, CLIPS, STORY, COPY } = H;

const PUB = path.join(__dirname, '..', 'public', 'wq');
const LIVE_SRC = fs.readFileSync(path.join(PUB, 'wq-read-live.js'), 'utf8');
const TRAIL_SRC = fs.readFileSync(path.join(PUB, 'wq-trail.js'), 'utf8');
const LR_SRC = fs.readFileSync(path.join(PUB, 'wq-liveread.js'), 'utf8');
const PACE_PATH = path.join(PUB, 'wq-pace.js');
const PACE_SRC = fs.existsSync(PACE_PATH) ? fs.readFileSync(PACE_PATH, 'utf8') : '';
const toks = (ws, { from = 0, gap = 1, final = true } = {}) => ws.map((w, k) => ({ text: (from + k === 0 ? '' : ' ') + w, start_ms: (from + k) * gap * 1000, end_ms: ((from + k) * gap + 0.8) * 1000, is_final: final }));

// the meter alone, loaded by a script tag that says data-meter / data-grade
function pace(attrs = {}) {
  const window = {};
  const document = { currentScript: { getAttribute: (k) => (k in attrs ? attrs[k] : null) } };
  const ctx = { window, document, Math, Number, String, Date };
  vm.createContext(ctx);
  vm.runInContext(PACE_SRC, ctx);
  return window.WQPace;
}
// a stand-in meter that records what the reader asks of it
const FAKE = (v) => `var __pace = []; window.WQPace = { variant: ${JSON.stringify(v)}, grade: 'G3', mount: function (el, o) { var r = { el: el, o: o, words: [] }; __pace.push(r); return { word: function (n) { r.words.push(n); }, stop: function () { r.stopped = true; }, destroy: function () { r.gone = true; } }; } };`;

describe('the meter: how full, how fast it falls', () => {
  test('full by grade: G1–2 35, G3 50, G4–5 60 correct words a minute; an unknown grade is the kinder G1–2', () => {
    const P = pace();
    expect([P.full('G1'), P.full(2), P.full('G3'), P.full(4), P.full('G5'), P.full(undefined), P.full('KG')]).toEqual([35, 35, 50, 60, 60, 35, 35]);
  });
  test('a word lifts it at once; a 6-s pause lets it fall to about a third; never below 0, never above 1', () => {
    const P = pace();
    const a = P.step(null, 0, 1, { grade: 'G3' });
    expect(a.level).toBeCloseTo(1 / 5, 5);                 // 50 a minute over 6 s = 5 words fill it
    const b = P.step(a, 6000, 0, { grade: 'G3' });
    expect(b.level).toBeCloseTo(a.level / Math.E, 5);
    let s = null;
    for (let t = 0; t <= 60000; t += 600) s = P.step(s, t, 1, { grade: 'G3' });   // 100 a minute: past full
    expect(s.level).toBe(1);
    expect(P.step(s, 600000, 0, { grade: 'G3' }).level).toBeGreaterThanOrEqual(0);
  });
  test('a steady read at the grade\'s pace fills it; half that pace sits near half', () => {
    const P = pace();
    let s = null;
    for (let t = 0; t <= 30000; t += 1200) s = P.step(s, t, 1, { grade: 'G3' });   // 50 a minute
    expect(s.level).toBeGreaterThan(0.9);
    s = null;
    for (let t = 0; t <= 30000; t += 2400) s = P.step(s, t, 1, { grade: 'G3' });   // 25 a minute
    expect(s.level).toBeGreaterThan(0.4);
    expect(s.level).toBeLessThan(0.75);
  });
  test('the variant and grade come from its own script tag; an unknown variant is none', () => {
    expect(pace({ 'data-meter': 'vine', 'data-grade': 'G4' })).toMatchObject({ variant: 'vine', grade: 'G4' });
    expect(pace({ 'data-meter': 'sky' }).variant).toBe('sky');
    expect(pace({ 'data-meter': 'rainbow' }).variant).toBeNull();
  });
});

// ── the Challenge's reading screen under lr3 ──────────────────────────────────────────────────
const TC = { title: "{name}'s Trail", sub: '{done} of {total} stops done.', allDone: 'All done', badge: 'Done', next: 'Next', mic: 'uses the microphone', needsMic: 'needs a microphone', micWait: 'wait', other: 'Go to another stop', back: 'Back to the trail', practice: 'Practice round.', stopDone: 'Stop done!' };
const EXS = [{ id: 'read', name: 'Read aloud', mins: 2, done: false, last: null, badge: false, mic: true }];
const V2 = { pool: true, story: true, consent: false };
const MENU = { lang: 'en', form: 'G3', record: true, trail: true, trail_copy: TC, exercises: EXS, v2: V2, lr3: true };
const ROOM = 'https://portal.test/c/HUB.TOKEN?kid=&lang=en&room=story&pid=en.read.1.kite';
const KEY = { api_key: 'temp:key-test-only', expires_at: 'x', ws: 'wss://stt.test/ws', model: 'stt-rt-v5', lang: 'en' };
const LR3 = (quiet = true) => ({ meter: 'glow', done: true, done_from: quiet ? 0 : 0.8, counted: !quiet, finish: { pct: 0.8, quiet_ms: 4000, tail_ms: 1000, quiet } });
const SREAD = (extra = {}) => ({ ex: 'read', ct: 'CTS', secs: 60, clips: CLIPS, story: STORY, story_clip: { url: '/clips/story-kite.mp3' }, trail: true, trail_copy: TC, v2: V2, practice_round: true, mode: 'practice', questions_on: false, live: true, ...extra });
// a fake Soniox socket and the window's event bus, on the page's own window
const WS = 'var __socks = []; window.WebSocket = function (u) { this.url = u; this.sent = []; this.bufferedAmount = 0; __socks.push(this); };'
  + 'window.WebSocket.prototype.send = function (x) { this.sent.push(x); }; window.WebSocket.prototype.close = function () { this.closed = true; };'
  + 'var __evs = []; window.dispatchEvent = function (e) { __evs.push(e); return true; }; CustomEvent = function (n, o) { this.type = n; this.detail = o && o.detail; };';
const ROUTES = (read, extra = {}) => ({ 'ch/HUB.TOKEN/read': ok(read), 'ch/live': ok(KEY), 'ch/upload': ok({ put_url: 'https://store.test/put', content_type: 'audio/webm', key: 'k1' }), 'store.test': ok({}), ...extra });
const store = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
const room = (o = {}) => H.page({ menu: MENU, href: ROOM, freshEls: true, session: store(), ...o, pre: [LIVE_SRC, WS, ...(o.pre || []), LR_SRC, TRAIL_SRC] });
const startRead = async (p) => { await p.flush(); await p.click('wqc-story-read'); await p.flush(); };
const sock = (p) => p.ctx.__socks[0];

describe('the Challenge reading screen: the meter in the glow\'s place', () => {
  test('loaded: the glow\'s box holds the meter, and every word heard lifts it by the words newly lit', async () => {
    const p = room({ pre: [FAKE('sky')], routes: ROUTES(SREAD({ lr3: LR3() })) });
    await startRead(p);
    const s = sock(p); s.onopen({});
    const P = p.ctx.__pace;
    expect(P.length).toBe(1);
    expect(p.els['wqc-lr-glow'].className).toBe('lr-pace lr-pace-sky');
    expect(P[0].o).toMatchObject({ variant: 'sky', grade: 'G3' });
    s.onmessage({ data: JSON.stringify({ tokens: toks(STORY.tokens.slice(0, 3)) }) });
    s.onmessage({ data: JSON.stringify({ tokens: toks(STORY.tokens.slice(3, 5), { from: 3 }) }) });
    const all = P.filter((r) => !r.gone);
    expect(all.length).toBe(1);
    expect(all[0].words.reduce((a, n) => a + n, 0)).toBe(5);
    expect(p.els['wqc-lr-glow'].className).toBe('lr-pace lr-pace-sky');   // never repainted as a glow
    expect(p.html()).not.toMatch(/wqc-wpm|words a minute/);
  });
  test('not loaded (switch off): today\'s glow, untouched', async () => {
    const p = room({ routes: ROUTES(SREAD({ lr3: LR3() })) });
    await startRead(p);
    const s = sock(p); s.onopen({});
    s.onmessage({ data: JSON.stringify({ tokens: toks(STORY.tokens.slice(0, 5)) }) });
    expect(p.els['wqc-lr-glow'].className).toBe('lr-glow lr-glow-3');
  });
});

describe('a story page (mount): the meter in the glow\'s place', () => {
  function dom() {
    const made = [];
    function El(sel) { this.sel = sel; this.className = ''; this.style = {}; this.l = {}; this.innerHTML = ''; }
    El.prototype.addEventListener = function (n, fn) { this.l[n] = fn; };
    const el = new El('root');
    const kids = {};
    el.querySelector = (sel) => { if (!kids[sel]) kids[sel] = new El(sel); return kids[sel]; };
    el.querySelectorAll = (sel) => { const n = (el.innerHTML.match(/class="lr-w[^"]*"/g) || []).length; if (!kids[sel] || kids[sel].length !== n) kids[sel] = Array.from({ length: n }, () => new El(sel)); return kids[sel]; };
    return { el, kids, made };
  }
  function env() {
    const socks = []; const recs = []; const evs = [];
    const window = {};
    function WebSocket(u) { this.url = u; this.sent = []; this.bufferedAmount = 0; socks.push(this); }
    WebSocket.prototype.send = function (x) { this.sent.push(x); }; WebSocket.prototype.close = function () {};
    function MediaRecorder() { this.state = 'inactive'; recs.push(this); }
    MediaRecorder.prototype.start = function (s) { this.state = 'recording'; this.slice = s; };
    MediaRecorder.prototype.stop = function () { this.state = 'inactive'; };
    window.WebSocket = WebSocket; window.MediaRecorder = MediaRecorder;
    window.dispatchEvent = (e) => evs.push(e);
    const timers = [];
    const ctx = { window, console, Date, Math, JSON, String, Number, Object, Array, RegExp, Promise, Blob: function () {},
      CustomEvent: function (n, o) { this.type = n; this.detail = o && o.detail; },
      setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout() {}, setInterval: () => 1, clearInterval() {},
      navigator: { userAgent: 'Android' }, location: { host: 'x', pathname: '/', search: '' } };
    vm.createContext(ctx);
    vm.runInContext(LIVE_SRC, ctx);
    vm.runInContext(LR_SRC, ctx);
    const flush = async () => { for (let i = 0; i < 6; i += 1) await new Promise((r) => setImmediate(r)); };
    return { L: window.WQLiveRead, socks, recs, evs, timers, flush, window, ctx };
  }
  const PAGE = ['The', 'kite', 'flew', 'high'];
  const KEYP = () => Promise.resolve({ ws: 'wss://x', api_key: 'k', model: 'm', lang: 'en' });
  test('loaded: a slot instead of the glow, a lift per word heard, stopped when the reading ends', async () => {
    const E = env(); const D = dom();
    vm.runInContext(FAKE('sky'), E.ctx);
    E.L.mount(D.el, { words: PAGE, lang: 'en', meter: 'none', getKey: KEYP, stream: {} });
    expect(D.el.innerHTML).toMatch(/<p class="lr-nudge">[^<]*<\/p><div class="lr-pace"><\/div><div class="lr-text">/);   // above the words
    expect(D.el.innerHTML).not.toContain('lr-glow');
    const P = E.ctx.__pace;
    expect(P.length).toBe(1);
    expect(P[0].el.sel).toBe('.lr-pace');
    await E.flush();
    const s = E.socks[0]; s.onopen({});
    s.onmessage({ data: JSON.stringify({ tokens: toks(['the', 'kite']) }) });
    s.onmessage({ data: JSON.stringify({ tokens: toks(['flew', 'high'], { from: 2 }) }) });
    expect(P[0].words.reduce((a, n) => a + n, 0)).toBe(4);
    expect(P[0].stopped).toBeUndefined();
    D.kids['.lr-done'].l.click();   // the reading ends (here: Done)
    expect(P[0].stopped).toBe(true);
  });
  test('the vine: the reader is .lr-vine and the meter stands in it', () => {
    const E = env(); const D = dom();
    vm.runInContext(FAKE('vine'), E.ctx);
    E.L.mount(D.el, { words: PAGE, lang: 'ur', meter: 'none', getKey: KEYP, stream: {} });
    expect(D.el.innerHTML).toContain('<div class="lr lr-vine" dir="rtl" lang="ur">');
    expect(E.ctx.__pace[0].el.sel).toBe('.lr');
    expect(D.el.innerHTML).not.toContain('lr-pace');
  });
  test('not loaded: today\'s markup, byte for byte (meter none: no glow; meter glow: the glow)', () => {
    const a = env(); const A = dom();
    a.L.mount(A.el, { words: PAGE, lang: 'en', meter: 'none', getKey: KEYP, stream: {} });
    expect(A.el.innerHTML).not.toMatch(/lr-pace|lr-glow|lr-vine/);
    const b = env(); const B = dom();
    vm.runInContext('window.WQPace = { variant: null };', b.ctx);
    b.L.mount(B.el, { words: PAGE, lang: 'en', meter: 'none', getKey: KEYP, stream: {} });
    expect(B.el.innerHTML).toBe(A.el.innerHTML);
    const c = env(); const C = dom();
    c.L.mount(C.el, { words: PAGE, lang: 'en', getKey: KEYP, stream: {} });
    expect(C.el.innerHTML).toContain('<div class="lr-glow lr-glow-0" aria-hidden="true"></div>');
  });
});

describe('the edge loads the meter only when the bot names it', () => {
  const { renderChallengePage, renderHubPage } = require('../routes/web-quiz.routes');
  const ch = (menu) => renderChallengePage({ menu: { lang: 'en', exercises: [], ...menu }, token: 't', kid: null, origin: 'https://x', assetV: 'v1', chV: 'c', brandKey: 'niete' });
  const hub = (payload) => renderHubPage({ payload: { lang: 'en', ...payload }, token: 'HUB.TOKEN', origin: 'https://x', assetV: 'abcdef0123' });
  test('the Challenge: lr3 + pace ⇒ wq-pace.css and wq-pace.js with data-meter and the menu\'s grade', () => {
    const html = ch({ lr3: true, pace: 'vine', form: 'G4' });
    expect(html).toMatch(/<link rel="stylesheet" href="\/wq\/wq-pace\.css\?v=[0-9a-f]{10}">/);
    expect(html).toMatch(/<script src="\/wq\/wq-pace\.js\?v=[0-9a-f]{10}" data-meter="vine" data-grade="G4" defer><\/script>/);
  });
  test('the hub: pace ⇒ the meter before hub.js', () => {
    const html = hub({ pace: 'sky' });
    expect(html.indexOf('data-meter="sky"')).toBeGreaterThan(0);
    expect(html.indexOf('wq-pace.js')).toBeLessThan(html.indexOf('/wq/hub.js'));
  });
  test('off, or an unknown name: not a byte of it', () => {
    expect(ch({ lr3: true })).not.toContain('wq-pace');
    expect(ch({ lr3: true, pace: 'rainbow' })).not.toContain('wq-pace');
    expect(ch({ pace: 'sky' })).not.toContain('wq-pace');   // only under live reading v3
    expect(hub({})).not.toContain('wq-pace');
    expect(hub({ pace: '"><script>' })).not.toContain('wq-pace');
  });
});
