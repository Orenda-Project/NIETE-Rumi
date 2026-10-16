/**
 * The child's Stories client (wq-stories.js): the shelf, the reader (read-along over the book's own pictures),
 * "Your turn", the questions and the done card. The shipped file runs in a vm with a small fake DOM, fake
 * WQReadAlong / WQLiveRead and a fake clock (the server's JSON is the boundary). Invented books only.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.join(__dirname, '..', 'public', 'wq', 'wq-stories.js');
const CSS = path.join(__dirname, '..', 'public', 'wq', 'wq-stories.css');
const TOKEN = 'eyJrIjoiaCJ9.AbCdEfGhIjKlMnOpQrStUv';
const KID = '0123456789abcdef';
const BANNED = /\b(test|exam|wpm|words per minute)\b|امتحان|ٹیسٹ|استاد/i;

const W = (i, t, s, box) => (box ? { i, t, s_ms: s, e_ms: s + 400, box } : { i, t, s_ms: s, e_ms: s + 400 });
function book(over = {}) {
  return {
    id: 'b-1', title: 'Mina Kahaniwala', lang: 'en', dir: 'ltr', grade: 1, pace_wpm: 90,
    pages: [
      { n: 1, image: { url: '/s/b-1/p01.webp', w: 720, h: 1080 }, text_band: { url: '/s/b-1/p01-band.webp', w: 1440, h: 260, box: [100, 800, 520, 130] },
        text: 'It is a sunny day', words: [W(0, 'It', 100, [110, 810, 40, 50]), W(1, 'is', 600, [160, 810, 30, 50]), W(2, 'a', 1100, [200, 810, 20, 50]), W(3, 'sunny', 1600, [230, 870, 90, 50]), W(4, 'day', 2100, [330, 870, 60, 50])],
        audio: { url: '/a/p1.ogg', ms: 2600 }, boxes_ok: true, is_picture: false },
      { n: 2, image: { url: '/s/b-1/p02.webp', w: 720, h: 1080 }, text_band: null, text: '', words: [], audio: null, boxes_ok: false, is_picture: true },
      { n: 3, image: { url: '/s/b-1/p03.webp', w: 720, h: 1080 }, text_band: { url: '/s/b-1/p03-band.webp', w: 1440, h: 260, box: [100, 800, 520, 130] },
        text: 'I want to play.', words: [W(0, 'I', 100), W(1, 'want', 600), W(2, 'to', 1100), W(3, 'play.', 1600)], audio: null, boxes_ok: false, is_picture: false },
    ],
    questions: [
      { n: 1, kind: 'literal', page_ref: 1, q: 'What is the day like?', options: [{ t: 'sunny' }, { t: 'rainy' }, { t: 'cold' }], audio: { q: '/a/q1.ogg', o: ['/a/q1o1.ogg', '/a/q1o2.ogg', '/a/q1o3.ogg'] } },
      { n: 2, kind: 'vocab', page_ref: 3, q: 'Who wants to play?', options: [{ t: 'I', img: 'q2o1-abcd1234.webp' }, { t: 'the cat' }, { t: 'the sun' }] },
    ],
    ...over,
  };
}
const SHELF = {
  grade: 1, lang: 'en', grades: [1, 2, 3, 4, 5],
  books: [
    { id: 'b-9', title: 'Zed Book', grade: 1, lang: 'en', dir: 'ltr', pages: 4, minutes: 2, cover: '/s/b-9/cover.webp', done: false, from_teacher: true, shelf_position: 0, by: 'Ayesha Writer' },
    { id: 'b-1', title: 'Mina Kahaniwala', grade: 1, lang: 'en', dir: 'ltr', pages: 3, minutes: 1, cover: '/s/b-1/cover.webp', done: false, from_teacher: false, shelf_position: 1 },
    { id: 'b-4', title: 'Apple Tale', grade: 1, lang: 'en', dir: 'ltr', pages: 5, minutes: 3, cover: '/s/b-4/cover.webp', done: true, from_teacher: false, shelf_position: 2 },
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
    querySelectorAll() { return []; }, appendChild() {},
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
      else if (body.event === 'story_answer') r = { status: 200, body: { ok: true, right: opt.right ? opt.right(body.data) : true } };
      else if (body.event === 'story_done') r = { status: 200, body: { ok: true, sticker: body.data.pages_read > 0 || body.data.pages_listened > 0 } };
      else r = { status: 200, body: { ok: true } };
    } else if (/\/lr\/key/.test(url)) r = { status: 200, body: { ws: 'wss://x', api_key: 'k', model: 'm', lang: 'en' } };
    else r = { status: 404, body: {} };
    return Promise.resolve({ status: r.status, ok: r.status < 400, json: () => Promise.resolve(r.body), text: () => Promise.resolve(JSON.stringify(r.body)) });
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
        const p = { el, data, o, log: [], audio: {}, play() { p.log.push('play'); }, pause() { p.log.push('pause'); }, replay() { p.log.push('replay'); }, playWord(i) { p.log.push('word:' + i); }, destroy() { p.log.push('destroy'); } };
        calls.ra.push(p); return p;
      },
      preload(d) { calls.preload = (calls.preload || []).concat([d.id]); },
    };
  }
  if (opt.lr !== false) {
    win.WQLiveRead = {
      mount(el, o) { const c = { el, o, log: [], stop(w) { c.log.push('stop:' + w); }, destroy() { c.log.push('destroy'); }, view: () => ({ heard: 2, total: 5 }) }; calls.lr.push(c); return c; },
      askMic(el, o) { el.innerHTML = '<button class="lr-go">go</button>'; calls.ask.push(o); },
      glowLevel: () => 2,
    };
  }
  if (opt.wqj) win.WQJ = { tap() { calls.juice.push('tap'); }, finish(o) { calls.juice.push('finish:' + o.stars); }, correct() {}, wrong() {}, muted: () => calls.juice.includes('mute:true'), mute(b) { calls.juice.push('mute:' + b); } };
  const wqRoot = fakeEl('wq');
  const doc = { getElementById: (id) => (id === 'boot' && opt.boot ? { textContent: JSON.stringify(opt.boot) } : id === 'wq' && opt.boot ? wqRoot : null), querySelector: () => null };
  vm.runInNewContext(fs.readFileSync(SRC, 'utf8'), { window: win, document: doc, JSON, Math, String, Number, Array, Object, Promise, encodeURIComponent, Date });
  const S = win.WQSTORIES;
  const ctx = (over = {}) => ({ token: TOKEN, kid: KID, lang: 'en', clock, ev: (n, p) => { (calls.ev = calls.ev || []).push([n, p]); }, ...over });
  return { S, win, calls, clock, advance, ctx, store, winL, wqRoot, get now() { return now; } };
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
  test('server order kept, the teacher book as ONE full-width primary card, done tick, lazy sized covers, a home link', async () => {
    const e = env(); const el = fakeEl('shelf');
    e.S.shelf(el, e.ctx());
    expect(el.innerHTML).toContain('wqs-skel');
    await flush();
    const h = el.innerHTML;
    checkScreen(h, 'en');
    expect(screenOf(h)).toBe('stories-shelf');
    expect(e.calls.gets[0]).toBe(`/api/wq/stories/shelf/h/${TOKEN}?kid=${KID}`);
    const order = ['Zed Book', 'Mina Kahaniwala', 'Apple Tale'].map((t) => h.indexOf(t));
    expect(order[0]).toBeGreaterThan(0); expect(order[0]).toBeLessThan(order[1]); expect(order[1]).toBeLessThan(order[2]);
    expect(h).toMatch(/class="wqs-tcard"[^>]*data-primary/);
    expect(text(h)).toContain('▶ Read  Zed Book  with Jugnu');
    expect(h).toContain('From your teacher');
    expect((h.match(/data-done/g) || []).length).toBe(1);
    expect(h).toContain('✓');
    expect(h).toContain('by Ayesha Writer');
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
    expect(el.innerHTML).toMatch(/class="wqs-book" data-tap="book" data-arg="0" data-primary/);
  });
  test('tap a book: story_opened carries shelf_position/from_teacher/grade/lang, then #story/<id>', async () => {
    const e = env(); const el = fakeEl('shelf');
    e.S.shelf(el, e.ctx()); await flush();
    fire(el, 'book', 0);
    const p = e.calls.posts.find((x) => x.body.event === 'story_opened');
    expect(p.url).toBe(`/api/wq/stories/event/h/${TOKEN}`);
    expect(p.body).toMatchObject({ kid: KID, book_id: 'b-9', event: 'story_opened', data: { shelf_position: 0, from_teacher: true, grade: 1, lang: 'en' } });
    expect(e.win.location.hash).toBe('#story/b-9');
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
    const h = el.innerHTML;
    checkScreen(h, 'ur');
    expect(h).toContain('ٹیچر کی طرف سے');
    expect(h).toContain('جگنو کے ساتھ');
    expect(text(h)).not.toMatch(/[0-9]/);
    expect(h).toContain('جماعت ۲، اردو');
    // a new shelf later keeps the language
    const el2 = fakeEl('shelf2'); e.S.shelf(el2, e.ctx()); await flush();
    expect(e.calls.gets[3]).toContain('l=ur');
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
describe('the reader', () => {
  test('page 1: the picture, one big button, ONE player (overlay) that also gets the text band', async () => {
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
    expect(p.o.band).toEqual({ url: '/s/b-1/p01-band.webp', x: 100, y: 800, w: 520, h: 130 });
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
  test('Your turn: the mic sheet (one OK, "Not now", a marked close), then reading with "I\'m done ✓" from the first render', async () => {
    const e = env(); const root = await openReader(e);
    toMic(e, root);
    let h = root.innerHTML;
    checkScreen(h, 'en');
    expect(screenOf(h)).toBe('story-mic');
    expect(h).toContain('Tap to let Jugnu hear you');
    expect(h).toMatch(/data-primary data-tap="mic">[^<]*OK/);
    expect(h).toContain('Not now, just listen');
    expect(h).toMatch(/data-back[^>]*>✕/);
    fire(root, 'mic');
    expect(e.calls.ask).toHaveLength(1);
    e.calls.ask[0].onStream({ id: 'stream' });
    h = root.innerHTML;
    checkScreen(h, 'en');
    expect(screenOf(h)).toBe('story-read');
    expect(h).toMatch(/data-primary[^>]*>I&#39;m done ✓</);
    expect(text(h)).not.toMatch(/[0-9]/);
    const c = e.calls.lr[0];
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
  test('"Not now, just listen": back to Listen, mic_declined not_now, nothing lost', async () => {
    const e = env(); const root = await openReader(e);
    toMic(e, root);
    fire(root, 'notnow');
    expect(screenOf(root.innerHTML)).toBe('story-page');
    expect(root.innerHTML).toMatch(/data-main[^>]*>Listen</);
    expect(e.calls.ev).toContainEqual(['mic_declined', { src: 'story', how: 'not_now' }]);
  });
  test('a result: story_page_read without the transcript; praise; practise the skipped word, then Next', async () => {
    const e = env(); const root = await openReader(e);
    toMic(e, root); fire(root, 'mic'); e.calls.ask[0].onStream({});
    e.calls.lr[0].o.onResult({ words_total: 5, words_read: 4, skipped: 1, ms: 5000, ended: 'quiet', marks: ['read', 'read', 'read', 'skipped', 'read'], transcript_final: 'it is a day', wpm: null });
    const ev = e.calls.posts.find((x) => x.body.event === 'story_page_read');
    expect(ev.body.data).toEqual({ words_total: 5, words_read: 4, skipped: 1, ms: 5000, ended: 'quiet' });
    expect(JSON.stringify(e.calls.posts)).not.toContain('it is a day');
    const h = root.innerHTML;
    checkScreen(h, 'en');
    expect(screenOf(h)).toBe('story-page');
    expect(h).toContain('Let&#39;s practise this word');
    expect(h).toContain('sunny');
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
  test('a denied mic: "That\'s OK, let\'s listen with Jugnu", Listen, mic_declined denied; never a dead end', async () => {
    const e = env(); const root = await openReader(e);
    toMic(e, root); fire(root, 'mic');
    e.calls.ask[0].onDenied('notallowed');
    const h = root.innerHTML;
    checkScreen(h, 'en');
    expect(h).toContain('That&#39;s OK, let&#39;s listen with Jugnu');
    expect(e.calls.ev).toContainEqual(['mic_declined', { src: 'story', how: 'denied' }]);
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
    toMic(e, root);
    checkScreen(root.innerHTML, 'ur');
    expect(root.innerHTML).toContain('جگنو کو اپنی آواز سنانے کے لیے دبائیں');
    expect(root.innerHTML).toContain('ابھی نہیں، صرف سنیں');
    fire(root, 'mic'); e.calls.ask[0].onStream({});
    checkScreen(root.innerHTML, 'ur');
    expect(root.innerHTML).toContain('میں نے پڑھ لیا ✓');
    e.calls.lr[0].o.onResult({ words_total: 5, words_read: 0, marks: [] });
    expect(root.innerHTML).toContain('آؤ مل کر پڑھیں');
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
  test('#story/<id>/q: one at a time, 🔊 on the question and options, one tap answers, 900 ms on; no score anywhere', async () => {
    const e = env({ hash: '#story/b-1/q', wqj: true });
    const root = fakeEl('root');
    expect(e.S.route(e.ctx({ root }))).toBe(true);
    await flush();
    let h = root.innerHTML;
    checkScreen(h, 'en');
    expect(screenOf(h)).toBe('story-questions');
    expect(h).toContain('What is the day like?');
    expect(h).not.toContain('Who wants to play?');
    expect((h.match(/data-tap="say"/g) || []).length).toBe(4);
    expect((h.match(/data-tap="ans"/g) || []).length).toBe(3);
    fire(root, 'ans', 2);
    expect(root.innerHTML).toContain('wqs-chosen');
    await flush();
    expect(e.calls.posts.find((x) => x.body.event === 'story_answer').body).toMatchObject({ book_id: 'b-1', event: 'story_answer', data: { n: 1, pick: 2 } });
    e.advance(899);
    expect(root.innerHTML).toContain('What is the day like?');
    e.advance(1);
    h = root.innerHTML;
    checkScreen(h, 'en');
    expect(h).toContain('Who wants to play?');
    expect(h).toContain('/s/b-1/q2o1-abcd1234.webp');
    expect((h.match(/data-tap="say"/g) || []).length).toBe(0);
    fire(root, 'ans', 0); await flush(); e.advance(900); await flush(); await flush();
    const qd = e.calls.posts.find((x) => x.body.event === 'story_questions_done');
    expect(qd.body.data).toEqual({ answers: [2, 0] });
    const sd = e.calls.posts.find((x) => x.body.event === 'story_done');
    expect(sd.body.data).toEqual({ pages_listened: 0, pages_read: 0, stars: 2 });
    h = root.innerHTML;
    checkScreen(h, 'en');
    expect(screenOf(h)).toBe('story-done');
    expect(h).toContain('You tried a new story!');
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
    expect(h).toContain('A new sticker for your Book!');
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
  test('Look back (RULING #S7): a first miss wobbles, slides in the page that answers it, plays it on a tap, then a second try is taken', async () => {
    const e = env({ hash: '#story/b-1/q', wqj: true, right: (d) => d.n === 1 && d.pick === 0 });
    const root = fakeEl('root');
    e.S.route(e.ctx({ root })); await flush();
    fire(root, 'ans', 2); await flush();
    expect(root.innerHTML).toContain('What is the day like?');
    e.advance(600);
    let h = root.innerHTML;
    checkScreen(h, 'en');
    expect(screenOf(h)).toBe('story-look');
    expect(h).toContain('Let&#39;s look back!');
    expect(h).toMatch(/data-primary data-tap="lret">Back to the question</);
    expect(text(h)).not.toMatch(/wrong|try again|no\b/i);
    const p = e.calls.ra[e.calls.ra.length - 1];
    expect(p.data.id).toBe('b-1/p1');
    expect(p.o.band).toEqual({ url: '/s/b-1/p01-band.webp', x: 100, y: 800, w: 520, h: 130 });
    expect(p.log).not.toContain('play');
    fire(root, 'lplay'); expect(p.log).toContain('play');
    fire(root, 'lret');
    expect(p.log).toContain('destroy');
    h = root.innerHTML;
    checkScreen(h, 'en');
    expect(h).toContain('What is the day like?');
    fire(root, 'ans', 1); await flush();
    e.advance(900);
    expect(root.innerHTML).toContain('Who wants to play?');
    // Q2: a miss on a page with no voice: the picture only, then the second try
    fire(root, 'ans', 2); await flush(); e.advance(600);
    expect(screenOf(root.innerHTML)).toBe('story-look');
    expect(root.innerHTML).toContain('p03.webp');
    fire(root, 'lret'); fire(root, 'ans', 0); await flush(); e.advance(900); await flush(); await flush();
    const qd = e.calls.posts.find((x) => x.body.event === 'story_questions_done');
    expect(qd.body.data).toEqual({ answers: [1, 0] });
    expect(e.calls.posts.filter((x) => x.body.event === 'story_answer')).toHaveLength(4);
    expect(screenOf(root.innerHTML)).toBe('story-done');
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
    expect(root.innerHTML).toContain('Who wants to play?');
    const e2 = env({ hash: '#story/b-1/q', fail: (u) => /event/.test(u) });
    const r2 = fakeEl('root');
    e2.S.route(e2.ctx({ root: r2 })); await flush();
    fire(r2, 'ans', 2); await flush(); e2.advance(900);
    expect(r2.innerHTML).toContain('Who wants to play?');
  });
  test('W6 zero-input chain: skip Listen, Done at 0 words, no questions -> "You tried a new story!", no sticker, no confetti', async () => {
    const e = env({ wqj: true, replies: { book: { status: 200, body: book({ questions: [] }) } } });
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
    expect(h).toContain('You tried a new story!');
    expect(text(h)).not.toMatch(/whole story|sticker|page/i);
    expect(e.calls.juice.filter((x) => /^finish/.test(x))).toHaveLength(0);
    const e2 = env({ replies: { book: { status: 200, body: book({ lang: 'ur', dir: 'rtl', questions: [] }) } } });
    const r2 = await openReader(e2, { lang: 'ur' });
    fire(r2, 'next'); fire(r2, 'next'); fire(r2, 'next'); await flush(); await flush();
    checkScreen(r2.innerHTML, 'ur');
    expect(r2.innerHTML).toContain('آپ نے ایک نئی کہانی آزمائی!');
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
    expect(h).toContain('What is the day like?');
    expect(h).toContain('Who wants to play?');
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
  test('no answer key client side, no U+00B7, banned Urdu words absent from the copy, size budgets', () => {
    const src = fs.readFileSync(SRC, 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(src).not.toContain('answer_i');
    expect(src).not.toContain('·');
    expect(code).not.toMatch(/ٹیپ کریں|گم شدہ|استاد|امتحان|ٹیسٹ/);
    const zlib = require('zlib');
    expect(zlib.gzipSync(src, { level: 9 }).length).toBeLessThanOrEqual(12 * 1024);
    const css = fs.readFileSync(CSS, 'utf8');
    expect(zlib.gzipSync(css, { level: 9 }).length).toBeLessThanOrEqual(3 * 1024);
    expect(css).toContain('prefers-reduced-motion');
  });
});
