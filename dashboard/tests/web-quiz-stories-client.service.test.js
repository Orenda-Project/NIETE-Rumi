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
const CSS = path.join(__dirname, '..', 'public', 'wq', 'wq-stories.css');
const TOKEN = 'eyJrIjoiaCJ9.AbCdEfGhIjKlMnOpQrStUv';
const KID = 'kidchipabcdefghi';
const BANNED = /\b(test|exam|wpm|words per minute)\b|امتحان|ٹیسٹ|استاد/i;

const W = (i, t, s, box) => (box ? { i, t, s_ms: s, e_ms: s + 400, box } : { i, t, s_ms: s, e_ms: s + 400 });
function book(over = {}) {
  return {
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
function fire(root, tap, arg) {
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
    let r;
    if (opt.fail && opt.fail(url)) return Promise.reject(new Error('offline'));
    if (/\/stories\/shelf\//.test(url)) r = replies.shelf || { status: 200, body: SHELF };
    else if (/\/stories\/book\/|\/teacher\/story\//.test(url)) r = replies.book || { status: 200, body: book() };
    else if (/\/stories\/event\//.test(url)) {
      if (body.event === 'story_questions_done') r = { status: 200, body: { ok: true, correct: 1, total: 2, stars: 2 } };
      else if (body.event === 'story_answer') { const ok = opt.right ? opt.right(body.data) : true; r = { status: 200, body: ok || body.data.try !== 2 ? { ok: true, right: ok } : { ok: true, right: false, show: 0 } }; }
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
    addEventListener(n, f) { (winL[n] = winL[n] || []).push(f); }, removeEventListener() {},
    setTimeout: clock.set, clearTimeout: clock.clear,
  };
  if (opt.ra !== false) {
    win.WQReadAlong = {
      mount(el, data, o) {
        if (o.band) el.innerHTML = '<div class="wqra-pic wqra-band"></div>';
        const p = { el, data, o, log: [], audio: {}, play() { p.log.push('play'); }, pause() { p.log.push('pause'); }, replay() { p.log.push('replay'); }, playWord(i) { p.log.push('word:' + i); }, seekToWord(i) { p.log.push('seek:' + i); }, destroy() { p.log.push('destroy'); } };
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
      ...(opt.doneHtml ? { COPY: { en: { done: 'X' }, ur: { done: 'Y' } }, doneHtml: (c) => '<span class="lr-done-ok">' + c.done + '</span>' } : {}),
    };
  }
  if (opt.wqj) win.WQJ = { tap() { calls.juice.push('tap'); }, finish(o) { calls.juice.push('finish:' + o.stars); }, correct() {}, wrong() {}, muted: () => calls.juice.includes('mute:true'), mute(b) { calls.juice.push('mute:' + b); } };
  const wqRoot = fakeEl('wq');
  calls.loaded = []; calls.hist = []; calls.disp = [];
  const doc = {
    getElementById: (id) => (id === 'boot' && opt.boot ? { textContent: JSON.stringify(opt.boot) } : id === 'wq' && opt.boot ? wqRoot : null),
    querySelector: (sel) => { (calls.qs = calls.qs || []).push(sel); if (opt.slot && /data-stories-shelf/.test(sel)) return opt.slot; return /wq-stories\.js/.test(sel) ? { getAttribute: () => '/wq/wq-stories.js?v=abc123' } : null; },
    createElement: (tag) => ({ tag }),
    L: {}, addEventListener(n, f) { (this.L[n] = this.L[n] || []).push(f); },
    head: { appendChild(x) {
      calls.loaded.push(x);
      if (x.tag !== 'script') return;
      if (/wq-stories-q\.js\?v=abc123$/.test(x.src)) { if (opt.qFail) return x.onerror(); vm.runInContext(fs.readFileSync(QSRC, 'utf8'), sb); return x.onload(); }
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
  return { S, win, calls, clock, advance, ctx, store, winL, wqRoot, doc, get now() { return now; } };
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
  test('Your turn: the word to read next is outlined, never covered (the current box is see-through)', () => {
    const css = fs.readFileSync(CSS, 'utf8');
    const rule = (/\.wqs-cam \.lr-box\.lr-current\{([^}]*)\}/.exec(css) || [])[1] || '';
    expect(rule).toMatch(/outline:3px solid #15803D/);
    expect(rule).toMatch(/background:(transparent|rgba\([^)]*,\s*0?\.\d+\))/);
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
    expect(root.innerHTML).toMatch(/data-tap="prev"[^>]*><span dir="ltr">‹<\/span>/);
    expect(root.innerHTML).toMatch(/data-tap="next"[^>]*><span dir="ltr">›<\/span>/);
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
    expect(zlib.gzipSync(fs.readFileSync(SRC, 'utf8'), { level: 9 }).length).toBeLessThanOrEqual(12 * 1024);
    expect(zlib.gzipSync(fs.readFileSync(QSRC, 'utf8'), { level: 9 }).length).toBeLessThanOrEqual(8 * 1024);
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
  test('whole page before Listen; on Listen the line; the next line as the word moves; Whole page toggle; back out after the last word; Your turn zoomed', async () => {
    const e = env(); const root = await openReader(e);
    const h = root.innerHTML;
    expect(h).toMatch(/data-cam style="width:720px;height:1080px"/);
    expect(h).toContain('Whole page');
    const cam = root.querySelector('[data-cam]');
    expect(cam.style.transform).toBe(T0);
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
    expect(cam.style.transform).toBe(T0);
    fire(root, 'main'); fire(root, 'mic'); e.calls.ask[0].onStream({});
    const r = root.innerHTML;
    expect(r).toMatch(/data-cam[^>]*><div class="wqs-lr" data-lr><\/div>/);
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
    expect(css).toMatch(/\.lr-read[^{]*\{background:linear-gradient\(transparent/);
    expect(css).toMatch(/\.lr-skipped\{[^}]*dashed/);
    expect(css).toMatch(/\.wqs-cam\{[^}]*transition:transform \.6s/);
  });
  test('Urdu: the toggle reads «پورا صفحہ»', async () => {
    const e = env({ replies: { book: { status: 200, body: book({ lang: 'ur', dir: 'rtl' }) } } });
    const root = await openReader(e, { lang: 'ur' });
    expect(root.innerHTML).toContain('پورا صفحہ');
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
    expect(got.o).toEqual({ source: 'story', ended: 'read', pages_read: 2, pages_listened: expect.any(Number), stars: null, title: 'Mina Testwala', cover: undefined, lang: 'en', auth: { hub: TOKEN, kid: KID }, ev: expect.any(Function), home: '#', next: null, sticker: true });
    expect(root.querySelector('[data-own]').hidden).toBe(true);
    // the card leads with its own one primary: ours ("More stories") steps back to a secondary
    expect(primaries(root.innerHTML)).toBe(0);
    expect(root.innerHTML).toMatch(/<button class="wqs-sec" data-tap="more">More stories</);
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
    const c = e.S._cam([[40, 160, 640, 40]], 360, 540, 720, 1080, false);
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
  test('Slower: playbackRate 0.85 with pitch kept, remembered per child, applied after a page change; no number shown; not the primary', async () => {
    const e = env(); const root = await openReader(e);
    const h = root.innerHTML;
    expect(h).toMatch(/<button class="wqs-slow" data-tap="slow" aria-pressed="false"><svg class="wqs-g"[^>]*><path[^>]*><\/svg> Slower<\/button>/);
    expect(text(h.split('wqs-slow')[1].split('</button>')[0])).not.toMatch(/[0-9]/);
    fire(root, 'slow');
    const p = e.calls.ra[0];
    expect(p.audio.playbackRate).toBe(0.85); expect(p.audio.preservesPitch).toBe(true);
    expect(e.store.getItem('wq_st_slow:' + KID)).toBe('1');
    fire(root, 'next'); fire(root, 'prev');
    const p2 = e.calls.ra[e.calls.ra.length - 1];
    expect(p2).not.toBe(p);
    expect(p2.audio.playbackRate).toBe(0.85);
    expect(root.innerHTML).toMatch(/data-tap="slow" aria-pressed="true"/);
    fire(root, 'slow');
    expect(p2.audio.playbackRate).toBe(1);
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
    const z0 = cam.style.transform;
    expect(z0).not.toBe('translate(0px,0px) scale(0.5)');
    pl.o.onWord(12);
    expect(cam.style.transform).toBe('translate(0px,0px) scale(0.5)');
    const mk = root.querySelector('[data-mk]');
    expect([mk.style.left, mk.style.top, mk.style.height]).toEqual(['0px', '1040px', '40px']);
    pl.o.onWord(25);
    expect(cam.style.transform).not.toBe('translate(0px,0px) scale(0.5)');
  });
});

describe('marks, teacher links, copy', () => {
  test('one green: heard draws like read (a bar in the bottom 22 %), skipped a dashed amber bar, only current is a box', () => {
    const css = fs.readFileSync(CSS, 'utf8');
    const rule = (sel) => (new RegExp(sel.replace(/[.]/g, '\\.') + '[^{]*\\{([^}]*)\\}').exec(css) || [])[1] || '';
    expect(css).toMatch(/\.wqs-cam \.lr-box\.lr-read,\s*\.wqs-cam \.lr-box\.lr-heard\{/);
    expect(rule('.wqs-cam .lr-box.lr-heard')).toMatch(/linear-gradient\(transparent 78%,\s*rgba\(21,\s*128,\s*61,\s*\.85\) 78%\)/);
    expect(rule('.wqs-cam .lr-box.lr-skipped')).toMatch(/dashed #E65100/i);
    expect(rule('.wqs-cam .lr-box.lr-cur')).toMatch(/border|outline/);
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
    fire(root, 'echo');
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
    expect(c.o).toMatchObject({ lang: 'en', dir: 'ltr', meter: 'none', record: false, counted: false, stream: { id: 'st' } });
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
    fire(root, 'main'); e.advance(700); fire(root, 'main');
    expect(p.log).toEqual(['play', 'pause']);
    expect(root.querySelector('[data-main]').textContent).toBe('Listen');
    fire(root, 'main');
    expect(p.log).toEqual(['play', 'pause', 'play']);
    expect(root.querySelector('[data-main]').textContent).toBe('Pause');
    e.advance(300); p.o.onEnd();
    expect(e.calls.posts.find((x) => x.body.event === 'story_page_listened').body.data.ms).toBe(1000);
  });
});
