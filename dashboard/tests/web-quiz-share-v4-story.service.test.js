/**
 * The one share on the storybook's done card (app_settings web_quiz_share_v4, the book payload's `share_v4`; default
 * OFF): the mint names the book, a tap opens the one sheet with the card's picture and its /k/ link. Switch off (absent,
 * false, "true", 1): the done card, its mint and its tap are today's. The shipped wq-stories.js and wq-finish-card.js
 * run in a vm with a small fake DOM and a fake clock (the server's JSON is the boundary). Invented books only.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.join(__dirname, '..', 'public', 'wq', 'wq-stories.js');
const QSRC = path.join(__dirname, '..', 'public', 'wq', 'wq-stories-q.js');
const DSRC = path.join(__dirname, '..', 'public', 'wq', 'wq-stories-d.js');
const CSS = path.join(__dirname, '..', 'public', 'wq', 'wq-stories.css');
const TOKEN = 'eyJrIjoiaCJ9.AbCdEfGhIjKlMnOpQrStUv';
const KID = 'kidchipabcdefghi';
const BANNED = /\b(test|exam|wpm|words per minute)\b|امتحان|ٹیسٹ|استاد/i;

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
      if (/wq-stories-q\.js\?v=abc123$/.test(x.src)) { if (opt.qFail) return x.onerror(); if (opt.qHold && !calls.qGo) { calls.qGo = () => { vm.runInContext(fs.readFileSync(QSRC, 'utf8'), sb); x.onload(); }; return; } vm.runInContext(fs.readFileSync(QSRC, 'utf8'), sb); return x.onload(); }
      if (/wq-stories-d\.js\?v=abc123$/.test(x.src)) { if (opt.dFail) return x.onerror(); vm.runInContext(fs.readFileSync(DSRC, 'utf8'), sb); return x.onload(); }
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

// ---- the shelf ----------------------------------------------------------------------------------------------------

// ---- the reader ---------------------------------------------------------------------------------------------------
async function openReader(e, over = {}) {
  const root = fakeEl('root');
  e.S.open('b-1', e.ctx({ root, ...over }));
  await flush();
  return root;
}
function toMic(e, root) { fire(root, 'main'); e.calls.ra[e.calls.ra.length - 1].o.onEnd(); fire(root, 'main'); }
function runBook(e, root) {
  toMic(e, root); fire(root, 'mic'); e.calls.ask[0].onStream({});
  e.calls.lr[0].o.onResult(READ(['read', 'read', 'skipped', 'read', 'read']));
  fire(root, 'main'); fire(root, 'next');
  fire(root, 'main'); fire(root, 'mic'); e.calls.ask[1].onStream({});
  e.calls.lr[1].o.onResult(READ(['read', 'read', 'read', 'read']));
  fire(root, 'main');
}

// ==== the one share on the storybook's done card: the real WQFC, the real reader, three ways to finish ====
const FCP = path.join(__dirname, '..', 'public', 'wq', 'wq-finish-card.js');
const UUID = '3b9c1e2a-7d4f-4a1b-9c2d-5e6f7a8b9c0d';
const TOKC = 'Qm9va2Nhc2VfdG9rZW5fZm9yX3Rlc3RzX29ubHlfMDEyMzQ1Njc4OWFiY2RlZg';
const RETC = { text: 'Play with Jugnu any day. Tap, then send:', cta: 'Play with Jugnu', words: 'quiz please', href: 'https://wa.me/15550001111?text=quiz%20please' };
const MINTC = { token: TOKC, url: `/k/${TOKC}`, img: `/wq/card/${TOKC}.png`, ret: RETC };
const shaC = (s) => require('crypto').createHash('sha256').update(String(s)).digest('hex').slice(0, 16);
// the real WQFC in its own vm, with a share anchor that can be tapped and a body the sheet lands in
function liveCard(sink, answer) {
  return (w) => {
    sink.posts = []; sink.body = ''; sink.card = '';
    const ls = [];
    const a = { tagName: 'A', attrs: {}, innerHTML: 'Share', setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; }, addEventListener(n, fn) { ls.push(fn); } };
    sink.tap = () => { const e = { currentTarget: a, prevented: 0, preventDefault() { this.prevented += 1; } }; ls.forEach((fn) => fn(e)); return e; };
    sink.a = a;
    const els = {};
    const doc = {
      getElementById: (id) => (id === 'wqfc-share' ? (sink.card.includes('id="wqfc-share"') ? a : null) : sink.body.indexOf(`id="${id}"`) >= 0 ? (els[id] = els[id] || { id, l: [], addEventListener(n, fn) { this.l.push(fn); }, focus() {}, parentNode: { removeChild() { sink.body = ''; } } }) : null),
      createElement: () => ({ setAttribute() {}, style: {} }), head: { appendChild() {} },
      body: { insertAdjacentHTML(pos, h) { sink.body += h; }, appendChild() {}, removeChild() {} }, querySelector: () => null,
    };
    const c = { window: {}, document: doc, location: { origin: 'https://portal.example' }, navigator: {}, localStorage: { getItem: () => null, setItem() {} },
      setTimeout: () => 0, clearTimeout() {},
      fetch: (url, init) => { if (init && init.method === 'POST') sink.posts.push(JSON.parse(init.body)); const b = typeof answer === 'function' ? answer(JSON.parse(init.body)) : answer; return Promise.resolve(b == null ? { ok: false, text: () => Promise.resolve('') } : { ok: true, text: () => Promise.resolve(JSON.stringify(b)) }); } };
    c.window = c; vm.createContext(c); vm.runInContext(fs.readFileSync(FCP, 'utf8'), c);
    w.WQFC = { mount(el, o) { sink.o = o; return c.WQFC.mount({ insertAdjacentHTML: (pos, h) => { sink.card += h; } }, o); } };
  };
}
async function openUuid(e, lang) { const root = fakeEl('root'); e.S.open(UUID, e.ctx({ root, lang })); await flush(); return root; }
async function answerAll(e, root) { fire(root, 'ans', 0); await flush(); e.advance(900); fire(root, 'ans', 1); await flush(); e.advance(900); await flush(); await flush(); }
// three done states: read (no questions), read + questions answered, nothing read but questions answered
async function finishBook(state, lang, extra, answer) {
  const sink = {};
  let bk;
  if (state === 'answered_only') { bk = book({ card_v3: true, lang, ...extra }); bk.pages = bk.pages.slice(0, 2); }
  else bk = book({ card_v3: true, lang, ...(state === 'read' ? { questions: [] } : {}), ...extra });
  const e = env({ lr: state !== 'answered_only', replies: { book: { status: 200, body: bk } }, onLoad: liveCard(sink, answer) });
  const root = await openUuid(e, lang);
  if (state === 'answered_only') { fire(root, 'next'); fire(root, 'next'); await answerAll(e, root); }
  else { runBook(e, root); await flush(); await flush(); if (state === 'read_q') await answerAll(e, root); }
  await flush(); await flush();
  return { e, root, sink };
}
const STATES = ['read', 'read_q', 'answered_only'];
describe('storybook one share', () => {
  // OFF: whatever the book says that is not literally true, the done card, its mint, its tap are today's (hash here; compared with base)
  test('off golden rows', async () => {
    const rows = {};
    for (const lang of ['en', 'ur']) for (const st of STATES) for (const [nm, v] of [['absent', undefined], ['false', false], ['str', 'true'], ['one', 1]]) {
      const d = await finishBook(st, lang, v === undefined ? {} : { share_v4: v }, MINTC);
      const tap = d.sink.card.includes('wqfc-share') ? d.sink.tap() : { prevented: 'none' };
      rows[`${lang}|${st}|${nm}`] = shaC([d.sink.card, d.root.innerHTML, JSON.stringify(d.sink.posts), d.sink.a.attrs.href || '', tap.prevented, d.sink.body].join('\n#\n'));
    }
    // within a run every OFF value equals absent
    for (const k of Object.keys(rows)) expect([k, rows[k]]).toEqual([k, rows[k.replace(/\|[^|]+$/, '|absent')]]);
  });
  test.each([['en', 'read'], ['ur', 'read'], ['en', 'read_q'], ['ur', 'read_q']])('on %s %s: mint names the book; tap opens the one sheet, picture + /k link + the book title in the words', async (lang, st) => {
    const d = await finishBook(st, lang, { share_v4: true }, (b) => ({ ...MINTC, v4: true, item: b.item ? 'book' : null }));
    expect(d.sink.posts).toHaveLength(1);
    expect(d.sink.posts[0]).toMatchObject({ kind: 'book', deed: 'book_read', item: { type: 'book', id: UUID } });
    const e = d.sink.tap();
    expect(e.prevented).toBe(1);
    expect(d.sink.body).toContain('data-screen="share_sheet"');
    expect(d.sink.body).toContain(`dir="${lang === 'ur' ? 'rtl' : 'ltr'}"`);
    expect(d.sink.body).toContain(`<img class="wqfc-sh-pic" src="/wq/card/${TOKC}.png"`);
    const words = decodeURIComponent(/id="wqfc-sh-wa"[^>]*href="https:\/\/wa\.me\/\?text=([^"]+)"/.exec(d.sink.body)[1]);
    expect(words).toContain(`https://portal.example/k/${TOKC}`);
    expect(words).toContain('Mina Testwala');
    expect(words).not.toMatch(BANNED);
    // the label on the card's share
    rowsLabel[`${lang}|${st}`] = /<a [^>]*id="wqfc-share"[^>]*>([^<]*)<\/a>/.exec(d.sink.card)[1];
  });
  test('on, answered only (nothing read): what the mint is told', async () => {
    const d = await finishBook('answered_only', 'en', { share_v4: true }, (b) => ({ ...MINTC, v4: true, item: 'door' }));
    expect(d.sink.posts).toHaveLength(1);
    rowsLabel.answered_post = d.sink.posts[0];
    // the book is named to the server
    expect(d.sink.posts[0]).toMatchObject({ kind: 'story', deed: 'answered', item: { type: 'book', id: UUID } });
  });
  test('on, the book not ready (server drops the item): the sheet still opens with picture + plain /k link', async () => {
    const d = await finishBook('read', 'en', { share_v4: true }, () => ({ ...MINTC, v4: true, item: null }));
    expect(d.sink.tap().prevented).toBe(1);
    expect(d.sink.body).toContain(`/wq/card/${TOKC}.png`);
  });
  test('on, a host id that is not an id: no item to the server', async () => {
    const sink = {};
    const e = env({ replies: { book: { status: 200, body: book({ card_v3: true, questions: [], share_v4: true }) } }, onLoad: liveCard(sink, MINTC) });
    const root = await openReader(e); runBook(e, root); await flush(); await flush();
    expect(sink.posts[0].item).toBeUndefined();
  });
});
const rowsLabel = {};
