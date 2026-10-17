/**
 * The storybook reader's voice requests, in order (wq-stories.js, wq-stories-q.js, wq-stories-d.js).
 *
 * With the faster-wait switch on (app_settings web_quiz_wait_ux; the book answer says `wait_ux: true`):
 *   1. opening a book asks for the first page's voice only (no other page, no questions voice);
 *   2. the next page's voice is asked for when the current page STARTS PLAYING, never when a page is only shown;
 *   3. the questions voice (the sprite, or each question's own clips) is asked for once the child reaches the
 *      last page, never before.
 * Off (no `wait_ux`, or anything but true): today's order, pinned below request for request.
 *
 * Every Audio the page makes is a stand-in that records each `src` it is given, labelled with the step the test is
 * on. The player (WQReadAlong) is a stand-in shaped like the real one: mount() makes the page's own Audio and gives
 * it the page's voice at once; preload() makes one Audio with preload=auto on the voice; play() starts that Audio
 * (its 'play' event, then the 'playing' state). The book's JSON is the boundary; invented books only.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const DIR = path.join(__dirname, '..', 'public', 'wq');
const SRC = path.join(DIR, 'wq-stories.js');
const QSRC = path.join(DIR, 'wq-stories-q.js');
const DSRC = path.join(DIR, 'wq-stories-d.js');
const TOKEN = 'eyJrIjoiaCJ9.AbCdEfGhIjKlMnOpQrStUv';
const KID = 'kidchipabcdefghi';

const W = (i, t, s) => ({ i, t, s_ms: s, e_ms: s + 400 });
const PAGE = (n) => ({
  n, image: { url: `/s/b-7/p0${n}.webp`, w: 720, h: 1080 }, text_band: null, text: `Page ${n} is here.`,
  words: [W(0, 'Page', 100), W(1, String(n), 600), W(2, 'is', 1100), W(3, 'here.', 1600)],
  audio: { url: `/a/p${n}.ogg`, ms: 2200 }, boxes_ok: false, is_picture: false,
});
const SPRITE = { url: '/a/qs.ogg', clips: { q1: { s_ms: 0, e_ms: 1200 }, q1o1: { s_ms: 1300, e_ms: 1800 }, q1o2: { s_ms: 1900, e_ms: 2400 }, q2: { s_ms: 2500, e_ms: 3600 } } };
const CLIPS = { q: '/a/q1.ogg', o: ['/a/q1o1.ogg', '/a/q1o2.ogg'] };
// a three-page book with two questions; `over` adds the switch (`wait_ux`), the stall setting (`steady`), the sprite
function book(over = {}) {
  return {
    id: 'b-7', title: 'Kite Day', lang: 'en', dir: 'ltr', grade: 2, pace_wpm: 90, lr3: false,
    pages: [PAGE(1), PAGE(2), PAGE(3)],
    questions: [
      { n: 1, kind: 'literal', page_ref: 1, q: 'What flies?', options: [{ t: 'a kite' }, { t: 'a cup' }] },
      { n: 2, kind: 'literal', page_ref: 3, q: 'Where does it go?', options: [{ t: 'up' }, { t: 'down' }] },
    ],
    ...over,
  };
}
const withSprite = (over = {}) => book({ questions_sprite: SPRITE, ...over });
const withClips = (over = {}) => {
  const b = book(over);
  b.questions[0].audio = CLIPS;
  return b;
};

// ---- a small fake DOM -------------------------------------------------------------------------------------------
function key(sel) { return sel.replace(/^[.[]/, '').replace(/[\]=].*$/, '').split(' ')[0]; }
function fakeEl(name) {
  const els = {};
  const L = {};
  return {
    name, _h: '', attrs: {}, style: {}, hidden: false, textContent: '', className: '', clientWidth: 360, clientHeight: 540, L,
    set innerHTML(h) { this._h = String(h); Object.keys(els).forEach((k) => delete els[k]); }, get innerHTML() { return this._h; },
    setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return this.attrs[k] == null ? null : this.attrs[k]; }, removeAttribute(k) { delete this.attrs[k]; },
    addEventListener(n, f) { (L[n] = L[n] || []).push(f); }, removeEventListener() {},
    querySelector(sel) { if (!this._h.includes(key(sel))) return null; els[sel] = els[sel] || fakeEl(sel); return els[sel]; },
    querySelectorAll() { return []; }, appendChild() {},
  };
}
const flush = () => new Promise((r) => setImmediate(r));

function env(bk) {
  let now = 0;
  let step = 'boot';
  const timers = [];
  const clock = {
    now: () => now,
    set(f, ms) { const t = { f, at: now + (ms || 0), id: timers.length + 1 }; timers.push(t); return t.id; },
    clear(id) { const t = timers.find((x) => x.id === id); if (t) t.dead = true; },
  };
  function advance(ms) {
    const end = now + ms;
    for (;;) {
      const due = timers.filter((t) => !t.dead && !t.done && t.at <= end).sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!due) break;
      now = due.at; due.done = true; due.f();
    }
    now = end;
  }
  // every voice request, in order: [step, url]
  const asked = [];
  const players = [];
  function Audio(u) {
    const a = this;
    let src = '';
    a.l = {}; a.currentTime = 0; a.readyState = 0; a.paused = true; a.preload = '';
    Object.defineProperty(a, 'src', { get() { return src; }, set(v) { src = String(v); if (src) asked.push([step, src]); }, configurable: true });
    a.addEventListener = (n, f) => { (a.l[n] = a.l[n] || []).push(f); };
    a.removeEventListener = (n, f) => { a.l[n] = (a.l[n] || []).filter((g) => g !== f); };
    a.dispatch = (n) => (a.l[n] || []).slice().forEach((f) => f({ type: n, target: a }));
    a.play = () => { a.paused = false; return Promise.resolve(); };
    a.pause = () => { a.paused = true; };
    a.load = () => {};
    if (u) a.src = u;
  }
  const win = {
    location: { hash: '', pathname: '/h/tok', search: '?x=1' },
    localStorage: { m: {}, getItem(k) { return k in this.m ? this.m[k] : null; }, setItem(k, v) { this.m[k] = String(v); } },
    addEventListener() {}, removeEventListener() {},
    setTimeout: clock.set, clearTimeout: clock.clear,
    history: { replaceState() {} },
    HashChangeEvent: function (n) { this.type = n; },
    dispatchEvent() {},
    Image: function () { Object.defineProperty(this, 'src', { set() {}, get() { return ''; } }); },
    Audio,
  };
  win.fetch = (url, init) => {
    init = init || {};
    let body = { ok: true };
    if ((init.method || 'GET') === 'GET' && /\/stories\/book\//.test(url)) body = JSON.parse(JSON.stringify(bk));
    else if (init.body && JSON.parse(init.body).event === 'story_answer') body = { ok: true, right: true };
    return Promise.resolve({ status: 200, ok: true, json: () => Promise.resolve(body) });
  };
  // the player, shaped like wq-readalong.js: the page's Audio gets its voice at mount; preload() is one more Audio
  win.WQReadAlong = {
    mount(el, data, o) {
      const audio = new Audio();
      audio.src = data.audio.url;
      const p = {
        el, data, o, audio, state: 'ready',
        play() { audio.paused = false; audio.currentTime = 0.4; audio.readyState = 4; audio.dispatch('play'); p.state = 'playing'; if (o.onState) o.onState('playing'); audio.dispatch('playing'); },
        pause() { audio.paused = true; if (p.state === 'playing') { p.state = 'paused'; if (o.onState) o.onState('paused'); } },
        replay() { p.play(); }, playWord() {}, seekToWord() {}, destroy() { audio.paused = true; },
      };
      players.push(p);
      return p;
    },
    preload(d) { const a = new Audio(); a.preload = 'auto'; a.src = typeof d === 'string' ? d : d.audio.url; return a; },
  };
  const doc = {
    getElementById: () => null,
    querySelector: (sel) => (/wq-stories\.js/.test(sel) ? { getAttribute: () => '/wq/wq-stories.js?v=abc123' } : null),
    createElement: (tag) => ({ tag }),
    addEventListener() {},
    head: { appendChild(x) {
      if (x.tag !== 'script') return;
      if (/wq-stories-q\.js/.test(x.src)) { vm.runInContext(fs.readFileSync(QSRC, 'utf8'), sb); return x.onload(); }
      if (/wq-stories-d\.js/.test(x.src)) { vm.runInContext(fs.readFileSync(DSRC, 'utf8'), sb); return x.onload(); }
      return x.onerror();
    } },
  };
  const sb = vm.createContext({ window: win, document: doc, JSON, Math, String, Number, Array, Object, Promise, encodeURIComponent, Date });
  vm.runInContext(fs.readFileSync(SRC, 'utf8'), sb);
  const root = fakeEl('root');
  function tap(t, arg) {
    advance(700);   // a child's tap, well after the button last changed
    const target = { getAttribute: (k) => (k === 'data-tap' ? t : k === 'data-arg' ? (arg == null ? null : String(arg)) : null), parentNode: null };
    (root.L.click || []).forEach((f) => f({ target, preventDefault() {} }));
  }
  return {
    win, root, asked, players, advance, tap,
    at(s) { step = s; },
    async open() { win.WQSTORIES.open('b-7', { token: TOKEN, kid: KID, lang: 'en', clock, ev() {}, root }); await flush(); await flush(); advance(50); },
    // the child taps Listen and the page's voice starts playing (its 'play' event, then playing); a second later
    async listen() { tap('main'); advance(1000); await flush(); },
    async next() { tap('next'); await flush(); advance(50); await flush(); },
    during: (s) => asked.filter((x) => x[0] === s).map((x) => x[1]),
    page: () => win.WQSTORIES && players.length && players[players.length - 1].data.id,
  };
}

const VOICE = /\/a\/(p\d|q)/;
const voices = (e, s) => e.during(s).filter((u) => VOICE.test(u));

// the switch-on walk: open, show page 2 without playing it, play page 2, reach page 3
async function walkOn(bk) {
  const e = env(bk);
  e.at('open'); await e.open();
  e.at('show p2'); await e.next();
  e.at('play p2'); await e.listen();
  e.at('show p3 (last)'); await e.next();
  return e;
}

describe('switch on (book says wait_ux: true): the voice is asked for in the order the child needs it', () => {
  test('opening a book asks for the first page\'s voice only: no page 2, no questions sprite', async () => {
    const e = await walkOn(withSprite({ wait_ux: true }));
    expect({ open: voices(e, 'open') }).toEqual({ open: ['/a/p1.ogg'] });
  });

  test('a page only shown asks for nothing ahead: showing page 2 asks for page 2\'s voice, not page 3\'s', async () => {
    const e = await walkOn(withSprite({ wait_ux: true }));
    expect({ 'show p2': voices(e, 'show p2') }).toEqual({ 'show p2': ['/a/p2.ogg'] });
  });

  test('page 3\'s voice is asked for when page 2 starts playing', async () => {
    const e = await walkOn(withSprite({ wait_ux: true }));
    expect({ 'play p2': voices(e, 'play p2') }).toEqual({ 'play p2': ['/a/p3.ogg'] });
  });

  test('the questions sprite is asked for on reaching the last page, once, and never before it', async () => {
    const e = await walkOn(withSprite({ wait_ux: true }));
    const before = e.asked.filter((x) => x[0] !== 'show p3 (last)').map((x) => x[1]);
    expect({ beforeLast: before.filter((u) => u === SPRITE.url) }).toEqual({ beforeLast: [] });
    expect({ lastPage: voices(e, 'show p3 (last)').filter((u) => u === SPRITE.url) }).toEqual({ lastPage: [SPRITE.url] });
  });

  test('without a sprite, the first question\'s own clips are asked for on reaching the last page, never before it', async () => {
    const e = await walkOn(withClips({ wait_ux: true }));
    const qs = (s) => voices(e, s).filter((u) => /\/a\/q/.test(u));
    expect({ open: qs('open'), 'show p2': qs('show p2'), 'play p2': qs('play p2') }).toEqual({ open: [], 'show p2': [], 'play p2': [] });
    expect({ lastPage: qs('show p3 (last)').sort() }).toEqual({ lastPage: [CLIPS.q, ...CLIPS.o].sort() });
  });
});

describe('switch off: today\'s order, request for request', () => {
  // the full walk, on to the questions: every voice request with the step it came in
  async function walkOff(bk) {
    const e = env(bk);
    e.at('open'); await e.open();
    e.at('show p2'); await e.next();
    e.at('play p2'); await e.listen();
    e.at('show p3 (last)'); await e.next();
    e.at('questions'); await e.next(); e.advance(50); await flush(); await flush();
    return e.asked.filter((x) => VOICE.test(x[1]));
  }
  const TODAY_SPRITE = [
    ['open', '/a/p1.ogg'], ['open', '/a/p2.ogg'],
    ['show p2', '/a/p2.ogg'], ['show p2', '/a/p3.ogg'],
    ['show p3 (last)', '/a/p3.ogg'],
    ['questions', '/a/qs.ogg'],
  ];
  test.each([
    ['no wait_ux', {}],
    ['wait_ux not true', { wait_ux: 'true' }],
    ['wait_ux false', { wait_ux: false }],
  ])('%s, a sprite: the next page on every page shown, the sprite at the questions', async (name, over) => {
    expect(await walkOff(withSprite(over))).toEqual(TODAY_SPRITE);
  });
  test('no wait_ux, per-question clips: the clips at the questions', async () => {
    expect(await walkOff(withClips())).toEqual([
      ['open', '/a/p1.ogg'], ['open', '/a/p2.ogg'],
      ['show p2', '/a/p2.ogg'], ['show p2', '/a/p3.ogg'],
      ['show p3 (last)', '/a/p3.ogg'],
      ['questions', '/a/q1.ogg'], ['questions', '/a/q1o1.ogg'], ['questions', '/a/q1o2.ogg'],
    ]);
  });
  test('the stall setting (steady) alone: the next page once this page plays, the sprite at the questions', async () => {
    expect(await walkOff(withSprite({ steady: 1 }))).toEqual([
      ['open', '/a/p1.ogg'],
      ['show p2', '/a/p2.ogg'],
      ['play p2', '/a/p3.ogg'],
      ['show p3 (last)', '/a/p3.ogg'],
      ['questions', '/a/qs.ogg'],
    ]);
  });
});
