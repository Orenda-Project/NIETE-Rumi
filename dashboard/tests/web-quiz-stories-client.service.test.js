/**
 * The child's Stories client (wq-stories.js): the shelf, the reader (read-along over the book's own pictures),
 * "Your turn", the questions and the done card. The shipped file runs in a vm with a small fake DOM, fake
 * WQReadAlong / WQLiveRead and a fake clock (the server's JSON is the boundary). Invented books only.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.join(__dirname, '..', 'public', 'wq', 'wq-stories.js');
const QSRC = path.join(__dirname, '..', 'public', 'wq', 'wq-stories-q.js');
const DSRC = path.join(__dirname, '..', 'public', 'wq', 'wq-stories-d.js');
const WSRC = path.join(__dirname, '..', 'public', 'wq', 'wq-stories-w.js');
const CSS = path.join(__dirname, '..', 'public', 'wq', 'wq-stories.css');
const TOKEN = 'eyJrIjoiaCJ9.AbCdEfGhIjKlMnOpQrStUv';
const KID = 'kidchipabcdefghi';
const BANNED = /\b(test|exam|wpm|words per minute)\b|امتحان|ٹیسٹ|استاد/i;
// the live reader's own practice-word choice (wq-liveread.js practice), run as shipped: the fake reader below hands it on
const PRACTICE = (() => {
  const window = {}; const ctx = { window, console, Date, Math, JSON, String, Number, Object, Array, RegExp, setTimeout, clearTimeout };
  vm.createContext(ctx);
  ['wq-read-live.js', 'wq-liveread.js'].forEach((f) => vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', f), 'utf8'), ctx));
  return window.WQLiveRead.practice;
})();

const W = (i, t, s, box) => (box ? { i, t, s_ms: s, e_ms: s + 400, box } : { i, t, s_ms: s, e_ms: s + 400 });
// the stall setting (web_quiz_stories_steady): the book says `steady`; on only inside its own describe
let STEADY = false;
function book(over = {}) {
  return {
    ...(STEADY ? { steady: 1 } : {}),
    id: 'b-1', title: 'Mina Testwala', lang: 'en', dir: 'ltr', grade: 1, pace_wpm: 90, lr3: true,
    pages: [
      { n: 1, image: { url: '/s/b-1/p01.webp', w: 720, h: 1080 }, text_band: { url: '/s/b-1/p01-band.webp', w: 1440, h: 260, box: [100, 800, 520, 130] },
        text: 'Mina Testwala has a kite', words: [W(0, 'Mina', 100, [110, 810, 40, 50]), W(1, 'Testwala', 600, [160, 810, 30, 50]), W(2, 'has', 1100, [200, 810, 20, 50]), W(3, 'zigzag', 1600, [230, 870, 90, 50]), W(4, 'kite.', 2100, [330, 870, 60, 50])],
        audio: { url: '/a/p1.ogg', ms: 2600 }, boxes_ok: true, is_picture: false },
      { n: 2, image: { url: '/s/b-1/p02.webp', w: 720, h: 1080 }, text_band: null, text: '', words: [], audio: null, boxes_ok: false, is_picture: true },
      { n: 3, image: { url: '/s/b-1/p03.webp', w: 720, h: 1080 }, text_band: { url: '/s/b-1/p03-band.webp', w: 1440, h: 260, box: [100, 800, 520, 130] },
        text: 'The kite goes up.', words: [W(0, 'The', 100), W(1, 'kite', 600), W(2, 'goes', 1100), W(3, 'up.', 1600)], audio: null, boxes_ok: false, is_picture: false },
    ],
    questions: [
      { n: 1, kind: 'literal', page_ref: 1, q: 'What does Mina have?', options: [{ t: 'a kite' }, { t: 'a ball' }, { t: 'a hat' }], audio: { q: '/a/q1.ogg', o: ['/a/q1o1.ogg', '/a/q1o2.ogg', '/a/q1o3.ogg'] } },
      { n: 2, kind: 'vocab', page_ref: 3, q: 'Where does the kite go?', options: [{ t: 'up', img: 'q2o1-abcd1234.webp' }, { t: 'down' }, { t: 'home' }] },
    ],
    ...over,
  };
}
const SHELF = {
  grade: 1, lang: 'en', grades: [1, 2, 3, 4, 5],
  books: [
    { id: 'b-9', title: 'Zed Testwala', grade: 1, lang: 'en', dir: 'ltr', pages: 4, minutes: 2, cover: '/s/b-9/cover.webp', done: false, from_teacher: true, shelf_position: 0, by: 'Ayesha Testwala' },
    { id: 'b-1', title: 'Mina Testwala', grade: 1, lang: 'en', dir: 'ltr', pages: 3, minutes: 1, cover: '/s/b-1/cover.webp', done: false, from_teacher: false, shelf_position: 1 },
    { id: 'b-4', title: 'Apple Testwala', grade: 1, lang: 'en', dir: 'ltr', pages: 5, minutes: 3, cover: '/s/b-4/cover.webp', done: true, from_teacher: false, shelf_position: 2 },
  ],
};

// ---- a small fake DOM -------------------------------------------------------------------------------------------
function key(sel) { return sel.replace(/^[.[]/, '').replace(/[\]=].*$/, '').split(' ')[0]; }
function fakeEl(name) {
  const els = {};
  const L = {};
  return {
    name, _h: '', attrs: {}, style: {}, hidden: false, textContent: '', className: '', clientWidth: 360, L, els,
    set innerHTML(h) { this._h = String(h); Object.keys(els).forEach((k) => delete els[k]); }, get innerHTML() { return this._h; },
    setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return this.attrs[k] == null ? null : this.attrs[k]; }, removeAttribute(k) { delete this.attrs[k]; },
    addEventListener(n, f) { (L[n] = L[n] || []).push(f); }, removeEventListener() {},
    querySelector(sel) { if (!this._h.includes(key(sel))) return null; els[sel] = els[sel] || fakeEl(sel); return els[sel]; },
    querySelectorAll() { return []; }, appendChild(c) { (this.kids = this.kids || []).push(c); },
    click() { (L.click || []).forEach((f) => f({ target: this })); },
  };
}
// a child's tap on the main button comes at least 700 ms after it last changed (the reader ignores one inside 600 ms:
// the tap-lock tests below fire it early on purpose with fireNow)
let lastEnv = null;
// every test, whatever it did: once the reader is left (the address loses #story/…), no offline / online / pagehide
// listener of its may stay on the window (a leak keeps the whole reader alive and acts on a page the child left)
const envs = [];
afterEach(() => {
  const left = envs.splice(0).map((e) => {
    e.win.location.hash = '';
    try { e.S.route(e.ctx()); } catch (x) { /* a test that broke the reader on purpose */ }
    return ['offline', 'online', 'pagehide'].filter((n) => (e.winL[n] || []).length);
  });
  expect(left.filter((x) => x.length)).toEqual([]);
});
function fire(root, tap, arg) {
  if (tap === 'main' && lastEnv) lastEnv.advance(700);
  fireNow(root, tap, arg);
}
function fireNow(root, tap, arg) {
  const target = { getAttribute: (k) => (k === 'data-tap' ? tap : k === 'data-arg' ? (arg == null ? null : String(arg)) : null), parentNode: null };
  expect(root.L.click && root.L.click.length).toBeTruthy();
  root.L.click.forEach((f) => f({ target, preventDefault() {} }));
}
const flush = () => new Promise((r) => setImmediate(r));

function env(opt = {}) {
  let now = 0;
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
  const calls = { gets: [], posts: [], ra: [], lr: [], ask: [], juice: [] };
  const replies = opt.replies || {};
  function fetch(url, init) {
    init = init || {};
    const body = init.body ? JSON.parse(init.body) : null;
    if ((init.method || 'GET') === 'POST') calls.posts.push({ url, body }); else calls.gets.push(url);
    if (init.keepalive) (calls.ka = calls.ka || []).push(body && body.event);
    let r;
    if (opt.fail && opt.fail(url)) return Promise.reject(new Error('offline'));
    if (/\/stories\/shelf\//.test(url)) r = replies.shelf || { status: 200, body: SHELF };
    else if (/\/stories\/book\/|\/teacher\/story\//.test(url)) r = replies.book || { status: 200, body: book() };
    else if (/\/stories\/event\//.test(url)) {
      if (body.event === 'story_questions_done') r = { status: 200, body: { ok: true, correct: 1, total: 2, stars: 2 } };
      else if (body.event === 'story_answer') { const ok = opt.right ? opt.right(body.data) : true; r = { status: 200, body: ok || body.data.try !== 2 ? { ok: true, right: ok } : { ok: true, right: false, show: 0 } }; }
      else if (body.event === 'story_done' && replies.done) r = replies.done;
      else if (body.event === 'story_done') r = { status: 200, body: { ok: true, sticker: opt.alwaysSticker ? true : opt.noSticker ? false : body.data.pages_read > 0 || body.data.pages_listened > 0 } };
      else r = { status: 200, body: { ok: true } };
    } else if (/\/lr\/key/.test(url)) r = replies.key || { status: 200, body: { ws: 'wss://x', api_key: 'k', model: 'm', lang: 'en' } };
    else r = { status: 404, body: {} };
    const res = { status: r.status, ok: r.status < 400, json: () => Promise.resolve(r.body), text: () => Promise.resolve(JSON.stringify(r.body)) };
    if (opt.hold && opt.hold(url)) return new Promise((go) => (calls.held = calls.held || []).push(() => go(res)));
    return Promise.resolve(res);
  }
  const store = { m: {}, getItem(k) { return k in this.m ? this.m[k] : null; }, setItem(k, v) { this.m[k] = String(v); } };
  const winL = {};
  const win = {
    location: { hash: opt.hash || '' }, localStorage: store, fetch,
    addEventListener(n, f) { (winL[n] = winL[n] || []).push(f); }, removeEventListener(n, f) { winL[n] = (winL[n] || []).filter((g) => g !== f); },
    setTimeout: clock.set, clearTimeout: clock.clear,
  };
  if (opt.ra !== false) {
    win.WQReadAlong = {
      mount(el, data, o) {
        if (o.band) el.innerHTML = '<div class="wqra-pic wqra-band"></div>';
        const p = { el, data, o, log: [], slows: [], audio: {}, slow(on, g) { p.slows.push([on, g]); }, play() { p.log.push('play'); }, pause() { p.log.push('pause'); }, replay() { p.log.push('replay'); }, playWord(i) { p.log.push('word:' + i); }, seekToWord(i) { p.log.push('seek:' + i); }, destroy() { p.log.push('destroy'); } };
        calls.ra.push(p); return p;
      },
      preload(d) { calls.preload = (calls.preload || []).concat([d.id]); },
    };
  }
  if (opt.lr !== false) {
    win.WQLiveRead = {
      mount(el, o) { const c = { el, o, log: [], stop(w) { c.log.push('stop:' + w); }, destroy() { c.log.push('destroy'); }, view: () => ({ heard: 2, total: 5 }) }; calls.lr.push(c); return c; },
      askMic: opt.noAsk ? undefined : (el, o) => { el.innerHTML = '<button class="lr-go">go</button>'; calls.ask.push(o); calls.askEl = el; },
      glowLevel: () => 2,
      practice: PRACTICE,
      ...(opt.doneHtml ? { COPY: { en: { done: 'X' }, ur: { done: 'Y' } }, doneHtml: (c) => '<span class="lr-done-ok">' + c.done + '</span>' } : {}),
    };
  }
  if (opt.wqj) win.WQJ = { tap() { calls.juice.push('tap'); }, finish(o) { calls.juice.push('finish:' + o.stars); }, correct() {}, wrong() {}, muted: () => calls.juice.includes('mute:true'), mute(b) { calls.juice.push('mute:' + b); } };
  const wqRoot = fakeEl('wq');
  calls.loaded = []; calls.hist = []; calls.disp = [];
  const doc = {
    getElementById: (id) => (id === 'boot' && opt.boot ? { textContent: JSON.stringify(opt.boot) } : id === 'wq' && opt.boot ? wqRoot : null),
    querySelector: (sel) => { (calls.qs = calls.qs || []).push(sel); if (opt.slot && /data-stories-shelf/.test(sel)) return opt.slot; return /wq-stories\.js/.test(sel) ? { getAttribute: () => '/wq/wq-stories.js?v=abc123' } : null; },
    // opt.canPlay: the phone's own answer for an <audio> type (an iPhone before iOS 18.4 says '' for Ogg Opus)
    createElement: (tag) => (tag === 'audio' && opt.canPlay ? { tag, canPlayType: opt.canPlay } : { tag }),
    L: {}, addEventListener(n, f) { (this.L[n] = this.L[n] || []).push(f); },
    head: { appendChild(x) {
      calls.loaded.push(x);
      if (x.tag !== 'script') return;
      if (/wq-stories-q\.js\?v=abc123$/.test(x.src)) { if (opt.qFail) return x.onerror(); if (opt.qHold && !calls.qGo) { calls.qGo = () => { vm.runInContext(fs.readFileSync(QSRC, 'utf8'), sb); x.onload(); }; return; } vm.runInContext(fs.readFileSync(QSRC, 'utf8'), sb); return x.onload(); }
      if (/wq-stories-d\.js\?v=abc123$/.test(x.src)) { if (opt.dFail) return x.onerror(); vm.runInContext(fs.readFileSync(DSRC, 'utf8'), sb); return x.onload(); }
      if (/wq-stories-w\.js\?v=abc123$/.test(x.src)) { vm.runInContext(fs.readFileSync(WSRC, 'utf8'), sb); return x.onload(); }
      if (opt.onLoad) { opt.onLoad(win); x.onload(); }
      // a file the reader brings that this test does not serve answers as a 404 does (not on this server)
      else if (/wq-readalong\.js|wq-read-live\.js|wq-liveread\.js/.test(x.src)) x.onerror();
    } },
  };
  win.history = { replaceState(a, b, u) { calls.hist.push(u); } };
  win.location.pathname = '/h/tok'; win.location.search = opt.search || '?x=1';
  win.HashChangeEvent = function (n) { this.type = n; };
  calls.audios = [];
  win.Audio = function (u) { const a = this; a.src = u || ''; a.currentTime = 0; a.paused = true; a.play = () => { a.paused = false; return Promise.resolve(); }; a.pause = () => { a.paused = true; }; calls.audios.push(a); };
  win.dispatchEvent = (e) => calls.disp.push(e.type);
  calls.imgs = [];
  win.Image = function () { const im = this; Object.defineProperty(im, 'src', { set(v) { calls.imgs.push(v); }, get() { return ''; } }); };
  const sb = vm.createContext({ window: win, document: doc, JSON, Math, String, Number, Array, Object, Promise, encodeURIComponent, Date });
  vm.runInContext(fs.readFileSync(SRC, 'utf8'), sb);
  const S = win.WQSTORIES;
  const ctx = (over = {}) => ({ token: TOKEN, kid: KID, lang: 'en', clock, ev: (n, p) => { (calls.ev = calls.ev || []).push([n, p]); }, ...over });
  const E = { S, win, calls, clock, advance, ctx, store, winL, wqRoot, doc, get now() { return now; } };
  lastEnv = E;
  envs.push(E);
  return E;
}
const text = (h) => h.replace(/<[^>]*>/g, ' ').replace(/&(#39|amp|lt|gt|quot);/g, ' ');
const primaries = (h) => (h.match(/data-primary/g) || []).length;
const screenOf = (h) => (/data-screen="([^"]+)"/.exec(h) || [])[1];
function checkScreen(h, lang) {
  expect(screenOf(h)).toBeTruthy();
  expect(primaries(h)).toBe(1);
  expect(text(h)).not.toMatch(BANNED);
  expect(h).not.toContain('·');
  const root = /<[^>]*data-screen="[^"]+"[^>]*>/.exec(h)[0];
  expect(root).toContain(`lang="${lang}"`);
  expect(root).toContain(`dir="${lang === 'ur' ? 'rtl' : 'ltr'}"`);
}


// ---- the pure state machine -------------------------------------------------------------------------------------
const READ = (marks) => ({ words_total: marks.length, words_read: marks.filter((x) => x === 'read').length, skipped: marks.filter((x) => x === 'skipped').length, marks });
describe('the reader state machine (pure, fake clock)', () => {
  function mk(e, over = {}, lr = true) { return e.S._machine(book(over), { lr, clock: e.clock }); }
  test('button label per state: Listen -> Pause -> Listen -> Your turn -> done -> Next', () => {
    const e = env(); const m = mk(e);
    expect(m.st).toBe('idle'); expect(m.label()).toBe('listen');
    m.primary(); expect(m.st).toBe('listening'); expect(m.label()).toBe('pause');
    m.primary(); expect(m.st).toBe('paused'); expect(m.label()).toBe('listen');
    m.primary(); expect(m.st).toBe('listening');
    m.end(); expect(m.st).toBe('listened'); expect(m.label()).toBe('yourTurn');
    m.primary(); expect(m.st).toBe('mic'); expect(m.label()).toBe(null);
    m.granted(); expect(m.st).toBe('reading'); expect(m.label()).toBe('done');
    m.result(READ(['read', 'skipped', 'read', 'read', 'read'])); expect(m.st).toBe('practise'); expect(m.skip).toBe(1); expect(m.label()).toBe('next');
    m.primary(); expect(m.i).toBe(1); expect(m.st).toBe('picture'); expect(m.label()).toBe('next');
  });
  test('honest praise: 0 words heard -> "together", Listen again, not counted as read', () => {
    const e = env(); const m = mk(e);
    m.primary(); m.end(); m.primary(); m.granted();
    m.result({ words_total: 5, words_read: 0, skipped: 0, marks: ['ahead', 'ahead', 'ahead', 'ahead', 'ahead'] });
    expect(m.st).toBe('together'); expect(m.label()).toBe('listen');
    expect(m.counts().pages_read).toBe(0);
    m.primary(); expect(m.st).toBe('listening');
  });
  test('no live reading: after listening the button is Next', () => {
    const e = env(); const m = mk(e, {}, false);
    m.primary(); m.end(); expect(m.label()).toBe('next');
    m.primary(); expect(m.i).toBe(1);
  });
  test('a picture page never moves on its own (no auto-advance after 10 s); Next is its one labelled button', () => {
    const e = env(); const m = mk(e);
    m.go(1); expect(m.st).toBe('picture'); expect(m.label()).toBe('next');
    e.advance(10000); expect(m.i).toBe(1);
    m.primary(); expect(m.i).toBe(2);
  });
  test('audio:null skips Listen: Your turn first (or Next with no live reading)', () => {
    const e = env(); const m = mk(e);
    m.go(2); expect(m.st).toBe('idle'); expect(m.label()).toBe('yourTurn');
    m.primary(); expect(m.st).toBe('mic');
    const m2 = mk(e, {}, false); m2.go(2); expect(m2.label()).toBe('next');
  });
  test('"Not now, just listen" returns to Listen with no loss, and that page stops asking', () => {
    const e = env(); const m = mk(e);
    m.primary(); m.end(); m.primary(); expect(m.st).toBe('mic');
    m.notNow(); expect(m.st).toBe('idle'); expect(m.label()).toBe('listen');
    expect(m.counts().pages_listened).toBe(1);
    m.primary(); m.end(); expect(m.label()).toBe('next');
  });
  test('the last page -> questions -> done; no questions -> done', () => {
    const e = env(); const m = mk(e);
    m.go(2); m.primary(); m.granted(); m.result(READ(['read', 'read', 'read', 'read']));
    expect(m.st).toBe('read'); m.primary(); expect(m.st).toBe('questions');
    const m2 = mk(e, { questions: [] }); m2.go(2); m2.next(); expect(m2.st).toBe('done');
  });
  test('the tally counts pages listened and pages read, once each', () => {
    const e = env(); const m = mk(e);
    m.primary(); m.end(); m.primary(); m.granted(); m.result(READ(['read']));
    m.prev(); m.go(0); m.primary(); m.end();
    m.go(2); m.primary(); m.granted(); m.result(READ(['read', 'skipped']));
    expect(m.counts()).toEqual({ pages_listened: 1, pages_read: 2 });
  });
  test('a denied mic: kind state, Listen offered, no more asking in this book', () => {
    const e = env(); const m = mk(e);
    m.primary(); m.end(); m.primary(); m.denied();
    expect(m.st).toBe('denied'); expect(m.label()).toBe('listen');
    m.go(2); expect(m.label()).toBe('next');
  });
});

// ---- the shelf ----------------------------------------------------------------------------------------------------
describe('the shelf', () => {
  test('the shelf\'s one primary is the first UNFINISHED book (a finished teacher book keeps its card and ribbon, not the primary); all finished -> the first card', async () => {
    const shelfWith = (books) => ({ status: 200, body: { ...SHELF, books } });
    const B = SHELF.books;   // b-9 teacher (unfinished), b-1 unfinished, b-4 finished
    const prim = (h) => (/data-id="([^"]+)"[^>]*data-primary/.exec(h) || [])[1];
    const run = async (books) => { const e = env({ replies: { shelf: shelfWith(books) } }); const el = fakeEl('shelf'); e.S.shelf(el, e.ctx()); await flush(); return el.innerHTML; };
    let h = await run(B);
    expect(prim(h)).toBe('b-9');                                         // an unfinished teacher book leads
    h = await run([{ ...B[0], done: true }, B[1], B[2]]);
    expect(prim(h)).toBe('b-1');                                         // a finished teacher book: the first unfinished card leads
    expect(h).toContain('wqs-tcard');                                    // the teacher's card stays
    expect((h.match(/data-primary/g) || []).length).toBe(1);
    h = await run([{ ...B[2] }, { ...B[1], done: true }].concat([{ ...B[1], id: 'b-5', done: false }]));
    expect(prim(h)).toBe('b-5');                                         // no teacher book, the first card finished: the first unfinished
    h = await run([{ ...B[0], done: true }, { ...B[1], done: true }, B[2]]);
    expect(prim(h)).toBe('b-9');                                         // every book finished: the first card, as today
    expect((h.match(/data-primary/g) || []).length).toBe(1);
  });
  test('every book card (the teacher card too) carries its book id, so a tap can name the book and not its position', async () => {
    const e = env(); const el = fakeEl('shelf');
    e.S.shelf(el, e.ctx()); await flush();
    const h = el.innerHTML;
    SHELF.books.forEach((b) => expect(h).toMatch(new RegExp('data-tap="book" data-arg="\\d+" data-id="' + b.id + '"')));
  });
  test('one primary: none at all when the host screen already has its own (ctx.primary === false)', async () => {
    const e = env(); const el = fakeEl('shelf');
    e.S.shelf(el, e.ctx({ primary: false }));
    await flush();
    expect((el.innerHTML.match(/data-primary/g) || []).length).toBe(0);
    const e2 = env(); const el2 = fakeEl('shelf');
    e2.S.shelf(el2, e2.ctx());
    await flush();
    expect((el2.innerHTML.match(/data-primary/g) || []).length).toBe(1);
  });
  test('an Urdu page asks for the Urdu shelf even before the child picks a language', async () => {
    const e = env(); const el = fakeEl('shelf');
    e.S.shelf(el, e.ctx({ lang: 'ur' }));
    await flush();
    expect(e.calls.gets[0]).toContain('&l=ur');
  });
  test('server order kept, the teacher book as ONE full-width primary card, done tick, lazy sized covers, a home link', async () => {
    const e = env(); const el = fakeEl('shelf');
    e.S.shelf(el, e.ctx());
    expect(el.innerHTML).toContain('wqs-skel');
    await flush();
    const h = el.innerHTML;
    checkScreen(h, 'en');
    expect(screenOf(h)).toBe('stories-shelf');
    expect(e.calls.gets[0]).toBe(`/api/wq/stories/shelf/h/${TOKEN}?kid=${KID}&l=en`);
    const order = ['Zed Testwala', 'Mina Testwala', 'Apple Testwala'].map((t) => h.indexOf(t));
    expect(order[0]).toBeGreaterThan(0); expect(order[0]).toBeLessThan(order[1]); expect(order[1]).toBeLessThan(order[2]);
    expect(h).toMatch(/class="wqs-tcard"[^>]*data-primary/);
    expect(text(h)).toContain('Read  Zed Testwala  with Jugnu');
    expect(h).toMatch(/<b><svg class="wqs-g"[^>]*><path d="M8 5v14l11-7z"\/><\/svg> Read <bdi lang="en" dir="ltr">Zed Testwala<\/bdi>/);
    expect(h).toContain('From your teacher');
    expect((h.match(/data-done/g) || []).length).toBe(1);
    expect(h).toMatch(/class="wqs-tick"[^>]*><svg class="wqs-g"/);
    expect(h).toContain('by Ayesha Testwala');
    expect((h.match(/<img[^>]*loading="lazy"[^>]*>/g) || []).length).toBe(3);
    expect(h).toMatch(/width="160" height="240"/);
    expect(h).toMatch(/onerror=/);
    expect(h).toMatch(/data-home/);
    // grade + language: ONE chip, collapsed; tap to change
    expect(h).toContain('Grade 1, English');
    expect(h).not.toContain('data-tap="g"');
    fire(el, 'gl');
    expect(el.innerHTML).toMatch(/data-tap="g" data-arg="1"[^>]*aria-pressed="true"/);
    expect(e.calls.ev).toContainEqual(['story_shelf_shown', { n: 3, grade: 1, lang: 'en' }]);
    expect(e.calls.posts).toHaveLength(0);
  });
  test('no teacher book: the first cover is the primary', async () => {
    const e = env({ replies: { shelf: { status: 200, body: { ...SHELF, books: SHELF.books.slice(1) } } } }); const el = fakeEl('shelf');
    e.S.shelf(el, e.ctx()); await flush();
    checkScreen(el.innerHTML, 'en');
    expect(el.innerHTML).not.toContain('wqs-tcard');
    expect(el.innerHTML).toMatch(/class="wqs-book" data-tap="book" data-arg="0" data-id="[^"]+" data-primary/);
  });
  test('tap a book: story_opened carries shelf_position/from_teacher/grade/lang, then #story/<id>', async () => {
    const e = env(); const el = fakeEl('shelf');
    e.S.shelf(el, e.ctx()); await flush();
    fire(el, 'book', 0);
    const p = e.calls.posts.find((x) => x.body.event === 'story_opened');
    expect(p.url).toBe(`/api/wq/stories/event/h/${TOKEN}`);
    expect(p.body).toMatchObject({ kid: KID, book_id: 'b-9', event: 'story_opened', data: { shelf_position: 0, from_teacher: true, grade: 1, lang: 'en' } });
    expect(e.win.location.hash).toBe('#story/b-9');
    const e2 = env({ replies: { shelf: { status: 200, body: { ...SHELF, books: SHELF.books.map(({ shelf_position, ...b }) => b) } } } }); const el2 = fakeEl('shelf');
    e2.S.shelf(el2, e2.ctx()); await flush();
    fire(el2, 'book', 1);
    expect(e2.calls.posts.find((x) => x.body.event === 'story_opened').body.data.shelf_position).toBe(2);
  });
  test('grade and language chips refetch and are remembered; Urdu shelf: rtl, Urdu teacher copy, Urdu digits', async () => {
    const ur = { ...SHELF, lang: 'ur', grade: 2, books: SHELF.books.map((b) => ({ ...b, lang: 'ur', dir: 'rtl' })) };
    const e = env({ replies: { shelf: { status: 200, body: ur } } }); const el = fakeEl('shelf');
    e.S.shelf(el, e.ctx()); await flush();
    fire(el, 'gl'); fire(el, 'l', 'ur'); await flush();
    expect(e.calls.gets[1]).toContain('l=ur');
    fire(el, 'gl'); fire(el, 'g', 3); await flush();
    expect(e.calls.gets[2]).toMatch(/g=3/);
    expect(e.store.getItem('wq_st_gl')).toBe('3,ur');
    expect(e.calls.gets[1]).not.toContain('g=');
    const h = el.innerHTML;
    checkScreen(h, 'ur');
    expect(h).toContain('ٹیچر کی طرف سے');
    expect(h).toContain('جگنو کے ساتھ');
    expect(h).toContain('<bdi lang="ur" dir="rtl">Zed Testwala</bdi>');
    expect(text(h)).not.toMatch(/[0-9]/);
    expect(h).toContain('جماعت ۲، اردو');
    // a new shelf later keeps the language
    const el2 = fakeEl('shelf2'); e.S.shelf(el2, e.ctx()); await flush();
    expect(e.calls.gets[3]).toContain('l=ur');
    expect(e.calls.gets[3]).toContain('g=3');
    // a language change alone remembers no grade: the server's grade stays
    const e3 = env(); const el3 = fakeEl('s3'); e3.S.shelf(el3, e3.ctx()); await flush();
    fire(el3, 'gl'); fire(el3, 'l', 'ur'); await flush();
    expect(e3.store.getItem('wq_st_gl')).toBe(',ur');
    e3.S.shelf(fakeEl('s4'), e3.ctx()); await flush();
    expect(e3.calls.gets[2]).toContain('l=ur'); expect(e3.calls.gets[2]).not.toContain('g=');
  });
  test('an empty shelf: one kind line, no "coming soon"', async () => {
    const e = env({ replies: { shelf: { status: 200, body: { ...SHELF, books: [] } } } }); const el = fakeEl('shelf');
    e.S.shelf(el, e.ctx()); await flush();
    checkScreen(el.innerHTML, 'en');
    expect(text(el.innerHTML)).not.toMatch(/soon|on its way/i);
  });
  test('stories off: nothing at all; offline: one kind retry that refetches', async () => {
    const e = env({ replies: { shelf: { status: 404, body: { error: 'stories_off' } } } }); const el = fakeEl('shelf');
    e.S.shelf(el, e.ctx()); await flush();
    expect(el.innerHTML).toBe('');
    let off = true;
    const e2 = env({ fail: () => off }); const el2 = fakeEl('shelf');
    e2.S.shelf(el2, e2.ctx()); await flush();
    checkScreen(el2.innerHTML, 'en');
    expect(el2.innerHTML).toContain('data-tap="retry"');
    off = false; fire(el2, 'retry'); await flush();
    expect(screenOf(el2.innerHTML)).toBe('stories-shelf');
  });
});

// ---- the reader ---------------------------------------------------------------------------------------------------
async function openReader(e, over = {}) {
  const root = fakeEl('root');
  e.S.open('b-1', e.ctx({ root, ...over }));
  await flush();
  return root;
}
function toMic(e, root) { fire(root, 'main'); e.calls.ra[e.calls.ra.length - 1].o.onEnd(); fire(root, 'main'); }
describe('OFF goldens', () => {
  const scripts = (e) => e.calls.loaded.filter((x) => x.tag === 'script').map((x) => x.src.replace(/\?.*/, ''));
  test('live reading off (the book says lr3:false, no live reader on the page): no live-reading file, and the page is byte-identical to a book that does not mention lr3', async () => {
    for (const lang of ['en', 'ur']) {
      const dir = lang === 'ur' ? 'rtl' : 'ltr';
      const off = env({ lr: false, replies: { book: { status: 200, body: { ...book({ lang, dir }), lr3: false } } } });
      const ro = await openReader(off, { lang });
      const plain = book({ lang, dir }); delete plain.lr3;
      const none = env({ lr: false, replies: { book: { status: 200, body: plain } } });
      const rn = await openReader(none, { lang });
      expect(ro.innerHTML).toBe(rn.innerHTML);
      expect(scripts(off).filter((u) => /wq-read-live|wq-liveread/.test(u))).toEqual([]);
      expect(ro.innerHTML).not.toMatch(/data-tap="alt"[^>]*>(Your turn|اب آپ پڑھیں)</);   // no Your turn without the live reader
    }
  });
  test('stories off (the server answers 404 stories_off): the shelf draws nothing, a book link shows one kind way home, and no reader file is fetched (no player on the page, as on the real hub)', async () => {
    const e = env({ ra: false, lr: false, replies: { shelf: { status: 404, body: { error: 'stories_off' } }, book: { status: 404, body: { error: 'stories_off' } } } });
    const el = fakeEl('shelf'); e.S.shelf(el, e.ctx()); await flush();
    expect(el.innerHTML).toBe('');
    const root = await openReader(e);
    expect(screenOf(root.innerHTML)).toBe('stories-off');
    expect(primaries(root.innerHTML)).toBe(1);
    expect(scripts(e).filter((u) => /wq-readalong|wq-read-live|wq-liveread|wq-stories-q|wq-finish-card/.test(u))).toEqual([]);
  });
});

describe('the voice player comes with the book (the hub page never loads it)', () => {
  // env() puts a WQReadAlong stub on the page; these tests take it off and hand it back only when the reader fetches it
  const without = (opt = {}) => {
    let RA = null;
    const e = env({ ...opt, onLoad: (w) => { if (RA && !w.WQReadAlong) w.WQReadAlong = RA; } });
    RA = e.win.WQReadAlong; delete e.win.WQReadAlong;
    return e;
  };
  const scripts = (e, rx) => e.calls.loaded.filter((x) => x.tag === 'script' && rx.test(x.src)).map((x) => x.src);
  test('no player on the page: the reader fetches wq-readalong.js once, at its own ?v=, and the page has its voice (Listen, one player)', async () => {
    const e = without(); const root = await openReader(e);
    // at the player's own content version (as the Trail fetches it): a player change alone busts its cached copy
    const v = require('crypto').createHash('sha256').update(fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'wq-readalong.js'))).digest('hex').slice(0, 10);
    expect(scripts(e, /wq-readalong\.js/)).toEqual([`/wq/wq-readalong.js?v=${v}`]);
    expect(root.querySelector('[data-main]').textContent).toBe('Listen');
    expect(e.calls.ra).toHaveLength(1);
    e.S.open('b-1', e.ctx({ root })); await flush();
    expect(scripts(e, /wq-readalong\.js/)).toHaveLength(1);
  });
  test('live reading on (the book\'s lr3) and not on the page: wq-read-live.js, THEN wq-liveread.js + its css (it reads WQLive as it loads), then Your turn', async () => {
    let RA = null; let LR = null; const order = [];
    const e = env({ replies: { book: { status: 200, body: { ...book(), lr3: true } } }, onLoad: (w) => {
      const src = e.calls.loaded[e.calls.loaded.length - 1].src; order.push(src.replace(/\?.*/, ''));
      if (/wq-readalong\.js/.test(src)) w.WQReadAlong = RA;
      if (/wq-read-live\.js/.test(src)) w.WQLive = {};
      if (/wq-liveread\.js/.test(src)) { expect(w.WQLive).toBeTruthy(); w.WQLiveRead = LR; }
    } });
    RA = e.win.WQReadAlong; LR = e.win.WQLiveRead; delete e.win.WQReadAlong; delete e.win.WQLiveRead;
    const root = await openReader(e);
    expect(order).toEqual(['/wq/wq-readalong.js', '/wq/wq-read-live.js', '/wq/wq-liveread.js']);
    expect(e.calls.loaded.filter((x) => x.rel === 'stylesheet').map((x) => x.href)).toEqual(['/wq/wq-liveread.css?v=abc123']);
    fire(root, 'main'); e.calls.ra[0].o.onEnd();
    expect(root.querySelector('[data-main]').textContent).toBe('Your turn');
  });
  test('live reading off (lr3 false), or a teacher\'s preview: no live-reading file is fetched', async () => {
    const e = without({ replies: { book: { status: 200, body: { ...book(), lr3: false } } } }); delete e.win.WQLiveRead; await openReader(e);
    expect(scripts(e, /wq-read-live|wq-liveread/)).toHaveLength(0);
    const t = without(); delete t.win.WQLiveRead;
    t.S.open('b-1', { role: 'teacher', bookUrl: '/api/teacher/story/b-1', root: fakeEl('root'), lang: 'en', clock: t.clock }); await flush();
    expect(scripts(t, /wq-read-live|wq-liveread/)).toHaveLength(0);
  });
  test('the live reader already on the page: no live-reading file is fetched', async () => {
    const e = without(); await openReader(e);
    expect(scripts(e, /wq-read-live|wq-liveread/)).toHaveLength(0);
  });
  test('the player already on the page: nothing more is fetched', async () => {
    const e = env(); await openReader(e);
    expect(scripts(e, /wq-readalong\.js/)).toHaveLength(0);
  });
  test('the player cannot load (offline): the book still opens, without a voice, never stuck on the wait screen', async () => {
    const e = without(); e.win.__noRA = true;
    const root = fakeEl('root');
    // the script tag is added but never answers; the reader gives up after its 8 s wait
    e.calls.loaded.length = 0;
    const realAppend = e.doc.head.appendChild; e.doc.head.appendChild = (x) => { e.calls.loaded.push(x); };
    e.S.open('b-1', e.ctx({ root })); await flush();
    expect(screenOf(root.innerHTML)).toBe('story-wait');
    e.advance(8000); await flush();
    expect(screenOf(root.innerHTML)).toBe('story-page');
    expect(root.querySelector('[data-main]').textContent).not.toBe('Listen');
    e.doc.head.appendChild = realAppend;
    // the next book asks again (a failed load is not remembered as done), and this time the player comes
    e.S.open('b-2', e.ctx({ root })); await flush();
    expect(scripts(e, /wq-readalong\.js/)).toHaveLength(2);
    expect(root.querySelector('[data-main]').textContent).toBe('Listen');
  });
});
describe('the reader', () => {
  test('page 1: the picture, one big button, ONE player (overlay) on the print; a zoomable page shows no band', async () => {
    const e = env(); const root = await openReader(e);
    const h = root.innerHTML;
    checkScreen(h, 'en');
    expect(screenOf(h)).toBe('story-page');
    expect(e.calls.gets[0]).toBe(`/api/wq/stories/book/b-1/h/${TOKEN}?kid=${KID}`);
    expect(h).toMatch(/data-primary[^>]*>[^<]*Listen/);
    expect(h).toMatch(/data-back/);
    expect(h).toMatch(/data-tap="snd"/);
    expect(h).toMatch(/data-sound data-trigger="tap"/);
    expect(h).not.toMatch(/band/);
    expect(e.calls.ra).toHaveLength(1);
    const p = e.calls.ra[0];
    expect(p.o.mode).toBe('overlay'); expect(p.o.leadMs).toBe(50);
    expect(p.o.band).toBeUndefined();
    expect(p.data).toMatchObject({ v: 1, id: 'b-1/p1', lang: 'en', dir: 'ltr', audio: { url: '/a/p1.ogg' }, image: { url: '/s/b-1/p01.webp' } });
    expect(p.log).not.toContain('play');
  });
  test('no text_band: the picture only, no band option, no extra DOM', async () => {
    const bk = book(); bk.pages[0].text_band = null;
    const e = env({ replies: { book: { status: 200, body: bk } } }); const root = await openReader(e);
    expect(e.calls.ra[0].o.band).toBeUndefined();
    expect(root.innerHTML).not.toMatch(/band/);
  });
  test('Listen plays inside the tap; onEnd -> story_page_listened + Your turn', async () => {
    const e = env(); const root = await openReader(e);
    const p = e.calls.ra[0];
    fire(root, 'main');
    expect(p.log).toEqual(['play']);
    expect(root.querySelector('[data-main]').textContent).toBe('Pause');
    e.advance(2600);
    p.o.onEnd();
    const ev = e.calls.posts.find((x) => x.body.event === 'story_page_listened');
    expect(ev.body).toMatchObject({ book_id: 'b-1', page_n: 1, data: { ms: 2600, completed: true } });
    expect(root.querySelector('[data-main]').textContent).toBe('Your turn');
  });
  test('no askMic: no live read at all - Listen only, no Your turn, no mic sheet of our own, never getUserMedia', async () => {
    const e = env({ noAsk: true }); let asked = 0;
    e.win.navigator = { mediaDevices: { getUserMedia: () => { asked += 1; return Promise.resolve({ id: 's' }); } } };
    const root = await openReader(e);
    let h = root.innerHTML;
    checkScreen(h, 'en');
    expect(h).toMatch(/data-main[^>]*>Listen</);
    expect(h).not.toContain('Your turn');
    expect(h).not.toContain('data-tap="alt"');
    fire(root, 'main'); e.calls.ra[0].o.onEnd();
    expect(root.querySelector('[data-main]').textContent).toBe('Next');
    fire(root, 'main'); fire(root, 'next');
    expect(root.innerHTML).toMatch(/data-main[^>]*>Next</);   // the unvoiced page: no Your turn either
    expect(screenOf(root.innerHTML)).toBe('story-page');
    fire(root, 'mic');
    expect(asked).toBe(0);
    expect(e.calls.lr).toHaveLength(0);
    const q = fs.readFileSync(QSRC, 'utf8');
    expect(q).not.toMatch(/getUserMedia|data-tap="mic"|micSay/);
    // with askMic the page offers Your turn and the sheet is the live reader's
    const e2 = env(); const r2 = await openReader(e2);
    expect(r2.innerHTML).toContain('data-tap="alt">Your turn<');
    fire(r2, 'alt');
    expect(e2.calls.ask).toHaveLength(1);
  });
  test('askMic present: called per LIVEREAD §11 (lang, onStream, onDenied, onNotNow, src) when the sheet opens; its button is the primary', async () => {
    const e = env(); const root = await openReader(e);
    toMic(e, root);
    expect(screenOf(root.innerHTML)).toBe('story-mic');
    expect(e.calls.ask).toHaveLength(1);
    expect(e.calls.ask[0]).toMatchObject({ lang: 'en', src: 'story' });
    expect(typeof e.calls.ask[0].onNotNow).toBe('function');
    expect(typeof e.calls.ask[0].ev).toBe('function'); // the sheet reports mic_ask / mic_declined itself
    expect(e.calls.askEl.querySelector('.lr-go').attrs).toHaveProperty('data-primary');
    expect(root.innerHTML).not.toMatch(/<img|<h2 class="wqs-say"|data-tap="notnow"|data-tap="mic"/);
    expect(primaries(root.innerHTML)).toBe(0);
    expect(root.innerHTML).toMatch(/data-back[^>]*>✕/);
  });
  test('the mic notice: the sheet is handed this child\'s chip and whether Jugnu keeps passage recordings (lr3_keep), one mark for the live reader to keep', async () => {
    const e = env(); const root = await openReader(e);
    toMic(e, root);
    expect(e.calls.ask[0].notice).toEqual({ kid: KID, keep: false });
    const e2 = env({ replies: { book: { status: 200, body: book({ lr3_keep: true }) } } }); const r2 = await openReader(e2);
    toMic(e2, r2);
    expect(e2.calls.ask[0].notice).toEqual({ kid: KID, keep: true });
  });
  test('the kept notice, told once: the page read after a sheet that showed it carries notice:2 (the server\'s record), the next read does not; never for "nothing kept" or with no notice shown', async () => {
    const R5 = { words_total: 5, words_read: 5, skipped: 0, ms: 5000, ended: 'quiet', marks: ['read', 'read', 'read', 'read', 'read'] };
    const reads = (e) => e.calls.posts.filter((x) => x.body.event === 'story_page_read').map((x) => x.body.data);
    const e = env({ replies: { book: { status: 200, body: book({ lr3_keep: true }) } } }); const root = await openReader(e);
    toMic(e, root);
    e.calls.ask[0].notice.shown = 1;                               // the live reader showed it and the child tapped Start
    e.calls.ask[0].onStream({});
    e.calls.lr[0].o.onResult(R5);
    expect(reads(e)[0].notice).toBe(2);
    expect(e.calls.ask[0].notice.shown).toBe(0);
    fire(root, 'main'); toMic(e, root);
    e.calls.ask[1].onStream({});
    e.calls.lr[e.calls.lr.length - 1].o.onResult(R5);
    expect(reads(e)).toHaveLength(2);
    expect(reads(e)[1]).not.toHaveProperty('notice');
    const e2 = env(); const r2 = await openReader(e2);           // lr3_keep absent: the "nothing kept" words
    toMic(e2, r2); e2.calls.ask[0].notice.shown = 1; e2.calls.ask[0].onStream({}); e2.calls.lr[0].o.onResult(R5);
    expect(reads(e2)[0]).not.toHaveProperty('notice');
    const e3 = env({ replies: { book: { status: 200, body: book({ lr3_keep: true }) } } }); const r3 = await openReader(e3);
    toMic(e3, r3); e3.calls.ask[0].onStream({}); e3.calls.lr[0].o.onResult(R5);   // already seen on this phone: nothing shown
    expect(reads(e3)[0]).not.toHaveProperty('notice');
  });
  test('the notice version the reader sends is the Trail\'s (TrailPage.NOTICE_V): a new notice wording moves both or the server ignores the field', () => {
    const tp = fs.readFileSync(path.join(__dirname, '..', '..', 'bot', 'shared', 'services', 'quiz', 'web-quiz-trail-page.js'), 'utf8');
    expect(fs.readFileSync(QSRC, 'utf8').match(/d\.notice = (\d+);/)[1]).toBe(tp.match(/const NOTICE_V = (\d+);/)[1]);
  });
  // the phone's microphone light: a stream whose tracks count their stops
  const micStream = (id) => { const tr = { stops: 0, stop() { tr.stops += 1; } }; return { id, tr, getTracks: () => [tr] }; };
  test('the microphone is given back the moment a page read ends (every track stopped); the next Your turn asks again', async () => {
    const e = env(); const root = await openReader(e);
    toMic(e, root);
    const st = micStream('a');
    e.calls.ask[0].onStream(st);
    expect(st.tr.stops).toBe(0);                                  // reading: the microphone is on
    e.calls.lr[0].o.onResult({ words_total: 5, words_read: 4, skipped: 1, ms: 5000, ended: 'quiet', marks: ['read', 'read', 'read', 'skipped', 'read'] });
    expect(st.tr.stops).toBe(1);
    fire(root, 'main');                                            // Next
    toMic(e, root);
    expect(e.calls.ask).toHaveLength(2);
    const st2 = micStream('b');
    e.calls.ask[1].onStream(st2);
    expect(e.calls.lr[e.calls.lr.length - 1].o.stream).toBe(st2);
  });
  test('the microphone is given back when the read is closed, when the page is left, and when the reader is closed', async () => {
    const e = env(); const root = await openReader(e);
    toMic(e, root);
    const st = micStream('a');
    e.calls.ask[0].onStream(st);
    fire(root, 'close');
    expect(st.tr.stops).toBeGreaterThanOrEqual(1);
    const e2 = env(); const r2 = await openReader(e2);
    toMic(e2, r2);
    const st2 = micStream('b');
    e2.calls.ask[0].onStream(st2);
    e2.S.open('b-2', e2.ctx({ root: r2 }));                        // another book opened (a route change)
    await flush();
    expect(st2.tr.stops).toBeGreaterThanOrEqual(1);
    const e3 = env(); const r3 = await openReader(e3);
    toMic(e3, r3);
    const st3 = micStream('c');
    e3.calls.ask[0].onStream(st3);
    fire(r3, 'back');                                              // the reader's own way out (by the hash)
    (e3.winL.hashchange || []).forEach((f) => f({}));
    expect(st3.tr.stops).toBeGreaterThanOrEqual(1);
    const e4 = env(); const r4 = await openReader(e4);
    toMic(e4, r4);
    const st4 = micStream('d');
    e4.calls.ask[0].onStream(st4);
    (e4.winL.pagehide || []).forEach((f) => f({}));                 // the tab closed mid-read
    expect(st4.tr.stops).toBeGreaterThanOrEqual(1);
  });
  test('a stream granted after the reader is gone (Back while the phone asks) is given back at once, never read', async () => {
    const e = env(); const root = await openReader(e);
    toMic(e, root);
    const nlr = e.calls.lr.length;
    e.S.open('b-2', e.ctx({ root }));                              // the child left while the phone's prompt was open
    await flush();
    const late = micStream('late');
    e.calls.ask[0].onStream(late);
    expect(late.tr.stops).toBe(1);
    expect(e.calls.lr.length).toBe(nlr);
  });
  test('a stream that arrives after the sheet has gone is given back at once', async () => {
    const e = env(); const root = await openReader(e);
    toMic(e, root);
    e.calls.ask[0].onNotNow();
    const late = micStream('late');
    e.calls.ask[0].onStream(late);
    expect(late.tr.stops).toBe(1);
  });
  test('a wide line of small print is whole on screen, both edges, in page view, while listening and while reading, in English (left to right) and Urdu (right to left)', async () => {
    const bk = book(); bk.pages[0].lines = [{ i0: 0, i1: 2, box: [40, 800, 640, 22] }, { i0: 3, i1: 4, box: [60, 830, 600, 22] }];
    for (const lang of ['en', 'ur']) {
      const e = env({ replies: { book: { status: 200, body: { ...bk, lang, dir: lang === 'ur' ? 'rtl' : 'ltr' } } } }); const root = await openReader(e, { lang });
      const whole = (lines) => {
        const m = /translate\((-?[\d.]+)px,(-?[\d.]+)px\) scale\(([\d.]+)\)/.exec(root.querySelector('[data-cam]').style.transform);
        const tx = Number(m[1]); const ty = Number(m[2]); const sc = Number(m[3]);
        lines.forEach((l) => {
          expect(l.box[0] * sc + tx).toBeGreaterThanOrEqual(-0.5);              // the line's left end on screen
          expect((l.box[0] + l.box[2]) * sc + tx).toBeLessThanOrEqual(360.5);   // the line's right end on screen
          expect(l.box[1] * sc + ty).toBeGreaterThanOrEqual(-0.5);              // its top on screen
          expect((l.box[1] + l.box[3]) * sc + ty).toBeLessThanOrEqual(540.5);   // its bottom on screen
        });
      };
      whole(bk.pages[0].lines);                                                   // page view
      fire(root, 'main'); e.calls.ra[e.calls.ra.length - 1].o.onWord(0);
      whole([bk.pages[0].lines[0]]);                                              // listening: the line being read
      e.calls.ra[e.calls.ra.length - 1].o.onWord(3);
      whole([bk.pages[0].lines[1]]);
      e.calls.ra[e.calls.ra.length - 1].o.onEnd();
      toMic(e, root); e.calls.ask[e.calls.ask.length - 1].onStream({ id: 's' });
      expect(screenOf(root.innerHTML)).toBe('story-read');
      whole(bk.pages[0].lines);                                                   // reading: every line of the part
    }
  });
  test('steady on, listening to a short line under long ones (the operator\'s "made tw…" cut): every line stays whole across the screen, in English and Urdu', async () => {
    // the stall setting on (web_quiz_stories_steady): the camera fix rides it, so with it off every page is today's
    const bk = { ...book(), steady: 1 }; bk.pages[0].words = Array.from({ length: 6 }, (_, i) => ({ i, t: 'w' + i, s_ms: i * 300, e_ms: i * 300 + 250 }));
    bk.pages[0].lines = [{ i0: 0, i1: 1, box: [40, 700, 640, 40] }, { i0: 2, i1: 3, box: [40, 760, 620, 40] }, { i0: 4, i1: 5, box: [40, 820, 300, 40] }];
    for (const lang of ['en', 'ur']) {
      const e = env({ replies: { book: { status: 200, body: { ...bk, lang, dir: lang === 'ur' ? 'rtl' : 'ltr' } } } }); const root = await openReader(e, { lang });
      fire(root, 'main');
      const ra = e.calls.ra[e.calls.ra.length - 1].o;
      for (const w of [0, 2, 4]) {
        ra.onWord(w);
        const m = /translate\((-?[\d.]+)px,(-?[\d.]+)px\) scale\(([\d.]+)\)/.exec(root.querySelector('[data-cam]').style.transform);
        const tx = Number(m[1]); const ty = Number(m[2]); const sc = Number(m[3]);
        bk.pages[0].lines.forEach((l) => {
          expect(l.box[0] * sc + tx).toBeGreaterThanOrEqual(-0.5);
          expect((l.box[0] + l.box[2]) * sc + tx).toBeLessThanOrEqual(360.5);
        });
        const cur = bk.pages[0].lines[w / 2];                       // the line being read is on screen top to bottom
        expect(cur.box[1] * sc + ty).toBeGreaterThanOrEqual(-0.5);
        expect((cur.box[1] + cur.box[3]) * sc + ty).toBeLessThanOrEqual(540.5);
      }
    }
  });
  test('Your turn on a tall column (five lines read at once): the last line is not cut at the bottom of the stage', async () => {
    const bk = book(); bk.pages[0].words = Array.from({ length: 10 }, (_, i) => ({ i, t: 'w' + i, s_ms: i * 300, e_ms: i * 300 + 250 }));
    bk.pages[0].lines = [0, 1, 2, 3, 4].map((k) => ({ i0: k * 2, i1: k * 2 + 1, box: [100, 500 + k * 110, 400, 60] }));
    const e = env({ replies: { book: { status: 200, body: bk } } }); const root = await openReader(e);
    fire(root, 'main'); e.calls.ra[0].o.onEnd(); toMic(e, root); e.calls.ask[e.calls.ask.length - 1].onStream({ id: 's' });
    const m = /translate\((-?[\d.]+)px,(-?[\d.]+)px\) scale\(([\d.]+)\)/.exec(root.querySelector('[data-cam]').style.transform);
    expect((500 + 4 * 110 + 60) * Number(m[3]) + Number(m[2])).toBeLessThanOrEqual(540.5);
    expect(500 * Number(m[3]) + Number(m[2])).toBeGreaterThanOrEqual(-0.5);
  });
  test('the "Whole page" pill sits OUTSIDE the page (under the stage, at the end of the row), never over a word or a heading, in every state', async () => {
    const bk = book(); bk.pages[0].lines = [{ i0: 0, i1: 2, box: [100, 800, 500, 60] }, { i0: 3, i1: 4, box: [100, 870, 120, 60] }];
    // inside the stage the pill is the stage's last child (its </div> follows); outside, the next thing is the screen's own
    const outside = (h) => { const m = /<button class="wqs-whole"[^>]*>[^<]*<\/button>(<\/div>)?/.exec(h); return !!m && !m[1]; };
    for (const lang of ['en', 'ur']) {
      const e = env({ replies: { book: { status: 200, body: { ...bk, lang, dir: lang === 'ur' ? 'rtl' : 'ltr' } } } }); const root = await openReader(e, { lang });
      expect(root.innerHTML).toContain('data-whole');
      expect(outside(root.innerHTML)).toBe(true);                          // page view
      fire(root, 'main');
      expect(outside(root.innerHTML)).toBe(true);                          // listening
      e.calls.ra[0].o.onEnd(); toMic(e, root); e.calls.ask[0] && e.calls.ask[e.calls.ask.length - 1].onStream({ id: 's' });
      if (screenOf(root.innerHTML) === 'story-read') expect(outside(root.innerHTML)).toBe(true);   // reading
      expect(root.innerHTML).toMatch(/class="wqs-stage wqs-st2" data-stage/);   // the stage gives up the pill's row
    }
    const css = fs.readFileSync(CSS, 'utf8');
    expect((/\.wqs-whole\{([^}]*)\}/.exec(css) || [])[1]).not.toMatch(/position:absolute/);
  });
  test('the page\'s main button keeps its label on one line (an Urdu label wrapped and made the row jump)', () => {
    const css = fs.readFileSync(CSS, 'utf8');
    expect(css).toMatch(/\.wqs-ctl \.wqs-main\{[^}]*white-space:nowrap/);
    expect(css).toMatch(/\.wqs\[lang=ur\] \.wqs-ctl \.wqs-main\{[^}]*font-size:18px/);
  });
  test('every Back is a drawn chevron (a Nastaliq font draws the ‹ glyph like the letter ر), mirrored on right-to-left screens', async () => {
    for (const lang of ['en', 'ur']) {
      const e = env({ replies: { book: { status: 200, body: book({ lang, dir: lang === 'ur' ? 'rtl' : 'ltr' }) } } }); const root = await openReader(e, { lang });
      const back = (/<button class="wqs-ic" data-back[^>]*>([\s\S]*?)<\/button>/.exec(root.innerHTML) || [])[1];
      expect(back).toMatch(/^<svg class="wqs-g"/);
      expect(root.innerHTML).not.toMatch(/>‹</);
    }
    expect(fs.readFileSync(CSS, 'utf8')).toMatch(/\.wqs\[dir=rtl\] \.wqs-ic\[data-back\] svg\{transform:scaleX\(-1\)\}/);
  });
  test('the page-turn arrows are drawn chevrons (no text glyph a Nastaliq font turns into a bracket), the same in English and Urdu', async () => {
    for (const lang of ['en', 'ur']) {
      const e = env({ replies: { book: { status: 200, body: book({ lang, dir: lang === 'ur' ? 'rtl' : 'ltr' }) } } }); const root = await openReader(e, { lang });
      const h = root.innerHTML;
      const arr = h.match(/<button class="wqs-arr"[^>]*>[\s\S]*?<\/button>/g) || [];
      expect(arr).toHaveLength(2);
      arr.forEach((a) => { expect(a).toMatch(/<svg class="wqs-g"[^>]*><path d="[^"]+"\/><\/svg>/); expect(a).not.toMatch(/[‹›<>]\s*<\/span>|>[‹›]</); });
    }
  });
  test('Your turn never shows a white stage: an unboxed page gets the reader\'s picture under the live-read layer; a boxed page is drawn by the live reader itself (one picture, its marks on it)', async () => {
    const bk = book(); bk.pages[0].lines = [{ i0: 0, i1: 2, box: [100, 800, 500, 60] }, { i0: 3, i1: 4, box: [100, 870, 120, 60] }];
    for (const lang of ['en', 'ur']) {
      for (const boxed of [false, true]) {
        const e = env({ replies: { book: { status: 200, body: { ...bk, lang, dir: lang === 'ur' ? 'rtl' : 'ltr', pages: [{ ...bk.pages[0], boxes_ok: boxed }, ...bk.pages.slice(1)] } } } });
        const root = await openReader(e, { lang });
        toMic(e, root); e.calls.ask[e.calls.ask.length - 1].onStream({ id: 'stream' });
        const h = root.innerHTML;
        expect(screenOf(h)).toBe('story-read');
        if (boxed) expect(h).toMatch(/data-cam[^>]*><div class="wqs-lr" data-lr><\/div>/);
        else expect(h).toMatch(/data-cam[^>]*><img src="\/s\/b-1\/p01\.webp"[^>]*><div class="wqs-lr" data-lr><\/div>/);
      }
    }
    // the live-read layer sits on the picture whichever draws it (it was positioned only after a player's [data-ra])
    expect(fs.readFileSync(CSS, 'utf8')).toMatch(/\.wqs-cam \[data-ra\]~\.wqs-lr,\.wqs-cam img~\.wqs-lr\{position:absolute;left:0;top:0/);
  });
  test('Your turn on a zoomed page: the camera frames ALL the lines being read and holds still (a short line never zooms the long ones off the edge)', async () => {
    const bk = book(); bk.pages[0].lines = [{ i0: 0, i1: 2, box: [100, 800, 500, 60] }, { i0: 3, i1: 4, box: [100, 870, 120, 60] }];
    const e = env({ replies: { book: { status: 200, body: bk } } }); const root = await openReader(e);
    toMic(e, root); e.calls.ask[0].onStream({ id: 'stream' });
    expect(screenOf(root.innerHTML)).toBe('story-read');
    const cam = root.querySelector('[data-cam]');
    const t0 = cam.style.transform;
    const s0 = Number((/scale\(([\d.]+)\)/.exec(t0) || [])[1]);
    expect(s0 * 500).toBeLessThanOrEqual(360);   // the long line fits the stage (360 px in this page)
    e.calls.lr[0].view = () => ({ states: ['read', 'read', 'read', 'current', 'ahead'] });   // the child reaches the short line
    e.advance(1000);
    expect(cam.style.transform).toBe(t0);
  });
  test('Your turn: the word to read next is outlined, never covered (the current box is see-through, alpha under one half)', () => {
    const css = fs.readFileSync(CSS, 'utf8');
    const rule = (/\.wqs-cam \.lr-box\.lr-current\{([^}]*)\}/.exec(css) || [])[1] || '';
    expect(rule).toMatch(/outline:3px solid #15803D/);
    const a = /background:rgba\(\s*\d+,\s*\d+,\s*\d+,\s*([\d.]+)\)/.exec(rule);
    expect(a).toBeTruthy();
    expect(Number(a[1])).toBeLessThan(0.5);
  });
  test('the stage gives the "Whole page" pill its row (so the screen does not grow), and the look-back sheet\'s stage leaves its primary on screen', () => {
    const css = fs.readFileSync(CSS, 'utf8');
    expect(css).toMatch(/\.wqs-st2\{height:calc\(62vh - 52px\)\}/);
    expect(css).toMatch(/\.wqs-sheet \.wqs-stage\{height:calc\(100vh - 400px\);min-height:150px\}/);
  });
  test('the page arrows are two different chevrons, mirrored only by their own screen\'s direction (an English book inside an Urdu app keeps its arrows)', async () => {
    const e = env(); const root = await openReader(e);
    const prev = (/data-tap="prev"[^>]*><svg[^>]*><path d="([^"]+)"/.exec(root.innerHTML) || [])[1];
    const next = (/data-tap="next"[^>]*><svg[^>]*><path d="([^"]+)"/.exec(root.innerHTML) || [])[1];
    expect(prev).toBeTruthy(); expect(next).toBeTruthy(); expect(prev).not.toBe(next);
    const css = fs.readFileSync(CSS, 'utf8');
    expect(css).toMatch(/\.wqs\[dir=rtl\] \.wqs-arr\{transform:scaleX\(-1\)\}/);
    expect(css).toMatch(/\.wqs\[dir=rtl\] \.wqs-ic\[data-back\] svg\{transform:scaleX\(-1\)\}/);
    expect(css).not.toMatch(/(^|[\s}])\[dir=rtl\] \.wqs-(arr|ic)/);   // never keyed to ANY right-to-left ancestor
  });
  test('Your turn: reading with "I\'m done ✓" from the first render', async () => {
    const e = env(); const root = await openReader(e);
    toMic(e, root);
    let h;
    expect(e.calls.ask).toHaveLength(1);
    e.calls.ask[0].onStream({ id: 'stream' });
    h = root.innerHTML;
    checkScreen(h, 'en');
    expect(screenOf(h)).toBe('story-read');
    expect(h).toMatch(/data-primary[^>]*>I&#39;m done <svg class="wqs-g"[^>]*><path d="M9 16.2/);
    expect(text(h)).not.toMatch(/[0-9]/);
    const c = e.calls.lr[0];
    expect(c.o.copy.checking).toBe('Listening…');
    expect(c.o).toMatchObject({ lang: 'en', dir: 'ltr', meter: 'none', record: false, counted: false, finish: { pct: 0.8, quiet_ms: 4000, tail_ms: 1000, quiet: true } });
    expect(c.o.stream).toEqual({ id: 'stream' });
    expect(c.o.words[3].box).toEqual([230, 870, 90, 50]);
    expect(c.o.image.url).toBe('/s/b-1/p01.webp');
    const k = await c.o.getKey();
    expect(k.ws).toBe('wss://x');
    const kp = e.calls.posts.find((x) => /\/lr\/key/.test(x.url));
    expect(kp.body).toEqual({ st: TOKEN, kid: KID, book: 'b-1', page: 1, lang: 'en' });
    fire(root, 'main');
    expect(c.log).toContain('stop:done_tap');
  });
  test('"Not now, just listen" (askMic onDenied(\'not_now\') or onNotNow): back to Listen, nothing lost, the event left to the sheet', async () => {
    const e = env(); const root = await openReader(e);
    toMic(e, root);
    e.calls.ask[0].onDenied('not_now');
    expect(screenOf(root.innerHTML)).toBe('story-page');
    expect(root.innerHTML).toMatch(/data-main[^>]*>Listen</);
    // the live reader's sheet logs mic_declined through the ev it is handed; the reader never logs it twice
    expect((e.calls.ev || []).filter((x) => x[0] === 'mic_declined')).toHaveLength(0);
    const e2 = env(); const r2 = await openReader(e2);
    toMic(e2, r2); e2.calls.ask[0].onNotNow();
    expect(r2.innerHTML).toMatch(/data-main[^>]*>Listen</);
  });
  test('a result: story_page_read without the transcript; praise; practise the skipped word, then Next', async () => {
    const e = env(); const root = await openReader(e);
    toMic(e, root); fire(root, 'mic'); e.calls.ask[0].onStream({});
    e.calls.lr[0].o.onResult({ words_total: 5, words_read: 4, skipped: 1, ms: 5000, ended: 'quiet', marks: ['read', 'read', 'read', 'skipped', 'read'], transcript_final: 'mina has a kite', wpm: null });
    const ev = e.calls.posts.find((x) => x.body.event === 'story_page_read');
    expect(ev.body.data).toEqual({ words_total: 5, words_read: 4, skipped: 1, ms: 5000, ended: 'quiet', skipped_words: [3], first: 'listen' });
    expect(JSON.stringify(e.calls.posts)).not.toContain('mina has a kite');
    const h = root.innerHTML;
    checkScreen(h, 'en');
    expect(screenOf(h)).toBe('story-page');
    expect(h).toContain('Let&#39;s practise this word');
    expect(h).toContain('zigzag</button>');
    const p2 = e.calls.ra[e.calls.ra.length - 1];
    fire(root, 'word', 3);
    expect(p2.log).toContain('word:3');
    expect(root.querySelector('[data-main]').textContent).toBe('Next');
  });
  test('lrr on: two words skipped ("The" and "game") → practise the longest, "game" (a tie keeps the earlier); the reader gets repeat; the page event carries the absorbed count only', async () => {
    const page = (ws, lrr) => { const bk = book(); if (lrr !== undefined) bk.lrr = lrr; bk.pages[0] = { ...bk.pages[0], text: ws.join(' '), words: ws.map((x, i) => W(i, x, 100 + 500 * i, [110 + 60 * i, 810, 40, 50])) }; return bk; };
    const run = async (ws, marks, extra = {}, ...off) => {
      const lrr = off.length ? off[0] : true;
      const e = env({ replies: { book: { status: 200, body: page(ws, lrr) } } }); const root = await openReader(e);
      toMic(e, root); fire(root, 'mic'); e.calls.ask[0].onStream({});
      e.calls.lr[0].o.onResult({ words_total: ws.length, words_read: marks.filter((x) => x === 'read').length, skipped: marks.filter((x) => x === 'skipped').length, ms: 5000, ended: 'quiet', marks, ...extra });
      return { e, root, h: root.innerHTML, o: e.calls.lr[0].o, ev: e.calls.posts.find((x) => x.body.event === 'story_page_read') };
    };
    const GAME = ['The', 'game', 'is', 'so', 'fun.'];
    const a = await run(GAME, ['skipped', 'skipped', 'read', 'read', 'read'], { absorbed: 2 });
    expect(a.o.repeat).toBe(true);
    expect(a.h).toContain('Let&#39;s practise this word');
    expect(a.h).toContain('game</button>');
    expect(a.h).not.toContain('The</button>');
    expect(a.ev.body.data).toEqual({ words_total: 5, words_read: 3, skipped: 2, ms: 5000, ended: 'quiet', skipped_words: [0, 1], first: 'listen', absorbed: 2 });
    const b = await run(GAME, ['read', 'read', 'skipped', 'skipped', 'read']);
    expect(b.h).toContain('is</button>');   // "is" and "so": a tie, the earlier one
    expect(b.ev.body.data).not.toHaveProperty('absorbed');
    // lrr off (absent, or anything but true): today's reader — the first skipped word, no repeat, no absorbed key
    for (const lrr of [undefined, false]) {
      const c = await run(GAME, ['skipped', 'skipped', 'read', 'read', 'read'], {}, lrr); // eslint-disable-line no-await-in-loop
      expect(c.o.repeat).toBe(lrr);
      expect(c.h).toContain('The</button>');
      expect(c.ev.body.data).toEqual({ words_total: 5, words_read: 3, skipped: 2, ms: 5000, ended: 'quiet', skipped_words: [0, 1], first: 'listen' });
    }
  });
  test('0 words heard: no praise, "Let\'s read it together", Listen offered again', async () => {
    const e = env(); const root = await openReader(e);
    toMic(e, root); fire(root, 'mic'); e.calls.ask[0].onStream({});
    e.calls.lr[0].o.onResult({ words_total: 5, words_read: 0, skipped: 0, ms: 4000, ended: 'done_tap', marks: ['ahead', 'ahead', 'ahead', 'ahead', 'ahead'] });
    const h = root.innerHTML;
    checkScreen(h, 'en');
    expect(h).toContain('Let&#39;s read it together');
    expect(text(h)).not.toMatch(/Well read|Great|Shabash/i);
    expect(h).toMatch(/data-main[^>]*>Listen</);
  });
  test('a denied mic: "That\'s OK, let\'s listen with Jugnu", Listen; never a dead end', async () => {
    const e = env(); const root = await openReader(e);
    toMic(e, root); fire(root, 'mic');
    e.calls.ask[0].onDenied('notallowed');
    const h = root.innerHTML;
    checkScreen(h, 'en');
    expect(h).toContain('That&#39;s OK, let&#39;s listen with Jugnu');
    // the live reader's sheet logs mic_declined through the ev it is handed; the reader never logs it twice
    expect((e.calls.ev || []).filter((x) => x[0] === 'mic_declined')).toHaveLength(0);
    const p = e.calls.ra[e.calls.ra.length - 1];
    fire(root, 'main');
    expect(p.log).toContain('play');
  });
  test('the picture page: "Next" is the one labelled primary, no timer; arrows destroy the player', async () => {
    const e = env(); const root = await openReader(e);
    fire(root, 'next');
    expect(e.calls.ra[0].log).toContain('destroy');
    const h = root.innerHTML;
    checkScreen(h, 'en');
    expect(h).toMatch(/data-main data-primary data-tap="main">Next</);
    e.advance(10000);
    expect(root.innerHTML).toContain('p02.webp');
    fire(root, 'main');
    expect(root.innerHTML).toContain('p03.webp');
    fire(root, 'prev'); fire(root, 'prev');
    expect(root.innerHTML).toMatch(/data-tap="prev" disabled/);
  });
  test('audio:null page: no Listen, Your turn straight away; the book is polled once after 3 s and Listen appears if voiced', async () => {
    const voiced = book(); voiced.pages[2].audio = { url: '/a/p3.ogg', ms: 2000 };
    let n = 0;
    const e = env({ replies: { get book() { n += 1; return { status: 200, body: n > 1 ? voiced : book() }; } } });
    const root = await openReader(e);
    fire(root, 'next'); fire(root, 'next');
    let h = root.innerHTML;
    checkScreen(h, 'en');
    expect(text(h)).not.toMatch(/Listen/);
    expect(h).toMatch(/data-main[^>]*>Your turn</);
    e.advance(3000); await flush();
    expect(e.calls.gets.filter((u) => /stories\/book/.test(u))).toHaveLength(2);
    h = root.innerHTML;
    expect(h).toMatch(/data-main[^>]*>Listen</);
    e.advance(10000); await flush();
    expect(e.calls.gets.filter((u) => /stories\/book/.test(u))).toHaveLength(2);
    const e2 = env({ lr: false }); const r2 = await openReader(e2);
    fire(r2, 'next'); fire(r2, 'next');
    expect(r2.innerHTML).toMatch(/data-main[^>]*>Next</);
  });
  test('#story/<id>/p<n> opens on page n', async () => {
    const e = env({ hash: '#story/b-1/p3' });
    const root = fakeEl('root');
    expect(e.S.route(e.ctx({ root }))).toBe(true);
    await flush();
    expect(root.innerHTML).toContain('p03.webp');
  });
  test('Back from the reader goes to #stories; mute is remembered (wq_snd, or WQJ.mute when present)', async () => {
    const e = env(); const root = await openReader(e);
    fire(root, 'snd');
    expect(e.store.getItem('wq_snd')).toBe('0');
    expect(e.calls.ra[0].audio.muted).toBe(true);
    fire(root, 'back');
    expect(e.win.location.hash).toBe('#stories');
    expect(e.calls.ra[0].log).toContain('destroy');
    const e2 = env({ wqj: true }); const r2 = await openReader(e2);
    fire(r2, 'snd');
    expect(e2.calls.juice).toContain('mute:true');
  });
  test('an Urdu book: rtl screens, Urdu copy, no banned words', async () => {
    const e = env({ replies: { book: { status: 200, body: book({ lang: 'ur', dir: 'rtl', title: 'بلی' }) } } });
    const root = await openReader(e, { lang: 'ur' });
    checkScreen(root.innerHTML, 'ur');
    expect(root.innerHTML).toContain('سنیں');
    // In Urdu the next page is to the LEFT: the glyphs are isolated from the browser's own mirroring, and the stylesheet
    // flips them once, so each arrow points outward (a double flip pointed both inward).
    expect(root.innerHTML).toMatch(/data-tap="prev"[^>]*><svg class="wqs-g"/);   // drawn chevrons; RTL mirrors the buttons (CSS)
    expect(root.innerHTML).toMatch(/data-tap="next"[^>]*><svg class="wqs-g"/);
    expect(require('fs').readFileSync(require('path').join(__dirname, '..', 'public', 'wq', 'wq-stories.css'), 'utf8')).toContain('[dir=rtl] .wqs-arr{transform:scaleX(-1)}');
    // The top bar runs right to left too: back sits on the right and its ‹ is mirrored by the browser to point right.
    expect(root.innerHTML).toMatch(/class="wqs-top" dir="rtl"/);
    expect(root.innerHTML).not.toMatch(/class="wqs-top" dir="ltr"/);
    toMic(e, root);
    expect(root.innerHTML).toMatch(/data-screen="story-mic" lang="ur" dir="rtl"/);
    expect(e.calls.ask[0].lang).toBe('ur');
    fire(root, 'mic'); e.calls.ask[0].onStream({});
    checkScreen(root.innerHTML, 'ur');
    expect(root.innerHTML).toMatch(/میں نے پڑھ لیا <svg class="wqs-g"/);
    expect(e.calls.lr[0].o.copy.checking).toBe('آپ کی آواز سنی جا رہی ہے…');
    e.calls.lr[0].o.onResult({ words_total: 5, words_read: 0, marks: [] });
    expect(root.innerHTML).toContain('آئیں مل کر پڑھیں');
  });
  test('stories off on a teacher link: a kind way home; offline: retry', async () => {
    const e = env({ replies: { book: { status: 404, body: { error: 'stories_off' } } } });
    const root = await openReader(e);
    checkScreen(root.innerHTML, 'en');
    expect(root.innerHTML).toMatch(/data-home/);
    let off = true;
    const e2 = env({ fail: () => off });
    const r2 = await openReader(e2);
    checkScreen(r2.innerHTML, 'en');
    off = false; fire(r2, 'retry'); await flush();
    expect(screenOf(r2.innerHTML)).toBe('story-page');
  });
});

describe('the Done label', () => {
  test('when the live reader offers its Done label, the reading screen uses it (one implementation)', async () => {
    const e = env({ doneHtml: true });
    const root = await openReader(e);
    toMic(e, root);
    e.calls.ask[0].onStream({});
    expect(root.innerHTML).toContain('<span class="lr-done-ok">X</span>');
  });
});

// ---- questions + done --------------------------------------------------------------------------------------------
function runBook(e, root) {
  toMic(e, root); fire(root, 'mic'); e.calls.ask[0].onStream({});
  e.calls.lr[0].o.onResult(READ(['read', 'read', 'skipped', 'read', 'read']));
  fire(root, 'main'); fire(root, 'next');
  fire(root, 'main'); fire(root, 'mic'); e.calls.ask[1].onStream({});
  e.calls.lr[1].o.onResult(READ(['read', 'read', 'read', 'read']));
  fire(root, 'main');
}
describe('questions and the done card', () => {
  test('#story/<id>/q: one at a time, a speaker on the question and options, one tap answers, 900 ms on; no score anywhere', async () => {
    const e = env({ hash: '#story/b-1/q', wqj: true });
    const root = fakeEl('root');
    expect(e.S.route(e.ctx({ root }))).toBe(true);
    await flush();
    let h = root.innerHTML;
    checkScreen(h, 'en');
    expect(screenOf(h)).toBe('story-questions');
    expect(h).toContain('What does Mina have?');
    expect(h).not.toContain('Where does the kite go?');
    expect((h.match(/data-tap="say"/g) || []).length).toBe(4);
    expect((h.match(/data-tap="ans"/g) || []).length).toBe(3);
    fire(root, 'ans', 2);
    expect(root.innerHTML).toContain('wqs-chosen');
    await flush();
    expect(e.calls.posts.find((x) => x.body.event === 'story_answer').body).toMatchObject({ book_id: 'b-1', event: 'story_answer', data: { n: 1, i: 2 } });
    e.advance(899);
    expect(root.innerHTML).toContain('What does Mina have?');
    e.advance(1);
    h = root.innerHTML;
    checkScreen(h, 'en');
    expect(h).toContain('Where does the kite go?');
    expect(h).toContain('/s/b-1/q2o1-abcd1234.webp');
    expect((h.match(/data-tap="say"/g) || []).length).toBe(0);
    fire(root, 'ans', 0); await flush(); e.advance(900); await flush(); await flush();
    const qd = e.calls.posts.find((x) => x.body.event === 'story_questions_done');
    expect(qd.body.data).toEqual({ answers: [[2], [0]] });
    const sd = e.calls.posts.find((x) => x.body.event === 'story_done');
    expect(sd.body.data).toEqual({ pages_listened: 0, pages_read: 0, stars: 2 });
    h = root.innerHTML;
    checkScreen(h, 'en');
    expect(screenOf(h)).toBe('story-done');
    expect(h).toContain('You looked through the whole book.');
    expect(text(h)).not.toMatch(/\d\s*\/\s*\d|wrong|★|⭐|whole story/i);
    expect(h).not.toContain('sticker');
    expect(e.calls.juice).not.toContain('finish:3');
    fire(root, 'more');
    expect(e.win.location.hash).toBe('#stories');
  });
  test('the whole book read: "You read the whole story!" + the deed count; no questions -> straight to the card', async () => {
    const e = env({ replies: { book: { status: 200, body: book({ questions: [] }) } } });
    const root = await openReader(e);
    runBook(e, root);
    await flush(); await flush();
    expect(e.calls.posts.find((x) => x.body.event === 'story_questions_done')).toBeUndefined();
    const sd = e.calls.posts.find((x) => x.body.event === 'story_done');
    expect(sd.body.data).toMatchObject({ pages_listened: 1, pages_read: 2 });
    const h = root.innerHTML;
    checkScreen(h, 'en');
    expect(screenOf(h)).toBe('story-done');
    expect(h).toContain('You read the whole story!');
    expect(h).toContain('2 pages read');
    // one card renderer (WQFC); our fallback is only the line, More stories and Home
    expect(h).not.toMatch(/sticker|jugnu_celebrate|wa\.me|data-tap="share"/);
  });
  test('Urdu done card: the ergative line and the deed in Urdu digits', async () => {
    const e = env({ replies: { book: { status: 200, body: book({ lang: 'ur', dir: 'rtl', questions: [] }) } } });
    const root = await openReader(e, { lang: 'ur' });
    runBook(e, root);
    await flush(); await flush();
    const h = root.innerHTML;
    checkScreen(h, 'ur');
    expect(h).toContain('آپ نے پوری کہانی پڑھ لی!');
    expect(h).toContain('۲ صفحے پڑھے');
    expect(text(h)).not.toMatch(/[0-9]/);
  });
  test('Urdu, every text page listened to, no reading: «آپ نے پوری کہانی سن لی!» and «۱ صفحہ سنا»', async () => {
    const bk = book({ lang: 'ur', dir: 'rtl' }); bk.pages = bk.pages.slice(0, 2);
    const e = env({ lr: false, replies: { book: { status: 200, body: bk } } });
    const root = await openReader(e, { lang: 'ur' });
    fire(root, 'main'); e.calls.ra[0].o.onEnd(); fire(root, 'main'); fire(root, 'next');
    checkScreen(root.innerHTML, 'ur');
    fire(root, 'ans', 0); await flush(); e.advance(900); fire(root, 'ans', 1); await flush(); e.advance(900); await flush(); await flush();
    const h = root.innerHTML;
    checkScreen(h, 'ur');
    expect(h).toContain('آپ نے پوری کہانی سن لی!');
    expect(h).toContain('۱ صفحہ سنا');
  });
  test('Look back: 1st miss -> a soft shake, "Hmm, look again" with the page; back with the tile dimmed; 2nd miss -> "It was: …" kindly, then Next', async () => {
    const e = env({ hash: '#story/b-1/q', wqj: true, right: (d) => (d.n === 1 && d.i === 0) || (d.n === 2 && d.i === 0) });
    const root = fakeEl('root');
    e.S.route(e.ctx({ root })); await flush();
    fire(root, 'ans', 2); await flush();
    expect(root.innerHTML).toContain('What does Mina have?');
    expect(root.querySelector('.wqs-chosen').className).toContain('wqs-wob');
    e.advance(600);
    let h = root.innerHTML;
    checkScreen(h, 'en');
    expect(screenOf(h)).toBe('story-look');
    expect(h).toContain('Hmm, look again');
    expect(h).toMatch(/data-primary data-tap="lret">Back to the question</);
    expect(text(h)).not.toMatch(/wrong|no\b/i);
    const p = e.calls.ra[e.calls.ra.length - 1];
    expect(p.data.id).toBe('b-1/p1');
    expect(p.o.band).toBeUndefined();
    expect(p.log).not.toContain('play');
    fire(root, 'lplay'); expect(p.log).toContain('play');
    fire(root, 'lret');
    expect(p.log).toContain('destroy');
    h = root.innerHTML;
    checkScreen(h, 'en');
    expect(h).toContain('What does Mina have?');
    expect(h).toMatch(/class="wqs-opt wqs-dim" data-tap="ans" data-arg="2"/);
    fire(root, 'ans', 1); await flush();
    expect(e.calls.posts.filter((x) => x.body.event === 'story_answer')[0].body.data).toEqual({ n: 1, i: 2 });
    expect(e.calls.posts.filter((x) => x.body.event === 'story_answer')[1].body.data).toEqual({ n: 1, i: 1, try: 2, first: 2 });
    h = root.innerHTML;
    checkScreen(h, 'en');
    expect(h).toContain('It was: a kite');
    expect(text(h)).not.toMatch(/wrong|not right|no\b/i);
    expect(h).toMatch(/data-primary data-tap="qnext">Next</);
    e.advance(5000);
    expect(root.innerHTML).toContain('It was: a kite');
    fire(root, 'qnext');
    expect(root.innerHTML).toContain('Where does the kite go?');
    // Q2: a miss on a page with no voice: the picture only; right on the 2nd try = the same effort
    fire(root, 'ans', 2); await flush(); e.advance(600);
    expect(screenOf(root.innerHTML)).toBe('story-look');
    expect(root.innerHTML).toContain('p03.webp');
    fire(root, 'lret'); fire(root, 'ans', 0); await flush(); e.advance(900); await flush(); await flush();
    const qd = e.calls.posts.find((x) => x.body.event === 'story_questions_done');
    expect(qd.body.data).toEqual({ answers: [[2, 1], [2, 0]] });
    expect(e.calls.posts.filter((x) => x.body.event === 'story_answer')).toHaveLength(4);
    expect(screenOf(root.innerHTML)).toBe('story-done');
  });
  test('Urdu look-back copy: «ہمم، ایک بار پھر دیکھیں» and «جواب یہ ہے: …»', async () => {
    const e = env({ hash: '#story/b-1/q', right: () => false, replies: { book: { status: 200, body: book({ lang: 'ur', dir: 'rtl' }) } } });
    const root = fakeEl('root');
    e.S.route(e.ctx({ root, lang: 'ur' })); await flush();
    fire(root, 'ans', 2); await flush(); e.advance(600);
    expect(root.innerHTML).toContain('ہمم، ایک بار پھر دیکھیں');
    fire(root, 'lret'); fire(root, 'ans', 1); await flush();
    checkScreen(root.innerHTML, 'ur');
    expect(root.innerHTML).toContain('جواب یہ ہے: a kite');
  });
  test('Look back: a right answer -> correct beat + 900 ms on; story_answer offline -> just moves on', async () => {
    const e = env({ hash: '#story/b-1/q', wqj: true });
    const root = fakeEl('root');
    e.S.route(e.ctx({ root })); await flush();
    const juice = [];
    e.win.WQJ.correct = () => juice.push('correct');
    fire(root, 'ans', 0); await flush();
    expect(juice).toEqual(['correct']);
    e.advance(900);
    expect(root.innerHTML).toContain('Where does the kite go?');
    const e2 = env({ hash: '#story/b-1/q', fail: (u) => /event/.test(u) });
    const r2 = fakeEl('root');
    e2.S.route(e2.ctx({ root: r2 })); await flush();
    fire(r2, 'ans', 2); await flush(); e2.advance(900);
    expect(r2.innerHTML).toContain('Where does the kite go?');
  });
  test('zero-input chain: skip Listen, Done at 0 words, no questions -> "You looked through the whole book.", no sticker, no confetti', async () => {
    const e = env({ wqj: true, alwaysSticker: true, replies: { book: { status: 200, body: book({ questions: [] }) } } });
    const root = await openReader(e);
    fire(root, 'next'); fire(root, 'next');
    fire(root, 'main'); fire(root, 'mic'); e.calls.ask[0].onStream({});
    fire(root, 'main');
    e.calls.lr[0].o.onResult({ words_total: 4, words_read: 0, skipped: 0, ms: 900, ended: 'done_tap', marks: ['ahead', 'ahead', 'ahead', 'ahead'] });
    expect(root.innerHTML).toContain('Let&#39;s read it together');
    fire(root, 'main'); await flush(); await flush();
    const sd = e.calls.posts.find((x) => x.body.event === 'story_done');
    expect(sd.body.data).toMatchObject({ pages_listened: 0, pages_read: 0 });
    const h = root.innerHTML;
    checkScreen(h, 'en');
    expect(screenOf(h)).toBe('story-done');
    // the done line says what happened (the book was paged through), not an offer to read together
    expect(h).toContain('You looked through the whole book.');
    expect(h).not.toContain('Let&#39;s read it together');
    expect(text(h)).not.toMatch(/whole story|sticker|page|tried/i);
    expect(e.calls.juice.filter((x) => /^finish/.test(x))).toHaveLength(0);
    const e2 = env({ replies: { book: { status: 200, body: book({ lang: 'ur', dir: 'rtl', questions: [] }) } } });
    const r2 = await openReader(e2, { lang: 'ur' });
    fire(r2, 'next'); fire(r2, 'next'); fire(r2, 'next'); await flush(); await flush();
    checkScreen(r2.innerHTML, 'ur');
    expect(r2.innerHTML).toContain('آپ نے پوری کتاب دیکھ لی۔');
    expect(screenOf(r2.innerHTML)).toBe('story-done');
  });
});

// ---- entries: the teacher link, the teacher preview, the hash ------------------------------------------------------
describe('entries', () => {
  test('boot.story: opens #story/<id>, remembers the teacher book, story_opened carries from_teacher + code, shelf sends t=', async () => {
    const e = env({ boot: { token: TOKEN, kid: KID, lang: 'en', story: { id: 'b-7', from_teacher: true, code: 'K7Q2' } } });
    expect(e.win.location.hash).toBe('#story/b-7');
    expect(e.store.getItem('wq_st_t:' + KID)).toBe('b-7');
    await flush();
    expect(screenOf(e.wqRoot.innerHTML)).toBe('story-page');
    const op = e.calls.posts.filter((x) => x.body.event === 'story_opened');
    expect(op).toHaveLength(1);
    expect(op[0].body).toMatchObject({ book_id: 'b-7', data: { from_teacher: true, code: 'K7Q2', shelf_position: null } });
    const el = fakeEl('shelf'); e.S.shelf(el, e.ctx()); await flush();
    expect(e.calls.gets.find((u) => /shelf/.test(u))).toContain('&t=b-7');
  });
  test('the teacher preview: bookUrl, no events, no Your turn, questions read-only then Back', async () => {
    const e = env();
    const root = fakeEl('root');
    let backs = 0;
    e.S.open('b-1', { role: 'teacher', bookUrl: '/api/teacher/story/b-1', root, lang: 'en', clock: e.clock, onBack: () => { backs += 1; } });
    await flush();
    expect(e.calls.gets).toEqual(['/api/teacher/story/b-1']);
    checkScreen(root.innerHTML, 'en');
    fire(root, 'main'); e.calls.ra[0].o.onEnd();
    expect(root.querySelector('[data-main]').textContent).toBe('Next');
    fire(root, 'next'); fire(root, 'next');
    expect(root.innerHTML).toMatch(/data-main[^>]*>Next</);
    fire(root, 'main');
    const h = root.innerHTML;
    checkScreen(h, 'en');
    expect(h).toContain('What does Mina have?');
    expect(h).toContain('Where does the kite go?');
    expect(h).not.toContain('data-tap="ans"');
    expect(h).not.toContain('story-done');
    fire(root, 'back');
    expect(backs).toBe(1);
    expect(e.calls.posts).toHaveLength(0);
  });
  test('the global, and a #story hash routed on hashchange (story_opened once, no shelf position)', async () => {
    const e = env();
    expect(typeof e.S.shelf).toBe('function'); expect(typeof e.S.open).toBe('function'); expect(typeof e.S.route).toBe('function');
    const root = fakeEl('root');
    e.win.WQSTORIES_CTX = e.ctx({ root });
    e.win.location.hash = '#story/b-1';
    e.winL.hashchange.forEach((f) => f());
    await flush();
    expect(screenOf(root.innerHTML)).toBe('story-page');
    const op = e.calls.posts.filter((x) => x.body.event === 'story_opened');
    expect(op).toHaveLength(1);
    expect(op[0].body.data.shelf_position).toBe(null);
    expect(op[0].body.data.from_teacher).toBe(false);
    e.win.location.hash = '#stories';
    expect(e.S.route(e.ctx({ root }))).toBe(false);
    expect(e.calls.ra[0].log).toContain('destroy');
  });
});

describe('the shipped files', () => {
  test('the lazy chunk: asked once at our ?v= when the reader opens; it failing to load is a kind retry, never a dead end', async () => {
    const e = env(); const root = await openReader(e);
    expect(e.calls.loaded.filter((x) => /wq-stories-q/.test(x.src)).map((x) => x.src)).toEqual(['/wq/wq-stories-q.js?v=abc123']);
    toMic(e, root);
    expect(screenOf(root.innerHTML)).toBe('story-mic');
    const e2 = env({ qFail: true }); const r2 = await openReader(e2);
    toMic(e2, r2);
    checkScreen(r2.innerHTML, 'en');
    expect(r2.innerHTML).toContain('data-tap="retry"');
    expect(r2.innerHTML).toMatch(/data-back/);
  });
  test('no answer key client side, no U+00B7, banned Urdu words absent from the copy, size budgets (core <= 12 KB gz)', () => {
    const src = fs.readFileSync(SRC, 'utf8') + fs.readFileSync(QSRC, 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(src).not.toContain('answer_i');
    expect(src).not.toContain('·');
    expect(code).not.toMatch(/ٹیپ کریں|گم شدہ|استاد|امتحان|ٹیسٹ/);
    const zlib = require('zlib');
    expect(zlib.gzipSync(fs.readFileSync(SRC, 'utf8'), { level: 9 }).length).toBeLessThanOrEqual(13580);   // the ruled core budget (12,288 less 8; +296 for the reader's text lens, COS YES 18 Oct; +136 for the steady camera that keeps every line whole, lead YES 18 Oct; +348 for the reading moment's picture box that keeps a framed page's picture whole, 19 Oct; +232 for its live-state fix: the opening words hidden under a clipped sheet once its picture is in, framed again when the stage resizes, 19 Oct; +80 for the look's drawn replay sign on Listen again (the Urdu face draws ↻ like «ج»), 19 Oct; +200 for the page voice as .mp3 on a phone that plays no Ogg Opus (iOS before 18.4; web_quiz_story_mp3), 27 Oct; served minified)
    // 9 KiB (#S88): heard first slow tap must run inside the tap; headroom recorded in the size test
    const qgz = zlib.gzipSync(fs.readFileSync(QSRC, 'utf8'), { level: 9 }).length;
    console.log('wq-stories-q.js gz ' + qgz + ' / 9216, headroom ' + (9 * 1024 - qgz));
    expect(qgz).toBeLessThanOrEqual(9 * 1024);
    expect(zlib.gzipSync(fs.readFileSync(DSRC, 'utf8'), { level: 9 }).length).toBeLessThanOrEqual(8 * 1024);   // the questions + done file
    const css = fs.readFileSync(CSS, 'utf8');
    expect(zlib.gzipSync(css, { level: 9 }).length).toBeLessThanOrEqual(3 * 1024);
    expect(css).toContain('prefers-reduced-motion');
  });
});

// ---- one text, zoom to the line ------------------------------------------------
describe('the camera (pure)', () => {
  test('lines group by box y-overlap, in reading order', () => {
    const e = env();
    const ln = e.S._lines(book().pages[0]);
    expect(ln.l.map((x) => x.i)).toEqual([[0, 1, 2], [3, 4]]);
    expect(ln.of).toEqual([0, 0, 0, 1, 1]);
    // Nastaliq: words of one line sit at slightly different heights, still one line
    const ur = [[600, 500, 80, 40], [520, 506, 70, 34], [430, 498, 80, 44], [610, 560, 70, 40]].map((box, i) => ({ i, t: 'w', box }));
    expect(e.S._lines({ words: ur }).l.map((x) => x.i)).toEqual([[0, 1, 2], [3]]);
  });
  test('whole page: contain-fit and centred', () => {
    const e = env();
    expect(e.S._cam(null, 360, 540, 720, 1080)).toMatchObject({ s: 0.5, tx: 0, ty: 0 });
    expect(e.S._cam(null, 360, 600, 720, 1080)).toMatchObject({ s: 0.5, tx: 0, ty: 30 });
  });
  test('an EN line: fills the width up to 3x the whole page, centred, at 70 % of the height; words >= 26 px', () => {
    const e = env();
    const c = e.S._cam([[110, 810, 40, 50], [160, 810, 30, 50], [200, 810, 20, 50]], 360, 540, 720, 1080, false);
    expect(c).toMatchObject({ s: 1.5, tx: -67.5, ty: -874.5, ok: true });
    expect(c.px).toBe(75);
  });
  test('an RTL Urdu line wider than the screen: 26 px words, the line START (right edge) in view', () => {
    const e = env();
    const line = [[600, 500, 80, 18], [400, 500, 150, 18], [40, 500, 300, 18]];
    const c = e.S._cam(line, 360, 540, 720, 1080, true);
    expect(c.ok).toBe(true);
    expect(c.px).toBeCloseTo(26, 0);
    expect(680 * c.s + c.tx).toBeCloseTo(345.6, 0);
    const l = e.S._cam(line, 360, 540, 720, 1080, false);
    expect(40 * l.s + l.tx).toBeCloseTo(14.4, 0);
  });
  test('print too small for 26 px within 3x: not ok', () => {
    const e = env();
    expect(e.S._cam([[100, 900, 30, 8], [140, 900, 30, 8]], 360, 540, 720, 1080, false).ok).toBe(false);
  });
  test('the sweep mark: the word box, else its line row, else a progress bar (from the right for Urdu)', () => {
    const e = env();
    const p = book().pages[0];
    expect(e.S._mark(p, 1, null, false)).toEqual([160, 810, 30, 50]);
    const q = { ...p, words: p.words.map((w, i) => (i === 4 ? { ...w, box: undefined } : w)) };
    expect(e.S._mark(q, 4, [100, 800, 520, 130], false)).toEqual([100, 870, 520, 50, 1]);
    const n = book().pages[2];
    expect(e.S._mark(n, 1, [100, 800, 520, 130], false)).toEqual([100, 800, 260, 130, 1]);
    expect(e.S._mark(n, 1, [100, 800, 520, 130], true)).toEqual([360, 800, 260, 130, 1]);
    expect(e.S._mark(n, 1, null, false)).toEqual([0, 1040, 360, 40, 1]);
  });
});

describe('the reader zooms to the printed line', () => {
  const T0 = 'translate(0px,0px) scale(0.5)';
  test('whole page before Listen (its words in the lens when small); on Listen the line; the next line as the word moves; Whole page toggle; back out after the last word; Your turn zoomed', async () => {
    const REST = T0;
    const e = env(); const root = await openReader(e);
    const h = root.innerHTML;
    expect(h).toMatch(/data-cam style="width:720px;height:1080px"/);
    expect(h).toContain('Whole page');
    const cam = root.querySelector('[data-cam]');
    expect(cam.style.transform).toBe(REST);
    const p = e.calls.ra[0];
    fire(root, 'main');
    expect(cam.style.transform).toBe('translate(-67.5px,-874.5px) scale(1.5)');
    p.o.onWord(1);
    expect(cam.style.transform).toBe('translate(-67.5px,-874.5px) scale(1.5)');
    p.o.onWord(3);
    expect(cam.style.transform).toBe('translate(-285px,-964.5px) scale(1.5)');
    fire(root, 'cam');
    expect(cam.style.transform).toBe(T0);
    p.o.onWord(4);
    expect(cam.style.transform).toBe(T0);
    fire(root, 'cam');
    expect(cam.style.transform).toBe('translate(-285px,-964.5px) scale(1.5)');
    p.o.onEnd();
    expect(cam.style.transform).toBe(REST);
    fire(root, 'main'); fire(root, 'mic'); e.calls.ask[0].onStream({});
    const r = root.innerHTML;
    expect(r).toMatch(/data-cam[^>]*><div class="wqs-lr" data-lr><\/div>/);   // a boxed page: the live reader draws the picture and its marks itself
    // Your turn frames both lines of the page at once (not line 1 at the zoom cap), so no line runs off the stage
    expect(root.querySelector('[data-cam]').style.transform).toBe('translate(-97.1px,-580.7px) scale(1.108)');
    checkScreen(r, 'en');
  });
  test('print too small to zoom + a text band (boxed page): OUR crop over the print region and a tight mark on it; no band to the player', async () => {
    const bk = book(); bk.pages[0].words = bk.pages[0].words.map((w) => ({ ...w, box: [w.box[0], w.box[1], w.box[2], 8] }));
    const e = env({ replies: { book: { status: 200, body: bk } } }); const root = await openReader(e);
    const h = root.innerHTML;
    expect(h).toMatch(/<img class="wqs-lens" src="\/s\/b-1\/p01-band.webp" width="1440" height="260"[^>]*style="left:100px;top:800px;width:520px;height:130px"/);
    expect((h.match(/p01-band/g) || []).length).toBe(1);
    const p = e.calls.ra[0];
    expect(p.o.band).toBeUndefined(); expect(p.o.mode).toBe('overlay');
    fire(root, 'main'); p.o.onWord(1);
    const mk = root.querySelector('[data-mk]');
    expect([mk.style.left, mk.style.top, mk.style.width, mk.style.height, mk.style.opacity]).toEqual(['160px', '810px', '30px', '8px', '1']);
    expect(root.querySelector('[data-cam]').style.transform).not.toBe(T0);
  });
  test('a strip page (boxes_ok:false, no lines) + a text band: our crop over the print region and our sweep; no band to the player', async () => {
    const bk = book(); bk.pages[0].boxes_ok = false; bk.pages[0].words = bk.pages[0].words.map((w, i) => (i === 4 ? { ...w, box: undefined } : w));
    const e = env({ replies: { book: { status: 200, body: bk } } }); const root = await openReader(e);
    const h = root.innerHTML;
    expect(h).toMatch(/<img class="wqs-lens" src="\/s\/b-1\/p01-band.webp" width="1440" height="260"[^>]*style="left:100px;top:800px;width:520px;height:130px"/);
    expect((h.match(/p01-band/g) || []).length).toBe(1);
    const p = e.calls.ra[0];
    expect(p.o.band).toBeUndefined(); expect(p.o.mode).toBe('strip');
    fire(root, 'main'); p.o.onWord(4);
    const mk = root.querySelector('[data-mk]');
    expect([mk.style.left, mk.style.top, mk.style.width, mk.style.height, mk.style.opacity]).toEqual(['100px', '870px', '520px', '50px', '1']);
  });
  test('boxes_ok=false and no band: the whole page with a sweep, no zoom, no toggle', async () => {
    const bk = book(); bk.pages[0].boxes_ok = false; bk.pages[0].text_band = null; bk.pages[0].words = bk.pages[0].words.map(({ box, ...w }) => w);
    const e = env({ replies: { book: { status: 200, body: bk } } }); const root = await openReader(e);
    expect(root.innerHTML).not.toContain('Whole page');
    expect(root.innerHTML).not.toContain('wqs-lens');
    const p = e.calls.ra[0];
    expect(p.o.mode).toBe('strip');
    fire(root, 'main'); p.o.onWord(1);
    const mk = root.querySelector('[data-mk]');
    expect([mk.style.left, mk.style.width]).toEqual(['0px', '288px']);
    expect(root.querySelector('[data-cam]').style.transform).toBe(T0);
  });
  test('the highlight is a tight bordered box, never a glow; read marks are underlines', () => {
    const css = fs.readFileSync(CSS, 'utf8');
    // the player's pill is its own (we never restyle it); our mark (lens / sweep) looks the same: tight, outlined, no glow
    expect(css).not.toMatch(/wqra-pill|wqra-band/);
    expect(css).toMatch(/\.wqs-mk\{[^}]*background:rgba\(187,247,208,\.3\)[^}]*box-shadow:inset 0 0 0 3px #15803D[^}]*border-radius:8px/);
    expect(css).not.toMatch(/\.wqs-print/);
    // read marks are underlines drawn below the word (an outer shadow), never a bar over the ink
    expect(css).toMatch(/\.lr-read[^{]*\{background:none;box-shadow:0 5px 0 /);
    expect(css).toMatch(/\.lr-skipped::after\{[^}]*dashed/);
    expect(css).toMatch(/\.wqs-cam\{[^}]*transition:transform \.6s/);
  });
  test('Urdu: the toggle reads «پورا صفحہ»', async () => {
    const e = env({ replies: { book: { status: 200, body: book({ lang: 'ur', dir: 'rtl' }) } } });
    const root = await openReader(e, { lang: 'ur' });
    expect(root.innerHTML).toContain('پورا صفحہ');
  });
});

describe('the text lens wins over unsure word boxes (band setting)', () => {
  const LINES = [{ i0: 0, i1: 2, box: [100, 800, 300, 60] }, { i0: 3, i1: 4, box: [220, 860, 200, 60] }];
  const LENS = /<img class="wqs-lens" src="\/s\/b-1\/p01-band.webp" width="1440" height="260"[^>]*style="left:100px;top:800px;width:520px;height:130px"/;
  function page(over) { const bk = book(); bk.pages[0] = { ...bk.pages[0], lines: LINES, ...over }; return bk; }
  async function run(bk) {
    const e = env({ replies: { book: { status: 200, body: bk } } }); const root = await openReader(e);
    const h = root.innerHTML; const cam = root.querySelector('[data-cam]');
    fire(root, 'main'); e.calls.ra[0].o.onWord(1);
    const mk = root.querySelector('[data-mk]');
    const after = { cam: cam.style.transform, mk: mk ? [mk.style.left, mk.style.top, mk.style.width, mk.style.height, mk.style.opacity, mk.className] : null };
    e.calls.ra[0].o.onEnd(); fire(root, 'main'); fire(root, 'mic'); e.calls.ask[0].onStream({});
    return { e, h, after, mic: root.innerHTML };
  }
  // pinned from the reader BEFORE the lens rule (the setting OFF, and a good-box page, must not move a byte); re-pinned on the lines-stay-whole reader
  const PIN = {
    off: {"h":"<section class=\"wqs \" data-screen=\"story-page\" lang=\"en\" dir=\"ltr\"><div class=\"wqs-top\" dir=\"ltr\"><button class=\"wqs-ic\" data-back data-tap=\"back\" aria-label=\"Back\"><svg class=\"wqs-g\" viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M15.4 7.4 14 6l-6 6 6 6 1.4-1.4-4.6-4.6z\"/></svg></button><h2 lang=\"en\" dir=\"ltr\">Mina Testwala</h2><button class=\"wqs-ic wqs-snd\" data-snd data-tap=\"snd\" aria-pressed=\"false\" aria-label=\"Sound\"><svg class=\"wqs-g\" viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M3 9v6h4l5 5V4L7 9zm13.5 3A4.5 4.5 0 0 0 14 8v8a4.5 4.5 0 0 0 2.5-4zM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z\"/></svg></button></div><div class=\"wqs-stage wqs-st2\" data-stage><div class=\"wqs-cam\" data-cam style=\"width:720px;height:1080px\"><img src=\"/s/b-1/p01.webp\" width=\"720\" height=\"1080\" alt=\"\" onerror=\"WQSTORIES._bad(this)\"><div data-ra></div><i class=\"wqs-mk\" data-mk></i></div></div><button class=\"wqs-whole\" data-whole data-tap=\"cam\" aria-pressed=\"false\">Whole page</button><div class=\"wqs-extra\" data-extra><button class=\"wqs-sec\" data-tap=\"alt\">Your turn</button></div><div class=\"wqs-lrl\" data-lrl></div><div class=\"wqs-ctl\"><button class=\"wqs-arr\" data-tap=\"prev\" disabled aria-label=\"Page before\"><svg class=\"wqs-g\" viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M15.4 7.4 14 6l-6 6 6 6 1.4-1.4-4.6-4.6z\"/></svg></button><button class=\"wqs-main\" data-main data-primary data-tap=\"main\" data-sound data-trigger=\"tap\">Listen</button><button class=\"wqs-slow\" data-tap=\"slow\" aria-pressed=\"false\"><svg class=\"wqs-g\" viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M3 16a9 7 0 0 1 18 0zm17-3a2 2 0 1 0 2.5-2.5zM6 16v3h3v-3zm9 0v3h3v-3z\"/></svg> Slower</button><button class=\"wqs-arr\" data-tap=\"next\" aria-label=\"Next page\"><svg class=\"wqs-g\" viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M8.6 7.4 10 6l6 6-6 6-1.4-1.4 4.6-4.6z\"/></svg></button></div></section>","after":{"cam":"translate(-78.6px,-480.6px) scale(1.034)","mk":["160px","810px","30px","50px","1","wqs-mk"]},"mic":"<section class=\"wqs \" data-screen=\"story-read\" lang=\"en\" dir=\"ltr\"><div class=\"wqs-top\" dir=\"ltr\"><button class=\"wqs-ic\" data-back data-tap=\"close\" aria-label=\"Close\">✕</button><h2 lang=\"en\" dir=\"ltr\"></h2></div><img class=\"wqs-jg wqs-g0\" src=\"/wq/jugnu/hello.webp\" width=\"72\" height=\"72\" alt=\"\" data-jg onerror=\"WQSTORIES._bad(this)\"><div class=\"wqs-stage wqs-st2\" data-stage><div class=\"wqs-cam\" data-cam style=\"width:720px;height:1080px\"><img src=\"/s/b-1/p01.webp\" width=\"720\" height=\"1080\" alt=\"\" onerror=\"WQSTORIES._bad(this)\"><div class=\"wqs-lr\" data-lr></div><i class=\"wqs-mk\" data-mk></i></div></div><button class=\"wqs-whole\" data-whole data-tap=\"cam\" aria-pressed=\"false\">Whole page</button><button class=\"wqs-main wqs-done\" data-primary data-tap=\"main\">I&#39;m done <svg class=\"wqs-g\" viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z\"/></svg></button></section>"},
    good: {"h":"<section class=\"wqs \" data-screen=\"story-page\" lang=\"en\" dir=\"ltr\"><div class=\"wqs-top\" dir=\"ltr\"><button class=\"wqs-ic\" data-back data-tap=\"back\" aria-label=\"Back\"><svg class=\"wqs-g\" viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M15.4 7.4 14 6l-6 6 6 6 1.4-1.4-4.6-4.6z\"/></svg></button><h2 lang=\"en\" dir=\"ltr\">Mina Testwala</h2><button class=\"wqs-ic wqs-snd\" data-snd data-tap=\"snd\" aria-pressed=\"false\" aria-label=\"Sound\"><svg class=\"wqs-g\" viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M3 9v6h4l5 5V4L7 9zm13.5 3A4.5 4.5 0 0 0 14 8v8a4.5 4.5 0 0 0 2.5-4zM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z\"/></svg></button></div><div class=\"wqs-stage wqs-st2\" data-stage><div class=\"wqs-cam\" data-cam style=\"width:720px;height:1080px\"><div data-ra></div></div></div><button class=\"wqs-whole\" data-whole data-tap=\"cam\" aria-pressed=\"false\">Whole page</button><div class=\"wqs-extra\" data-extra><button class=\"wqs-sec\" data-tap=\"alt\">Your turn</button></div><div class=\"wqs-lrl\" data-lrl></div><div class=\"wqs-ctl\"><button class=\"wqs-arr\" data-tap=\"prev\" disabled aria-label=\"Page before\"><svg class=\"wqs-g\" viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M15.4 7.4 14 6l-6 6 6 6 1.4-1.4-4.6-4.6z\"/></svg></button><button class=\"wqs-main\" data-main data-primary data-tap=\"main\" data-sound data-trigger=\"tap\">Listen</button><button class=\"wqs-slow\" data-tap=\"slow\" aria-pressed=\"false\"><svg class=\"wqs-g\" viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M3 16a9 7 0 0 1 18 0zm17-3a2 2 0 1 0 2.5-2.5zM6 16v3h3v-3zm9 0v3h3v-3z\"/></svg> Slower</button><button class=\"wqs-arr\" data-tap=\"next\" aria-label=\"Next page\"><svg class=\"wqs-g\" viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M8.6 7.4 10 6l6 6-6 6-1.4-1.4 4.6-4.6z\"/></svg></button></div></section>","after":{"cam":"translate(-78.6px,-480.6px) scale(1.034)","mk":null},"mic":"<section class=\"wqs \" data-screen=\"story-read\" lang=\"en\" dir=\"ltr\"><div class=\"wqs-top\" dir=\"ltr\"><button class=\"wqs-ic\" data-back data-tap=\"close\" aria-label=\"Close\">✕</button><h2 lang=\"en\" dir=\"ltr\"></h2></div><img class=\"wqs-jg wqs-g0\" src=\"/wq/jugnu/hello.webp\" width=\"72\" height=\"72\" alt=\"\" data-jg onerror=\"WQSTORIES._bad(this)\"><div class=\"wqs-stage wqs-st2\" data-stage><div class=\"wqs-cam\" data-cam style=\"width:720px;height:1080px\"><div class=\"wqs-lr\" data-lr></div></div></div><button class=\"wqs-whole\" data-whole data-tap=\"cam\" aria-pressed=\"false\">Whole page</button><button class=\"wqs-main wqs-done\" data-primary data-tap=\"main\">I&#39;m done <svg class=\"wqs-g\" viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z\"/></svg></button></section>"},
  };
  test('boxes unsure + lines that fit + a band: the lens replaces the zoomed print; the box glides on the lens', async () => {
    const { e, h, after } = await run(page({ boxes_ok: false }));
    expect(h).toMatch(LENS);
    expect(h).toContain('Whole page');
    expect(h).toContain('data-mk');
    const c = e.S._cam([[100, 800, 520, 130]], 360, 540, 720, 1080, false, 6);
    expect(after.cam).toBe(`translate(${c.tx}px,${c.ty}px) scale(${c.s})`);
    expect(after.mk[4]).toBe('1');
  });
  test('Your turn on a lens page: the picture and the lens under the live-read layer (never a white stage); the camera frames the band and holds still', async () => {
    for (const lang of ['en', 'ur']) {
      const bk = page({ boxes_ok: false }); bk.lang = lang; bk.dir = lang === 'ur' ? 'rtl' : 'ltr';
      const e = env({ replies: { book: { status: 200, body: bk } } }); const root = await openReader(e, { lang });
      toMic(e, root); e.calls.ask[e.calls.ask.length - 1].onStream({ id: 'stream' });
      const h = root.innerHTML;
      expect(screenOf(h)).toBe('story-read');
      expect(h).toMatch(/data-cam[^>]*><img src="\/s\/b-1\/p01\.webp"[^>]*><div class="wqs-lr" data-lr><\/div>/);
      expect(h).toMatch(LENS);
      const c = e.S._cam([[100, 800, 520, 130]], 360, 540, 720, 1080, lang === 'ur', 6, 1);
      expect(root.querySelector('[data-cam]').style.transform).toBe(`translate(${c.tx}px,${c.ty}px) scale(${c.s})`);
    }
  });
  test('a page whose lines have no boxes at all (the poem case): the sweep sits under the line being read, one row of the band, never a block over every line', async () => {
    for (const rtl of [false, true]) {
      const bk = book(); bk.lang = rtl ? 'ur' : 'en'; bk.dir = rtl ? 'rtl' : 'ltr';
      const ws = ['Aa', 'Bb', 'Cc', 'Dd', 'Ee', 'Ff', 'Gg', 'Hh'].map((t, i) => W(i, t, 100 + i * 400));   // no word boxes
      bk.pages[0] = { ...bk.pages[0], words: ws, boxes_ok: false, lines: [{ i0: 0, i1: 1 }, { i0: 2, i1: 3 }, { i0: 4, i1: 5 }, { i0: 6, i1: 7 }] };
      const e = env({ replies: { book: { status: 200, body: bk } } }); const root = await openReader(e, { lang: bk.lang });
      expect(e.S._mark(bk.pages[0], 2, bk.pages[0].text_band.box, rtl)).toEqual([rtl ? 100 + 520 / 2 : 100, 800 + 130 / 4 * 2 - 6, 520 / 2, 6, 1]);
      fire(root, 'main'); e.calls.ra[0].o.onWord(5);
      const mk = root.querySelector('[data-mk]');
      expect([mk.style.left, mk.style.top, mk.style.width, mk.style.height, mk.className]).toEqual([rtl ? '100px' : '100px', `${800 + 130 / 4 * 3 - 6}px`, '520px', '6px', 'wqs-mk wqs-sw']);
    }
  });
  test('the same page with the setting OFF (no band): byte-identical to before', async () => {
    const r = await run(page({ boxes_ok: false, text_band: null }));
    expect({ h: r.h, after: r.after, mic: r.mic }).toEqual(PIN.off);
  });
  test('good boxes + lines: the zoomed print as before, byte-identical', async () => {
    const r = await run(page({ boxes_ok: true }));
    expect({ h: r.h, after: r.after, mic: r.mic }).toEqual(PIN.good);
  });
  test('boxes unsure, no lines, a band: the lens as before', async () => {
    const bk = book(); bk.pages[0].boxes_ok = false;
    const { h } = await run(bk);
    expect(h).toMatch(LENS);
    expect(h).toContain('Whole page');
  });
});

describe('the finish card and Home', () => {
  async function toDone(e) { const root = await openReader(e); runBook(e, root); await flush(); await flush(); return root; }
  test('card_v3: loads wq-finish-card at our ?v=, mounts on our button row with the real API, hides our block', async () => {
    let got = null;
    const e = env({ replies: { book: { status: 200, body: book({ questions: [], card_v3: true }) } }, onLoad: (w) => { w.WQFC = { mount(el, o) { got = { el, o }; return true; } }; } });
    const root = await toDone(e);
    expect(e.calls.loaded.map((x) => x.src || x.href).filter((u) => /finish-card/.test(u))).toEqual(['/wq/wq-finish-card.css?v=abc123', '/wq/wq-finish-card.js?v=abc123']);
    expect(got.el).toBe(root.querySelector('[data-col]'));
    // the card's Next tile is "More stories" (this page's own shelf) and it leads; the share steps back
    expect(got.o).toEqual({ source: 'story', ended: 'read', pages_read: 2, pages_listened: expect.any(Number), stars: null, title: 'Mina Testwala', cover: undefined, lang: 'en', auth: { hub: TOKEN, kid: KID }, ev: expect.any(Function), home: '#',
      next: { kind: 'stories', href: '/h/tok?x=1#stories', title: 'More stories' }, lead: true, whole: true, answered: 0, sticker: true });
    expect(root.querySelector('[data-own]').hidden).toBe(true);
    // one "More stories": the card's tile, so our own button is not drawn beside it; Home stays ours
    expect(primaries(root.innerHTML)).toBe(0);
    expect(root.innerHTML).not.toContain('data-tap="more"');
    expect(root.innerHTML).toMatch(/<button class="wqs-sec" data-home data-tap="home">Home</);
    let g2 = null;
    const e2 = env({ noSticker: true, replies: { book: { status: 200, body: book({ questions: [], card_v3: true }) } }, onLoad: (w) => { w.WQFC = { mount(el, o) { g2 = o; return true; } }; } });
    await toDone(e2);
    expect(g2.sticker).toBe(false);
  });
  test('the card refuses (false) -> our own block stays; no card_v3 -> nothing loaded', async () => {
    const e = env({ replies: { book: { status: 200, body: book({ questions: [], card_v3: true }) } }, onLoad: (w) => { w.WQFC = { mount: () => false }; } });
    const root = await toDone(e);
    expect(root.querySelector('[data-own]').hidden).toBe(false);
    expect(root.innerHTML).toContain('You read the whole story!');
    // no card: today's screen, "More stories" our one primary again
    expect(primaries(root.innerHTML)).toBe(1);
    expect(root.innerHTML).toMatch(/<button class="wqs-main" data-primary data-tap="more">More stories</);
    expect(root.innerHTML).not.toMatch(/sticker|jugnu_celebrate|wa\.me/);
    const e2 = env({ replies: { book: { status: 200, body: book({ questions: [] }) } } });
    await toDone(e2);
    expect(e2.calls.loaded.filter((x) => /finish-card/.test(x.src || x.href))).toHaveLength(0);
  });
  test('Home: the hash is cleared with replaceState and a hashchange is dispatched (so the home re-renders)', async () => {
    const e = env({ replies: { book: { status: 200, body: book({ questions: [] }) } } });
    const root = await toDone(e);
    fire(root, 'home');
    expect(e.calls.hist).toEqual(['/h/tok?x=1']);
    expect(e.calls.disp).toEqual(['hashchange']);
  });
});

describe('hooks, hush, back controls, the own done screen', () => {
  test('the home slot is [data-stories-shelf] (hub-play owns [data-shelf])', () => {
    const src = fs.readFileSync(SRC, 'utf8');
    expect(src).toContain("querySelector('[data-stories-shelf], .wq-shelf[data-shelf]')");
    expect(src).not.toContain("'[data-shelf]'");
  });
  test('Urdu without askMic: Listen only («سنیں»), no «اب آپ پڑھیں», no sheet copy of our own', async () => {
    const e = env({ noAsk: true, replies: { book: { status: 200, body: book({ lang: 'ur', dir: 'rtl' }) } } });
    const root = await openReader(e, { lang: 'ur' });
    checkScreen(root.innerHTML, 'ur');
    expect(root.innerHTML).toMatch(/data-main[^>]*>سنیں</);
    expect(root.innerHTML).not.toContain('اب آپ پڑھیں');
    fire(root, 'main'); e.calls.ra[0].o.onEnd();
    expect(root.querySelector('[data-main]').textContent).toBe('آگے');
    expect(fs.readFileSync(QSRC, 'utf8')).not.toContain('جگنو کو اپنی آواز سنانے کے لیے دبائیں');
  });
  test('the page hidden: the listen player pauses and its clock stops; a reading is stopped', async () => {
    const e = env(); const root = await openReader(e);
    const p = e.calls.ra[0];
    fire(root, 'main'); e.advance(1000);
    e.doc.visibilityState = 'hidden'; e.doc.L.visibilitychange.forEach((f) => f());
    expect(p.log).toEqual(['play', 'pause']);
    expect(root.querySelector('[data-main]').textContent).toBe('Listen');
    e.advance(5000);
    fire(root, 'next');
    const ev = e.calls.posts.find((x) => x.body.event === 'story_page_listened');
    expect(ev.body.data).toEqual({ ms: 1000, completed: false });
    const e2 = env(); const r2 = await openReader(e2);
    toMic(e2, r2); e2.calls.ask[0].onStream({});
    e2.doc.visibilityState = 'hidden'; e2.doc.L.visibilitychange.forEach((f) => f());
    expect(e2.calls.lr[0].log).toContain('stop:hidden');
  });
  test('the page hidden on the look-back screen: its player pauses too', async () => {
    const e = env({ hash: '#story/b-1/q', right: () => false });
    const root = fakeEl('root');
    e.S.route(e.ctx({ root })); await flush();
    fire(root, 'ans', 2); await flush(); e.advance(600);
    expect(screenOf(root.innerHTML)).toBe('story-look');
    const p = e.calls.ra[e.calls.ra.length - 1];
    fire(root, 'lplay');
    e.doc.visibilityState = 'hidden'; e.doc.L.visibilitychange.forEach((f) => f());
    expect(p.log).toEqual(['play', 'pause']);
  });
  test('a missed tile is visibly dimmed; the sweep uses the one green of the box', () => {
    const css = fs.readFileSync(CSS, 'utf8');
    const rule = (sel) => (new RegExp(sel.replace(/[.]/g, '\\.') + '\\{([^}]*)\\}').exec(css) || [])[1] || '';
    expect(rule('.wqs-dim')).toMatch(/opacity:\.45/);
    expect(rule('.wqs-sw')).toMatch(/rgba\(187,247,208,\.3\)/);
    expect(rule('.wqs-sw')).toMatch(/#15803D/i);
    expect(css).not.toMatch(/88,\s*204,\s*2/);
  });
  test('a first miss whose page_ref has no page: the question again with "Hmm, look again" and the tile dimmed', async () => {
    const bk = book(); bk.questions[0].page_ref = 9;
    const e = env({ hash: '#story/b-1/q', right: () => false, replies: { book: { status: 200, body: bk } } });
    const root = fakeEl('root');
    e.S.route(e.ctx({ root })); await flush();
    fire(root, 'ans', 2); await flush(); e.advance(600);
    const h = root.innerHTML;
    checkScreen(h, 'en');
    expect(screenOf(h)).toBe('story-questions');
    expect(h).toContain('Hmm, look again');
    expect(h).toMatch(/class="wqs-opt wqs-dim" data-tap="ans" data-arg="2"/);
    fire(root, 'ans', 1); await flush();
    expect(root.innerHTML).not.toContain('Hmm, look again');
  });
  test('the loading screens: the reader\'s has a back as its one primary; the shelf\'s has a home link that is never the primary', async () => {
    const e = env(); const root = fakeEl('root');
    e.S.open('b-1', e.ctx({ root }));
    let h = root.innerHTML;
    expect(screenOf(h)).toBe('story-wait');
    checkScreen(h, 'en');
    expect(h).toMatch(/data-back[^>]*data-primary|data-primary[^>]*data-back/);
    const el = fakeEl('shelf');
    e.S.shelf(el, e.ctx());
    h = el.innerHTML;
    expect(h).toContain('wqs-skel');
    expect(screenOf(h)).toBe('stories-wait');
    expect(h).toMatch(/data-home/);
    expect(primaries(h)).toBe(0);
    const el2 = fakeEl('shelf2');
    e.S.shelf(el2, e.ctx({ primary: false }));
    expect(primaries(el2.innerHTML)).toBe(0);
  });
  test('a block the reader hides with [hidden] is gone even when its class sets a display (the done screen\'s own block under the card)', () => {
    const css = fs.readFileSync(CSS, 'utf8');
    expect(css).toMatch(/\.wqs \[hidden\]\{display:none!important\}/);
  });
  test('the look-back screen (a centred sheet) stretches the page stage: the stage\'s only child is absolute, so a centred stage would be 0 px wide', () => {
    const css = fs.readFileSync(CSS, 'utf8');
    expect(css).toMatch(/\.wqs-sheet \.wqs-stage[^{]*\{[^}]*align-self:stretch/);
  });
  test('the look-back screen has a back control; the shelf retry has a home link', async () => {
    const e = env({ hash: '#story/b-1/q', right: () => false });
    const root = fakeEl('root');
    e.S.route(e.ctx({ root })); await flush();
    fire(root, 'ans', 2); await flush(); e.advance(600);
    expect(screenOf(root.innerHTML)).toBe('story-look');
    expect(root.innerHTML).toMatch(/data-back data-tap="lret"/);
    const e2 = env({ fail: () => true }); const el = fakeEl('shelf');
    e2.S.shelf(el, e2.ctx()); await flush();
    expect(el.innerHTML).toMatch(/data-home/);
  });
  test('the own done screen has NO share, sticker or picture (share lives only in WQFC); WQFC gets the cover', async () => {
    const e = env({ replies: { book: { status: 200, body: book({ questions: [], cover: '/s/b-1/cover.webp' }) } } });
    const root = await openReader(e); runBook(e, root); await flush(); await flush();
    const h = root.innerHTML;
    expect(h).not.toMatch(/wa\.me|data-tap="share"|<img|sticker/);
    expect((h.match(/<button/g) || []).length).toBe(3);   // mute, More stories, Home
    expect(h).toMatch(/data-primary data-tap="more">More stories</);
    expect(h).toMatch(/data-home data-tap="home">Home</);
    fire(root, 'share');
    expect(e.calls.posts.find((x) => x.body.event === 'story_shared')).toBeUndefined();
    let got = null;
    const e2 = env({ replies: { book: { status: 200, body: book({ questions: [], card_v3: true, cover: '/s/b-1/cover.webp' }) } }, onLoad: (w) => { w.WQFC = { mount(el, o) { got = o; return true; } }; } });
    const r2 = await openReader(e2); runBook(e2, r2); await flush(); await flush();
    expect(got.cover).toBe('/s/b-1/cover.webp');
  });
});

// ---- the done screen with the real finish card: the child's next thing leads, the book's cover on the card ----------
describe('the done screen with the real finish card (card_v3): ONE primary = More stories, the cover', () => {
  const FCSRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'wq-finish-card.js'), 'utf8');
  // the real WQFC in its own vm; its block lands before our button row, so the screen = card block + our row
  function realCard(sink) {
    return (w) => {
      const c = { window: {}, document: { getElementById: () => null, createElement: () => ({}), head: { appendChild() {} } }, location: { origin: 'https://portal.example' }, navigator: {}, fetch: () => Promise.resolve({ ok: false }) };
      c.window = c; vm.createContext(c); vm.runInContext(FCSRC, c);
      w.WQFC = { mount(el, o) { sink.o = o; return c.WQFC.mount({ insertAdjacentHTML: (pos, h) => { sink.card = (sink.card || '') + h; } }, o); } };
    };
  }
  const d0 = (sink) => sink.card || '';
  async function done(over, lang) {
    const sink = {};
    const e = env({ replies: { book: { status: 200, body: book({ questions: [], card_v3: true, lang: lang || 'en', ...over }) } }, onLoad: realCard(sink) });
    const root = await openReader(e); runBook(e, root); await flush(); await flush();
    return { e, root, sink, screen: () => (sink.card || '') + root.innerHTML };
  }
  // the share keeps the card's own word, whatever it is today
  const SEND = (l) => new RegExp(l + ": \\{ send: '([^']*)'").exec(FCSRC)[1];
  test.each([['en', 'More stories', 'Next', SEND('en'), 'Home'], ['ur', 'اور کہانیاں', 'اگلا', SEND('ur'), 'ہوم']])('%s: exactly one data-primary and it is the More stories tile; the share is present and not primary; Home third', async (lang, more, nextW, send, home) => {
    const d = await done({}, lang);
    const h = d.screen();
    expect(screenOf(d.root.innerHTML)).toBe('story-done');
    expect(primaries(h)).toBe(1);
    const prim = /<a [^>]*data-primary[^>]*>[^]*?<\/a>/.exec(h)[0];
    expect(prim).toContain('id="wqfc-next"');
    expect(prim).toContain('href="/h/tok?x=1#stories"');
    expect(prim).toContain('<small>' + nextW + '</small><b dir="auto">' + more + '</b>');
    const share = /<a [^>]*id="wqfc-share"[^>]*>([^<]*)<\/a>/.exec(h);
    expect(share).not.toBeNull();
    expect(share[0]).not.toContain('data-primary');
    expect(share[0]).toContain('wq-soft');
    expect(share[1]).toBe(send);
    // the order on the screen: More stories, the share, Home; one More stories, not two
    const iHome = h.indexOf('data-home data-tap="home">' + home + '<');
    expect(h.indexOf('id="wqfc-next"')).toBeLessThan(h.indexOf('id="wqfc-share"'));
    expect(h.indexOf('id="wqfc-share"')).toBeLessThan(iHome);
    expect(h.split(more).length - 1).toBe(1);
  });
  test('the card shows the book\'s cover (src = the book\'s cover file, alt = its title); no cover -> no box', async () => {
    const d = await done({ cover: '/s/b-1/cover.webp' });
    expect(d.sink.o.cover).toBe('/s/b-1/cover.webp');
    expect(d.screen()).toMatch(/<img class="wqfc-cov" src="\/s\/b-1\/cover\.webp" alt="Mina Testwala"/);
    const d2 = await done({ cover: null });
    expect(d2.screen()).not.toContain('wqfc-cov');
    expect(d2.screen()).not.toMatch(/<img/);
  });
  test('the More stories tile shows the next unread shelf book\'s cover (the shelf\'s own data; no extra request)', async () => {
    const sink = {};
    const e = env({ replies: { book: { status: 200, body: book({ questions: [], card_v3: true }) } }, onLoad: realCard(sink) });
    e.win.document = e.doc;
    e.S.shelf(fakeEl('shelf'), e.ctx()); await flush();
    const n = e.calls.gets.length;
    const root = await openReader(e); runBook(e, root); await flush(); await flush();
    // b-9 (the teacher's, unread) is first; b-1 is this book; b-4 is done
    expect(sink.o.next.art).toBe('/s/b-9/cover.webp');
    expect(/<a [^>]*id="wqfc-next"[^>]*>[^]*?<\/a>/.exec(d0(sink))[0]).toContain('<img class="wqfc-art" src="/s/b-9/cover.webp"');
    expect(e.calls.gets.slice(n).filter((u) => /shelf/.test(u))).toHaveLength(0);
    // every other shelf book read, or no shelf on the page: the plain tile
    const k2 = {};
    const e2 = env({ replies: { shelf: { status: 200, body: { books: [{ id: 'b-1', cover: '/s/b-1/cover.webp' }, { id: 'b-4', cover: '/s/b-4/cover.webp', done: true }] } }, book: { status: 200, body: book({ questions: [], card_v3: true }) } }, onLoad: realCard(k2) });
    e2.win.document = e2.doc;
    e2.S.shelf(fakeEl('shelf'), e2.ctx()); await flush();
    const r2 = await openReader(e2); runBook(e2, r2); await flush(); await flush();
    expect(k2.o.next.art).toBeUndefined();
    const k3 = {};
    const e3 = env({ replies: { book: { status: 200, body: book({ questions: [], card_v3: true }) } }, onLoad: realCard(k3) });
    const r3 = await openReader(e3); runBook(e3, r3); await flush(); await flush();
    expect(k3.o.next.art).toBeUndefined();
  });
  // The real flow: the child picks the book on the shelf, and the page then draws the reader in the shelf's place, so
  // no shelf element is left by the done screen. The cover still comes from the shelf's own answer (no request).
  test('the More stories cover survives the shelf leaving the page (picked on the shelf, finished in the reader)', async () => {
    const sink = {};
    const e = env({ replies: { book: { status: 200, body: book({ questions: [], card_v3: true }) } }, onLoad: realCard(sink) });
    e.win.document = e.doc;
    e.S.shelf(fakeEl('shelf'), e.ctx()); await flush();
    const n = e.calls.gets.length;
    const root = await openReader(e); runBook(e, root); await flush(); await flush();
    expect(e.doc.querySelector('[data-stories-shelf], .wq-shelf[data-shelf]')).toBeNull();
    expect(sink.o.next.art).toBe('/s/b-9/cover.webp');
    expect(/<a [^>]*id="wqfc-next"[^>]*>[^]*?<\/a>/.exec(d0(sink))[0]).toContain('<img class="wqfc-art" src="/s/b-9/cover.webp"');
    expect(e.calls.gets.slice(n).filter((u) => /shelf/.test(u))).toHaveLength(0);
  });
  test('tapping More stories on the card goes to the shelf (never turns a page)', async () => {
    const d = await done({});
    const before = d.e.calls.ra.length;
    fire(d.root, 'next');
    expect(d.e.win.location.hash).toBe('#stories');
    expect(d.e.calls.ra.length).toBe(before);
  });
  // Hashed from the reader before this change (this harness, these fixtures): card switch off, or a card that refuses.
  test('golden: card_v3 off (and a card that refuses), the done screen is today\'s, byte for byte, EN and UR', async () => {
    const GOLD = { en_off: 'd52d1313a86a18cc', ur_off: '30d6c83d78038e97', en_refused: 'd52d1313a86a18cc', ur_refused: '30d6c83d78038e97' };
    const hash = (h) => require('crypto').createHash('sha256').update(h).digest('hex').slice(0, 16);
    const out = {};
    for (const lang of ['en', 'ur']) {
      const e = env({ replies: { book: { status: 200, body: book({ questions: [], lang, cover: '/s/b-1/cover.webp' }) } } });
      const root = await openReader(e); runBook(e, root); await flush(); await flush();
      out[lang + '_off'] = hash(root.innerHTML);
      const e2 = env({ replies: { book: { status: 200, body: book({ questions: [], lang, card_v3: true, cover: '/s/b-1/cover.webp' }) } }, onLoad: (w) => { w.WQFC = { mount: () => false }; } });
      const r2 = await openReader(e2); runBook(e2, r2); await flush(); await flush();
      out[lang + '_refused'] = hash(r2.innerHTML);
    }
    expect(out).toEqual(GOLD);
  });
  test('the card refuses: our own screen, More stories our one primary, no tile', async () => {
    const e = env({ replies: { book: { status: 200, body: book({ questions: [], card_v3: true, cover: '/s/b-1/cover.webp' }) } }, onLoad: (w) => { w.WQFC = { mount: () => false }; } });
    const root = await openReader(e); runBook(e, root); await flush(); await flush();
    expect(primaries(root.innerHTML)).toBe(1);
    expect(root.innerHTML).toMatch(/<button class="wqs-main" data-primary data-tap="more">More stories</);
    expect(root.innerHTML).not.toMatch(/wqfc|<img/);
  });
});

// ---- the end of the book names the biggest true thing ------------------------------------------------------------
describe('the end of the book (card_v3): the card hears the finish and the questions answered', () => {
  function cap(sink) { return (w) => { w.WQFC = { mount(el, o) { sink.o = o; return true; } }; }; }
  test('1 page heard + both questions answered -> whole: true, answered: 2 (the card draws the finish)', async () => {
    const bk = book({ card_v3: true }); bk.pages = bk.pages.slice(0, 2);
    const sink = {};
    const e = env({ lr: false, replies: { book: { status: 200, body: bk } }, onLoad: cap(sink) });
    const root = await openReader(e);
    fire(root, 'main'); e.calls.ra[0].o.onEnd(); fire(root, 'main'); fire(root, 'next');
    fire(root, 'ans', 0); await flush(); e.advance(900); fire(root, 'ans', 1); await flush(); e.advance(900); await flush(); await flush();
    expect(sink.o).toMatchObject({ source: 'story', ended: 'listened', pages_read: 0, whole: true, answered: 2 });
  });
  test('nothing heard or read, the questions answered -> the card still mounts (the finish + the questions line)', async () => {
    const bk = book({ card_v3: true }); bk.pages = bk.pages.slice(0, 2);
    const sink = {};
    const e = env({ lr: false, replies: { book: { status: 200, body: bk } }, onLoad: cap(sink) });
    const root = await openReader(e);
    fire(root, 'next'); fire(root, 'next');
    fire(root, 'ans', 0); await flush(); e.advance(900); fire(root, 'ans', 1); await flush(); e.advance(900); await flush(); await flush();
    expect(sink.o).toMatchObject({ pages_read: 0, pages_listened: 0, whole: true, answered: 2 });
    expect(root.querySelector('[data-own]').hidden).toBe(true);
  });
  test('paged through with nothing heard, read or answered -> no card, "You looked through the whole book."', async () => {
    const bk = book({ card_v3: true, questions: [] }); bk.pages = bk.pages.slice(0, 2);
    const sink = {};
    const e = env({ lr: false, replies: { book: { status: 200, body: bk } }, onLoad: cap(sink) });
    const root = await openReader(e);
    fire(root, 'next'); fire(root, 'next'); await flush(); await flush();
    expect(sink.o).toBeUndefined();
    expect(root.innerHTML).toContain('You looked through the whole book.');
  });
});
// ---- server lines[] and chunked Your turn ------------------------------------------------------------------------
function longPage(n, perLine, withLines) {
  const words = []; const lines = [];
  for (let i = 0; i < n; i += 1) words.push({ i, t: 'w' + i, s_ms: i * 300, e_ms: i * 300 + 250 });
  for (let k = 0; k * perLine < n; k += 1) lines.push({ i0: k * perLine, i1: Math.min(n, (k + 1) * perLine) - 1, box: [40, 100 + k * 60, 640, 40] });
  return { n: 1, image: { url: '/s/b-1/p01.webp', w: 720, h: 1080 }, text_band: null, text: '', words, audio: { url: '/a/p1.ogg', ms: n * 300 }, boxes_ok: false, is_picture: false, lines: withLines ? lines : undefined };
}
describe('server lines[] and chunked Your turn', () => {
  test('the line pick: lines[k] contains word i; the camera uses lines[k].box', () => {
    const e = env();
    const p = longPage(30, 10, true);
    const ln = e.S._lines(p);
    expect(ln.of[0]).toBe(0); expect(ln.of[9]).toBe(0); expect(ln.of[10]).toBe(1); expect(ln.of[29]).toBe(2);
    expect(ln.l[1].bs).toEqual([[40, 160, 640, 40]]);
  });
  test('the chunk split: <= 40 words is one chunk; longer pages go by consecutive lines, <= 25 words a chunk; no lines -> 25-word slices', async () => {
    const e = env(); toMic(e, await openReader(e));   // the split lives in the lazy part (wq-stories-q.js), loaded by Your turn
    expect(e.S._chunks(longPage(30, 10, true), e.S._lines(longPage(30, 10, true)))).toEqual([[0, 29]]);
    const p = longPage(60, 10, true);
    expect(e.S._chunks(p, e.S._lines(p))).toEqual([[0, 19], [20, 39], [40, 59]]);
    const q = longPage(50, 12, true);
    expect(e.S._chunks(q, e.S._lines(q))).toEqual([[0, 23], [24, 47], [48, 49]]);
    const r = longPage(50, 10, false);
    expect(e.S._chunks(r, e.S._lines(r))).toEqual([[0, 24], [25, 49]]);
  });
  test('boxes_ok:false WITH lines: zoom to the line box; a soft underline sweeps across it by word', async () => {
    const bk = book(); bk.pages[0] = longPage(30, 10, true);
    const e = env({ replies: { book: { status: 200, body: bk } } }); const root = await openReader(e);
    const p = e.calls.ra[0];
    expect(p.o.mode).toBe('strip');
    fire(root, 'main'); p.o.onWord(14);
    const c = e.S._cam([[40, 160, 640, 40]], 360, 540, 720, 1080, false, 3, 1);   // framed whole (fit)
    expect(root.querySelector('[data-cam]').style.transform).toBe(`translate(${c.tx}px,${c.ty}px) scale(${c.s})`);
    const mk = root.querySelector('[data-mk]');
    expect([mk.style.left, mk.style.top, mk.style.width, mk.style.height]).toEqual(['40px', '194px', '320px', '6px']);
  });
  test('a 60-word page: WQLiveRead once per chunk with the slice, ONE story_page_read with summed numbers', async () => {
    const bk = book(); bk.pages[0] = longPage(60, 10, true);
    const e = env({ replies: { book: { status: 200, body: bk } } }); const root = await openReader(e);
    toMic(e, root); e.calls.ask[0].onStream({ id: 's' });
    expect(e.calls.lr).toHaveLength(1);
    expect(e.calls.lr[0].o.words.map((w) => w.i)).toEqual([...Array(20).keys()]);
    const res = (a, k) => ({ words_total: 20, words_read: a, skipped: k, ms: 1000, ended: 'last_word', marks: Array(20).fill('read') });
    e.calls.lr[0].o.onResult(res(20, 0));
    expect(e.calls.posts.filter((x) => x.body.event === 'story_page_read')).toHaveLength(0);
    expect(e.calls.lr[1].o.words[0].i).toBe(20);
    expect(e.calls.lr[1].o.stream).toEqual({ id: 's' });
    expect(screenOf(root.innerHTML)).toBe('story-read');
    e.calls.lr[1].o.onResult(res(18, 2));
    e.calls.lr[2].o.onResult(res(20, 0));
    const pr = e.calls.posts.filter((x) => x.body.event === 'story_page_read');
    expect(pr).toHaveLength(1);
    expect(pr[0].body.data).toEqual({ words_total: 60, words_read: 58, skipped: 2, ms: 3000, ended: 'last_word', skipped_words: [], first: 'listen' });
    expect(screenOf(root.innerHTML)).toBe('story-page');
  });
  test('I\'m done during a chunk ends the whole page read', async () => {
    const bk = book(); bk.pages[0] = longPage(60, 10, true);
    const e = env({ replies: { book: { status: 200, body: bk } } }); const root = await openReader(e);
    toMic(e, root); e.calls.ask[0].onStream({});
    fire(root, 'main');
    expect(e.calls.lr[0].log).toContain('stop:done_tap');
    e.calls.lr[0].o.onResult({ words_total: 20, words_read: 5, skipped: 0, ms: 900, ended: 'done_tap', marks: [] });
    expect(e.calls.lr).toHaveLength(1);
    expect(e.calls.posts.filter((x) => x.body.event === 'story_page_read')[0].body.data).toMatchObject({ words_read: 5, ended: 'done_tap' });
  });
});

describe('question audio and the slower voice', () => {
  test('per-question clips: the question and its options are warmed in parallel when it appears', async () => {
    const e = env({ hash: '#story/b-1/q' });
    const root = fakeEl('root');
    e.S.route(e.ctx({ root })); await flush();
    expect(e.calls.audios.map((a) => a.src)).toEqual(['/a/q1.ogg', '/a/q1o1.ogg', '/a/q1o2.ogg', '/a/q1o3.ogg']);
    expect(e.calls.audios.every((a) => a.preload === 'auto')).toBe(true);
    fire(root, 'say', 1);
    expect(e.calls.audios[4].src).toBe('/a/q1o2.ogg');
    expect(e.calls.audios[4].paused).toBe(false);
  });
  test('a questions sprite: ONE audio, a clip plays from s_ms and pauses at e_ms; the speaker shown from the sprite alone', async () => {
    const bk = book(); bk.questions.forEach((q) => { delete q.audio; });
    bk.questions_sprite = { url: '/a/qs.ogg', clips: { q1: { s_ms: 0, e_ms: 1200 }, q1o1: { s_ms: 1300, e_ms: 1800 }, q1o2: { s_ms: 1900, e_ms: 2400 }, q2: { s_ms: 2500, e_ms: 3600 } } };
    const e = env({ hash: '#story/b-1/q', replies: { book: { status: 200, body: bk } } });
    const root = fakeEl('root');
    e.S.route(e.ctx({ root })); await flush();
    expect(e.calls.audios.map((a) => a.src)).toEqual(['/a/qs.ogg']);
    const a = e.calls.audios[0];
    expect(a.preload).toBe('auto');
    const h = root.innerHTML;
    expect((h.match(/data-tap="say"/g) || []).length).toBe(3);
    fire(root, 'say', 1);
    expect(a.currentTime).toBe(1.9); expect(a.paused).toBe(false);
    a.currentTime = 2.3; e.advance(40); expect(a.paused).toBe(false);
    a.currentTime = 2.41; e.advance(40); expect(a.paused).toBe(true);
    expect(e.calls.audios).toHaveLength(1);
  });
  // what the player does with it (the 0.85 stretch, or gaps with the book's slow_gaps): web-quiz-stories-slow-gaps
  test('Slower: handed to the player (slow(on, the book\'s slow_gaps)), remembered per child, applied after a page change; no number shown; not the primary', async () => {
    const e = env(); const root = await openReader(e);
    const h = root.innerHTML;
    expect(h).toMatch(/<button class="wqs-slow" data-tap="slow" aria-pressed="false"><svg class="wqs-g"[^>]*><path[^>]*><\/svg> Slower<\/button>/);
    expect(text(h.split('wqs-slow')[1].split('</button>')[0])).not.toMatch(/[0-9]/);
    const p = e.calls.ra[0];
    expect(p.slows).toEqual([[false, undefined]]);
    fire(root, 'slow');
    expect(p.slows.pop()).toEqual([true, undefined]);
    expect(e.store.getItem('wq_st_slow:' + KID)).toBe('1');
    fire(root, 'next'); fire(root, 'prev');
    const p2 = e.calls.ra[e.calls.ra.length - 1];
    expect(p2).not.toBe(p);
    expect(p2.slows).toEqual([[true, undefined]]);
    expect(root.innerHTML).toMatch(/data-tap="slow" aria-pressed="true"/);
    fire(root, 'slow');
    expect(p2.slows.pop()).toEqual([false, undefined]);
    const ur = env({ replies: { book: { status: 200, body: book({ lang: 'ur', dir: 'rtl' }) } } });
    const r2 = await openReader(ur, { lang: 'ur' });
    expect(r2.innerHTML).toContain('</svg> آہستہ');
  });
});

describe('lines without a box (the full export)', () => {
  test('a line with no box: no zoom for it (the whole page) and its words get the bottom sweep; boxed lines still zoom', async () => {
    const bk = book(); const p = longPage(30, 10, true);
    delete p.lines[1].box;
    bk.pages[0] = p;
    const e = env({ replies: { book: { status: 200, body: bk } } }); const root = await openReader(e);
    expect(e.S._lines(p).l[1].bs).toEqual([]);
    const pl = e.calls.ra[0]; const cam = root.querySelector('[data-cam]');
    fire(root, 'main');
    // a boxed line is framed WHOLE (a full-width line can only be shown at the page's width; it is never cut)
    const m0 = /translate\((-?[\d.]+)px,(-?[\d.]+)px\) scale\(([\d.]+)\)/.exec(cam.style.transform);
    expect(40 * Number(m0[3]) + Number(m0[1])).toBeGreaterThanOrEqual(0);
    expect(680 * Number(m0[3]) + Number(m0[1])).toBeLessThanOrEqual(360);
    pl.o.onWord(12);
    expect(cam.style.transform).toBe('translate(0px,0px) scale(0.5)');
    const mk = root.querySelector('[data-mk]');
    expect([mk.style.left, mk.style.top, mk.style.height]).toEqual(['0px', '1040px', '40px']);
    pl.o.onWord(25);   // a boxed line again: framed whole
    const m1 = /translate\((-?[\d.]+)px,(-?[\d.]+)px\) scale\(([\d.]+)\)/.exec(cam.style.transform);
    expect(40 * Number(m1[3]) + Number(m1[1])).toBeGreaterThanOrEqual(0);
    expect(680 * Number(m1[3]) + Number(m1[1])).toBeLessThanOrEqual(360);
  });
});

describe('marks, teacher links, copy', () => {
  test('one green: heard draws like read (a bar just BELOW the word, never over its ink), skipped a dashed amber bar below it, only current is a box padded clear of the letters', () => {
    const css = fs.readFileSync(CSS, 'utf8');
    const rule = (sel) => (new RegExp(sel.replace(/[.]/g, '\\.') + '[^{]*\\{([^}]*)\\}').exec(css) || [])[1] || '';
    expect(css).toMatch(/\.wqs-cam \.lr-box\.lr-read,\s*\.wqs-cam \.lr-box\.lr-heard\{/);
    // an outer shadow offset down paints only outside the box: under the word, never over a Nastaliq tail or a first letter
    expect(rule('.wqs-cam .lr-box.lr-heard')).toMatch(/background:none;box-shadow:0 5px 0 rgba\(21,128,61,\.85\)/);
    expect(rule('.wqs-cam .lr-box.lr-skipped::after')).toMatch(/top:calc\(100% \+ 1px\);[^}]*dashed #E65100/i);
    expect(rule('.wqs-cam .lr-box.lr-cur')).toMatch(/outline:3px solid #15803D;outline-offset:\.15em/);
    expect(css).not.toMatch(/lr-heard\{[^}]*\.4\)/);
  });
  test('a teacher link without boot.story (?from=link#story/<id>): remembered as a teacher book, story_opened from_teacher:true, no code', async () => {
    const e = env({ boot: { token: TOKEN, kid: KID, lang: 'en' }, hash: '#story/b-5', search: '?from=link' });
    await flush();
    expect(e.store.getItem('wq_st_t:' + KID)).toBe('b-5');
    const op = e.calls.posts.filter((x) => x.body.event === 'story_opened');
    expect(op).toHaveLength(1);
    expect(op[0].body.data.from_teacher).toBe(true);
    expect(op[0].body.data).not.toHaveProperty('code');
    const e2 = env({ boot: { token: TOKEN, kid: KID, lang: 'en' }, hash: '#story/b-5' });
    await flush();
    expect(e2.store.getItem('wq_st_t:' + KID)).toBe(null);
    expect(e2.calls.posts.find((x) => x.body.event === 'story_opened').body.data.from_teacher).toBe(false);
  });
  test('copy: no «استاد»; the reading Done is "I\'m done" + a tick / «میں نے پڑھ لیا» + a tick everywhere, never a bare Done / «ہو گیا»', () => {
    const code = (fs.readFileSync(SRC, 'utf8') + fs.readFileSync(QSRC, 'utf8')).replace(/\/\*[\s\S]*?\*\//g, '');
    expect(code).not.toContain('استاد');
    expect(code).not.toContain('ہو گیا');
    expect(code).not.toMatch(/'Done'/);
    expect(code).toContain("done: 'I\\'m done'");
    expect(code).toContain("done: 'میں نے پڑھ لیا'");
    // the tick and the control glyphs are inline SVGs (no font glyph falls into the Nastaliq face)
    expect(code).not.toMatch(/[\u2713\u25B6\u275A]|\u{1F50A}|\u{1F507}|\u{1F3E0}|\u{1F422}|\u{1F3A4}/u);
  });
});

describe('page quality and unvoiced pages', () => {
  test('quality:\'low\' rides into the player\'s pageJson (it sweeps the line); the camera still zooms by line', async () => {
    const bk = book(); bk.pages[0].quality = 'low';
    const e = env({ replies: { book: { status: 200, body: bk } } }); const root = await openReader(e);
    expect(e.calls.ra[0].data.quality).toBe('low');
    fire(root, 'main');
    expect(root.querySelector('[data-cam]').style.transform).toBe('translate(-67.5px,-874.5px) scale(1.5)');
    const e2 = env(); await openReader(e2);
    expect(e2.calls.ra[0].data.quality).toBeUndefined();
  });
  test('quality:\'low\': our own mark (lens, sweep, zoom without boxes_ok) covers the whole LINE of the current word, never one word', async () => {
    const low = (p) => ({ ...p, quality: 'low' });
    const p0 = low(book().pages[0]);
    expect(e0().S._mark(p0, 1, null, false)).toEqual([110, 810, 110, 50]);
    expect(e0().S._mark(p0, 3, null, false)).toEqual([230, 870, 160, 50]);
    const boxed = low({ ...book().pages[0], lines: [{ i0: 0, i1: 2, box: [100, 800, 300, 60] }, { i0: 3, i1: 4, box: [220, 860, 200, 60] }] });
    expect(e0().S._mark(boxed, 1, null, false)).toEqual([100, 800, 300, 60]);
    expect(e0().S._mark(boxed, 4, null, true)).toEqual([220, 860, 200, 60]);
    const bare = low(book().pages[2]);
    expect(e0().S._mark(bare, 1, [100, 800, 520, 130], false)).toEqual([100, 800, 520, 130]);
    // the reader: a lens page (boxes_ok:false + a band) draws the line box with the box style, not the sweep
    const bk = book(); bk.pages[0].quality = 'low'; bk.pages[0].boxes_ok = false;
    const e = env({ replies: { book: { status: 200, body: bk } } }); const root = await openReader(e);
    expect(root.innerHTML).toContain('data-mk');
    fire(root, 'main');
    e.calls.ra[0].o.onWord(1);
    const mk = root.querySelector('[data-mk]');
    expect([mk.style.left, mk.style.top, mk.style.width, mk.style.height]).toEqual(['110px', '810px', '110px', '50px']);
    expect(mk.className).toBe('wqs-mk');
    e.calls.ra[0].o.onWord(4);
    expect([mk.style.left, mk.style.width]).toEqual(['230px', '160px']);
    function e0() { return env(); }
  });
  test('an unvoiced page (audio:null): the server logs the miss, the client posts none; the one 3 s re-fetch stays', async () => {
    const e = env(); const root = await openReader(e);
    fire(root, 'next'); fire(root, 'next');
    const miss = () => e.calls.posts.filter((x) => x.body.event === 'story_page_listened' && x.body.data.miss);
    expect(miss()).toHaveLength(0);
    fire(root, 'prev'); fire(root, 'next');
    expect(miss()).toHaveLength(0);
    expect(e.calls.posts.filter((x) => x.body.page_n === 3)).toHaveLength(0);
    e.advance(3000); await flush();
    expect(e.calls.gets.filter((u) => /stories\/book/.test(u))).toHaveLength(2);
  });
  test('page_n rides only on page events and is always a page of the book (1..pages)', async () => {
    const e = env({ wqj: true }); const root = await openReader(e);
    runBook(e, root); await flush();
    fire(root, 'ans', 0); await flush(); e.advance(900); fire(root, 'ans', 0); await flush(); e.advance(900); await flush(); await flush();
    expect(screenOf(root.innerHTML)).toBe('story-done');
    const withN = e.calls.posts.filter((x) => x.body.page_n != null);
    expect(withN.length).toBeGreaterThan(0);
    withN.forEach((x) => { expect(['story_page_listened', 'story_page_read']).toContain(x.body.event); expect(x.body.page_n).toBeGreaterThanOrEqual(1); expect(x.body.page_n).toBeLessThanOrEqual(3); });
    ['story_opened', 'story_answer', 'story_questions_done', 'story_done'].forEach((n) => e.calls.posts.filter((x) => x.body.event === n).forEach((x) => expect(x.body.page_n).toBeUndefined()));
    // a page numbered outside the book is never sent
    const bk = book(); bk.pages[0].n = 4;
    const e2 = env({ replies: { book: { status: 200, body: bk } } }); const r2 = await openReader(e2);
    fire(r2, 'main'); e2.advance(500); e2.calls.ra[0].o.onEnd();
    fire(r2, 'main'); e2.calls.ask[0].onStream({}); e2.calls.lr[0].o.onResult(READ(['read', 'read', 'read', 'read', 'read']));
    expect(screenOf(r2.innerHTML)).toBe('story-page');
    expect(e2.calls.posts.filter((x) => /story_page_/.test(x.body.event))).toHaveLength(0);
  });
});

// ---- which button is first, echo reading, the deed for a partial listen, public-repo hygiene ----------------------
describe('which button is first follows the grade, then the child', () => {
  const voiced3 = (over) => { const bk = book(over); bk.pages[2].audio = { url: '/a/p3.ogg', ms: 2000 }; return bk; };
  test('machine: G1-2 Listen primary + Your turn as the one secondary; G3-5 Your turn primary + "Hear it first"; the last choice carries on', () => {
    const e = env();
    const m = e.S._machine(voiced3(), { lr: true });
    expect([m.label(), m.alt()]).toEqual(['listen', 'yourTurn']);
    m.altTap(); expect(m.st).toBe('mic'); expect(m.first[0]).toBe('read');
    m.granted(); m.result(READ(['read'])); m.go(2);
    expect([m.label(), m.alt()]).toEqual(['yourTurn', 'hearFirst']);
    const g3 = e.S._machine(voiced3({ grade: 3 }), { lr: true });
    expect([g3.label(), g3.alt()]).toEqual(['yourTurn', 'hearFirst']);
    g3.altTap(); expect(g3.st).toBe('listening'); expect(g3.first[0]).toBe('listen');
    g3.end(); expect([g3.label(), g3.alt()]).toEqual(['yourTurn', null]);
    g3.go(2); expect([g3.label(), g3.alt()]).toEqual(['listen', 'yourTurn']);
    const no = e.S._machine(voiced3({ grade: 4 }), { lr: false });
    expect([no.label(), no.alt()]).toEqual(['listen', null]);
  });
  test('G1 page: "Your turn" visible from the first render as data-tap="alt" (not primary); tapping it goes to the mic; first:\'read\' on the read', async () => {
    const e = env(); const root = await openReader(e);
    const h = root.innerHTML;
    checkScreen(h, 'en');
    expect(h).toMatch(/data-main data-primary data-tap="main"[^>]*>Listen</);
    expect(h).toMatch(/<button class="wqs-sec" data-tap="alt">Your turn<\/button>/);
    fire(root, 'alt');
    expect(screenOf(root.innerHTML)).toBe('story-mic');
    e.calls.ask[0].onStream({});
    e.calls.lr[0].o.onResult(READ(['read', 'read', 'read', 'read', 'read']));
    expect(e.calls.posts.find((x) => x.body.event === 'story_page_read').body.data.first).toBe('read');
    expect(root.innerHTML).toMatch(/data-tap="again"/);
  });
  test('G3 page: Your turn primary, "Hear it first" / «پہلے سنیں» secondary plays inside the tap', async () => {
    const e = env({ replies: { book: { status: 200, body: book({ grade: 3 }) } } }); const root = await openReader(e);
    expect(root.innerHTML).toMatch(/data-main data-primary data-tap="main"[^>]*>Your turn</);
    expect(root.innerHTML).toContain('>Hear it first</button>');
    fire(root, 'alt');
    expect(e.calls.ra[0].log).toEqual(['play']);
    const u = env({ replies: { book: { status: 200, body: book({ grade: 3, lang: 'ur', dir: 'rtl' }) } } }); const r2 = await openReader(u, { lang: 'ur' });
    expect(r2.innerHTML).toContain('>پہلے سنیں</button>');
  });
});

describe('echo reading on G1-2', () => {
  // two invented sentences on one boxed page
  const two = (over) => {
    const bk = book(over);
    bk.pages[0].words = [W(0, 'Mina', 100, [110, 810, 40, 50]), W(1, 'runs.', 600, [160, 810, 50, 50]), W(2, 'The', 1100, [220, 810, 30, 50]), W(3, 'kite', 1600, [230, 870, 40, 50]), W(4, 'flies!', 2100, [280, 870, 60, 50])];
    return bk;
  };
  async function afterRead(e, marks) {
    const root = await openReader(e);
    toMic(e, root); e.calls.ask[0].onStream({ id: 'st' });
    e.calls.lr[0].o.onResult(READ(marks));
    return root;
  }
  test('the button: G1-2 only, after a Your turn with 0 words or <= 50 % read; "Read it together" / «آئیں مل کر پڑھیں»', async () => {
    const e = env({ replies: { book: { status: 200, body: two() } } });
    let root = await afterRead(e, ['read', 'ahead', 'ahead', 'ahead', 'ahead']);
    expect(root.innerHTML).toMatch(/data-main data-primary[^>]*>Next</);
    expect(root.innerHTML).toMatch(/<button class="wqs-sec" data-tap="echo"[^>]*>Read it together<\/button>/);
    const z = env({ replies: { book: { status: 200, body: two() } } });
    root = await afterRead(z, ['ahead', 'ahead', 'ahead', 'ahead', 'ahead']);
    expect(root.innerHTML).toContain('data-tap="echo"');
    const hb = two(); hb.pages[0].words = hb.pages[0].words.slice(0, 4);
    const half = env({ replies: { book: { status: 200, body: hb } } });
    root = await afterRead(half, ['read', 'read', 'ahead', 'ahead']);
    expect(root.innerHTML).toContain('data-tap="echo"');
    const ok = env({ replies: { book: { status: 200, body: two() } } });
    root = await afterRead(ok, ['read', 'read', 'read', 'ahead', 'ahead']);
    expect(root.innerHTML).not.toContain('data-tap="echo"');
    const g3 = env({ replies: { book: { status: 200, body: two({ grade: 3 }) } } }); const r3 = await openReader(g3);
    fire(r3, 'main'); g3.calls.ask[0].onStream({});
    g3.calls.lr[0].o.onResult(READ(['read', 'ahead', 'ahead', 'ahead', 'ahead']));
    expect(r3.innerHTML).not.toContain('data-tap="echo"');
    const u = env({ replies: { book: { status: 200, body: two({ lang: 'ur', dir: 'rtl' }) } } });
    const ru = await openReader(u, { lang: 'ur' });
    toMic(u, ru); u.calls.ask[0].onStream({}); u.calls.lr[0].o.onResult(READ(['read', 'ahead', 'ahead', 'ahead', 'ahead']));
    expect(ru.innerHTML).toMatch(/data-tap="echo"[^>]*>آئیں مل کر پڑھیں<\/button>/);
  });
  test('Read it together: a microphone granted after the reader is gone is given back at once', async () => {
    const e = env({ replies: { book: { status: 200, body: two() } } });
    const root = await afterRead(e, ['read', 'ahead', 'ahead', 'ahead', 'ahead']);
    let give;
    e.win.WQLiveRead.micAgain = () => new Promise((r) => { give = r; });
    fire(root, 'echo');
    e.S.open('b-2', e.ctx({ root }));                              // left before the phone answered
    await flush();
    const tr = { stops: 0, stop() { tr.stops += 1; } };
    give({ id: 'late', getTracks: () => [tr] });
    await flush();
    expect(tr.stops).toBe(1);
  });
  test('sentences split on . ! ? ۔ ؟ (a closing quote kept with its sentence)', async () => {
    const e = env(); await openReader(e);
    const ws = ['Mina', 'runs.', '"Up!"', 'Is', 'it', 'red?', 'یہ', 'پتنگ', 'ہے۔', 'کیا', 'اڑی؟', 'Then'].map((t, i) => ({ i, t }));
    expect(e.S._sents(ws)).toEqual([[0, 1], [2, 2], [3, 5], [6, 8], [9, 10], [11, 11]]);
  });
  test('one sentence rule with the player: a closing » stays with its sentence, a silent word never ends one; the end test is the player\'s, letter for letter', async () => {
    const e = env(); await openReader(e);
    const ws = [{ i: 0, t: '«چلو' }, { i: 1, t: 'چلیں۔»' }, { i: 2, t: '(آہستہ۔)', silent: true }, { i: 3, t: 'وہ' }, { i: 4, t: 'گیا۔' }];
    expect(e.S._sents(ws)).toEqual([[0, 1], [2, 4]]);
    const fs = require('fs'); const path = require('path');
    const rx = (f) => (fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', f), 'utf8').match(/\/\[\.!\?[^/]*\/\.test/) || [])[0];
    expect(rx('wq-stories-q.js')).toBeTruthy();
    expect(rx('wq-stories-q.js')).toBe(rx('wq-readalong.js'));
  });
  test('Read it together: Jugnu plays ONE sentence (seek its first word, pause at its last e_ms), its boxes outlined, then the mic on that sentence only, then the next; ends back on the page', async () => {
    const e = env({ replies: { book: { status: 200, body: two() } } });
    const root = await afterRead(e, ['read', 'ahead', 'ahead', 'ahead', 'ahead']);
    const nra = e.calls.ra.length;
    // the read's microphone was given back when it ended; "Read it together" asks for one inside its tap
    let asked = 0;
    e.win.WQLiveRead.micAgain = () => { asked += 1; return Promise.resolve({ id: 'echo' }); };
    fire(root, 'echo');
    expect(asked).toBe(1);
    await flush();
    let h = root.innerHTML;
    checkScreen(h, 'en');
    expect(screenOf(h)).toBe('story-echo');
    expect(h).toMatch(/data-back/);
    expect(e.calls.ra).toHaveLength(nra + 1);
    const p = e.calls.ra[nra];
    expect(p.log).toEqual(['seek:0', 'play']);   // inside the tap
    let es = root.querySelector('[data-es]').innerHTML;
    expect((es.match(/class="wqs-es"/g) || []).length).toBe(2);
    expect(es).toContain('left:110px;top:810px;width:40px;height:50px');
    expect(es).toContain('left:160px;top:810px;width:50px;height:50px');
    expect(es).not.toContain('left:220px');
    expect(root.querySelector('[data-main]').textContent).toBe('Pause');
    // pause / play during the sentence
    fire(root, 'main');
    expect(p.log).toEqual(['seek:0', 'play', 'pause']);
    expect(root.querySelector('[data-main]').textContent).toBe('Listen');
    fire(root, 'main');
    expect(p.log).toEqual(['seek:0', 'play', 'pause', 'play']);
    // the sentence is not over at 0.9 s; at its last word's e_ms (1000 ms) Jugnu stops and the mic opens on it
    p.audio.currentTime = 0.9; e.advance(100);
    expect(e.calls.lr).toHaveLength(1);
    p.audio.currentTime = 1.0; e.advance(100);
    expect(p.log[p.log.length - 1]).toBe('pause');
    expect(e.calls.lr).toHaveLength(2);
    const c = e.calls.lr[1];
    expect(c.o.words.map((w) => w.t)).toEqual(['Mina', 'runs.']);
    expect(c.o.words[1].box).toEqual([160, 810, 50, 50]);
    expect(c.o).toMatchObject({ lang: 'en', dir: 'ltr', meter: 'none', record: false, counted: false, stream: { id: 'echo' } });
    expect(root.querySelector('[data-es]').innerHTML).toBe(es);   // the boxes stay outlined with the mic on
    // the child echoes -> the next sentence
    c.o.onResult(READ(['read', 'read']));
    expect(p.log.slice(-2)).toEqual(['seek:2', 'play']);
    es = root.querySelector('[data-es]').innerHTML;
    expect((es.match(/class="wqs-es"/g) || []).length).toBe(3);
    expect(es).toContain('left:280px');
    expect(es).not.toContain('left:110px');
    p.audio.currentTime = 2.4; e.advance(100);
    expect(e.calls.lr).toHaveLength(2);
    p.audio.currentTime = 2.5; e.advance(100);
    expect(e.calls.lr).toHaveLength(3);
    expect(e.calls.lr[2].o.words.map((w) => w.t)).toEqual(['The', 'kite', 'flies!']);
    // no story_page_read for the echo lines
    const reads = e.calls.posts.filter((x) => x.body.event === 'story_page_read').length;
    e.calls.lr[2].o.onResult(READ(['read', 'ahead', 'read']));
    expect(e.calls.posts.filter((x) => x.body.event === 'story_page_read')).toHaveLength(reads);
    // the last sentence -> back to the page's own state
    h = root.innerHTML;
    checkScreen(h, 'en');
    expect(screenOf(h)).toBe('story-page');
    expect(root.querySelector('[data-main]').textContent).toBe('Your turn');
    expect(p.log).toContain('destroy');
    expect(e.calls.lr[2].log).toContain('destroy');
  });
  test('the mic paused mid-sentence stops it; Listen replays that sentence; ✕ goes back to the page', async () => {
    const e = env({ replies: { book: { status: 200, body: two() } } });
    const root = await afterRead(e, ['ahead', 'ahead', 'ahead', 'ahead', 'ahead']);
    fire(root, 'echo');
    const p = e.calls.ra[e.calls.ra.length - 1];
    p.o.onEnd();   // the clip ran out: the mic opens anyway
    expect(e.calls.lr).toHaveLength(2);
    fire(root, 'main');
    expect(e.calls.lr[1].log).toContain('stop:pause');
    e.calls.lr[1].o.onResult(READ(['read', 'read']));   // a stopped read never moves on
    expect(e.calls.lr).toHaveLength(2);
    expect(root.querySelector('[data-main]').textContent).toBe('Listen');
    fire(root, 'main');
    expect(p.log.slice(-2)).toEqual(['seek:0', 'play']);
    e.doc.visibilityState = 'hidden'; e.doc.L.visibilitychange.forEach((f) => f());
    expect(p.log[p.log.length - 1]).toBe('pause');
    fire(root, 'eend');
    expect(screenOf(root.innerHTML)).toBe('story-page');
    expect(root.innerHTML).toContain('data-tap="echo"');
  });
});

describe('the next page is fetched ahead', () => {
  test('on a page, the next page\'s picture is asked for (and its voice preloaded when the player can); none past the last page', async () => {
    const e = env(); const root = await openReader(e);
    expect(e.calls.imgs).toContain('/s/b-1/p02.webp');
    fire(root, 'next'); fire(root, 'next');
    expect(screenOf(root.innerHTML)).toBe('story-page');
    const n = e.calls.imgs.length;
    expect(e.calls.imgs).toContain('/s/b-1/p03.webp');
    fire(root, 'prev'); fire(root, 'next');
    expect(e.calls.imgs.slice(n).filter((u) => /p04/.test(u))).toHaveLength(0);
  });
});

describe('silent words (a stage direction the voice does not read): never asked of the child, never lit', () => {
  // "(smiling)" is printed on the page but carries silent:true and no timing
  const play = () => {
    const bk = book();
    bk.pages[0].words = [W(0, 'Mina', 100, [110, 810, 40, 50]), { i: 1, t: '(smiling)', silent: true, box: [160, 810, 60, 50] }, W(2, 'runs.', 600, [230, 810, 50, 50]),
      W(3, 'The', 1100, [110, 870, 30, 50]), W(4, 'kite', 1600, [150, 870, 40, 50]), W(5, 'flies!', 2100, [200, 870, 60, 50])];
    return bk;
  };
  test('Your turn: the live reader gets the words without it; the page\'s marks keep the page\'s own word numbers', async () => {
    const e = env({ replies: { book: { status: 200, body: play() } } });
    const root = await openReader(e);
    toMic(e, root); e.calls.ask[0].onStream({});
    const c = e.calls.lr[0];
    expect(c.o.words.map((w) => w.t)).toEqual(['Mina', 'runs.', 'The', 'kite', 'flies!']);
    c.o.onResult(READ(['read', 'skipped', 'read', 'read', 'read']));
    const pr = e.calls.posts.filter((x) => x.body.event === 'story_page_read').pop();
    expect(pr.body.data).toMatchObject({ words_total: 5, words_read: 4, skipped: 1, skipped_words: [2] });
    expect(root.innerHTML).toMatch(/data-tap="word" data-arg="2"[^>]*>[^<]*(<svg[^>]*>.*?<\/svg>)?\s*runs\.</);
  });
  test('Read it together: the sentence holding it is outlined and asked without it; Jugnu still stops at the sentence\'s last spoken word', async () => {
    const e = env({ replies: { book: { status: 200, body: play() } } });
    const root = await openReader(e);
    toMic(e, root); e.calls.ask[0].onStream({ id: 'st' });
    e.calls.lr[0].o.onResult(READ(['read', 'ahead', 'ahead', 'ahead', 'ahead']));
    const nra = e.calls.ra.length;
    fire(root, 'echo');
    const p = e.calls.ra[nra];
    expect(p.log).toEqual(['seek:0', 'play']);
    const es = root.querySelector('[data-es]').innerHTML;
    expect((es.match(/class="wqs-es"/g) || []).length).toBe(2);
    expect(es).not.toContain('left:160px');
    p.audio.currentTime = 1.0; e.advance(100);
    expect(e.calls.lr).toHaveLength(2);
    expect(e.calls.lr[1].o.words.map((w) => w.t)).toEqual(['Mina', 'runs.']);
  });
});

describe('Read it together only where the reading key answers', () => {
  const READ20 = ['read', 'ahead', 'ahead', 'ahead', 'ahead'];
  async function readWith(e) {
    const root = await openReader(e);
    toMic(e, root); e.calls.ask[0].onStream({});
    return root;
  }
  test('the book says lr3:false (or says nothing): no "Read it together" button and no key asked for it; lr3:true: drawn', async () => {
    for (const lr3 of [false, undefined]) {
      const bk = book(); if (lr3 === undefined) delete bk.lr3; else bk.lr3 = lr3;
      const e = env({ replies: { book: { status: 200, body: bk } } });
      const root = await readWith(e);
      e.calls.lr[0].o.onResult(READ(READ20));
      expect(root.innerHTML).not.toContain('data-tap="echo"');
      expect(root.innerHTML).toMatch(/data-main data-primary[^>]*>Next</);
      expect(e.calls.posts.filter((x) => /\/lr\/key/.test(x.url))).toHaveLength(0);
    }
    const on = env({ replies: { book: { status: 200, body: book({ lr3: true }) } } });
    const r2 = await readWith(on);
    on.calls.lr[0].o.onResult(READ(READ20));
    expect(r2.innerHTML).toContain('data-tap="echo"');
  });
  test('the key endpoint answers 404 (the live reader not on this server yet): no "Read it together" button, Next stays primary', async () => {
    const e = env({ replies: { key: { status: 404, body: { error: 'not_found' } } } });
    const root = await readWith(e);
    const k = await e.calls.lr[0].o.getKey();
    expect(k).toEqual({ error: 'not_found' });
    e.calls.lr[0].o.onResult(READ(READ20));
    expect(root.innerHTML).not.toContain('data-tap="echo"');
    expect(root.innerHTML).toMatch(/data-main data-primary[^>]*>Next</);
    expect(e.calls.posts.filter((x) => /\/lr\/key/.test(x.url))).toHaveLength(1);
  });
  test('a 200 with {error} (no keys left), or a key request that never arrives: no echo button either', async () => {
    const e = env({ replies: { key: { status: 200, body: { error: 'cap' } } } });
    const root = await readWith(e);
    await e.calls.lr[0].o.getKey();
    e.calls.lr[0].o.onResult(READ(READ20));
    expect(root.innerHTML).not.toContain('data-tap="echo"');
    const o = env({ fail: (u) => /\/lr\/key/.test(u) });
    const r2 = await readWith(o);
    await expect(o.calls.lr[0].o.getKey()).rejects.toThrow('offline');
    o.calls.lr[0].o.onResult(READ(READ20));
    expect(r2.innerHTML).not.toContain('data-tap="echo"');
  });
  test('the key answers: the button shows, and each mount asks for its own key (one per mount, never a kept one)', async () => {
    const e = env();
    const root = await readWith(e);
    expect((await e.calls.lr[0].o.getKey()).ws).toBe('wss://x');
    e.calls.lr[0].o.onResult(READ(READ20));
    expect(root.innerHTML).toContain('data-tap="echo"');
    expect(e.calls.lr[0].o.key).toBeUndefined();
  });
  test('onFallback(\'key\'): the live reader\'s line is NOT moved onto the page (it would say "Read it aloud!" while Jugnu reads); no echo button after', async () => {
    const e = env(); const root = await readWith(e);
    const c = e.calls.lr[0];
    c.el.innerHTML = '<p class="lr-nudge"></p>';
    c.el.querySelector('.lr-nudge').textContent = 'Read it aloud!';
    c.o.onFallback('key');
    expect(screenOf(root.innerHTML)).toBe('story-page');
    expect((root.querySelector('[data-lrl]') || {}).kids || []).toEqual([]);
    expect(root.innerHTML).not.toContain('Read it aloud');
    expect(root.innerHTML).not.toContain('data-tap="echo"');
  });
});

describe('the day\'s readings used up, and low-timed pages', () => {
  test('onFallback(\'rest\' | \'key\'): the page voice plays like Listen, words on screen, no line of our own, no more Your turn', async () => {
    for (const why of ['rest', 'key']) {
      const e = env(); const root = await openReader(e);
      toMic(e, root); e.calls.ask[0].onStream({});
      expect(typeof e.calls.lr[0].o.onFallback).toBe('function');
      const n = e.calls.ra.length;
      e.calls.lr[0].o.onFallback(why);
      const h = root.innerHTML;
      checkScreen(h, 'en');
      expect(screenOf(h)).toBe('story-page');
      expect(e.calls.ra).toHaveLength(n + 1);
      expect(e.calls.ra[n].log).toEqual(['play']);
      expect(root.querySelector('[data-main]').textContent).toBe('Pause');
      expect(root.querySelector('[data-extra]').innerHTML).not.toMatch(/<p|Your turn/);
      expect(e.calls.lr[0].log).toContain('destroy');
      e.calls.ra[n].o.onEnd();
      expect(root.querySelector('[data-main]').textContent).toBe('Next');
      expect(e.calls.posts.filter((x) => x.body.event === 'story_page_read')).toHaveLength(0);
    }
    // any other reason: the live reader carries on by itself
    const o = env(); const r2 = await openReader(o);
    toMic(o, r2); o.calls.ask[0].onStream({});
    o.calls.lr[0].o.onFallback('socket');
    expect(screenOf(r2.innerHTML)).toBe('story-read');
    expect(o.calls.lr[0].log).not.toContain('destroy');
    // during Read it together: the same
    const bk = book(); bk.pages[0].words[1].t = 'Testwala.';
    const x = env({ replies: { book: { status: 200, body: bk } } }); const r3 = await openReader(x);
    toMic(x, r3); x.calls.ask[0].onStream({}); x.calls.lr[0].o.onResult(READ(['read', 'ahead', 'ahead', 'ahead', 'ahead']));
    fire(r3, 'echo'); x.calls.ra[x.calls.ra.length - 1].o.onEnd();
    expect(x.calls.lr).toHaveLength(2);
    x.calls.lr[1].o.onFallback('rest');
    expect(screenOf(r3.innerHTML)).toBe('story-page');
    expect(x.calls.ra[x.calls.ra.length - 1].log).toEqual(['play']);
  });
  test('onFallback(\'rest\'): the live reader\'s OWN kind line is moved onto the page above the main button; it goes on the next page', async () => {
    const e = env(); const root = await openReader(e);
    toMic(e, root); e.calls.ask[0].onStream({});
    const c = e.calls.lr[0];
    c.el.innerHTML = '<p class="lr-nudge"></p>';
    const line = c.el.querySelector('.lr-nudge');
    line.textContent = 'Jugnu Testwala needs a little rest now.';
    c.o.onFallback('rest');
    const h = root.innerHTML;
    checkScreen(h, 'en');
    expect(h).toMatch(/<div class="wqs-lrl" data-lrl><\/div><div class="wqs-ctl">/);
    const slot = root.querySelector('[data-lrl]');
    expect(slot.kids).toEqual([line]);
    expect(slot.kids[0].textContent).toBe('Jugnu Testwala needs a little rest now.');
    expect(text(h)).not.toContain('rest now');   // the live reader's node, not a copy of ours
    fire(root, 'next');
    expect(root.querySelector('[data-lrl]').kids || []).toHaveLength(0);
  });
  test('the page voice blocked (the player says onState blocked, as wq-readalong.js does): Listen is the one primary, and one tap plays it', async () => {
    const e = env(); const root = await openReader(e);
    toMic(e, root); e.calls.ask[0].onStream({});
    const mount = e.win.WQReadAlong.mount;
    // The real player's play() returns nothing; a refused autoplay is reported as onState('blocked').
    e.win.WQReadAlong.mount = (el, d, o) => { const p = mount(el, d, o); p.play = () => { p.log.push('play'); if (o && o.onState) o.onState('blocked'); }; return p; };
    e.calls.lr[0].o.onFallback('key');
    await flush();
    const h = root.innerHTML;
    checkScreen(h, 'en');
    expect(root.querySelector('[data-main]').textContent).toBe('Listen');
    expect(h).toMatch(/data-main data-primary/);
    const p = e.calls.ra[e.calls.ra.length - 1];
    fire(root, 'main');
    expect(p.log.filter((x) => x === 'play')).toHaveLength(2);
  });
  test('a page voice that fails to load: the Slower pill and the sound toggle go with it', async () => {
    const e = env(); const root = await openReader(e);
    expect(root.innerHTML).toContain('class="wqs-slow"');
    e.calls.ra[e.calls.ra.length - 1].o.onState('error');
    expect(root.innerHTML).not.toContain('class="wqs-slow"');
    expect(root.innerHTML).not.toContain('data-snd');
    checkScreen(root.innerHTML, 'en');
    expect(root.innerHTML).toMatch(/class="wqs-top" dir="ltr"/);
  });
  test('quality:\'low\': the live reader gets playWord:null and the page offers no word to tap (no practise word); a word-timed page does', async () => {
    const bk = book(); bk.pages[0].quality = 'low';
    const e = env({ replies: { book: { status: 200, body: bk } } }); const root = await openReader(e);
    toMic(e, root); e.calls.ask[0].onStream({});
    expect(e.calls.lr[0].o).toHaveProperty('playWord', null);
    e.calls.lr[0].o.onResult(READ(['read', 'read', 'read', 'skipped', 'read']));
    let h = root.innerHTML;
    expect((h.match(/data-tap="word"/g) || []).length).toBe(0);
    expect(h).not.toContain('Let&#39;s practise this word');
    expect(h).toContain('Well read!');
    const p = e.calls.ra[e.calls.ra.length - 1];
    fire(root, 'word', 3);
    expect(p.log.filter((x) => /^word:/.test(x))).toHaveLength(0);
    const e2 = env(); const r2 = await openReader(e2);
    toMic(e2, r2); e2.calls.ask[0].onStream({});
    expect(e2.calls.lr[0].o.playWord).toBeUndefined();
    e2.calls.lr[0].o.onResult(READ(['read', 'read', 'read', 'skipped', 'read']));
    h = r2.innerHTML;
    expect((h.match(/data-tap="word"/g) || []).length).toBe(1);
    fire(r2, 'word', 3);
    expect(e2.calls.ra[e2.calls.ra.length - 1].log).toContain('word:3');
  });
});

describe('the done line for a partial listen', () => {
  test('listened to some pages, read none: a deed ("1 page heard"), WQFC gets ended:\'listened\'', async () => {
    const bk = book({ questions: [], card_v3: true }); bk.pages[2].audio = { url: '/a/p3.ogg', ms: 2000 };
    let got = null;
    const e = env({ lr: false, replies: { book: { status: 200, body: bk } }, onLoad: (w) => { w.WQFC = { mount(el, o) { got = o; return false; } }; } });
    const root = await openReader(e);
    fire(root, 'main'); e.calls.ra[0].o.onEnd(); fire(root, 'main'); fire(root, 'next'); fire(root, 'next');
    await flush(); await flush();
    const h = root.innerHTML;
    checkScreen(h, 'en');
    expect(h).toContain('You listened with Jugnu!');
    expect(h).toContain('1 page heard');
    expect(got).toMatchObject({ source: 'story', ended: 'listened', pages_read: 0 });
    expect(got.pages_listened).toBeGreaterThan(0);
  });
});

describe('public-repo hygiene', () => {
  test('the shipped files carry plain product words only', () => {
    const tag = new RegExp('#[' + 'SC][0-9]+\\b');
    const bad = new RegExp(['RUL' + 'ING', 'le' + 'ad-', 'la' + 'ne', 'red ' + 'team', 'pan' + 'el', 'oper' + 'ator', 'C' + 'OS\\b', 'm-(score|live|read|home|story)'].join('|'), 'i');
    [SRC, QSRC, CSS].forEach((f) => { const x = fs.readFileSync(f, 'utf8'); expect(x).not.toMatch(bad); expect(x).not.toMatch(tag); });
  });
});

describe('a page counts as read only from 10 % of its words', () => {
  test('1 of 12 words: no praise, not counted, "Let\'s read it together"; 2 of 12 counts', async () => {
    const e = env();
    const m = e.S._machine(book(), { lr: true });
    m.primary(); m.end(); m.primary(); m.granted();
    m.result({ words_total: 12, words_read: 1, skipped: 0, marks: ['read'] });
    expect(m.st).toBe('together'); expect(m.counts().pages_read).toBe(0);
    m.primary(); m.end(); m.primary(); m.granted();
    m.result({ words_total: 12, words_read: 2, skipped: 0, marks: ['read', 'read'] });
    expect(m.st).toBe('read'); expect(m.counts().pages_read).toBe(1);
    const root = await openReader(e);
    toMic(e, root); e.calls.ask[0].onStream({});
    e.calls.lr[0].o.onResult({ words_total: 12, words_read: 1, skipped: 0, ms: 900, ended: 'done_tap', marks: ['read'] });
    const h = root.innerHTML;
    expect(h).toContain('Let&#39;s read it together');
    expect(text(h)).not.toMatch(/Well read/);
  });
  test('an unvoiced page is never counted as listened', () => {
    const e = env();
    const m = e.S._machine(book(), { lr: true });
    m.go(2); m.end(); m.primary(); m.end();
    expect(m.counts().pages_listened).toBe(0);
  });
});

describe('the shelf inside a host screen, and one writer per slot', () => {
  const host = (e, el, over = {}) => e.S.shelf(el, { kid: KID, lang: 'en' }, { token: TOKEN, lang: 'en', ...over });
  test('hosted (shelf(el, B, ctx)): no top bar and no primary while loading; books: one primary on the teacher card; primary:false: none', async () => {
    const e = env(); const el = fakeEl('slot');
    host(e, el);
    expect(el.innerHTML).toContain('wqs-skel');
    expect(el.innerHTML).not.toContain('wqs-top');
    expect(el.innerHTML).not.toContain('data-home');
    expect(primaries(el.innerHTML)).toBe(0);
    await flush();
    expect(el.innerHTML).not.toContain('wqs-top');
    expect(el.innerHTML).not.toContain('data-home');
    expect(primaries(el.innerHTML)).toBe(1);
    expect(el.innerHTML).toMatch(/class="wqs-tcard"[^>]*data-primary/);
    const e2 = env(); const el2 = fakeEl('slot2');
    host(e2, el2, { primary: false }); await flush();
    expect(primaries(el2.innerHTML)).toBe(0);
  });
  test('hosted, no books: only the "no books" line (the host keeps its own primary); a failed fetch keeps no top bar either', async () => {
    const e = env({ replies: { shelf: { status: 200, body: { grade: 1, lang: 'en', grades: [1, 2, 3, 4, 5], books: [] } } } }); const el = fakeEl('slot');
    host(e, el); await flush();
    expect(el.innerHTML).toContain('No storybooks here yet.');
    expect(el.innerHTML).not.toContain('wqs-top');
    expect(el.innerHTML).not.toContain('data-home');
    expect(el.innerHTML).not.toContain('data-tap="gl"');
    expect(primaries(el.innerHTML)).toBe(0);
    const f = env({ fail: (u) => /\/stories\/shelf\//.test(u) }); const el2 = fakeEl('slot2');
    host(f, el2); await flush();
    expect(el2.innerHTML).not.toContain('wqs-top');
    expect(primaries(el2.innerHTML)).toBe(1);
    expect(el2.innerHTML).toMatch(/data-primary data-tap="retry"/);
  });
  test('on its own (shelf(el, ctx)): Home is never the primary; an empty shelf makes "pick another grade" the primary', async () => {
    const e = env(); const el = fakeEl('shelf');
    e.S.shelf(el, e.ctx());
    expect(el.innerHTML).toContain('data-home');
    expect(el.innerHTML).not.toMatch(/data-home[^>]*data-primary/);
    const z = env({ replies: { shelf: { status: 200, body: { grade: 1, lang: 'en', grades: [1, 2, 3, 4, 5], books: [] } } } }); const el2 = fakeEl('shelf2');
    z.S.shelf(el2, z.ctx()); await flush();
    expect(el2.innerHTML).toContain('wqs-top');
    expect(el2.innerHTML).not.toMatch(/data-home[^>]*data-primary/);
    expect(primaries(el2.innerHTML)).toBe(1);
    expect(el2.innerHTML).toMatch(/data-tap="gl"[^>]*data-primary|data-primary[^>]*data-tap="gl"/);
  });
  test('two shelf() calls on one slot: only the later call paints, even when the older fetch answers last', async () => {
    const e = env({ hold: (u) => /\/stories\/shelf\//.test(u) }); const el = fakeEl('slot');
    e.S.shelf(el, e.ctx());                 // the self-mount's shape, its own primary
    host(e, el, { primary: false });        // then the host's call
    expect(e.calls.held).toHaveLength(2);
    e.calls.held[1](); await flush();
    const later = el.innerHTML;
    expect(later).toContain('stories-shelf');
    expect(primaries(later)).toBe(0);
    e.calls.held[0](); await flush();
    expect(el.innerHTML).toBe(later);
    expect((e.calls.ev || []).filter((x) => x[0] === 'story_shelf_shown')).toHaveLength(0);
  });
  test('the self-mount skips a slot a host has claimed (data-host), and fills an unclaimed one', async () => {
    const claimed = fakeEl('slot'); claimed.setAttribute('data-host', 'doors');
    const e = env({ boot: { token: TOKEN, kid: KID, lang: 'en' }, slot: claimed }); await flush();
    expect(e.calls.gets.filter((u) => /\/stories\/shelf\//.test(u))).toHaveLength(0);
    expect(claimed.innerHTML).toBe('');
    const free = fakeEl('slot2');
    const e2 = env({ boot: { token: TOKEN, kid: KID, lang: 'en' }, slot: free }); await flush();
    expect(e2.calls.gets.filter((u) => /\/stories\/shelf\//.test(u))).toHaveLength(1);
    expect(free.innerHTML).toContain('stories-shelf');
  });
});

describe('the host slot and the host call shape', () => {
  test('on load the shelf fills [data-stories-shelf] or a .wq-shelf[data-shelf] slot (never a bare [data-shelf] play tile)', async () => {
    const e = env({ boot: { token: TOKEN, kid: KID, lang: 'en' } });
    expect(e.calls.qs).toContain('[data-stories-shelf], .wq-shelf[data-shelf]');
  });
  test('shelf(el, B, ctx) as the hosts call it: kid from the boot, token/lang/ev from ctx; shelf(el, ctx) still works', async () => {
    const e = env(); const el = fakeEl('shelf'); const evs = [];
    e.S.shelf(el, { kid: KID, lang: 'ur' }, { token: TOKEN, lang: 'en', ev: (n) => evs.push(n), go() {} });
    await flush();
    expect(e.calls.gets[0]).toBe(`/api/wq/stories/shelf/h/${TOKEN}?kid=${KID}&l=en`);
    expect(evs).toContain('story_shelf_shown');
    const el2 = fakeEl('s2'); e.S.shelf(el2, { kid: KID }, { token: TOKEN }); await flush();
    expect(e.calls.gets[1]).toMatch(new RegExp(`^/api/wq/stories/shelf/h/${TOKEN.replace('.', '\\.')}\\?kid=${KID}&l=`));
    const el3 = fakeEl('s3'); e.S.shelf(el3, e.ctx()); await flush();
    expect(e.calls.gets[2]).toBe(`/api/wq/stories/shelf/h/${TOKEN}?kid=${KID}&l=en`);
  });
});

describe('hear a sentence again (a tapped word replays its sentence)', () => {
  // the real player's pause() reports onState('paused') when it was playing; a sentence replay pauses itself at its end
  const real = (e) => {
    const mount = e.win.WQReadAlong.mount;
    e.win.WQReadAlong.mount = (el, d, o) => { const p = mount(el, d, o); p.pause = () => { p.log.push('pause'); if (o.onState) o.onState('paused'); }; return p; };
  };
  test('the reader asks the player for the sentence tap', async () => {
    const e = env(); await openReader(e);
    expect(e.calls.ra[0].o.tap).toBe('sentence');
    expect(e.calls.ra[0].o.lines).toBeUndefined();   // a page without its own lines: the player finds them
  });
  test('a page with its own lines hands them to the player as [first, last] pairs (a low page replays those, not the browser\'s wrap)', async () => {
    const bk = book(); bk.pages[0].quality = 'low'; bk.pages[0].lines = [{ i0: 0, i1: 2, box: [100, 800, 300, 60] }, { i0: 3, i1: 4, box: [220, 860, 200, 60] }];
    const e = env({ replies: { book: { status: 200, body: bk } } }); await openReader(e);
    expect(e.calls.ra[0].o.lines).toEqual([[0, 2], [3, 4]]);
  });
  test('while listening: the replayed sentence ends by itself -> the button says Listen, not Pause; the time heard counts', async () => {
    const e = env(); real(e); const root = await openReader(e);
    const p = e.calls.ra[0];
    fire(root, 'main');
    expect(root.querySelector('[data-main]').textContent).toBe('Pause');
    p.o.onWordTap(2); e.advance(1500);
    p.o.onState('paused');                              // the player stopped after the sentence's last word
    expect(root.querySelector('[data-main]').textContent).toBe('Listen');
    fire(root, 'main');
    expect(p.log.filter((x) => x === 'play')).toHaveLength(2);
    e.advance(1000); p.o.onEnd();
    const ev = e.calls.posts.filter((x) => x.body.event === 'story_page_listened');
    expect(ev).toHaveLength(1);
    expect(ev[0].body.data).toMatchObject({ ms: 2500, completed: true });
  });
  test('after the page was heard: a sentence replay goes back to Your turn when it ends, and sends nothing new', async () => {
    const e = env(); real(e); const root = await openReader(e);
    const p = e.calls.ra[0];
    fire(root, 'main'); p.o.onEnd();
    expect(root.querySelector('[data-main]').textContent).toBe('Your turn');
    p.o.onWordTap(1);
    expect(root.querySelector('[data-main]').textContent).toBe('Pause');
    p.o.onState('paused');
    expect(root.querySelector('[data-main]').textContent).toBe('Your turn');
    expect(e.calls.posts.filter((x) => x.body.event === 'story_page_listened')).toHaveLength(1);
  });
  test('the child\'s own Pause (the player then says paused) is one pause: Listen, and one tap plays again', async () => {
    const e = env(); real(e); const root = await openReader(e);
    const p = e.calls.ra[0];
    fireNow(root, 'main'); e.advance(700); fireNow(root, 'main');
    expect(p.log).toEqual(['play', 'pause']);
    expect(root.querySelector('[data-main]').textContent).toBe('Listen');
    e.advance(700); fireNow(root, 'main');
    expect(p.log).toEqual(['play', 'pause', 'play']);
    expect(root.querySelector('[data-main]').textContent).toBe('Pause');
    e.advance(300); p.o.onEnd();
    expect(e.calls.posts.find((x) => x.body.event === 'story_page_listened').body.data.ms).toBe(1000);
  });
});

// ---- a kind screen on every stall --------------------------------------------------------------------------------
describe('a kind screen on every stall', () => {
  beforeAll(() => { STEADY = true; });
  afterAll(() => { STEADY = false; });
  test('a denied mic: kind state, Listen offered; Your turn is off for THIS page only, the next text page asks again', () => {
    const e = env(); const m = e.S._machine(book(), { lr: true, clock: e.clock });
    m.primary(); m.end(); m.primary(); m.denied();
    expect(m.st).toBe('denied'); expect(m.label()).toBe('listen');
    m.primary(); m.end(); expect(m.label()).toBe('next');   // this page: no Your turn again
    expect(m.dn).toBe(1);
    m.go(2); expect(m.label()).toBe('yourTurn');            // the next text page: the mic is offered again
  });
  test('the next page\'s picture and voice are warmed only once this page\'s voice plays (never on the book\'s open or a page turn); none past the last page', async () => {
    const bk = book(); bk.pages[1] = { ...bk.pages[1], audio: { url: '/a/p2.ogg', ms: 900 }, words: [W(0, 'Up', 100)], is_picture: false, text: 'Up' };
    const e = env({ replies: { book: { status: 200, body: bk } } }); const root = await openReader(e);
    expect(e.calls.imgs).toEqual([]);
    expect(e.calls.preload).toBeUndefined();
    fire(root, 'main');
    const p = e.calls.ra[0]; p.audio = { currentTime: 0, readyState: 1, paused: false }; p.o.onState('playing');
    e.advance(600);
    expect(e.calls.imgs).toEqual([]);                                  // asked, not yet playing: nothing warmed
    p.audio.currentTime = 0.4; p.audio.readyState = 4; e.advance(500);
    expect(e.calls.imgs).toEqual(['/s/b-1/p02.webp']);
    expect(e.calls.preload).toEqual(['b-1/p2']);
    e.advance(2000);
    expect(e.calls.imgs).toHaveLength(1);                              // once per page
    fire(root, 'next'); fire(root, 'next');
    const q = e.calls.ra[e.calls.ra.length - 1]; expect(q.data.id).toBe('b-1/p2');
    expect(e.calls.imgs).toHaveLength(1);                              // a turn alone warms nothing
  });
  test('a page voice that fails to load: never a bare redraw; Listen and Slower stay, the kind line says why, Listen fetches it anew', async () => {
    const e = env(); const root = await openReader(e);
    fire(root, 'main');
    e.calls.ra[0].o.onState('error');
    expect(root.innerHTML).toContain('class="wqs-slow"');
    expect(root.querySelector('[data-main]').textContent).toBe('Listen');
    expect(root.querySelector('[data-lrl]').innerHTML).toContain('Jugnu&#39;s voice is waiting for the internet…');
    checkScreen(root.innerHTML, 'en');
    fire(root, 'main');
    expect(e.calls.ra).toHaveLength(2);                                // the page and its voice, fetched anew
    expect(e.calls.ra[1].log).toEqual(['play']);                       // and played inside the tap
  });
  const NET = { en: 'Jugnu&#39;s voice is waiting for the internet…', ur: 'جگنو کی آواز انٹرنیٹ کا انتظار کر رہی ہے…' };
  const urBook = () => ({ ...book(), lang: 'ur', dir: 'rtl', title: 'مینا کی پتنگ' });
  // Listen tapped; the player's element plays (currentTime moving, data on hand)
  async function listening(e, lang = 'en') {
    const root = await openReader(e, { lang });
    fire(root, 'main');
    const p = e.calls.ra[0]; p.audio = { currentTime: 0.3, readyState: 4, paused: false };
    p.o.onState('playing');
    return { root, p };
  }
  const listened = (e) => e.calls.posts.filter((x) => x.body.event === 'story_page_listened').map((x) => x.body.data);

  test('mid-Listen the voice runs out of data: the listening clock stops at once, at 3 s the box rests, the button is Listen and a kind line says why (EN, UR)', async () => {
    for (const lang of ['en', 'ur']) {
      const e = env({ replies: { book: { status: 200, body: lang === 'ur' ? urBook() : book() } } });
      const { root, p } = await listening(e, lang);
      e.advance(1000);
      p.audio.readyState = 1;                                            // starved: no frames to play
      e.advance(500);
      expect(root.querySelector('[data-main]').textContent).toBe(lang === 'ur' ? 'رکیں' : 'Pause');   // a short wait is only a wait
      e.advance(3000);
      expect(p.log).toEqual(['play', 'pause']);
      expect(root.querySelector('[data-main]').textContent).toBe(lang === 'ur' ? 'سنیں' : 'Listen');
      expect(root.querySelector('[data-lrl]').innerHTML).toContain(NET[lang]);
      checkScreen(root.innerHTML, lang);
      e.advance(20000);
      fire(root, 'next');
      expect(listened(e)).toEqual([{ ms: 1500, completed: false }]);     // played 1.0 s (+ one 0.5 s look); no frozen seconds
    }
  });
  test('the data comes back within 3 s: the line goes, the clock runs again, Jugnu keeps reading', async () => {
    const e = env(); const { root, p } = await listening(e);
    e.advance(1000); p.audio.readyState = 1; e.advance(2000);
    expect(root.querySelector('[data-main]').textContent).toBe('Pause');
    expect(p.log).toEqual(['play']);
    p.audio.readyState = 4; e.advance(500);
    expect(root.querySelector('[data-lrl]').innerHTML).toBe('');
    expect(root.querySelector('[data-main]').textContent).toBe('Pause');
    e.advance(1000); p.o.onEnd();
    expect(listened(e)[0].ms).toBeLessThan(3000);                       // the 3 s wait is not billed
  });
  test('the first load slower than 3 s: the kind line while it keeps trying; the rest at 10 s', async () => {
    const e = env(); const { root, p } = await listening(e);
    p.audio.currentTime = 0; p.audio.readyState = 0;
    e.advance(3500);
    expect(root.querySelector('[data-lrl]').innerHTML).toContain(NET.en);
    expect(p.log).toEqual(['play']);
    e.advance(7000);
    expect(p.log).toEqual(['play', 'pause']);
    expect(root.querySelector('[data-main]').textContent).toBe('Listen');
  });
  test('the phone goes offline mid-Listen: at once; back online: the page\'s picture and voice are fetched anew, Listen waits for the tap', async () => {
    const e = env(); const { root, p } = await listening(e);
    e.advance(800);
    e.winL.offline.forEach((f) => f());
    expect(p.log).toEqual(['play', 'pause']);
    expect(root.querySelector('[data-lrl]').innerHTML).toContain(NET.en);
    expect(root.querySelector('[data-main]').textContent).toBe('Listen');
    e.winL.online.forEach((f) => f());
    expect(e.calls.ra).toHaveLength(2);                                  // a new player: the clip asked again
    expect(p.log).toContain('destroy');
    expect(e.calls.ra[1].data.image.url).toBe('/s/b-1/p01.webp');      // the player draws the page's picture again
    expect(e.calls.ra[1].log).toEqual([]);                               // never plays without the child's tap
    expect(root.querySelector('[data-main]').textContent).toBe('Listen');
    fire(root, 'main');
    expect(e.calls.ra[1].log).toEqual(['play']);
  });
  test('Listen again after a drop fetches the page anew and plays in the same tap (the ↻ button too)', async () => {
    const e = env(); const { root, p } = await listening(e);
    e.winL.offline.forEach((f) => f());
    expect(root.querySelector('[data-extra]').innerHTML).toContain('data-tap="again"');
    fire(root, 'again');
    expect(e.calls.ra).toHaveLength(2);
    expect(e.calls.ra[1].log).toEqual(['replay']);
    expect(p.log).toContain('destroy');
  });
  test('a picture that failed offline is fetched again when the phone is back online', async () => {
    const bk = book(); bk.pages[0].boxes_ok = false;
    const e = env({ replies: { book: { status: 200, body: bk } } }); const root = await openReader(e);
    expect(root.innerHTML).toContain('<img src="/s/b-1/p01.webp"');
    root._h = root._h.replace('<img src="/s/b-1/p01.webp"', '<img class=" wqs-bad" src="/s/b-1/p01.webp"');
    e.winL.online.forEach((f) => f());
    expect(root.innerHTML).not.toContain('wqs-bad');
    expect(e.calls.ra).toHaveLength(2);
  });
  test('a book that is not here (unpublished, a mistyped link): "This story is not here any more." + More stories, EN and UR; stories off keeps its own words', async () => {
    for (const lang of ['en', 'ur']) {
      const e = env({ replies: { book: { status: 404, body: { error: 'gone' } } } });
      const root = await openReader(e, { lang }); await flush();
      const h = root.innerHTML;
      expect(screenOf(h)).toBe('stories-gone');
      expect(text(h)).toContain(lang === 'ur' ? 'یہ کہانی اب یہاں نہیں ہے۔' : 'This story is not here any more.');
      expect(text(h)).toContain(lang === 'ur' ? 'اور کہانیاں' : 'More stories');
      expect(text(h)).not.toMatch(/resting|آرام/);
      checkScreen(h, lang);
      fire(root, 'back');
      expect(e.win.location.hash).toBe('#stories');
    }
    const off = env({ replies: { book: { status: 404, body: { error: 'stories_off' } } } });
    const r2 = await openReader(off); await flush();
    expect(screenOf(r2.innerHTML)).toBe('stories-off');
    expect(r2.innerHTML).toContain('Stories are resting today.');
  });
  test('"Read it together": a voice that errors or starves never leaves the child waiting; back to the page with the kind line', async () => {
    const two = () => { const bk = book(); bk.pages[0].words = [W(0, 'Mina', 100, [110, 810, 40, 50]), W(1, 'runs.', 600, [160, 810, 50, 50]), W(2, 'The', 1100, [220, 810, 30, 50]), W(3, 'kite', 1600, [230, 870, 40, 50]), W(4, 'flies!', 2100, [280, 870, 60, 50])]; return bk; };
    for (const how of ['error', 'starve']) {
      const e = env({ replies: { book: { status: 200, body: two() } } });
      const root = await openReader(e);
      toMic(e, root); e.calls.ask[0].onStream({ id: 'st' });
      e.calls.lr[0].o.onResult(READ(['read', 'ahead', 'ahead', 'ahead', 'ahead']));
      fire(root, 'echo');
      expect(screenOf(root.innerHTML)).toBe('story-echo');
      const p = e.calls.ra[e.calls.ra.length - 1];
      if (how === 'error') p.o.onState('error');
      else { p.audio = { currentTime: 0.2, readyState: 1, paused: false }; e.advance(4000); }
      expect(screenOf(root.innerHTML)).toBe('story-page');
      expect(root.querySelector('[data-lrl]').innerHTML).toContain(NET.en);
    }
  });

  test('every page turn writes #story/<id>/p<N> in place (no new history entry); a link to /p3 opens page 3', async () => {
    const e = env({ hash: '#story/b-1' }); const root = await openReader(e);
    expect(e.calls.hist).toEqual(['#story/b-1/p1']);
    fire(root, 'next');
    expect(e.calls.hist.slice(-1)).toEqual(['#story/b-1/p2']);
    fire(root, 'next'); fire(root, 'prev');
    expect(e.calls.hist.slice(-2)).toEqual(['#story/b-1/p3', '#story/b-1/p2']);
    const e2 = env({ hash: '#story/b-1/p3' });
    const r2 = fakeEl('root'); e2.S.route({ ...e2.ctx({ root: r2 }) }); await flush();
    expect(r2.innerHTML).toContain('/s/b-1/p03.webp');
  });
  test('the in-app browser closed mid-Listen (pagehide): the listening so far is sent', async () => {
    const e = env(); const { p } = await listening(e);
    e.advance(1500);
    e.winL.pagehide.forEach((f) => f());
    expect(listened(e)).toEqual([{ ms: 1500, completed: false }]);
    expect(p.log).toEqual(['play']);
  });

  test('after a denied mic the next text page offers Your turn again, its sheet saying "Try the mic again" (EN, UR)', async () => {
    for (const lang of ['en', 'ur']) {
      const e = env({ replies: { book: { status: 200, body: lang === 'ur' ? urBook() : book() } } });
      const root = await openReader(e, { lang });
      toMic(e, root); e.calls.ask[0].onDenied('notallowederror');
      expect(root.querySelector('[data-main]').textContent).toBe(lang === 'ur' ? 'سنیں' : 'Listen');
      fire(root, 'next'); fire(root, 'next');
      expect(root.querySelector('[data-main]').textContent).toBe(lang === 'ur' ? 'اب آپ پڑھیں' : 'Your turn');
      fire(root, 'main');
      expect(screenOf(root.innerHTML)).toBe('story-mic');
      expect(text(root.innerHTML)).toContain(lang === 'ur' ? 'مائیک پھر سے چلا کر دیکھیں' : 'Try the mic again');
      expect(e.calls.ask).toHaveLength(2);
      expect(e.calls.ask[0].hash).toBe(true);                         // Open in Chrome keeps #story/<id>/p<N>
    }
  });

  test('the stage is never blank: before the picture loads it shows the page\'s words and "Opening…" (EN, UR); the look-back page the same', async () => {
    for (const lang of ['en', 'ur']) {
      const bk = lang === 'ur' ? urBook() : book(); bk.pages[0].text = lang === 'ur' ? 'مینا کے پاس پتنگ ہے' : 'Mina Testwala has a kite';
      const e = env({ replies: { book: { status: 200, body: bk } } }); const root = await openReader(e, { lang });
      expect(root.innerHTML).toContain('<div class="wqs-ph" data-ph><p>' + bk.pages[0].text + '</p><i>' + (lang === 'ur' ? 'صفحہ کھل رہا ہے…' : 'Opening…') + '</i></div><div class="wqs-cam"');
    }
    const css = fs.readFileSync(CSS, 'utf8');
    expect(css).toMatch(/\.wqs-ph\{position:absolute;inset:0/);
    const e = env({ right: (d) => d.n !== 1 }); const root = await openReader(e);
    runBook(e, root); await flush(); await flush();
    fire(root, 'ans', 1); await flush(); e.advance(700);
    expect(screenOf(root.innerHTML)).toBe('story-look');
    expect(root.innerHTML).toContain('data-ph><p>Mina Testwala has a kite</p><i>Opening…</i>');
  });
  test('the "Opening…" frame goes the moment the page\'s picture has loaded', async () => {
    const e = env(); const root = await openReader(e);
    const st = root.querySelector('[data-stage]'); const im = { complete: false, naturalWidth: 0, l: {}, addEventListener(n, f) { this.l[n] = f; } };
    st.querySelectorAll = () => [im];
    const ph = root.querySelector('[data-ph]'); ph._w = 0;
    fire(root, 'main');
    expect(ph.style.display).toBeUndefined();
    im.l.load();
    expect(ph.style.display).toBe('none');
  });

  test('opening a book asks for no voice: the player\'s element is set to preload none in the mount\'s own task; the Listen tap is the first audio request', async () => {
    const e = env(); const root = await openReader(e);
    expect(e.calls.ra[0].audio.preload).toBe('none');
    expect(e.calls.audios).toHaveLength(0);
    expect(e.calls.preload).toBeUndefined();
    fire(root, 'main');
    expect(e.calls.ra[0].log).toEqual(['play']);
  });

  test('the main button holds for 600 ms after it changes: a tap at 300 ms does nothing, at 700 ms it acts; it keeps its old colour meanwhile (under the look it already wears the new state, .wqs-to-*)', async () => {
    const e = env(); const root = await openReader(e);
    const p = e.calls.ra[0];
    e.advance(700); fireNow(root, 'main');                               // Listen -> Pause
    expect(root.querySelector('[data-main]').className).toBe('wqs-main wqs-listen wqs-lk wqs-to-pause');
    e.advance(300); fireNow(root, 'main');
    expect(p.log).toEqual(['play']);
    e.advance(400);
    expect(root.querySelector('[data-main]').className).toBe('wqs-main wqs-pause');
    fireNow(root, 'main');
    expect(p.log).toEqual(['play', 'pause']);
    // the voice ends by itself: Pause becomes Your turn under the child's finger
    e.advance(700); fireNow(root, 'main'); e.advance(700);
    p.o.onEnd();
    expect(root.querySelector('[data-main]').textContent).toBe('Your turn');
    e.advance(300); fireNow(root, 'main');
    expect(screenOf(root.innerHTML)).toBe('story-page');
    e.advance(400); fireNow(root, 'main');
    expect(screenOf(root.innerHTML)).toBe('story-mic');
    expect(fs.readFileSync(CSS, 'utf8')).toMatch(/\.wqs-lk\{pointer-events:none\}/);
  });

  test('play and pause look different from the first tap: the first paint is the play kind, the held button names its new state', async () => {
    const e = env(); const root = await openReader(e);
    const mb = () => root.querySelector('[data-main]');
    expect(mb().className).toMatch(/\bwqs-listen\b/);                  // ▶ on the first paint, before any tap
    e.advance(700); fireNow(root, 'main');                              // Listen -> Pause: held, already the pause kind
    expect(mb().className).toBe('wqs-main wqs-listen wqs-lk wqs-to-pause');
    e.advance(700);
    expect(mb().className).toBe('wqs-main wqs-pause');
    fireNow(root, 'main');                                              // Pause -> Listen: held, already the play kind
    expect(mb().className).toBe('wqs-main wqs-pause wqs-lk wqs-to-listen');
  });

  test('an Urdu title is never cut at its first letter: the clipped title row keeps room at its start', () => {
    const css = fs.readFileSync(CSS, 'utf8');
    expect(css).toMatch(/\[data-steady\] \.wqs-top h2\[dir=rtl\]\{padding-inline-start:\.3em\}/);
  });
  // every reader state: one visible button that leads somewhere, and no wait on the voice without an end
  test('the way-out lint: listening, echo, mic sheet, denied, the drop, together, questions, done — each has a way on; no state waits on the voice for ever', async () => {
    const WAYS = /data-tap="(main|next|prev|back|home|close|eend|again|more|retry|ans|qnext|lret|late)"/;
    const seen = {};
    const look = (name, root) => { const h = root.innerHTML; seen[name] = 1; expect(h).toMatch(WAYS); expect(primaries(h)).toBeLessThanOrEqual(1); };
    let e = env(); let r = await listening(e);
    look('listening', r.root);
    r.p.audio.readyState = 1; e.advance(4000);                           // the voice starves: never a wait for ever
    look('drop', r.root); expect(r.root.querySelector('[data-main]').textContent).toBe('Listen');
    e = env(); let root = await openReader(e); toMic(e, root);
    look('mic', root);
    e.calls.ask[0].onDenied('notallowederror'); look('denied', root);
    e = env(); root = await openReader(e); toMic(e, root); e.calls.ask[0].onStream({ id: 's' });
    e.calls.lr[0].o.onResult(READ(['ahead', 'ahead', 'ahead', 'ahead', 'ahead'])); look('together', root);
    fire(root, 'echo'); look('echo', root);
    const ep = e.calls.ra[e.calls.ra.length - 1]; ep.audio = { currentTime: 0.2, readyState: 1, paused: false }; e.advance(11000);
    expect(screenOf(root.innerHTML)).toBe('story-page');                 // the echo's wait on the voice has an end
    e = env(); root = await openReader(e); runBook(e, root); await flush(); await flush();
    look('questions', root);
    e = env({ replies: { book: { status: 200, body: book({ questions: [] }) } } }); root = await openReader(e); runBook(e, root); await flush(); await flush();
    expect(screenOf(root.innerHTML)).toBe('story-done'); look('done', root);
    expect(Object.keys(seen).sort()).toEqual(['denied', 'done', 'drop', 'echo', 'listening', 'mic', 'questions', 'together']);
  });
});

// ---- the stall setting OFF: today's reader, step for step ---------------------------------------------------------
// One scripted walk (EN + UR: open, Listen, the voice's error, a page voiced late, Your turn, a blocked mic, the
// internet events, the questions, the done screen, a missing book). Its transcript (every screen, the main button, the
// extras, every request, post, picture warm, voice preload, address write and file loaded; the split-off questions
// file excepted, a file move) is hashed. PIN = the hash on the reader before the setting existed (sandbox 5c574c638).
describe('the stall setting OFF (no `steady` on the book): byte-identical to today', () => {
  const OFF_PIN = 'd5c805a4bf3ecc1bfffe16c17ca146f0c648bd5e952023935f47006295c1f400';
  async function walk(lang) {
    const T = [];
    const bk0 = () => ({ ...book(), lang, dir: lang === 'ur' ? 'rtl' : 'ltr' });
    const snap = (e, root, tag) => {
      const m = root.querySelector('[data-main]'); const x = root.querySelector('[data-extra]'); const l = root.querySelector('[data-lrl]');
      T.push([tag, root.innerHTML, m && m.textContent, m && m.className, x && x.innerHTML, l && l.innerHTML,
        e.calls.gets.slice(), e.calls.posts.map((p) => [p.url, p.body]), e.calls.imgs.slice(), e.calls.preload || null, e.calls.hist.slice(),
        e.calls.loaded.map((x) => x.src || x.href).filter((u) => !/wq-stories-d\.js/.test(u)), e.calls.ra.map((p) => [p.data.id, p.log.slice(), p.audio.preload || null])]);
    };
    const fireAll = (e, n) => (e.winL[n] || []).forEach((f) => f());
    // 1. open, Listen, the voice fails, the internet events
    let e = env({ replies: { book: { status: 200, body: bk0() } } }); let root = await openReader(e, { lang });
    snap(e, root, 'open');
    fire(root, 'main'); snap(e, root, 'listen');
    e.calls.ra[0].audio = { currentTime: 0.3, readyState: 1, paused: false }; e.calls.ra[0].o.onState('playing'); e.advance(4000); snap(e, root, 'starve');
    fireAll(e, 'offline'); fireAll(e, 'online'); fireAll(e, 'pagehide'); snap(e, root, 'net');
    e.calls.ra[e.calls.ra.length - 1].o.onState('error'); snap(e, root, 'error');
    fire(root, 'next'); fire(root, 'next'); e.advance(3500); await flush(); snap(e, root, 'late');
    // 2. Your turn, blocked, the next page
    e = env({ replies: { book: { status: 200, body: bk0() } } }); root = await openReader(e, { lang });
    toMic(e, root); snap(e, root, 'mic');
    e.calls.ask[0].onDenied('notallowederror'); snap(e, root, 'denied');
    fire(root, 'next'); fire(root, 'next'); fire(root, 'main'); snap(e, root, 'p3');
    // 3. the whole book to the done screen
    e = env({ replies: { book: { status: 200, body: bk0() } } }); root = await openReader(e, { lang });
    runBook(e, root); await flush(); await flush(); snap(e, root, 'questions');
    fire(root, 'ans', 0); await flush(); e.advance(1000); await flush(); fire(root, 'ans', 0); await flush(); e.advance(1000); await flush(); await flush(); snap(e, root, 'done');
    // 4. a book that is not there
    e = env({ replies: { book: { status: 404, body: { error: 'not_found' } } } }); root = await openReader(e, { lang }); await flush(); snap(e, root, '404');
    return T;
  }
  test('the microphone sheet is not asked to keep the page in its Chrome link', async () => {
    const e = env(); const root = await openReader(e); toMic(e, root);
    expect(e.calls.ask[0].hash).toBe(false);
  });
  test('the walk\'s transcript hash, EN and UR, equals today\'s', async () => {
    const h = require('crypto').createHash('sha256').update(JSON.stringify([await walk('en'), await walk('ur')])).digest('hex');
    if (process.env.PRINT_OFF_PIN) console.log('OFF_PIN', h);
    expect(h).toBe(OFF_PIN);
  });
});

// ---- the stall setting OFF: the second file (wq-stories-q.js) failing or landing late changes nothing -------------
// On a slow link the second file can land after the page voice has already failed, or never. Today's reader handles
// the voice's error, the quiet look again for a page voiced late and the next page's warm-up on its own, so the walk
// must read the same with that file failed, late or on time.
describe('the stall setting OFF: a failed or late second file never changes the voice-error path', () => {
  async function run(opt) {
    const T = [];
    const e = env({ ...opt }); const root = await openReader(e);
    const snap = (tag) => {
      const m = root.querySelector('[data-main]'); const x = root.querySelector('[data-extra]');
      T.push([tag, screenOf(root.innerHTML), root.innerHTML, m && m.textContent, x && x.innerHTML, e.calls.gets.slice(), e.calls.posts.map((p) => [p.url, p.body]),
        e.calls.imgs.slice(), e.calls.preload || null, e.calls.hist.slice(), e.calls.ra.map((p) => [p.data.id, p.log.slice(), p.audio.preload || null])]);
    };
    snap('open');
    fire(root, 'main'); snap('listen');
    e.calls.ra[0].o.onState('error'); snap('error');
    if (e.calls.qGo) e.calls.qGo();                       // the second file lands only now
    snap('q');
    e.advance(3500); await flush(); await flush(); snap('late');
    fire(root, 'next'); snap('p2');
    fire(root, 'next'); e.advance(3500); await flush(); await flush(); snap('p3');
    return { e, root, T };
  }
  const pick = (T, tag) => T.find((x) => x[0] === tag);
  test('the second file fails to load: the voice error still turns the button to Your turn, and the next page\'s picture is warmed', async () => {
    const ok = await run({}); const bad = await run({ qFail: true });
    expect(pick(bad.T, 'open')[7]).toEqual(['/s/b-1/p02.webp']);
    expect(pick(bad.T, 'listen')[3]).toBe('Pause');
    expect(pick(bad.T, 'error')[3]).toBe('Your turn');
    expect(pick(bad.T, 'error')[2]).not.toContain('data-ra');            // the page drawn again without its voice
    expect(pick(bad.T, 'late')[5].filter((u) => /\/stories\/book\//.test(u))).toHaveLength(2);   // one quiet look again
    expect(bad.T).toEqual(ok.T);
    expect(ok.e.calls.ka).toBeUndefined(); expect(bad.e.calls.ka).toBeUndefined();   // keepalive never reaches the setting-off reader
  });
  test('the second file lands after the voice error: the same walk as when it came on time, nothing done twice', async () => {
    const ok = await run({}); const late = await run({ qHold: true });
    expect(late.e.calls.qGo).toBeTruthy();
    expect(pick(late.T, 'error')[3]).toBe('Your turn');
    expect(pick(late.T, 'open')[7]).toEqual(['/s/b-1/p02.webp']);
    expect(late.T).toEqual(ok.T);
  });
  test('a starved voice (data stops, the player never says playing) shows no kind screen and never stops the listening clock; "Read it together" too', async () => {
    const e = env(); const root = await openReader(e);
    fire(root, 'main');
    const p = e.calls.ra[0]; p.audio = { currentTime: 0.3, readyState: 1, paused: false };
    p.o.onState('stalled'); p.o.onState('waiting');
    e.advance(11000);
    expect(root.innerHTML).not.toContain('wqs-net');
    expect(root.querySelector('[data-lrl]').innerHTML).toBe('');
    expect(root.querySelector('[data-main]').textContent).toBe('Pause');
    expect(p.log).toEqual(['play']);
    fire(root, 'next');
    const lp = e.calls.posts.filter((x) => x.body.event === 'story_page_listened');
    expect(lp.map((x) => x.body.data)).toEqual([{ ms: 11000, completed: false }]);
    // Read it together, starved
    const bk = book(); bk.pages[0].words = [W(0, 'Mina', 100, [110, 810, 40, 50]), W(1, 'runs.', 600, [160, 810, 50, 50]), W(2, 'The', 1100, [220, 810, 30, 50]), W(3, 'kite', 1600, [230, 870, 40, 50]), W(4, 'flies!', 2100, [280, 870, 60, 50])];
    const e2 = env({ replies: { book: { status: 200, body: bk } } }); const r2 = await openReader(e2);
    toMic(e2, r2); e2.calls.ask[0].onStream({ id: 'st' });
    e2.calls.lr[0].o.onResult(READ(['read', 'ahead', 'ahead', 'ahead', 'ahead']));
    fire(r2, 'echo');
    expect(screenOf(r2.innerHTML)).toBe('story-echo');
    const ep = e2.calls.ra[e2.calls.ra.length - 1]; ep.audio = { currentTime: 0.2, readyState: 1, paused: false };
    e2.advance(11000);
    expect(screenOf(r2.innerHTML)).toBe('story-echo');
    expect(r2.innerHTML).not.toContain('wqs-net');
    expect(ep.log).not.toContain('pause');
  });
});

// ---- the stall setting ON: the edges after the review (the in-app browser closing, leaving the book, a missing
// second file, a voice error before it lands) -------------------------------------------------------------------
describe('a kind screen on every stall: the edges', () => {
  beforeAll(() => { STEADY = true; });
  afterAll(() => { STEADY = false; });
  const NET = 'Jugnu&#39;s voice is waiting for the internet…';
  test('the in-app browser closing (pagehide) sends the listening so far with keepalive, so it leaves the phone; a page turn sends as before', async () => {
    const e = env(); const root = await openReader(e);
    fire(root, 'main'); e.advance(1200); fire(root, 'next');
    expect(e.calls.posts.filter((x) => x.body.event === 'story_page_listened')).toHaveLength(1);
    expect(e.calls.ka).toBeUndefined();                                  // a page turn: an ordinary send
    const e2 = env(); const r2 = await openReader(e2);
    fire(r2, 'main'); e2.advance(900);
    e2.winL.pagehide.forEach((f) => f());
    const lp = e2.calls.posts.filter((x) => x.body.event === 'story_page_listened');
    expect(lp.map((x) => x.body.data)).toEqual([{ ms: 900, completed: false }]);
    expect(e2.calls.ka).toEqual(['story_page_listened']);
  });
  test('leaving the book (Back, Home, another book) takes its offline / online / pagehide listeners with it at once, before any of them fires', async () => {
    const n = (e) => ['offline', 'online', 'pagehide'].map((k) => (e.winL[k] || []).length);
    for (const how of ['back', 'home']) {
      const e = env(); const root = await openReader(e);
      expect(n(e)).toEqual([1, 1, 1]);
      fire(root, how);
      expect(n(e)).toEqual([0, 0, 0]);
    }
    const e = env(); const root = await openReader(e);
    e.S.open('b-1', e.ctx({ root })); await flush();                   // a second open: the first book's go, the new one's stay
    expect(n(e)).toEqual([1, 1, 1]);
  });
  test('the stall setting on: the microphone is still given back when the tab closes and when the book is left, through the book\'s own one pagehide listener', async () => {
    const n = (e) => ['offline', 'online', 'pagehide'].map((k) => (e.winL[k] || []).length);
    const micStream = (id) => { const tr = { stops: 0, stop() { tr.stops += 1; } }; return { id, tr, getTracks: () => [tr] }; };
    const e = env(); const root = await openReader(e);
    toMic(e, root);
    const st = micStream('a');
    e.calls.ask[0].onStream(st);
    expect(n(e)).toEqual([1, 1, 1]);                               // no listener of the microphone's own
    expect(st.tr.stops).toBe(0);
    (e.winL.pagehide || []).forEach((f) => f({}));                 // the tab closed mid-read
    expect(st.tr.stops).toBeGreaterThanOrEqual(1);
    const e2 = env(); const r2 = await openReader(e2);
    toMic(e2, r2);
    const st2 = micStream('b');
    e2.calls.ask[0].onStream(st2);
    fire(r2, 'back');                                              // the book left: its listeners and the microphone go at once
    expect(st2.tr.stops).toBeGreaterThanOrEqual(1);
    expect(n(e2)).toEqual([0, 0, 0]);
  });
  test('a book that is not here while the second file cannot load: the kind retry screen with Back, never the waiting screen', async () => {
    const e = env({ qFail: true, replies: { book: { status: 404, body: { error: 'gone' } } } });
    const root = await openReader(e); await flush();
    expect(screenOf(root.innerHTML)).toBe('stories-retry');
    expect(text(root.innerHTML)).toContain('Jugnu could not open this.');
    expect(root.innerHTML).toMatch(/data-tap="back"/);
    checkScreen(root.innerHTML, 'en');
  });
  test('a voice error before the second file lands: once it lands the kind line and Listen (a fresh fetch); if it never lands, the page without its voice, never Pause over a dead voice', async () => {
    const e = env({ qHold: true }); const root = await openReader(e);
    fire(root, 'main');
    e.calls.ra[0].o.onState('error');
    e.calls.qGo();
    expect(root.querySelector('[data-main]').textContent).toBe('Listen');
    expect(root.querySelector('[data-lrl]').innerHTML).toContain(NET);
    expect(e.calls.ra[0].log).toContain('pause');
    fire(root, 'main');
    expect(e.calls.ra).toHaveLength(2);
    expect(e.calls.ra[1].log).toEqual(['play']);
    const f = env({ qFail: true }); const r2 = await openReader(f);
    fire(r2, 'main');
    f.calls.ra[0].o.onState('error');
    expect(r2.querySelector('[data-main]').textContent).not.toBe('Pause');
    expect(r2.innerHTML).not.toContain('data-ra');
  });
  test('a voice error, then the child leaves before the second file lands: its arrival breaks nothing (the next book still gets its kind screens)', async () => {
    const e = env({ qHold: true }); const root = await openReader(e);
    fire(root, 'main');
    e.calls.ra[0].o.onState('error');
    fire(root, 'back');
    const r2 = fakeEl('root2'); e.S.open('b-1', e.ctx({ root: r2 })); await flush();   // the next book, its own wait queued behind
    expect(() => e.calls.qGo()).not.toThrow();
    expect(['offline', 'online', 'pagehide'].map((k) => (e.winL[k] || []).length)).toEqual([1, 1, 1]);
    fire(r2, 'main');
    e.calls.ra[e.calls.ra.length - 1].o.onState('error');
    expect(r2.querySelector('[data-main]').textContent).toBe('Listen');
    expect(r2.querySelector('[data-lrl]').innerHTML).toContain(NET);
  });
  test('a voice error, then the child leaves, and the second file never lands: the left book is never drawn again over what the child went to', async () => {
    const e = env({ qHold: true }); const root = await openReader(e);
    fire(root, 'main');
    e.calls.ra[0].o.onState('error');
    fire(root, 'back');
    root.innerHTML = '<section data-screen="stories-shelf"></section>';
    e.advance(8000);                                                    // the loader gives up on the file
    expect(root.innerHTML).toBe('<section data-screen="stories-shelf"></section>');
  });
  test('a text page served before its voice: exactly one quiet look again, never a second', async () => {
    const e = env(); const root = await openReader(e);
    fire(root, 'next'); fire(root, 'next');
    e.advance(3500); await flush(); await flush();
    e.advance(10000); fire(root, 'prev'); fire(root, 'next'); e.advance(3500); await flush(); await flush();
    expect(e.calls.gets.filter((u) => /\/stories\/book\//.test(u))).toHaveLength(2);
  });
  test('"Finish your story" lands on the page where the child stopped: #story/<id>/p2 opens page 2, with Page before ready', async () => {
    const e = env({ hash: '#story/b-1/p2' });
    const root = fakeEl('root'); e.S.route({ ...e.ctx({ root }) }); await flush();
    expect(root.innerHTML).toContain('/s/b-1/p02.webp');
    expect(root.innerHTML).toMatch(/data-tap="prev" aria-label/);
    expect(root.innerHTML).not.toMatch(/data-tap="prev" disabled/);
  });
  test('the look-back page\'s "Opening…" frame goes the moment its picture has loaded', async () => {
    const e = env({ right: (d) => d.n !== 1 }); const root = await openReader(e);
    runBook(e, root); await flush(); await flush();
    fire(root, 'ans', 1); await flush();
    const im = { complete: false, naturalWidth: 0, l: {}, addEventListener(k, f) { this.l[k] = f; } };
    const q0 = root.querySelector.bind(root);
    root.querySelector = (sel) => { const el = q0(sel); if (el && sel === '[data-stage]') el.querySelectorAll = () => [im]; return el; };
    e.advance(700);
    expect(screenOf(root.innerHTML)).toBe('story-look');
    expect(root.innerHTML).toContain('data-ph><p>Mina Testwala has a kite</p>');
    const ph = root.querySelector('[data-ph]');
    expect(ph.style.display).toBeUndefined();                            // the words, while the picture comes
    expect(typeof im.l.load).toBe('function');
    im.l.load();
    expect(ph.style.display).toBe('none');
  });
});

// ---- the reading moment (the book says read_fb: 1; app_settings web_quiz_read_feedback) ----------------------------
describe('every read-aloud answered: the page after Your turn and the book\'s end', () => {
  const MSRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'wq-moment.js'), 'utf8');
  const withMoment = (e) => { vm.runInContext(MSRC, vm.createContext({ window: e.win, document: {} })); return e; };
  const RFB = (over = {}) => ({ status: 200, body: book({ read_fb: 1, ...over }) });
  const readPage1 = (e, root, marks) => { toMic(e, root); e.calls.ask[0].onStream({}); e.calls.lr[0].o.onResult(READ(marks)); return root.innerHTML; };
  test('the book says nothing (key off): "Well read!" as today, no moment, the moment file never asked for', async () => {
    const e = withMoment(env()); const root = await openReader(e);
    const h = readPage1(e, root, ['read', 'read', 'read', 'read', 'read']);
    expect(h).toContain('Well read!');
    expect(h).not.toContain('data-rf');
    expect(e.calls.loaded.filter((x) => /wq-moment/.test(x.src || x.href || ''))).toHaveLength(0);
  });
  test('read_fb, the file not here yet: the reader asks for it once; the page stays today\'s until it is', async () => {
    const e = env({ replies: { book: RFB() } }); const root = await openReader(e);
    const h = readPage1(e, root, ['read', 'read', 'read', 'read', 'read']);
    expect(e.calls.loaded.filter((x) => x.tag === 'script' && /wq-moment\.js/.test(x.src))).toHaveLength(1);
    expect(h).toContain('Well read!');
  });
  test.each(['en', 'ur'])('%s, read_fb: a page read well is answered with words, stars and lights (small), the speed hidden on a short page', async (lang) => {
    const e = withMoment(env({ replies: { book: RFB({ lang, dir: lang === 'ur' ? 'rtl' : 'ltr' }) } })); const root = await openReader(e, { lang });
    const h = readPage1(e, root, ['read', 'read', 'read', 'read', 'read']);
    expect(h).toContain('data-rf');
    expect(h).toContain('wq-moment--s');
    expect(h).toContain(lang === 'ur' ? 'آپ نے ۵ لفظ پڑھے!' : 'You read 5 words!');
    expect(h).toContain('data-stars="3"');
    expect(h).not.toContain(lang === 'ur' ? 'ایک منٹ میں' : 'a minute');
    checkScreen(h, lang);
  });
  test('read_fb, a word skipped: the moment AND the word to practise; on a short page one word missed is still 3 stars, two missed is 1', async () => {
    const e = withMoment(env({ replies: { book: RFB() } })); const root = await openReader(e);
    const h = readPage1(e, root, ['read', 'read', 'read', 'skipped', 'read']);
    expect(h).toContain('You read 4 words!');
    expect(h).toContain('data-stars="3"');
    expect(h).toContain('data-tap="word"');
    const e2 = withMoment(env({ replies: { book: RFB() } })); const r2 = await openReader(e2);
    const h2 = readPage1(e2, r2, ['read', 'skipped', 'read', 'skipped', 'read']);
    expect(h2).toContain('You read 3 words!');
    expect(h2).toContain('data-stars="1"');
  });
  test('read_fb, a page\'s result keeps the whole page in view: the word chip\'s replay never zooms the art past the screen', async () => {
    const e = withMoment(env({ replies: { book: RFB() } })); const root = await openReader(e);
    readPage1(e, root, ['read', 'read', 'read', 'skipped', 'read']);
    e.advance(10);
    const cam = root.querySelector('[data-cam]');
    expect(root.querySelector('[data-whole]').getAttribute('aria-pressed')).toBe('true');
    const p = e.calls.ra[e.calls.ra.length - 1];
    p.o.onWord(3);
    expect(cam.style.transform).toBe('translate(0px,0px) scale(0.5)');
  });
  test('read_fb, nothing read: the kind moment ("let\'s read it together", a brave-try badge), no stars', async () => {
    const e = withMoment(env({ replies: { book: RFB() } })); const root = await openReader(e);
    const h = readPage1(e, root, ['skipped', 'skipped', 'skipped', 'skipped', 'skipped']);
    expect(h).toContain('data-badge="try"');
    expect(h).not.toContain('wq-moment-star');
    expect(text(/<section class="wq-moment[\s\S]*?<\/section>/.exec(h)[0])).not.toMatch(/\b(test|exam|slower)\b/i);   // (the page's own "Slower" pill is the voice speed)
  });
  test.each(['en', 'ur'])('%s, read_fb: the book\'s end shows the whole read — words, the jar with the speed beside it, faster than the last book', async (lang) => {
    const done = { status: 200, body: { ok: true, sticker: true, reading: { words_read: 48, words_total: 50, ms: 40000, wcpm: 72, prev_wcpm: 60 } } };
    const e = withMoment(env({ replies: { book: RFB({ lang, dir: lang === 'ur' ? 'rtl' : 'ltr', questions: [] }), done }, wqj: true })); const root = await openReader(e, { lang });
    runBook(e, root); await flush(); await flush(); await flush();
    const h = root.innerHTML;
    expect(screenOf(h)).toBe('story-done');
    expect(h).toContain(lang === 'ur' ? 'آپ نے ۴۸ لفظ پڑھے!' : 'You read 48 words!');
    expect(h).toContain(lang === 'ur' ? 'ایک منٹ میں ۷۲ لفظ' : '72 words a minute');
    expect(h).toContain(lang === 'ur' ? 'پچھلی بار سے تیز!' : 'Faster than last time!');
    expect(h.indexOf('data-rf')).toBeLessThan(h.indexOf('data-col'));
    expect(primaries(h)).toBeLessThanOrEqual(1);
  });
  test('read_fb, a word skipped: "hear Jugnu say it" plays only the sentence with that word, from the page\'s own take, then stops', async () => {
    const e = withMoment(env({ replies: { book: RFB() } })); const root = await openReader(e);
    const h = readPage1(e, root, ['read', 'read', 'read', 'skipped', 'read']);
    expect(h).toContain('data-tap="rfhear"');
    const p = e.calls.ra[e.calls.ra.length - 1];
    p.log.length = 0; p.audio.currentTime = 0.1;
    fire(root, 'rfhear');
    expect(p.log).toEqual(['seek:0', 'play']);
    p.audio.currentTime = 2.6; e.advance(40);   // past the sentence's last word (kite., ends 2500 ms)
    expect(p.log).toEqual(['seek:0', 'play', 'pause']);
    expect(e.calls.audios).toHaveLength(0);   // no second player: the ONE mute and one voice per book hold
  });
  test('read_fb: no replay on a page whose words are not timed well (quality low), on a page with no voice, or with no word skipped', async () => {
    const low = book({ read_fb: 1 }); low.pages[0].quality = 'low';
    const e1 = withMoment(env({ replies: { book: { status: 200, body: low } } })); const r1 = await openReader(e1);
    expect(readPage1(e1, r1, ['read', 'read', 'read', 'skipped', 'read'])).not.toContain('rfhear');
    const e2 = withMoment(env({ replies: { book: RFB() } })); const r2 = await openReader(e2);
    expect(readPage1(e2, r2, ['read', 'read', 'read', 'read', 'read'])).not.toContain('rfhear');   // "Listen again" already plays the page
    const e3 = withMoment(env()); const r3 = await openReader(e3);
    expect(readPage1(e3, r3, ['read', 'read', 'read', 'skipped', 'read'])).not.toContain('rfhear');   // key off
  });
  test.each(['en', 'ur'])('%s, read_fb: a page read short of 3 stars offers "read it again for 3 stars"; a tap starts Your turn again', async (lang) => {
    const e = withMoment(env({ replies: { book: RFB({ lang, dir: lang === 'ur' ? 'rtl' : 'ltr' }) } })); const root = await openReader(e, { lang });
    const h = readPage1(e, root, ['read', 'skipped', 'read', 'skipped', 'read']);
    expect(h).toContain('data-tap="rfagain"');
    expect(h).toContain(lang === 'ur' ? 'تین ستاروں کے لیے پھر سے پڑھیں!' : 'Read it again for 3 stars!');
    fire(root, 'rfagain');
    expect(screenOf(root.innerHTML)).toBe('story-mic');
  });
  test('read_fb: 3 stars, or nothing read: no "read it again" (the kind card already leads)', async () => {
    const e = withMoment(env({ replies: { book: RFB() } })); const root = await openReader(e);
    expect(readPage1(e, root, ['read', 'read', 'read', 'read', 'read'])).not.toContain('rfagain');
    const e2 = withMoment(env({ replies: { book: RFB() } })); const r2 = await openReader(e2);
    expect(readPage1(e2, r2, ['skipped', 'skipped', 'skipped', 'skipped', 'skipped'])).not.toContain('rfagain');
  });
  test.each([['read', 'read', 'read', 'read', 'read'], ['read', 'skipped', 'read', 'skipped', 'read'], ['skipped', 'skipped', 'skipped', 'skipped', 'skipped']])('read_fb: Jugnu stays on the page\'s result and reacts (%s…): cheering 3 stars, happy for fewer, hello after a 0-word try', async (...marks) => {
    const e = withMoment(env({ replies: { book: RFB() } })); const root = await openReader(e);
    const h = readPage1(e, root, marks);
    const mo = /<section class="wq-moment[\s\S]*?<\/section>/.exec(h)[0];
    const n = marks.filter((x) => x === 'read').length;
    expect(mo).toContain(`/wq/jugnu/${n === 5 ? 'celebrate' : n ? 'correct' : 'hello'}.webp`);
    expect(mo).toContain('wq-moment-jg');
    const e0 = withMoment(env()); const r0 = await openReader(e0);
    expect(readPage1(e0, r0, marks)).not.toContain('wq-moment-jg');   // key off: today's page
  });
  test.each(['en', 'ur'])('%s, read_fb, nothing read: one "read it together" line, and the chip says the action', async (lang) => {
    const e = withMoment(env({ replies: { book: RFB({ lang, dir: lang === 'ur' ? 'rtl' : 'ltr' }) } })); const root = await openReader(e, { lang });
    const h = readPage1(e, root, ['skipped', 'skipped', 'skipped', 'skipped', 'skipped']);
    expect(text(h).match(lang === 'ur' ? /مل کر پڑھیں/g : /read it together/gi)).toHaveLength(1);
    expect(h).toMatch(new RegExp(`data-tap="echo"[^>]*>${lang === 'ur' ? 'جگنو کے ساتھ پڑھیں' : 'Read with Jugnu'}<`));
  });
  test.each(['en', 'ur'])('%s, read_fb, nothing read on a G3+ book: the card still offers "Read with Jugnu" (never only Listen)', async (lang) => {
    const e = withMoment(env({ replies: { book: RFB({ grade: 4, lang, dir: lang === 'ur' ? 'rtl' : 'ltr' }) } })); const root = await openReader(e, { lang });
    const h = readPage1(e, root, ['skipped', 'skipped', 'skipped', 'skipped', 'skipped']);
    expect(h).toMatch(new RegExp(`data-tap="echo"[^>]*>${lang === 'ur' ? 'جگنو کے ساتھ پڑھیں' : 'Read with Jugnu'}<`));
    // a word read on the same G3+ book: no echo offer (today's G1-2 rule for a partial read)
    const r = withMoment(env({ replies: { book: RFB({ grade: 4 }) } })); const rr = await openReader(r);
    expect(readPage1(r, rr, ['read', 'skipped', 'skipped', 'skipped', 'skipped'])).not.toContain('data-tap="echo"');
  });
  test.each(['en', 'ur'])('%s, read_fb, nothing read and no voice to read with: "Read it again" opens Your turn again', async (lang) => {
    // the reading key never came (no Read with Jugnu possible)
    const e = withMoment(env({ replies: { book: RFB({ grade: 4, lang, dir: lang === 'ur' ? 'rtl' : 'ltr' }), key: { status: 404, body: { error: 'not_found' } } } })); const root = await openReader(e, { lang });
    toMic(e, root); e.calls.ask[0].onStream({}); await e.calls.lr[0].o.getKey();
    e.calls.lr[0].o.onResult(READ(['skipped', 'skipped', 'skipped', 'skipped', 'skipped']));
    const h = root.innerHTML;
    expect(h).not.toContain('data-tap="echo"');
    expect(h).toMatch(new RegExp(`data-tap="rfagain"[^>]*>${lang === 'ur' ? 'پھر سے پڑھیں' : 'Read it again'}<`));
    fire(root, 'rfagain');
    expect(screenOf(root.innerHTML)).toBe('story-mic');
  });
  test('key off, nothing read: today\'s line and chip, as they are', async () => {
    const e = withMoment(env()); const root = await openReader(e);
    const h = readPage1(e, root, ['skipped', 'skipped', 'skipped', 'skipped', 'skipped']);
    expect(h).toMatch(/data-tap="echo"[^>]*>Read it together</);
  });
  test.each(['en', 'ur'])('%s, read_fb, silence while reading: at 6 s Jugnu leans in ("come a little closer"), at 15 s the offer to read with Jugnu; a word heard takes it away', async (lang) => {
    const e = withMoment(env({ replies: { book: RFB({ lang, dir: lang === 'ur' ? 'rtl' : 'ltr' }) } })); const root = await openReader(e, { lang });
    toMic(e, root); e.calls.ask[0].onStream({});
    expect(screenOf(root.innerHTML)).toBe('story-read');
    const lr = e.calls.lr[0]; let heard = 0;
    lr.view = () => ({ heard, total: 5 });
    const near = () => root.querySelector('[data-near]');
    expect(near()).not.toBeNull();
    e.advance(5000);
    expect(near().hidden).toBe(true);
    e.advance(1500);
    expect(near().hidden).toBe(false);
    expect(near().innerHTML.replace(/&#39;/g, "'")).toContain(lang === 'ur' ? 'مجھے ابھی آپ کی آواز نہیں آ رہی۔ تھوڑا قریب آئیں!' : "I can't hear you yet. Come a little closer!");
    expect(near().innerHTML).not.toContain('rfwith');
    expect(root.querySelector('[data-jg]').className).toContain('wq-moment-lean');
    e.advance(9000);
    expect(near().innerHTML).toMatch(new RegExp(`data-tap="rfwith"[^>]*>${lang === 'ur' ? 'جگنو کے ساتھ پڑھیں' : 'Read with Jugnu'}<`));
    heard = 1; e.advance(500);
    expect(near().hidden).toBe(true);
    expect(root.querySelector('[data-jg]').className).not.toContain('wq-moment-lean');
  });
  test.each(['en', 'ur'])('%s, the live meter on: Jugnu rides the bar in his own place above the page (never a second, glowing Jugnu, never inside the zoomed picture); the bar keeps this book\'s state; the silence lean moves to it', async (lang) => {
    const e = withMoment(env({ replies: { book: RFB({ lang, dir: lang === 'ur' ? 'rtl' : 'ltr' }) } }));
    e.win.WQPace = { variant: 'sky', grade: '3' };
    const root = await openReader(e, { lang });
    toMic(e, root); e.calls.ask[0].onStream({});
    expect(screenOf(root.innerHTML)).toBe('story-read');
    const h = root.innerHTML;
    expect(h).not.toContain('data-jg');
    expect(h).not.toContain('/wq/jugnu/hello.webp');
    expect(h.indexOf('<div class="wqs-pace" data-pace></div>')).toBeGreaterThan(0);
    expect(h.indexOf('data-pace')).toBeLessThan(h.indexOf('data-stage'));   // above the page, outside its camera
    const lr = e.calls.lr[0];
    expect(lr.o.pace.el).toBe(root.querySelector('[data-pace]'));
    expect(lr.o.pace.keep).toEqual({});
    lr.view = () => ({ heard: 0, total: 5 });
    e.advance(6500);
    expect(root.querySelector('[data-pace]').className).toContain('wq-moment-lean');
  });
  test('the live meter off: Jugnu and his glow above the page, as today', async () => {
    const e = withMoment(env({ replies: { book: RFB() } })); const root = await openReader(e);
    toMic(e, root); e.calls.ask[0].onStream({});
    expect(root.innerHTML).toContain('<img class="wqs-jg wqs-g0" src="/wq/jugnu/hello.webp" width="72" height="72" alt="" data-jg');
    expect(root.innerHTML).not.toContain('data-pace');
  });
  test('read_fb: "Read with Jugnu" ends the quiet read and Jugnu reads the page at once (one tap, never a dead end)', async () => {
    const e = withMoment(env({ replies: { book: RFB() } })); const root = await openReader(e);
    toMic(e, root); e.calls.ask[0].onStream({});
    const lr = e.calls.lr[0]; lr.view = () => ({ heard: 0, total: 5 });
    e.advance(16000);
    fire(root, 'rfwith');
    expect(lr.log).toContain('stop:done_tap');
    lr.o.onResult(READ(['ahead', 'ahead', 'ahead', 'ahead', 'ahead']));
    expect(screenOf(root.innerHTML)).toBe('story-page');
    expect(e.calls.ra[e.calls.ra.length - 1].log).toContain('play');
  });
  test('key off: the read screen has no nudge line and Jugnu never leans', async () => {
    const e = withMoment(env()); const root = await openReader(e);
    toMic(e, root); e.calls.ask[0].onStream({});
    e.calls.lr[0].view = () => ({ heard: 0, total: 5 });
    e.advance(16000);
    expect(root.innerHTML).not.toContain('data-near');
    expect(root.querySelector('[data-jg]').className).not.toContain('wq-moment-lean');
  });
  // "Hear Jugnu say it" plays one sentence on the page's own player: its 40 ms watch stops with the sentence, and
  // never outlives it (the reader gone, the player stopped, or the page's own Listen taking over)
  const hearTicks = (e) => { const set = e.clock.set; const n = { k: 0 }; e.clock.set = (f, ms) => { if (ms === 40) n.k += 1; return set(f, ms); }; return n; };
  const hearOn = async () => {
    const e = withMoment(env({ replies: { book: RFB() } })); const root = await openReader(e);
    readPage1(e, root, ['read', 'read', 'read', 'skipped', 'read']);
    const p = e.calls.ra[e.calls.ra.length - 1];
    const n = hearTicks(e);
    p.log.length = 0; p.audio.currentTime = 0.1;
    fire(root, 'rfhear');
    return { e, root, p, n };
  };
  test('read_fb: leaving the reader while Jugnu says the sentence stops its watch (no timer left behind)', async () => {
    const { e, root, n } = await hearOn();
    e.advance(200);
    fire(root, 'back');
    const k = n.k;
    e.advance(60000);
    expect(n.k - k).toBeLessThanOrEqual(1);
  });
  test('read_fb: "read it again" after Jugnu\'s sentence (the player stopped): the watch ends within a second', async () => {
    const { e, root, p, n } = await hearOn();
    e.advance(200);
    p.audio.paused = true;
    fire(root, 'rfagain');
    e.advance(10000);
    expect(n.k).toBeLessThan(40);
    expect(p.log.filter((x) => x === 'pause')).toHaveLength(0);
  });
  test('read_fb: the page\'s own Listen after Jugnu\'s sentence (the take starts again from earlier) is never cut at that sentence\'s end', async () => {
    const { e, p } = await hearOn();
    p.audio.currentTime = 1.2; e.advance(40);
    p.audio.currentTime = 0; e.advance(40);   // Listen: back to the page's start
    p.audio.currentTime = 2.6; e.advance(40);
    expect(p.log).toEqual(['seek:0', 'play']);
  });
  test('read_fb: the page\'s moment plays its motion once; a redraw of the same read lays it in still, a new read moves again', async () => {
    const e = withMoment(env({ replies: { book: RFB() } })); await openReader(e);
    const M = e.win.WQMoment, R = { P: book({ read_fb: 1 }).pages, L: 'en', b: { grade: 2 }, C: e.clock }, m = { i: 0 };
    const rd = { s: { words_read: 4, words_total: 5, ms: 3000, marks: ['read', 'read', 'read', 'skipped', 'read'] }, i: 0 };
    const x = { rd, st: 'read', sents: () => [] };
    expect(M.q('page', R, m, x)).not.toContain('wq-moment--still');
    expect(M.q('page', R, m, x)).toContain('wq-moment--still');
    expect(M.q('page', R, m, { ...x, rd: { s: { ...rd.s }, i: 0 } })).not.toContain('wq-moment--still');
  });
  test('read_fb: a read of one page never answers another page (back on page 1 after reading page 2: page 1\'s own words)', async () => {
    const e = withMoment(env({ replies: { book: RFB({ questions: [] }) } })); const root = await openReader(e);
    readPage1(e, root, ['read', 'read', 'read', 'read', 'read']);
    fire(root, 'main'); fire(root, 'next');
    fire(root, 'main'); fire(root, 'mic'); e.calls.ask[1].onStream({});
    e.calls.lr[1].o.onResult(READ(['read', 'skipped', 'skipped', 'skipped']));
    expect(root.innerHTML).toContain('You read 1 word!');
    fire(root, 'prev');
    expect(root.innerHTML).not.toContain('You read 1 word!');
  });
  test('read_fb, a book only listened to, even with a reading in the answer: no moment (nothing was read aloud on this phone)', async () => {
    const done = { status: 200, body: { ok: true, sticker: true, reading: { words_read: 48, words_total: 50, ms: 40000, wcpm: 72, prev_wcpm: 60 } } };
    const e = withMoment(env({ replies: { book: RFB({ questions: [] }), done } })); const root = await openReader(e);
    fire(root, 'main'); e.calls.ra[e.calls.ra.length - 1].o.onEnd(); fire(root, 'close'); fire(root, 'next');
    fire(root, 'main'); e.calls.ra[e.calls.ra.length - 1].o.onEnd(); fire(root, 'close'); fire(root, 'main');
    await flush(); await flush(); await flush();
    expect(screenOf(root.innerHTML)).toBe('story-done');
    expect(root.innerHTML).not.toContain('data-rf');
  });
  test('read_fb, the book\'s end with no finish card: ONE sound (the finish fanfare), never the badge jingle on top of it', async () => {
    const done = { status: 200, body: { ok: true, sticker: true, reading: { words_read: 48, words_total: 50, ms: 40000, wcpm: 72, prev_wcpm: 60 } } };
    const e = withMoment(env({ replies: { book: RFB({ questions: [] }), done }, wqj: true })); const root = await openReader(e);
    e.win.WQJ.badge = () => e.calls.juice.push('badge'); e.win.WQJ.sentence = () => e.calls.juice.push('sentence');
    // runBook's steps, the last tap apart: each page's own result had its one jingle; the book's end is counted alone
    toMic(e, root); fire(root, 'mic'); e.calls.ask[0].onStream({});
    e.calls.lr[0].o.onResult(READ(['read', 'read', 'skipped', 'read', 'read']));
    fire(root, 'main'); fire(root, 'next');
    fire(root, 'main'); fire(root, 'mic'); e.calls.ask[1].onStream({});
    e.calls.lr[1].o.onResult(READ(['read', 'read', 'read', 'read']));
    e.calls.juice.length = 0;
    fire(root, 'main'); await flush(); await flush(); await flush();
    expect(screenOf(root.innerHTML)).toBe('story-done');
    expect(root.innerHTML).toContain('data-rf');
    expect(e.calls.juice.filter((x) => /^(finish|badge|sentence)/.test(x))).toEqual(['finish:3']);
  });
  test.each(['en', 'ur'])('%s, read_fb: beside the finish card the book\'s read is the compact strip (the card\'s Next stays on the first screen); a card that refuses: the full moment', async (lang) => {
    const done = { status: 200, body: { ok: true, sticker: true, reading: { words_read: 48, words_total: 50, ms: 40000, wcpm: 72, prev_wcpm: 60 } } };
    for (const [ok, small] of [[true, true], [false, false]]) {
      const e = withMoment(env({ replies: { book: RFB({ lang, dir: lang === 'ur' ? 'rtl' : 'ltr', questions: [], card_v3: true }), done }, onLoad: (w) => { w.WQFC = { mount: () => ok }; } }));
      const root = await openReader(e, { lang });
      runBook(e, root); await flush(); await flush(); await flush();
      const h = root.innerHTML;
      expect([ok, /<section class="wq-moment[^"]*"/.exec(h)[0].includes('wq-moment--s')]).toEqual([ok, small]);
      expect(h).toContain(lang === 'ur' ? 'ایک منٹ میں ۷۲ لفظ' : '72 words a minute');
    }
  });
  test('read_fb, a page\'s result: the picture keeps its size (never under 300 px tall), one card, and only the next step under it', () => {
    const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'wq-moment.css'), 'utf8');
    // the picture gives up a little height for the card, never collapses (it fell to ~170 px wide on a 360 phone)
    expect(css).toContain('.wqs:has(.wqs-extra .wq-moment--s) .wqs-stage{flex:1 1 0;height:auto;max-height:62vh;min-height:300px}');
    expect(css).not.toMatch(/min-height:160px/);
    // while the result is there: no Whole page, no Slower, no Listen again (the sentence plays from the page's own taps)
    expect(css).toContain('.wqs:has(.wqs-extra > .wq-moment) .wqs-whole,.wqs:has(.wqs-extra > .wq-moment) .wqs-slow,.wqs:has(.wqs-extra > .wq-moment) .wqs-extra > .wqs-again{display:none}');
    // one soft offer to read again: Read with Jugnu takes the place of "for 3 stars"
    expect(css).toContain('.wqs-extra:has(> .wq-moment):has(> [data-tap="echo"]) > [data-tap="rfagain"]{display:none}');
    // the badge: one line beside the stars, 15 px (Urdu 17 px)
    expect(css).toContain('.wqs .wq-moment--s{display:grid;grid-template-columns:auto 1fr auto;grid-template-areas:"jg deed deed" "jg meter meter" "jg stars badge" "jg growth growth";');
    expect(css).toContain('.wqs .wq-moment--s>.wq-moment-badge{grid-area:badge;flex-direction:row;gap:6px;padding:2px 10px 2px 4px;font-size:15px;line-height:1.4;white-space:nowrap}');
    expect(css).toContain('.wqs .wq-moment--s[lang="ur"]>.wq-moment-badge{padding:0 4px 0 10px;font-size:17px;line-height:1.7}');
    expect(css).not.toMatch(/font-size:11px/);
    // when the main button already says Next, the › arrow beside it steps aside (its place kept, so Next stays centred)
    expect(css).toContain('.wqs:has(.wqs-extra > .wq-moment) .wqs-ctl:has(> .wqs-next) > [data-tap="next"]{visibility:hidden}');
  });
  test('read_fb, the read screen: room for the quiet-read nudge (2 Urdu lines) and Read with Jugnu above the done button, kept from the first frame', () => {
    const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'wq-moment.css'), 'utf8');
    // the screen is the phone's height and the picture gives up what the nudge needs (never under 200 px)
    expect(css).toContain('.wqs:has(> .wqs-near){height:100vh;height:100svh;min-height:0}');
    expect(css).toContain('.wqs:has(> .wqs-near) .wqs-stage{flex:1 1 0;height:auto;max-height:62vh;min-height:200px}');
    // the line's place is kept while it is hidden, so nothing moves mid-read: the words, then the pill under them
    expect(css).toContain('.wqs .wqs-near[hidden]{display:block!important;visibility:hidden}');   // over the reader's own [hidden] rule
    expect(css).toContain('.wqs-near{flex:none;margin:0 8px;min-height:calc(3em + 52px);text-align:center;font-weight:700;line-height:1.5;color:var(--ink,#1F2937)}');
    expect(css).toContain('.wqs[lang=ur] .wqs-near{min-height:calc(4em + 60px);line-height:2}');
    expect(css).toContain('.wqs-near>span{display:block;text-wrap:balance}');
  });
  test('read_fb, the first screen: the strip is one grid row-set, and only while a page\'s strip is there does the picture give up height (capped at today\'s 62vh)', () => {
    const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'wq-moment.css'), 'utf8');
    expect(css).toMatch(/\.wqs \.wq-moment--s\{display:grid;grid-template-columns:auto 1fr auto;/);
    // the Urdu "read it again" chip on a small phone: its label fits its box (scrollHeight 41 > 40 before; measured 40 = 40)
    expect(css).toContain('.wq-moment[lang="ur"] .wq-moment-again .wq-btn{padding:4px 6px;font-size:15px;line-height:1.6}');
    expect(css).toMatch(/\.wqs:has\(\.wqs-extra \.wq-moment--s\)\{height:100vh;height:100svh;min-height:0\}/);
    expect(css).toMatch(/\.wqs:has\(\.wqs-extra \.wq-moment--s\) \.wqs-stage\{flex:1 1 0;height:auto;max-height:62vh;min-height:300px\}/);
    // every rule that reaches the reader's own boxes is scoped to a moment being there (key off: never matched)
    const outside = css.replace(/\/\*[\s\S]*?\*\//g, '').split('}').map((r) => r.split('{')[0].trim()).filter((sel) => /\.wqs\b|\.wqs-stage/.test(sel) && !/wq-moment/.test(sel) && !/wqs-near/.test(sel) && !/wqs-art|data-art/.test(sel));   // (.wqs-art / [data-art]: the moment's own picture box, drawn only with it on)
    expect(outside).toEqual([]);
  });
  test('read_fb, the end of a book only listened to (no reading back): today\'s done screen', async () => {
    const done = { status: 200, body: { ok: true, sticker: true } };
    const e = withMoment(env({ replies: { book: RFB({ questions: [] }), done } })); const root = await openReader(e);
    runBook(e, root); await flush(); await flush(); await flush();
    expect(screenOf(root.innerHTML)).toBe('story-done');
    expect(root.innerHTML).not.toContain('data-rf');
  });
});

// ---- Your turn LIVE (the meter on, 3–25 s into a read): only the lines being read, and the picture whole or not at all ----
describe('Your turn live: the crop holds only the lines being read, the picture whole or left out', () => {
  const MSRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'wq-moment.js'), 'utf8');
  const withMoment = (e) => { vm.runInContext(MSRC, vm.createContext({ window: e.win, document: {} })); return e; };
  const yourTurn = (e, root) => { toMic(e, root); e.calls.ask[0].onStream({}); return root.querySelector('[data-cam]'); };
  const inset = (c) => { const m = /^inset\(([\d.]+)px 0 ([\d.]+)px 0\)$/.exec(c); return m ? [+m[1], +m[2]] : null; };
  // three printed lines close together (Nastaliq-tall, 5 px apart), the picture under them; the first two being read
  const im = { w: 720, h: 1080 }, L1 = [110, 300, 500, 70], L2 = [110, 375, 500, 70], L3 = [110, 450, 500, 70];
  test('the sheet is clipped to the lines being read: no band of the next printed line, nor of the one before', () => {
    const win = {}; vm.runInContext(MSRC, vm.createContext({ window: win, document: {} }));
    const cam = env().S._cam, a = fakeEl('art'); a.querySelector = () => null;
    const f = win.WQMoment.art(a, cam, im, [L1, L2, L3], [L1, L2], [360, 600], false, 0);
    const [t, b] = inset(f.clip);
    expect(im.h - b).toBeLessThanOrEqual(L3[1]);           // stops above line 3's glyphs
    expect(im.h - b).toBeGreaterThanOrEqual(L2[1] + L2[3]); // and line 2 whole
    const g = win.WQMoment.art(fakeEl('art'), cam, im, [L1, L2, L3], [L2, L3], [360, 600], false, 0);
    expect(inset(g.clip)[0]).toBeGreaterThanOrEqual(L1[1] + L1[3]);   // reading lines 2–3: nothing of line 1
  });
  test('the picture starts below the whole printed block and sits flush on the lines; whole, or left out under 96 px', () => {
    const win = {}; vm.runInContext(MSRC, vm.createContext({ window: win, document: {} }));
    const cam = env().S._cam;
    const pic = () => { const a = fakeEl('art'), i = fakeEl('i'), m = fakeEl('img'); a.querySelector = () => i; i.querySelector = () => m; a.i = i; a.m = m; return a; };
    const a = pic();
    win.WQMoment.art(a, cam, im, [L1, L2, L3], [L1, L2], [360, 600], false, 0);
    const z = parseFloat(a.m.style.width) / im.w, cy = -parseFloat(/translateY\(([-\d.]+)px\)/.exec(a.m.style.transform)[1]) / z;
    expect(cy).toBeGreaterThanOrEqual(L3[1] + L3[3] - 0.5);                         // no printed glyph inside the picture
    expect(parseFloat(a.i.style.height)).toBeLessThanOrEqual(parseFloat(a.style.height));   // whole inside its box
    expect(a.style.alignItems).toBe('flex-start');                                  // flush under the lines (no gap)
    expect(a.getAttribute('data-art')).toBe('on');
    // the last lines read: the picture carries on exactly where the clipped sheet stops (one piece)
    const b = pic(), f = win.WQMoment.art(b, cam, im, [L1, L2, L3], [L2, L3], [360, 600], false, 0);
    const zb = parseFloat(b.m.style.width) / im.w, cb = -parseFloat(/translateY\(([-\d.]+)px\)/.exec(b.m.style.transform)[1]) / zb;
    expect(Math.abs(cb - (im.h - inset(f.clip)[1]))).toBeLessThan(0.6);
    // a picture that would be 72–95 px tall: left out, never a stamp-sized piece
    const c = pic(); win.WQMoment.art(c, cam, im, [L1, L2, L3], [L1, L2, L3], [360, 270], false, 0);
    const zc = parseFloat(c.m.style.width) / im.w;
    expect(zc * (im.h - (L3[1] + L3[3]))).toBeGreaterThanOrEqual(72); expect(zc * (im.h - (L3[1] + L3[3]))).toBeLessThan(96);
    expect(c.getAttribute('data-art')).toBe('off');
  });
  test('a page with the opening words placeholder (steady): the placeholder goes once the page is clipped, so its words never show under the lines', async () => {
    const e = withMoment(env({ replies: { book: { status: 200, body: book({ read_fb: 1, steady: 1 }) } } })); const root = await openReader(e);
    expect(root.innerHTML).toContain('data-ph');
    yourTurn(e, root);
    expect(root.querySelector('[data-cam]').style.clipPath).toMatch(/^inset\(/);
    expect(root.querySelector('[data-ph]').style.display).toBe('none');
    // the picture still loading: "Opening…" stays until it is in, then goes
    const e2 = withMoment(env({ replies: { book: { status: 200, body: book({ read_fb: 1, steady: 1 }) } } })); const r2 = await openReader(e2);
    toMic(e2, r2);
    const pic = fakeEl('img'); pic.complete = false;
    const q0 = r2.querySelector.bind(r2);
    r2.querySelector = (sel) => { const x = q0(sel); if (x && sel === '[data-art]') x.querySelector = (s2) => (s2 === 'img' ? pic : null); return x; };
    e2.calls.ask[0].onStream({});
    expect(r2.querySelector('[data-ph]').style.display).not.toBe('none');
    pic.L.load.forEach((f) => f());
    expect(r2.querySelector('[data-ph]').style.display).toBe('none');
  });
  test('the stage changes size after it is framed (the meter comes in, the stage grows into the room): framed again to the new size', async () => {
    const ros = [];
    const e = withMoment(env({ replies: { book: { status: 200, body: book({ read_fb: 1 }) } } }));
    e.win.ResizeObserver = function (f) { const o = { f, els: [], observe(el) { o.els.push(el); }, disconnect() { o.off = 1; } }; ros.push(o); return o; };
    const root = await openReader(e);
    const cam = yourTurn(e, root), before = [cam.style.transform, root.querySelector('[data-art]').style.height];
    const st = root.querySelector('[data-stage]'), ro = ros.filter((o) => !o.off && o.els.includes(st))[0];
    expect(ro).toBeTruthy();
    st.clientHeight = 300; ro.f();
    expect([cam.style.transform, root.querySelector('[data-art]').style.height]).not.toEqual(before);
    expect(parseFloat(root.querySelector('[data-art]').style.top) + parseFloat(root.querySelector('[data-art]').style.height)).toBeLessThanOrEqual(300);
  });
  test('Your turn with the picture box: the stage takes the room down to the primary (no empty band above it)', () => {
    const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'wq-moment.css'), 'utf8');
    expect(css).toMatch(/\.wqs\[data-screen=story-read\]:has\(\[data-art\]\)\{height:100vh;height:100svh;min-height:0\}/);
    expect(css).toMatch(/\.wqs\[data-screen=story-read\]:has\(\[data-art\]\) \.wqs-stage\{flex:1 1 0;height:auto;max-height:none;min-height:200px\}/);
    // the nudge's room (kept so its two lines never hide under the primary) is given to the page while the nudge is hidden
    expect(css).toMatch(/\.wqs\[data-screen=story-read\]:has\(\[data-art\]\) \.wqs-near\[hidden\]\{display:none!important\}/);
  });
});

// ---- the words framed big never leave a cut sliver of the picture (the reading moment on) ---------------------------
// ---- one sheet (web_quiz_read_sheet: the book's read_sheet): «رانی کی مُرغی» p1, its printed lines on a sky band over the
// picture. The band and the picture are one sheet (one width, one scale, the picture carrying on where the band stops),
// and the card ends at the picture. #3131's rules hold: only the lines being read, the picture whole or left out.
describe('Your turn, one sheet: the sky band and the picture are one piece, the card ends at the picture', () => {
  const MSRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'wq-moment.js'), 'utf8');
  const moment = () => { const win = {}; vm.runInContext(MSRC, vm.createContext({ window: win, document: {} })); return win.WQMoment; };
  const withMoment = (e) => { vm.runInContext(MSRC, vm.createContext({ window: e.win, document: {} })); return e; };
  const yourTurn = (e, root) => { toMic(e, root); e.calls.ask[0].onStream({}); return root.querySelector('[data-cam]'); };
  const clipOf = (c) => { const m = /^inset\(([\d.]+)px 0 ([\d.]+)px 0(?: round [^)]*)?\)$/.exec(c); return m ? [+m[1], +m[2]] : null; };
  // the page as the reader has it (720 x 1019; three printed lines on the sky, the hen and her bowl under them)
  const im = { w: 720, h: 1019 }, L1 = [163, 79, 386, 84], L2 = [167, 189, 363, 89], L3 = [99, 300, 517, 93], ALL = [L1, L2, L3];
  const Y1 = L3[1] + L3[3];
  const pic = () => { const a = fakeEl('art'), i = fakeEl('i'), m = fakeEl('img'); a.querySelector = () => i; i.querySelector = () => m; a.i = i; a.m = m; return a; };
  // the stage at Your turn: Urdu 360 x 740 and 390 x 844 (the reader's own sizes there)
  const STAGES = [['ur 360x740', [328, 470]], ['ur 390x844', [358, 574]]];
  const draw = (d, bs, one) => { const a = pic(); const f = moment().art(a, env().S._cam, im, ALL, bs, d, true, 0, one); return { a, f }; };
  const shape = ({ a, f }, d) => {
    const z = parseFloat(a.m.style.width) / im.w, pw = parseFloat(a.i.style.width), ph = parseFloat(a.i.style.height);
    const cy = -parseFloat(/translateY\(([-\d.]+)px\)/.exec(a.m.style.transform)[1]) / z;
    const [c0, cb] = clipOf(f.clip), c1 = im.h - cb;
    return { z, pw, ph, cy, c0, c1, band: [Math.max(0, f.tx), Math.min(d[0], f.tx + im.w * f.s)], pic: [(d[0] - pw) / 2, (d[0] + pw) / 2], box: parseFloat(a.style.height) };
  };
  test.each(STAGES)('%s, the whole page being read: the picture at the band\'s width and scale, carrying on where the band stops; the card ends at it', (tag, d) => {
    const g = draw(d, ALL, true), x = shape(g, d);
    expect(g.a.getAttribute('data-art')).toBe('on');
    expect(Math.abs(x.pw - (x.band[1] - x.band[0]))).toBeLessThanOrEqual(1);          // one width
    expect(Math.abs(x.pic[0] - x.band[0])).toBeLessThanOrEqual(1);                      // one left edge (no white corner)
    expect(Math.abs(x.z - g.f.s)).toBeLessThan(0.002);                                  // one scale: the cloud is never sliced
    expect(x.c1 - x.cy).toBeGreaterThanOrEqual(0); expect(x.c1 - x.cy).toBeLessThan(2.5 / g.f.s); // the picture carries on where the band stops (the band 2 px under its edge: no hairline)
    expect(x.box).toBeLessThanOrEqual(x.ph + 0.5);                                      // the box ends at the picture: no strip under it
    expect(L1[3] * g.f.s).toBeGreaterThanOrEqual(25.5);                                 // the lines still read at that size
    expect(g.f.one).toBe(true);
  });
  test.each(STAGES)('%s, #3131 kept: only the lines being read show; the picture below every printed line, whole', (tag, d) => {
    const g = draw(d, [L1], true), x = shape(g, d);
    expect(Math.min(x.c1, (parseFloat(g.a.style.top) - g.f.ty) / g.f.s)).toBeLessThanOrEqual(L2[1] + 0.5); // nothing of the next line in view (the band's last 2 px lie under the picture)
    expect(x.cy).toBeGreaterThanOrEqual(Y1 - 0.5);                                      // no printed glyph inside the picture
    expect(x.ph).toBeLessThanOrEqual(x.box + 0.5);                                      // whole inside its box
    expect(Math.abs(x.pw - (x.band[1] - x.band[0]))).toBeLessThanOrEqual(1);
    expect(Math.abs(x.z - g.f.s)).toBeLessThan(0.002);
  });
  test('a stage too short for the picture at the band\'s width: the band and the picture shrink together (one width), or the picture is left out', () => {
    for (const d of [[328, 380], [328, 300], [328, 220]]) {
      const g = draw(d, ALL, true);
      if (g.a.getAttribute('data-art') !== 'on') continue;
      const x = shape(g, d);
      expect([d[1], Math.abs(x.pw - (x.band[1] - x.band[0])) <= 1, Math.abs(x.pic[0] - x.band[0]) <= 1]).toEqual([d[1], true, true]);
      expect(x.ph * 1).toBeGreaterThanOrEqual(96);
      expect(L1[3] * g.f.s).toBeGreaterThanOrEqual(25.5);   // shrunk together only while a drawn line keeps the reader's readable size (design-qa DQ80)
    }
  });
  test('without the switch: today\'s picture box, number for number', () => {
    for (const [, d] of STAGES) {
      const a = draw(d, ALL, undefined), b = draw(d, ALL, false);
      expect([a.f, a.a.style, a.a.i.style, a.a.m.style]).toEqual([b.f, b.a.style, b.a.i.style, b.a.m.style]);
      expect(a.f.one).toBeUndefined();
    }
  });
  test('the reader: the book\'s read_sheet marks the picture box as one sheet, so the stage drops its white card (no white card under the picture); without it, no mark', async () => {
    const e = withMoment(env({ replies: { book: { status: 200, body: book({ read_fb: 1, read_sheet: 1 }) } } })); const root = await openReader(e);
    yourTurn(e, root);
    expect(root.querySelector('[data-art]').getAttribute('data-one')).toBe('on');
    const e2 = withMoment(env({ replies: { book: { status: 200, body: book({ read_fb: 1 }) } } })); const r2 = await openReader(e2);
    yourTurn(e2, r2);
    expect(r2.querySelector('[data-art]').getAttribute('data-one')).toBeNull();
    const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'wq-moment.css'), 'utf8');
    expect(css).toContain('.wqs-stage:has(> [data-art][data-one=on]:not([hidden])){background:transparent;box-shadow:none;max-height:var(--wqs-cap,none);min-height:var(--wqs-min,200px)}');
  });
});

// ---- one sheet, reading and Jugnu's hint, two books (design-qa DQ80): «رانی کی مُرغی» p1 (three lines on the sky over the
// hen) and «آج کی تازہ خبر» p1 (two lines over a tall newspaper). The sheet keeps its reading size when the hint shows (the
// hint is a bubble over its foot, out of the page's flow); a drawn line is never under the reader's readable size (the
// picture goes first); nothing empty above «پورا صفحہ»; band and picture one width; no hairline at the join.
describe('Your turn, one sheet: two books x three phones, reading and hint', () => {
  const MSRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'wq-moment.js'), 'utf8');
  const moment = () => { const win = {}; vm.runInContext(MSRC, vm.createContext({ window: win, document: {} })); return win.WQMoment; };
  const withMoment = (e) => { vm.runInContext(MSRC, vm.createContext({ window: e.win, document: {} })); return e; };
  const clipOf = (c) => { const m = /^inset\(([\d.]+)px 0 ([\d.]+)px 0(?: round [^)]*)?\)$/.exec(c); return m ? [+m[1], +m[2]] : null; };
  const BOOKS = {
    murghi: { im: { w: 720, h: 1019 }, lines: [[163, 79, 386, 84], [167, 189, 363, 89], [99, 300, 517, 93]] },
    akhbar: { im: { w: 720, h: 1083 }, lines: [[109, 65, 494, 77], [271, 153, 167, 70]] },
  };
  // the reader's stage at Your turn (measured on the reader; the hint no longer takes room from it)
  const PHONES = { '390x844': [358, 574], '360x740': [328, 470], '360x640': [328, 370] };
  // the picture where it fits with every line at the reader's readable size (25.5 px drawn)
  const PIC = { murghi: { '390x844': 'on', '360x740': 'on', '360x640': 'on' }, akhbar: { '390x844': 'on', '360x740': 'on', '360x640': 'off' } };
  const CASES = [];
  Object.keys(BOOKS).forEach((bk) => Object.keys(PHONES).forEach((ph) => CASES.push([bk, ph])));
  const draw = (bk, d) => {
    const { im, lines } = BOOKS[bk];
    const a = fakeEl('art'), i = fakeEl('i'), m = fakeEl('img'), st = fakeEl('stage');
    a.querySelector = () => i; i.querySelector = () => m; a.parentNode = st; st.style.setProperty = (k, v) => { st.style[k] = v; };
    const f = moment().art(a, env().S._cam, im, lines, lines, d, true, 0, 1);
    return { a, i, m, st, f, im, lines };
  };
  test.each(CASES)('%s %s: every drawn line 25.5 px or more (never under 18); the picture there where it fits; band and picture one width', (bk, ph) => {
    const d = PHONES[ph], g = draw(bk, d);
    const box = Math.min(...g.lines.map((l) => l[3])) * g.f.s;               // the drawn line box, at the scale the page is drawn
    expect(box).toBeGreaterThanOrEqual(25.5);
    expect(g.a.getAttribute('data-art')).toBe(PIC[bk][ph]);
    if (PIC[bk][ph] === 'on') {
      const pw = parseFloat(g.i.style.width), band = [Math.max(0, g.f.tx), Math.min(d[0], g.f.tx + g.im.w * g.f.s)];
      expect(Math.abs(pw - (band[1] - band[0]))).toBeLessThanOrEqual(1);
      expect(Math.abs((d[0] - pw) / 2 - band[0])).toBeLessThanOrEqual(1);
    }
  });
  test.each(CASES)('%s %s: no gap over 24 px above «پورا صفحہ» (the stage ends at the sheet), and no hairline at the join', (bk, ph) => {
    const d = PHONES[ph], g = draw(bk, d);
    const [, cb] = clipOf(g.f.clip), bandBottom = (g.im.h - cb) * g.f.s + g.f.ty;
    const on = g.a.getAttribute('data-art') === 'on';
    const sheetBottom = on ? parseFloat(g.a.style.top) + parseFloat(g.i.style.height) : bandBottom;
    const cap = parseFloat(g.st.style['--wqs-cap']), stageBottom = cap >= 0 ? cap : d[1];
    expect(stageBottom - sheetBottom).toBeLessThanOrEqual(24);
    expect(sheetBottom).toBeLessThanOrEqual(stageBottom + 0.5);
    if (on) expect(bandBottom - parseFloat(g.a.style.top)).toBeGreaterThanOrEqual(1);
  });
  test.each(CASES)('%s %s: the stage held at the sheet stays held (drawn again in the capped room, the cap is kept, never let go and taken back)', (bk, ph) => {
    const d = PHONES[ph], g = draw(bk, d), cap = g.st.style['--wqs-cap'];
    if (cap === 'none') return;
    const { im, lines } = BOOKS[bk], a = fakeEl('art'), i = fakeEl('i'), m = fakeEl('img');
    a.querySelector = () => i; i.querySelector = () => m; a.parentNode = g.st;
    const f = moment().art(a, env().S._cam, im, lines, lines, [d[0], parseFloat(cap)], true, 0, 1);
    expect([g.st.style['--wqs-cap'], f.s, a.getAttribute('data-art')]).toEqual([cap, g.f.s, g.a.getAttribute('data-art')]);
    expect(parseFloat(g.st.style['--wqs-min'])).toBeLessThanOrEqual(parseFloat(cap));   // the stage's floor never holds it open past the cap
  });
  test('the reader: the hint never resizes the sheet; over the picture\'s foot when there is a picture, a line under the sheet when there is none', async () => {
    const e = withMoment(env({ replies: { book: { status: 200, body: book({ read_fb: 1, read_sheet: 1 }) } } })); const root = await openReader(e);
    toMic(e, root); e.calls.ask[0].onStream({});
    const cam = root.querySelector('[data-cam]'), art = root.querySelector('[data-art]'), st = root.querySelector('[data-stage]');
    const sheet = () => [cam.style.transform, cam.style.clipPath, art.style.top, art.style.height];
    const reading = sheet();
    e.calls.lr[0].view = () => ({ heard: 0, total: 5 });
    // no picture on this stage (the band alone, the stage held at it): the hint is a line under the sheet
    expect(art.getAttribute('data-art')).toBe('off');
    e.advance(6500);
    const near = root.querySelector('[data-near]');
    expect(near.hidden).toBe(false);
    expect((st.kids || []).includes(near)).toBe(false);
    expect(sheet()).toEqual(reading);
    // with its picture: the hint moves into the stage, a bubble over the picture's foot, out of the page's flow
    art.setAttribute('data-art', 'on');
    e.advance(1000);
    expect((st.kids || []).includes(near)).toBe(true);
    expect(sheet()).toEqual(reading);
    const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'wq-moment.css'), 'utf8');
    expect(css).toContain('.wqs .wqs-stage>.wqs-near{position:absolute;');
    expect(css).toContain('.wqs .wqs-stage>.wqs-near[hidden]{display:none!important}');
    expect(css).toContain('.wqs:has(.wqs-stage>[data-art][data-one=on]:not([hidden]))>[data-tap=main]{margin-top:auto}');
    // without the switch: the hint stays where it was, in the page's flow
    const e2 = withMoment(env({ replies: { book: { status: 200, body: book({ read_fb: 1 }) } } })); const r2 = await openReader(e2);
    toMic(e2, r2); e2.calls.ask[0].onStream({}); e2.calls.lr[0].view = () => ({ heard: 0, total: 5 }); r2.querySelector('[data-art]').setAttribute('data-art', 'on'); e2.advance(6500);
    expect((r2.querySelector('[data-stage]').kids || []).includes(r2.querySelector('[data-near]'))).toBe(false);
  });
});

describe('the framed words and the whole picture: Your turn, and an Urdu page at rest', () => {
  const MSRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'wq-moment.js'), 'utf8');
  const withMoment = (e) => { vm.runInContext(MSRC, vm.createContext({ window: e.win, document: {} })); return e; };
  const RFB = (over = {}) => ({ status: 200, body: book({ read_fb: 1, ...over }) });
  const yourTurn = (e, root) => { toMic(e, root); e.calls.ask[0].onStream({}); return root.querySelector('[data-cam]'); };
  test('Your turn: the lines framed in their half, the sheet clipped to them, the picture (above the words here) fitted whole over them', async () => {
    const e = withMoment(env({ replies: { book: RFB() } })); const root = await openReader(e);
    const cam = yourTurn(e, root);
    expect(root.innerHTML).toMatch(/<div class="wqs-art" data-art hidden><i><img src="\/s\/b-1\/p01\.webp" width="720" height="1080"/);
    // the same size of print as before (both lines across the stage), moved to the stage's foot under the picture
    expect(cam.style.transform).toBe('translate(-97.1px,-497.4px) scale(1.108)');
    expect(cam.style.clipPath).toBe('inset(793.8px 0 143.8px 0)');
    const a = root.querySelector('[data-art]');
    expect(a.hidden).toBe(false);
    expect([a.style.top, a.style.height, a.getAttribute('data-art')]).toEqual(['0px', '382.1px', 'on']);
    checkScreen(root.innerHTML, 'en');
  });
  test('the reading moment off, or its file not here yet: Your turn exactly as today (no clip, no picture box)', async () => {
    const off = env(); const r0 = await openReader(off);
    const c0 = yourTurn(off, r0);
    expect(r0.innerHTML).not.toContain('data-art');
    expect(c0.style.transform).toBe('translate(-97.1px,-580.7px) scale(1.108)');
    expect(c0.style.clipPath).toBeUndefined();
    const e = env({ replies: { book: RFB() } }); const root = await openReader(e);
    const cam = yourTurn(e, root);
    expect(cam.style.transform).toBe('translate(-97.1px,-580.7px) scale(1.108)');
    expect(cam.style.clipPath).toBe('');
    expect(root.querySelector('[data-art]').hidden).toBe(true);
  });
  test('Urdu page at rest: the words come up to Your turn\'s size with the picture whole beside them; Whole page shows the sheet; English at rest as today', async () => {
    const e = withMoment(env({ replies: { book: RFB({ lang: 'ur', dir: 'rtl' }) } })); const root = await openReader(e, { lang: 'ur' });
    const cam = root.querySelector('[data-cam]'), a = root.querySelector('[data-art]');
    expect(cam.style.transform).toBe('translate(-97.1px,-497.4px) scale(1.108)');
    expect(a.hidden).toBe(false);
    fire(root, 'cam');
    expect(cam.style.transform).toBe('translate(0px,0px) scale(0.5)');
    expect([cam.style.clipPath, a.hidden]).toEqual(['', true]);
    fire(root, 'cam');
    expect(cam.style.transform).toBe('translate(-97.1px,-497.4px) scale(1.108)');
    expect(a.hidden).toBe(false);
    const en = withMoment(env({ replies: { book: RFB() } })); const r2 = await openReader(en);
    expect(r2.innerHTML).not.toContain('data-art');
    expect(r2.querySelector('[data-cam]').style.transform).toBe('translate(0px,0px) scale(0.5)');
  });
  test('Read it together: Jugnu\'s line framed big keeps the picture whole too', async () => {
    const bk = book({ read_fb: 1 }); bk.pages[0].words = [W(0, 'Mina', 100, [110, 810, 40, 50]), W(1, 'runs.', 600, [160, 810, 50, 50]), W(2, 'The', 1100, [220, 810, 30, 50]), W(3, 'kite', 1600, [230, 870, 40, 50]), W(4, 'flies!', 2100, [280, 870, 60, 50])];
    const e = withMoment(env({ replies: { book: { status: 200, body: bk } } })); const root = await openReader(e);
    toMic(e, root); e.calls.ask[0].onStream({ id: 'st' });
    e.calls.lr[0].o.onResult(READ(['read', 'ahead', 'ahead', 'ahead', 'ahead']));
    e.win.WQLiveRead.micAgain = () => Promise.resolve({ id: 'echo' });
    fire(root, 'echo'); await flush();
    expect(screenOf(root.innerHTML)).toBe('story-echo');
    expect(root.innerHTML).toContain('data-art hidden');
    expect(root.querySelector('[data-cam]').style.clipPath).toMatch(/^inset\(/);
    expect(root.querySelector('[data-art]').hidden).toBe(false);
  });
  test('the moment\'s file arriving after the Urdu page was drawn: the page is framed again with its picture box', async () => {
    const e = env({ replies: { book: RFB({ lang: 'ur', dir: 'rtl' }) } }); const root = await openReader(e, { lang: 'ur' });
    const cam = root.querySelector('[data-cam]');
    expect(cam.style.transform).toBe('translate(0px,0px) scale(0.5)');
    expect(root.querySelector('[data-art]').hidden).toBe(true);
    const sc = e.calls.loaded.filter((x) => x.tag === 'script' && /wq-moment\.js/.test(x.src))[0];
    withMoment(e); sc.onload();
    expect(cam.style.transform).toBe('translate(-97.1px,-497.4px) scale(1.108)');
    expect(root.querySelector('[data-art]').hidden).toBe(false);
  });
  test('pure: no change when the picture is already whole in view; no picture at all (never a piece) when too little room is left', () => {
    const win = {}; vm.runInContext(MSRC, vm.createContext({ window: win, document: {} }));
    const e = env(); const cam = e.S._cam;
    const el = () => { const a = fakeEl('art'); return a; };
    const im = { w: 720, h: 1080 }, all = [[110, 810, 280, 50], [230, 870, 160, 50]];
    // lines across the sheet on a stage tall enough for all of it: the picture is already whole, as before
    const wide = [[10, 810, 700, 50], [10, 870, 700, 50]];
    expect(win.WQMoment.art(el(), cam, im, wide, wide, [360, 2000], false, 0)).toBeNull();
    // the same lines framed big on a tall stage (the picture would run off both sides): fitted
    expect(win.WQMoment.art(el(), cam, im, all, all, [360, 2000], false, 0)).not.toBeNull();
    // a short stage: the room over the words is under the picture's floor, so the box stays empty
    const a = el(); const f = win.WQMoment.art(a, cam, im, all, all, [360, 150], false, 0);
    expect(f && f.clip).toMatch(/^inset\(/);
    expect(a.getAttribute('data-art')).toBe('off');
    // Your turn's print is never made smaller for the picture: three lines on a short stage keep the reader's own zoom
    const three = [[110, 640, 280, 70], [110, 730, 280, 70], [110, 820, 280, 70]];
    expect(win.WQMoment.art(el(), cam, im, three, three, [360, 208], false, 0).s).toBe(cam(three, 360, 208, 720, 1080, false, 3, 1).s);
    // words over most of the sheet: no picture side of its own, as before
    expect(win.WQMoment.art(el(), cam, im, [[10, 100, 700, 50], [10, 1000, 700, 50]], [[10, 100, 700, 50]], [360, 540], false, 0)).toBeNull();
    // at rest, words that would not come up by a quarter: the whole sheet stays
    expect(win.WQMoment.art(el(), cam, im, [[10, 900, 700, 60]], [[10, 900, 700, 60]], [360, 540], false, 1)).toBeNull();
  });
  test('the picture box: over the cut sheet, centred, its picture shown whole or not at all', () => {
    const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'wq-moment.css'), 'utf8');
    expect(css).toMatch(/\.wqs-art\{position:absolute;left:0;right:0;z-index:2;display:flex;align-items:center;justify-content:center;pointer-events:none\}/);
    expect(css).toMatch(/\.wqs-art\[data-art=off\] i\{display:none\}/);
    expect(css).toMatch(/\.wqs-art i\{display:block;overflow:hidden/);
  });
});

// The reader warmed from the shelf (web_quiz_story_warm: the shelf's answer says `warm: true` and each book its first
// page's picture `p1`). The shelf then loads wq-stories-w.js: 1.5 s on, the reader's files are fetched ahead at low
// priority at exactly the addresses the reader asks (so the first tap does not wait for three files one after another);
// a tap on a book asks for its first page's picture at once, and the files side by side if they are not fetched yet.
// No warm: no extra file, nothing ahead (today).
describe('the reader warmed from the shelf', () => {
  const RAV = require('crypto').createHash('sha256').update(fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'wq-readalong.js'))).digest('hex').slice(0, 10);
  const AHEAD = (rel) => [[rel, 'script', `/wq/wq-readalong.js?v=${RAV}`], [rel, 'script', '/wq/wq-read-live.js?v=abc123'],
    [rel, 'script', '/wq/wq-liveread.js?v=abc123'], [rel, 'style', '/wq/wq-liveread.css?v=abc123']];
  const links = (e) => e.calls.loaded.filter((x) => x.tag === 'link' && /prefetch|preload/.test(x.rel || '')).map((x) => [x.rel, x.as, x.href]);
  const wfile = (e) => e.calls.loaded.filter((x) => x.tag === 'script' && /wq-stories-w\.js/.test(x.src)).map((x) => x.src);
  const WARM = { ...SHELF, warm: true, books: SHELF.books.map((b) => ({ ...b, p1: `/s/${b.id}/p01.webp` })) };
  const shelfThen = async (e) => { const el = fakeEl('shelf'); e.S.shelf(el, e.ctx()); await flush(); return el; };
  // the child's finger on a book card: the page-level listeners see it first (pointerdown, then click)
  const touch = (e, id, kind = 'pointerdown') => (e.doc.L[kind] || []).forEach((f) => f({ target: { getAttribute: (k) => (k === 'data-tap' ? 'book' : k === 'data-id' ? id : null), parentNode: null } }));

  test('warm: the shelf loads its one small file once, at the reader\'s ?v=; 1.5 s on, the reader\'s four files are fetched ahead (prefetch), once each', async () => {
    const e = env({ replies: { shelf: { status: 200, body: WARM } } });
    await shelfThen(e);
    expect(wfile(e)).toEqual(['/wq/wq-stories-w.js?v=abc123']);
    expect(links(e)).toEqual([]);
    e.advance(1500);
    expect(links(e)).toEqual(AHEAD('prefetch'));
    await shelfThen(e); e.advance(5000);
    expect(wfile(e)).toHaveLength(2);   // the shelf drawn again asks for the file again (cached); it acts once
    expect(links(e)).toEqual(AHEAD('prefetch'));
  });
  test('no warm in the shelf answer: no extra file, nothing fetched ahead, and a book opens as today', async () => {
    const e = env();
    await shelfThen(e); e.advance(5000);
    await openReader(e);
    expect(wfile(e)).toEqual([]);
    expect(links(e)).toEqual([]);
    expect(e.calls.imgs.filter((u) => /p01/.test(u))).toEqual([]);   // (the reader's own next-page warm-up is today's)
  });
  test('Save-Data, or a 2G line: nothing fetched ahead; a tapped book\'s picture is still asked for (the page needs it anyway)', async () => {
    for (const connection of [{ saveData: true }, { effectiveType: '2g' }, { effectiveType: 'slow-2g' }]) {
      const e = env({ replies: { shelf: { status: 200, body: WARM } } });
      e.win.navigator = { connection };
      await shelfThen(e); e.advance(5000);
      touch(e, 'b-1');
      expect(links(e)).toEqual([]);
      expect(e.calls.imgs).toEqual(['/s/b-1/p01.webp']);
    }
  });
  test('warm, a tap before the 1.5 s: the tapped book\'s first page picture at once, and the four files side by side (preload); nothing twice', async () => {
    const e = env({ replies: { shelf: { status: 200, body: WARM } } });
    await shelfThen(e);
    touch(e, 'b-4');
    expect(e.calls.imgs).toEqual(['/s/b-4/p01.webp']);
    expect(links(e)).toEqual(AHEAD('preload'));
    touch(e, 'b-4', 'click'); e.advance(5000);
    expect(e.calls.imgs).toEqual(['/s/b-4/p01.webp']);
    expect(links(e)).toEqual(AHEAD('preload'));
  });
  test('a tap on something that is not a book card asks for nothing', async () => {
    const e = env({ replies: { shelf: { status: 200, body: WARM } } });
    await shelfThen(e);
    (e.doc.L.pointerdown || []).forEach((f) => f({ target: { getAttribute: () => 'g', parentNode: null } }));
    expect(e.calls.imgs).toEqual([]);
    expect(links(e)).toEqual([]);
  });
});

describe('the page at rest: the whole sheet (its art) plus a lens of its words at a readable size (small print was tiny; the book\'s tx, web_quiz_stories_text_lens)', () => {
  test('switch off (no tx): no lens on the page, the sheet as today', async () => {
    const bk = book(); bk.pages[0].lines = [{ i0: 0, i1: 2, box: [160, 200, 400, 40] }, { i0: 3, i1: 4, box: [160, 250, 300, 40] }];
    const e = env({ replies: { book: { status: 200, body: bk } } }); const root = await openReader(e);
    expect(root.innerHTML).not.toContain('wqs-tx');
  });
  const camOf = (root) => { const m = /translate\((-?[\d.]+)px,(-?[\d.]+)px\) scale\(([\d.]+)\)/.exec(root.querySelector('[data-cam]').style.transform); return { tx: Number(m[1]), ty: Number(m[2]), s: Number(m[3]) }; };
  const onScreen = (k, b) => b[0] * k.s + k.tx >= -0.5 && (b[0] + b[2]) * k.s + k.tx <= 360.5 && b[1] * k.s + k.ty >= -0.5 && (b[1] + b[3]) * k.s + k.ty <= 540.5;
  const WHOLE = 0.5;   // the 720×1080 page in the 360×540 stage
  const lens = (root) => root.querySelector('[data-tx]').className;
  // print in the top third only, as many storybook pages are laid out
  const topText = () => { const bk = book({ tx: 1 }); bk.pages[0].lines = [{ i0: 0, i1: 2, box: [160, 200, 400, 40] }, { i0: 3, i1: 4, box: [160, 250, 300, 40] }]; return bk; };
  for (const lang of ['en', 'ur']) {
    test(`${lang}: before Listen the whole sheet shows (the art) and the lens of the words is on, on the side the print sits; Whole page drops the lens, and back`, async () => {
      const bk = topText();
      const e = env({ replies: { book: { status: 200, body: { ...bk, lang, dir: lang === 'ur' ? 'rtl' : 'ltr' } } } }); const root = await openReader(e, { lang });
      expect(root.innerHTML).toMatch(/<div class="wqs-tx" data-tx><img src="\/s\/b-1\/p01\.webp" width="720" height="1080"/);
      expect(camOf(root).s).toBe(WHOLE);
      expect(lens(root)).toBe('wqs-tx on');
      fire(root, 'cam');
      expect(lens(root)).toBe('wqs-tx');
      fire(root, 'cam');
      expect(lens(root)).toBe('wqs-tx on');
    });
  }
  test('print low on the sheet: the lens sits at the bottom; print already big enough: no lens', async () => {
    const low = book({ tx: 1 }); low.pages[0].lines = [{ i0: 0, i1: 2, box: [160, 900, 400, 40] }, { i0: 3, i1: 4, box: [160, 950, 300, 40] }];
    let e = env({ replies: { book: { status: 200, body: low } } }); let root = await openReader(e);
    expect(lens(root)).toBe('wqs-tx on lo');
    const big = book({ tx: 1 }); big.pages[0].lines = [{ i0: 0, i1: 2, box: [20, 300, 680, 160] }, { i0: 3, i1: 4, box: [20, 480, 680, 160] }];
    e = env({ replies: { book: { status: 200, body: big } } }); root = await openReader(e);
    expect(lens(root)).toBe('wqs-tx');
  });
  test('Listen: the lens goes and the camera follows the line; when the page has been heard, back to the sheet + lens', async () => {
    const bk = topText();
    const e = env({ replies: { book: { status: 200, body: bk } } }); const root = await openReader(e);
    fire(root, 'main'); e.calls.ra[e.calls.ra.length - 1].o.onWord(0);
    expect(lens(root)).toBe('wqs-tx');
    expect(camOf(root).s).toBeGreaterThan(WHOLE);
    e.calls.ra[e.calls.ra.length - 1].o.onEnd();
    expect(camOf(root).s).toBe(WHOLE);
    expect(lens(root)).toBe('wqs-tx on');
  });
  test('a sliver word box (far narrower than it is tall: bad box data) never zooms the page to a line; the text band frames it instead', async () => {
    const bk = book({ tx: 1 }); bk.pages[0].words[1].box = [160, 700, 6, 300];
    const e = env({ replies: { book: { status: 200, body: bk } } }); const root = await openReader(e);
    fire(root, 'main'); e.calls.ra[e.calls.ra.length - 1].o.onWord(1);
    const k = camOf(root);
    const tb = bk.pages[0].text_band.box;
    expect(onScreen(k, tb)).toBe(true);
  });
});

describe('the reader polish setting (web_quiz_stories_polish: the book says pl)', () => {
  const page = (e, h0) => { const html = { lang: h0[0], dir: h0[1] }; e.win.document = { documentElement: html }; return html; };
  const leave = (e) => { e.win.location.hash = ''; e.S.route(e.ctx()); };
  test('on: while a book is open <html> carries its language and direction (screen readers, the Urdu face) and the reader says data-ring; leaving gives <html> back', async () => {
    for (const [lang, dir, h0] of [['ur', 'rtl', ['en', 'ltr']], ['en', 'ltr', ['ur', 'rtl']]]) {
      const e = env({ replies: { book: { status: 200, body: book({ lang, dir, pl: 1 }) } } });
      const html = page(e, h0);
      const root = await openReader(e, { lang: h0[0] });
      expect([lang, html.lang, html.dir, root.getAttribute('data-ring')]).toEqual([lang, lang, dir, '']);
      leave(e);
      expect([lang, html.lang, html.dir, root.getAttribute('data-ring')]).toEqual([lang, h0[0], h0[1], null]);
    }
  });
  test('off (no pl on the book): <html> untouched, no data-ring, and the page byte-identical to a book that says pl', async () => {
    for (const lang of ['en', 'ur']) {
      const dir = lang === 'ur' ? 'rtl' : 'ltr';
      const off = env({ replies: { book: { status: 200, body: book({ lang, dir }) } } });
      const html = page(off, ['en', 'ltr']);
      const ro = await openReader(off, { lang: 'en' });
      expect([html.lang, html.dir, ro.getAttribute('data-ring')]).toEqual(['en', 'ltr', null]);
      const on = env({ replies: { book: { status: 200, body: book({ lang, dir, pl: 1 }) } } });
      page(on, ['en', 'ltr']);
      const rn = await openReader(on, { lang: 'en' });
      expect(ro.innerHTML).toBe(rn.innerHTML);
    }
  });
  test('the word ring is drawn round the word, never on its letters, only under data-ring', () => {
    // the player's pill (its own style, keyed on the host's data-ring) and our own mark (lens / sweep) alike
    const ra = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'wq-readalong.js'), 'utf8');
    expect(ra).toMatch(/\[data-ring\] \.wqra-pill\{[^}]*box-shadow:none[^}]*outline:[^}]*outline-offset:[1-9]/);
    expect(fs.readFileSync(CSS, 'utf8')).toMatch(/\[data-ring\] \.wqs-mk\{[^}]*box-shadow:none[^}]*outline:[^}]*outline-offset:[1-9]/);
  });
});

describe('"Listen again" under the look: a drawn replay icon, never the ↻ glyph (the Urdu face draws it like «ج»)', () => {
  const again = async (adv, lang) => {
    const e = env({ replies: { book: { status: 200, body: book({ lang, dir: lang === 'ur' ? 'rtl' : 'ltr' }) } } });
    if (adv) e.doc.documentElement = { classList: { contains: (c) => c === 'wq-adv' } };
    const root = await openReader(e, { lang });
    fire(root, 'main'); e.calls.ra[0].o.onEnd();
    return /<button class="wqs-again" data-tap="again"[^>]*>(.*?)<\/button>/.exec(root.querySelector('[data-extra]').innerHTML)[1];
  };
  test.each(['en', 'ur'])('%s: look on, the chip carries the drawn icon and its word', async (lang) => {
    const h = await again(true, lang);
    expect(h).toBe('<i class="wqs-re"></i> ' + (lang === 'ur' ? 'دوبارہ سنیں' : 'Listen again'));
    expect(h).not.toContain('↻');
  });
  test('look off: today\'s "↻ Listen again"', async () => {
    expect(await again(false, 'en')).toBe('↻ Listen again');
  });
});

// ---- one sheet that fits (web_quiz_read_sheet_fit: the book's read_sheet 2): a page never shows its words with empty
// space where its picture would fit. Where the band and the picture cannot share one width with a line at the reader's
// readable size, the words keep their size and the picture is drawn in the room left as its own rounded card, centred
// under the band (when that room is 96 px or more). Jugnu's hint bubble is never wider than the picture it sits on.
describe('Your turn, one sheet that fits: the picture in the room left, the hint no wider than the picture', () => {
  const MSRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'wq-moment.js'), 'utf8');
  const moment = () => { const win = {}; vm.runInContext(MSRC, vm.createContext({ window: win, document: {} })); return win.WQMoment; };
  const clipOf = (c) => { const m = /^inset\(([\d.]+)px 0 ([\d.]+)px 0(?: round [^)]*)?\)$/.exec(c); return m ? [+m[1], +m[2]] : null; };
  const BOOKS = {
    murghi: { im: { w: 720, h: 1019 }, lines: [[163, 79, 386, 84], [167, 189, 363, 89], [99, 300, 517, 93]] },
    akhbar: { im: { w: 720, h: 1083 }, lines: [[109, 65, 494, 77], [271, 153, 167, 70]] },
  };
  const PHONES = { '390x844': [358, 574], '360x740': [328, 470], '360x640': [328, 370] };
  const CASES = [];
  Object.keys(BOOKS).forEach((bk) => Object.keys(PHONES).forEach((ph) => CASES.push([bk, ph])));
  const draw = (bk, d, one) => {
    const { im, lines } = BOOKS[bk];
    const a = fakeEl('art'), i = fakeEl('i'), m = fakeEl('img'), st = fakeEl('stage');
    a.querySelector = () => i; i.querySelector = () => m; a.parentNode = st; st.style.setProperty = (k, v) => { st.style[k] = v; };
    const f = moment().art(a, env().S._cam, im, lines, lines, d, true, 0, one);
    return { a, i, m, st, f, im, lines };
  };
  test('akhbar 360x640 (AK-1): the words keep their reading size and the newspaper is drawn under them, its own card, centred', () => {
    const d = PHONES['360x640'], g = draw('akhbar', d, 2);
    expect(Math.min(...g.lines.map((l) => l[3])) * g.f.s).toBeGreaterThanOrEqual(25.5);
    expect(g.a.getAttribute('data-art')).toBe('on');
    const pw = parseFloat(g.i.style.width), ph = parseFloat(g.i.style.height), top = parseFloat(g.a.style.top);
    expect(ph).toBeGreaterThanOrEqual(96);
    expect(pw).toBeLessThanOrEqual(d[0]);
    expect(g.i.style.borderRadius).toBe('12px');                                  // its own card: rounded all round
    const [, cb] = clipOf(g.f.clip), bandBottom = (g.im.h - cb) * g.f.s + g.f.ty;
    expect(top - bandBottom).toBeGreaterThanOrEqual(6);                            // a clear gap: no seam to hide
    expect(top + ph).toBeLessThanOrEqual(d[1] + 0.5);                              // inside the stage
    expect(g.f.clip).toMatch(/round ([\d.]+)px\)$/);                               // the band rounded on all four corners
    const cy = -parseFloat(/translateY\(([-\d.]+)px\)/.exec(g.m.style.transform)[1]) / (pw / g.im.w);
    expect(cy).toBeGreaterThanOrEqual(Math.max(...g.lines.map((l) => l[1] + l[3])) - 0.5);   // no printed glyph in the picture
    expect(parseFloat(g.st.style['--wqs-pi'])).toBeCloseTo((d[0] - pw) / 2, 0);    // the hint's inset: the picture's own
    const cap = g.st.style['--wqs-cap'];                                           // the stage ends at the picture (or the picture at its foot)
    expect(cap === 'none' ? d[1] - (top + ph) : parseFloat(cap) - (top + ph)).toBeLessThanOrEqual(1);
  });
  test.each(CASES)('%s %s: where today draws a picture, the same sheet number for number (only the hint inset is new)', (bk, ph) => {
    const d = PHONES[ph], a = draw(bk, d, 1), b = draw(bk, d, 2);
    if (a.a.getAttribute('data-art') !== 'on') return;
    expect([b.f, b.a.style, b.i.style, b.m.style, b.a.attrs]).toEqual([a.f, a.a.style, a.i.style, a.m.style, a.a.attrs]);
    const { '--wqs-pi': pi, setProperty: f1, ...rest } = b.st.style, { setProperty: f2, ...was } = a.st.style;
    expect(rest).toEqual(was);
    expect(parseFloat(pi)).toBeCloseTo((d[0] - parseFloat(b.i.style.width)) / 2, 0);  // murghi 360x640 (HB-1): 29 px a side
  });
  test('murghi 360x640 (HB-1): the bubble inset is the picture\'s, so the bubble is never wider than it; the rule reads it', () => {
    const g = draw('murghi', PHONES['360x640'], 2);
    expect(parseFloat(g.st.style['--wqs-pi'])).toBeGreaterThan(20);
    const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'wq-moment.css'), 'utf8');
    expect(css).toContain('.wqs .wqs-stage>.wqs-near{left:calc(var(--wqs-pi,0px) + 8px);right:calc(var(--wqs-pi,0px) + 8px)}');
  });
  test('a stage with no room for 96 px of picture still leaves it out (words alone, today\'s band)', () => {
    const g = draw('akhbar', [328, 190], 2), t = draw('akhbar', [328, 190], 1);
    expect(g.a.getAttribute('data-art')).toBe('off');
    expect([g.f, g.a.style]).toEqual([t.f, t.a.style]);
  });
  test.each(CASES)('%s %s, without the switch (read_sheet 1): no hint inset is set at all', (bk, ph) => {
    expect(draw(bk, PHONES[ph], 1).st.style).not.toHaveProperty('--wqs-pi');
  });
});

// ---- the picture card trimmed to its drawing (web_quiz_read_sheet_trim: the book's read_sheet 3, with the fit): where the
// picture is drawn as its own card in the room left (read_sheet 2's own card), the blank paper above and below the
// drawing is not part of the card. The page reads the drawing's ink rows from the loaded picture (a small canvas, once
// per picture), so the card holds the drawing with a thin margin and the drawing grows into the room the paper took.
// No pixels to read (no canvas, a picture not loaded yet, a tainted canvas): read_sheet 2's card, number for number.
describe('Your turn, the picture card trimmed to its drawing (akhbar 360x640, SF-1)', () => {
  const MSRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'wq-moment.js'), 'utf8');
  const IM = { w: 720, h: 1083 }, LINES = [[109, 65, 494, 77], [271, 153, 167, 70]], INK = [470, 1010], D = [328, 370];
  // a canvas whose pixels are the page's: white paper, the drawing's ink between INK[0] and INK[1] (image rows)
  const canvasDoc = (calls) => ({
    createElement: (t) => {
      if (t !== 'canvas') return {};
      const c = { width: 0, height: 0, src: null };
      c.getContext = () => ({
        drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh) { calls.push([sx, sy, sw, sh, dw, dh]); c.src = [sy, sh, dh]; },
        getImageData(x, y, w, h) {
          const data = new Uint8ClampedArray(w * h * 4).fill(255);
          for (let r = 0; r < h; r += 1) {
            const iy = c.src[0] + (r + 0.5) * c.src[1] / c.src[2];
            if (iy >= INK[0] && iy <= INK[1]) for (let k = Math.floor(w * 0.2); k < w * 0.8; k += 1) { const o = (r * w + k) * 4; data[o] = data[o + 1] = data[o + 2] = 60; }
          }
          return { data };
        },
      });
      return c;
    },
  });
  const moment = (doc) => { const win = {}; vm.runInContext(MSRC, vm.createContext({ window: win, document: doc })); return win.WQMoment; };
  const draw = (one, doc, img = {}) => {
    const a = fakeEl('art'), i = fakeEl('i'), m = Object.assign(fakeEl('img'), { complete: true, naturalWidth: IM.w }, img), st = fakeEl('stage');
    a.querySelector = () => i; i.querySelector = () => m; a.parentNode = st; st.style.setProperty = (k, v) => { st.style[k] = v; };
    const f = moment(doc).art(a, env().S._cam, IM, LINES, LINES, D, true, 0, one);
    const pw = parseFloat(i.style.width), z = pw / IM.w;
    return { a, i, m, st, f, z, pw, ph: parseFloat(i.style.height), top: parseFloat(a.style.top), cy: -parseFloat(/translateY\(([-\d.]+)px\)/.exec(m.style.transform)[1]) / z };
  };
  test('on: the card starts at the drawing (≤ 12 px of paper above it) and ends at it, the drawing larger than read_sheet 2\'s', () => {
    const calls = [];
    const b = draw(2, {}), g = draw(3, canvasDoc(calls));
    expect(calls.length).toBe(1);                                                   // one small read of the picture's part
    expect(calls[0][4]).toBeLessThanOrEqual(200);                                    // a small canvas, not the full picture
    expect(g.a.getAttribute('data-art')).toBe('on');
    expect(g.i.style.borderRadius).toBe('12px');
    expect((INK[0] - g.cy) * g.z).toBeGreaterThanOrEqual(0);
    expect((INK[0] - g.cy) * g.z).toBeLessThanOrEqual(12);                           // SF-1: no band of blank paper on top
    expect(g.cy + g.ph / g.z - INK[1]).toBeGreaterThanOrEqual(0);
    expect((g.cy + g.ph / g.z - INK[1]) * g.z).toBeLessThanOrEqual(12);              // nor at its foot
    expect((INK[0] - b.cy) * b.z).toBeGreaterThan(40);                               // read_sheet 2 shows the paper (the bug)
    expect(g.z).toBeGreaterThanOrEqual(b.z);                                         // the drawing never smaller
    expect(g.pw).toBeLessThanOrEqual(D[0]);
    expect(g.top + g.ph).toBeLessThanOrEqual(D[1] + 0.5);                            // inside the stage
    expect(g.top).toBe(b.top);                                                       // the same gap under the words
    expect(g.f).toEqual(b.f);                                                        // the words' sheet untouched
    expect(parseFloat(g.st.style['--wqs-pi'])).toBeCloseTo((D[0] - g.pw) / 2, 0);    // the hint stays inside the picture
    const cap = g.st.style['--wqs-cap'];
    expect(cap === 'none' ? D[1] - (g.top + g.ph) : parseFloat(cap) - (g.top + g.ph)).toBeLessThanOrEqual(1);
  });
  test('the read is kept on the picture: a second draw reads no pixels', () => {
    const calls = [], doc = canvasDoc(calls), M = moment(doc);
    const a = fakeEl('art'), i = fakeEl('i'), m = Object.assign(fakeEl('img'), { complete: true, naturalWidth: IM.w }), st = fakeEl('stage');
    a.querySelector = () => i; i.querySelector = () => m; a.parentNode = st; st.style.setProperty = (k, v) => { st.style[k] = v; };
    M.art(a, env().S._cam, IM, LINES, LINES, D, true, 0, 3); M.art(a, env().S._cam, IM, LINES, LINES, D, true, 0, 3);
    expect(calls.length).toBe(1);
  });
  test('the box\'s picture still loading: the stage\'s copy of the same file (drawn already) is read, so the card is trimmed', () => {
    const calls = [], a = fakeEl('art'), i = fakeEl('i'), st = fakeEl('stage');
    const m = Object.assign(fakeEl('img'), { complete: false, naturalWidth: 0, src: 'https://x.test/s/b/p01.webp' });
    const copy = Object.assign(fakeEl('img'), { complete: true, naturalWidth: IM.w, src: m.src });
    a.querySelector = () => i; i.querySelector = () => m; a.parentNode = st; st.querySelectorAll = () => [m, copy]; st.style.setProperty = (k, v) => { st.style[k] = v; };
    moment(canvasDoc(calls)).art(a, env().S._cam, IM, LINES, LINES, D, true, 0, 3);
    const z = parseFloat(i.style.width) / IM.w, cy = -parseFloat(/translateY\(([-\d.]+)px\)/.exec(m.style.transform)[1]) / z;
    expect(calls.length).toBe(1);
    expect((INK[0] - cy) * z).toBeLessThanOrEqual(12);
  });
  test('nothing loaded yet: the host\'s re-frame runs once the picture comes in (not before)', () => {
    const a = fakeEl('art'), i = fakeEl('i'), st = fakeEl('stage'), m = Object.assign(fakeEl('img'), { complete: false, naturalWidth: 0 });
    a.querySelector = () => i; i.querySelector = () => m; a.parentNode = st; st.style.setProperty = (k, v) => { st.style[k] = v; };
    let again = 0;
    const M = moment(canvasDoc([]));
    M.art(a, env().S._cam, IM, LINES, LINES, D, true, 0, 3, () => { again += 1; });
    M.art(a, env().S._cam, IM, LINES, LINES, D, true, 0, 3, () => { again += 1; });
    expect(again).toBe(0);
    expect(m.L.load.length).toBe(1);                                                 // one listener, however often it is framed
    m.L.load[0]();
    expect(again).toBe(1);
  });
  test.each([
    ['no canvas', () => ({}), {}],
    ['the picture not loaded yet', () => canvasDoc([]), { complete: false, naturalWidth: 0 }],
    ['a tainted canvas', () => ({ createElement: () => ({ getContext: () => ({ drawImage() {}, getImageData() { throw new Error('SecurityError'); } }) }) }), {}],
  ])('%s: read_sheet 2\'s card, number for number', (_n, doc, img) => {
    const b = draw(2, {}), g = draw(3, doc(), img);
    expect([g.f, g.a.style, g.i.style, g.m.style, g.a.attrs, g.st.style['--wqs-pi'], g.st.style['--wqs-cap']]).toEqual([b.f, b.a.style, b.i.style, b.m.style, b.a.attrs, b.st.style['--wqs-pi'], b.st.style['--wqs-cap']]);
  });
  test('a page where the sheet already shares one width with its picture (360x740): read_sheet 2\'s, number for number', () => {
    const run = (one, doc) => {
      const a = fakeEl('art'), i = fakeEl('i'), m = Object.assign(fakeEl('img'), { complete: true, naturalWidth: IM.w }), st = fakeEl('stage');
      a.querySelector = () => i; i.querySelector = () => m; a.parentNode = st; st.style.setProperty = (k, v) => { st.style[k] = v; };
      const f = moment(doc).art(a, env().S._cam, IM, LINES, LINES, [328, 470], true, 0, one);
      return [f, a.style, i.style, m.style, a.attrs, st.style['--wqs-pi']];
    };
    expect(run(3, canvasDoc([]))).toEqual(run(2, {}));
  });
});

describe('a phone that cannot play Ogg Opus (the book\'s mp3: 1, app_settings web_quiz_story_mp3): every story voice as .mp3', () => {
  const OGG_BOOK = () => book({ mp3: 1, pages: book().pages.map((p) => (p.audio ? { ...p, audio: { url: '/s/b-1/a01-0a1b2c3d.ogg', ms: 2600 } } : p)),
    questions: [{ ...book().questions[0], audio: { q: '/s/b-1/q1-11111111.ogg', o: ['/s/b-1/q1o1-22222222.ogg', '/s/b-1/q1o2-33333333.ogg', '/s/b-1/q1o3-44444444.ogg'] } }],
    questions_sprite: { url: '/s/b-1/qs-55555555.ogg', clips: { q1: { s_ms: 0, e_ms: 900 } } } });
  test('an iPhone (canPlayType says no): the page voice, the questions\' voices and their sprite are asked for as .mp3', async () => {
    const e = env({ canPlay: () => '', replies: { book: { status: 200, body: OGG_BOOK() } } });
    await openReader(e);
    expect(e.calls.ra[0].data.audio.url).toBe('/s/b-1/a01-0a1b2c3d.mp3');
    expect(JSON.stringify(e.calls.ra[0].data)).not.toMatch(/\.ogg/);
  });
  test('an iPhone on the questions: the sprite (and each question\'s own voices) as .mp3', async () => {
    const bk = OGG_BOOK();
    const e = env({ canPlay: () => '', hash: '#story/b-1/q', replies: { book: { status: 200, body: bk } } });
    const root = fakeEl('root');
    e.S.route(e.ctx({ root })); await flush();
    expect(e.calls.audios.map((a) => a.src)).toEqual(['/s/b-1/qs-55555555.mp3']);
    expect(bk.questions[0].audio).toEqual({ q: '/s/b-1/q1-11111111.mp3', o: ['/s/b-1/q1o1-22222222.mp3', '/s/b-1/q1o2-33333333.mp3', '/s/b-1/q1o3-44444444.mp3'] });
  });
  test('a phone that plays Ogg Opus: the .ogg, as today', async () => {
    const e = env({ canPlay: () => 'probably', replies: { book: { status: 200, body: OGG_BOOK() } } });
    await openReader(e);
    expect(e.calls.ra[0].data.audio.url).toBe('/s/b-1/a01-0a1b2c3d.ogg');
  });
  test('GOLDEN: a book without mp3 (the switch off) plays the .ogg even on an iPhone', async () => {
    const body = OGG_BOOK(); delete body.mp3;
    const e = env({ canPlay: () => '', replies: { book: { status: 200, body } } });
    await openReader(e);
    expect(e.calls.ra[0].data.audio.url).toBe('/s/b-1/a01-0a1b2c3d.ogg');
  });
});
