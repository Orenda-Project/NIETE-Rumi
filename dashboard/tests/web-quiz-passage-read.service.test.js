/**
 * Jugnu's story passage (Story Time: /c/<hub>?…&room=story&pid=<id>, public/wq/wq-trail.js + wq-readalong.js +
 * wq-finish-card.js), on the path a new child takes from the home: the serve comes back, the child taps "Read along
 * with Jugnu" at once.
 *   - the read-along player is asked for when the story opens; a tap that comes while it is still on its way WAITS
 *     for it on the along screen (no old clip, nothing moves on by itself) and the player plays when it lands; only a
 *     player that fails, or does not land in time, falls back to today's line-lit clip
 *   - the live read lights the passage's own words (one span per word, the heard ones green)
 *   - with the finish card on (card_v3), Story Time's end is the card: the deed + the sticker, ONE Next tile (the
 *     story's questions when they follow, else the ranked next thing, else "Pick a story" on the home), "Share to
 *     class group" soft, Home to the child's home; never "Back to the trail"
 *   - card_v3 off, or no `readalong` on the serve: today's page
 * Only the browser and the network are faked; the Urdu child is a self-joined grade-2 child (no class).
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const H = require('./wqc-page-harness');
const { ok, CLIPS, STORY } = H;

const PUB = path.join(__dirname, '..', 'public', 'wq');
const TRAIL_SRC = fs.readFileSync(path.join(PUB, 'wq-trail.js'), 'utf8');
const RA_SRC = fs.readFileSync(path.join(PUB, 'wq-readalong.js'), 'utf8');
const FC_SRC = fs.readFileSync(path.join(PUB, 'wq-finish-card.js'), 'utf8');
const LIVE_SRC = fs.readFileSync(path.join(PUB, 'wq-read-live.js'), 'utf8');
const LR_SRC = fs.readFileSync(path.join(PUB, 'wq-liveread.js'), 'utf8');

const TC = {
  title: "{name}'s Trail", sub: '{done} of {total} stops done.', allDone: 'All done', badge: 'Done', next: 'Next', mic: 'uses the microphone',
  needsMic: 'needs a microphone', micWait: 'wait', other: 'Go to another stop', back: 'Back to the trail', practice: 'Practice round.', stopDone: 'Stop done!',
};
const TC_UR = { ...TC, back: 'راستے پر واپس' };
const EXS = [
  { id: 'read', name: 'Read aloud', mins: 2, done: false, last: null, badge: false, mic: true },
  { id: 'listen', name: 'Listen', mins: 2, done: false, last: null, badge: false },
];
const V2 = { pool: true, story: true, consent: false };
const MENU = (lang = 'en', extra = {}) => ({ lang, form: 'G2', record: true, trail: true, trail_copy: lang === 'ur' ? TC_UR : TC, exercises: EXS, v2: V2, ...extra });

// an invented Urdu story of 38 words (no real child), and its timing object as the serve sends it
const UR_WORDS = ('آج گھر میں سب خوش تھے۔ امی نے میٹھا بنایا۔ ابو بازار سے دودھ لائے۔ چھوٹا بھائی بھی ساتھ تھا۔ '
  + 'سب نے مل کر کام کیا۔ پھر سب نے بیٹھ کر میٹھا کھایا۔ بہت مزہ آیا۔ سب نے شکریہ کہا۔').split(/\s+/).filter(Boolean).slice(0, 38);
const UR_STORY = { text: UR_WORDS.join(' '), dir: 'rtl', tokens: UR_WORDS.slice(), lines: [{ from: 0, to: 18 }, { from: 19, to: UR_WORDS.length - 1 }] };
const timed = (words, lang) => ({ v: 1, id: `${lang}.read.1.story01`, lang, dir: lang === 'ur' ? 'rtl' : 'ltr',
  audio: { url: 'https://signed.test/readalong/story01.ogg', ms: 25900, mime: 'audio/ogg; codecs=opus' },
  words: words.map((t, i) => ({ i, t, s_ms: i * 650, e_ms: i * 650 + 500 })) });
const EN_TIMED = timed(STORY.tokens, 'en');
const UR_TIMED = timed(UR_WORDS, 'ur');
const CLIP = { url: '/clips/story-old.ogg' };
const SREAD = (lang, extra = {}) => ({ ex: 'read', ct: 'CTS', secs: 60, clips: CLIPS, story: lang === 'ur' ? UR_STORY : STORY, story_clip: CLIP,
  trail: true, trail_copy: lang === 'ur' ? TC_UR : TC, v2: V2, practice_round: true, mode: 'practice', questions_on: false, ...extra });

// the browser's audio (the line-lit fallback's clip), held so a test can see what played
const AUDIO = 'var __aud = []; Audio = function (u) { this.url = u; this.l = {}; this.currentTime = 0; this.duration = NaN; __aud.push(this); };'
  + 'Audio.prototype.addEventListener = function (n, fn) { (this.l[n] = this.l[n] || []).push(fn); };'
  + 'Audio.prototype.play = function () { this.playing = true; return Promise.resolve(); };'
  + 'Audio.prototype.pause = function () { this.playing = false; };'
  + 'Audio.prototype.fire = function (n) { (this.l[n] || []).forEach(function (fn) { fn({}); }); };';
// the player's script is LATE: the page asks for it, it lands only when the test says (__release) or fails (__fail)
const LATE = 'var __held = []; var __ap = document.head.appendChild;'
  + 'document.head.appendChild = function (el) { if (el && /wq-readalong\\.js/.test(el.src)) { __held.push(el); return; } return __ap(el); };'
  + 'window.__release = function () { __held.splice(0).forEach(function (el) { __ap(el); }); };'
  + 'window.__fail = function () { __held.splice(0).forEach(function (el) { (el.l.error || []).forEach(function (fn) { fn({}); }); }); };';
const STUB = 'window.WQReadAlong = { mount: function (el, d, o) { var r = window.__ra = { el: el, d: d, o: o, plays: 0, destroyed: 0 };'
  + ' return { play: function () { r.plays += 1; }, destroy: function () { r.destroyed += 1; } }; } };';
const store = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
const ROOM = (lang) => `https://portal.test/c/HUB.TOKEN?kid=KID1&lang=${lang}&home=1&room=story&pid=${lang}.read.1.story01`;
const room = (lang, o = {}) => H.page({ menu: MENU(lang, o.menuExtra), lang, href: ROOM(lang), kid: 'KID1', freshEls: true, session: store(), ...o, pre: [AUDIO, ...(o.pre || []), TRAIL_SRC] });
const aud = (p) => p.ctx.__aud;

describe('the read-along player is late (the child taps the moment the story opens)', () => {
  test.each(['en', 'ur'])('%s: the tap waits on the along screen for the player — no old clip, no move on — and the player plays when it lands', async (lang) => {
    const ra = lang === 'ur' ? UR_TIMED : EN_TIMED;
    const p = room(lang, { pre: [LATE], routes: { 'ch/HUB.TOKEN/read': ok(SREAD(lang, { readalong: ra })) }, scripts: { '/wq/wq-readalong.js': STUB } });
    await p.flush();
    expect(p.screen()).toBe('story-ask');
    expect(p.win.WQReadAlong).toBeUndefined();     // still on its way
    await p.click('wqc-story-along');
    expect(p.screen()).toBe('story-along');
    expect(aud(p)).toEqual([]);                     // today: the old 12-s clip plays here, line-lit
    await p.runTimers((x) => x.ms < 1000);
    expect(p.screen()).toBe('story-along');         // nothing moves on by itself
    p.win.__release();
    await p.flush();
    expect(p.screen()).toBe('story-along');
    expect(p.win.__ra.d).toEqual(ra);
    expect(p.win.__ra.plays).toBe(1);
    expect(aud(p)).toEqual([]);
  });

  test('the player fails to load while the child waits: today\'s line-lit clip plays', async () => {
    const p = room('en', { pre: [LATE], routes: { 'ch/HUB.TOKEN/read': ok(SREAD('en', { readalong: EN_TIMED })) }, scripts: { '/wq/wq-readalong.js': STUB } });
    await p.flush();
    await p.click('wqc-story-along');
    p.win.__fail();
    await p.flush();
    expect(aud(p).map((x) => x.url)).toEqual([CLIP.url]);
    expect(p.win.__ra).toBeUndefined();
  });

  test('the player does not land in time (a few seconds, inside the tap\'s audio window): today\'s line-lit clip plays; a late arrival mounts nothing', async () => {
    const p = room('en', { pre: [LATE], routes: { 'ch/HUB.TOKEN/read': ok(SREAD('en', { readalong: EN_TIMED })) }, scripts: { '/wq/wq-readalong.js': STUB } });
    await p.flush();
    await p.click('wqc-story-along');
    const wait = p.timers.filter((x) => x.ms >= 1000 && x.ms < 5000);
    expect(wait.length).toBe(1);
    await p.runTimers((x) => x === wait[0]);
    expect(aud(p).map((x) => x.url)).toEqual([CLIP.url]);
    p.win.__release();
    await p.flush();
    expect(p.win.__ra).toBeUndefined();
  });

  test('"I\'m ready" while the player is on its way goes to the read; the player landing later mounts nothing', async () => {
    const p = room('en', { pre: [LATE], routes: { 'ch/HUB.TOKEN/read': ok(SREAD('en', { readalong: EN_TIMED })) }, scripts: { '/wq/wq-readalong.js': STUB } });
    await p.flush();
    await p.click('wqc-story-along');
    await p.click('wqc-along-read');
    expect(['mic-ask', 'read-ready', 'read-rec', 'mic-notice']).toContain(p.screen());
    const at = p.screen();
    p.win.__release();
    await p.flush();
    expect(p.win.__ra).toBeUndefined();
    expect(p.screen()).toBe(at);
  });

  test('no `readalong` on the serve (the switch off): today\'s line-lit clip at once, nothing new fetched', async () => {
    const p = room('en', { pre: [LATE], routes: { 'ch/HUB.TOKEN/read': ok(SREAD('en')) }, scripts: { '/wq/wq-readalong.js': STUB } });
    await p.flush();
    await p.click('wqc-story-along');
    expect(p.loaded.filter((s) => /wq-readalong/.test(s))).toEqual([]);
    expect(aud(p).map((x) => x.url)).toEqual([CLIP.url]);
  });
});

// A replayed practice read's "hear it first": the same late player, the same wait (today: Jugnu is skipped).
describe('"hear it first" on a replayed practice read, with the player late', () => {
  const V2P = { pool: true, story: false, consent: false };
  const PREAD = (extra = {}) => ({ ex: 'read', ct: 'CTP', secs: 60, clips: CLIPS, story: STORY, trail: true, trail_copy: TC, v2: V2P, practice_round: true, mode: 'practice', questions_on: false, ...extra });
  const trail = (o = {}) => H.page({ menu: { ...MENU('en'), v2: V2P }, href: 'https://portal.test/c/HUB.TOKEN?kid=&lang=en', freshEls: true, session: store(), ...o, pre: [AUDIO, ...(o.pre || []), TRAIL_SRC] });
  test('"Read along" waits for the player and plays it; "I\'m ready" then goes on to the read\'s intro', async () => {
    const p = trail({ pre: [LATE], routes: { 'ch/HUB.TOKEN/read': ok(PREAD({ hear_first: EN_TIMED })) }, scripts: { '/wq/wq-readalong.js': STUB } });
    await p.flush();
    await p.click('wqc-ex-read');
    expect(p.screen()).toBe('hear-ask');
    await p.click('wqc-hear-along');
    expect(p.screen()).toBe('story-along');   // today: straight to the intro, Jugnu never reads
    p.win.__release();
    await p.flush();
    expect(p.win.__ra.d).toEqual(EN_TIMED);
    expect(p.win.__ra.plays).toBe(1);
    await p.click('wqc-along-read');
    expect(p.screen()).toBe('intro');
  });
  test('the player fails while the child waits: on to the intro, as when it never loads', async () => {
    const p = trail({ pre: [LATE], routes: { 'ch/HUB.TOKEN/read': ok(PREAD({ hear_first: EN_TIMED })) }, scripts: { '/wq/wq-readalong.js': STUB } });
    await p.flush();
    await p.click('wqc-ex-read');
    await p.click('wqc-hear-along');
    p.win.__fail();
    await p.flush();
    expect(p.screen()).toBe('intro');
  });
});

// The real player on the Urdu story's timing object: one span per word, the pill moves, the events fire
// (its own fake DOM and audio clock, as web-quiz-readalong.service.test.js runs it).
describe('the real player on the Urdu G2 story\'s timing object', () => {
  function node(tag) {
    const n = {
      tag, children: [], attrs: {}, style: {}, l: {}, className: '', _text: '',
      appendChild(c) { n.children.push(c); return c; },
      setAttribute(k, v) { n.attrs[k] = String(v); }, getAttribute(k) { return n.attrs[k]; }, removeAttribute(k) { delete n.attrs[k]; },
      addEventListener(e, fn) { (n.l[e] = n.l[e] || []).push(fn); }, removeEventListener(e, fn) { n.l[e] = (n.l[e] || []).filter((f) => f !== fn); },
    };
    Object.defineProperty(n, 'textContent', { get: () => n._text + n.children.map((c) => c.textContent).join(''), set: (v) => { n._text = String(v); n.children = []; } });
    Object.defineProperty(n, 'innerHTML', { get: () => '', set: () => { n.children = []; n._text = ''; } });
    return n;
  }
  const all = (n, pred, out = []) => { if (pred(n)) out.push(n); n.children.forEach((c) => all(c, pred, out)); return out; };
  const byClass = (n, c) => all(n, (x) => String(x.className).split(' ').includes(c));
  test('38 words ⇒ 38 `.wqra-w` spans, and `wq:readalong` started + word events as Jugnu\'s clock moves', () => {
    const frames = [];
    const events = [];
    const audios = [];
    class Audio {
      constructor() { this.l = {}; this.currentTime = 0; this.duration = NaN; this.paused = true; this.attrs = {}; audios.push(this); }
      set src(v) { this.attrs.src = v; } get src() { return this.attrs.src; }
      removeAttribute(k) { delete this.attrs[k]; } load() {}
      addEventListener(n, fn) { (this.l[n] = this.l[n] || []).push(fn); } removeEventListener(n, fn) { this.l[n] = (this.l[n] || []).filter((f) => f !== fn); }
      play() { this.paused = false; return Promise.resolve(); } pause() { this.paused = true; }
    }
    const head = node('head');
    const document = { head, body: node('body'), visibilityState: 'visible', createElement: (t) => node(t),
      createTextNode: (t) => { const n = node('#text'); n.textContent = t; return n; },
      getElementById: (id) => all(head, (x) => x.id === id)[0] || null, addEventListener() {}, removeEventListener() {} };
    function CustomEvent(type, init) { this.type = type; this.detail = init && init.detail; }
    const window = { addEventListener() {}, removeEventListener() {}, dispatchEvent(e) { events.push(e.detail); },
      requestAnimationFrame: (fn) => { frames.push(fn); return frames.length; }, cancelAnimationFrame: (h) => { frames[h - 1] = null; } };
    const ctx = { window, document, Audio, CustomEvent, console, setTimeout, clearTimeout, Promise, fetch: () => Promise.reject(new Error('no net')) };
    vm.createContext(ctx);
    vm.runInContext(RA_SRC, ctx);
    const host = node('div');
    const p = window.WQReadAlong.mount(host, UR_TIMED, { labels: { play: 'سنیں', pause: 'روکیں', replay: 'دوبارہ سنیں' } });
    expect(UR_WORDS).toHaveLength(38);
    expect(byClass(host, 'wqra-w')).toHaveLength(38);
    p.play();
    const a = audios[audios.length - 1];
    for (const ms of [0, 700, 1400, 2100]) { a.currentTime = ms / 1000; frames.splice(0).forEach((f) => f && f()); }
    expect(byClass(host, 'wqra-on')).toHaveLength(1);
    const types = events.map((e) => e && e.type);
    expect(types).toContain('started');
    expect(types.filter((x) => x === 'word').length).toBeGreaterThanOrEqual(3);
  });
});

// The live read on the same passage: one span per printed word, the heard ones green (one green).
describe('the live read on the Urdu story lights its words', () => {
  const KEY = { api_key: 'temp:key-test-only', expires_at: 'x', ws: 'wss://stt.test/ws', model: 'stt-rt-v5', lang: 'ur' };
  const LR3 = { meter: 'glow', done: true, done_from: 0, counted: false, finish: { pct: 0.75, quiet_ms: 4000, tail_ms: 1000, quiet: true } };
  const WS = 'var __socks = []; window.WebSocket = function (u) { this.url = u; this.sent = []; this.bufferedAmount = 0; __socks.push(this); };'
    + 'window.WebSocket.prototype.send = function (x) { this.sent.push(x); }; window.WebSocket.prototype.close = function () { this.closed = true; };'
    + 'window.dispatchEvent = function () { return true; }; CustomEvent = function (n, o) { this.type = n; this.detail = o && o.detail; };';
  const toks = (ws) => ws.map((w, k) => ({ text: (k === 0 ? '' : ' ') + w, start_ms: k * 600, end_ms: k * 600 + 500, is_final: true }));
  test('the read screen has one span per word (38) and the words heard light green', async () => {
    const p = H.page({ menu: MENU('ur', { lr3: true }), lang: 'ur', href: ROOM('ur'), kid: 'KID1', freshEls: true, session: store(),
      routes: { 'ch/HUB.TOKEN/read': ok(SREAD('ur', { live: true, lr3: LR3, readalong: UR_TIMED })), 'ch/live': ok(KEY) },
      scripts: { '/wq/wq-readalong.js': STUB }, pre: [LIVE_SRC, WS, LR_SRC, TRAIL_SRC] });
    await p.flush();
    await p.click('wqc-story-read');
    await p.flush();
    expect(p.screen()).toBe('read-live');
    const s = p.ctx.__socks[0];
    s.onopen({});
    s.onmessage({ data: JSON.stringify({ tokens: toks(UR_WORDS.slice(0, 5)) }) });
    const live = p.els['wqc-live-story'].innerHTML;
    expect((live.match(/class="wqc-w[^"]*" data-i="/g) || []).length).toBe(38);
    expect((live.match(/wqc-ok/g) || []).length).toBe(5);
  });
});

// ── the fallback never moves on by itself (word timings on the serve) ─────────────────────────────────
describe('the line-lit fallback, when the passage has word timings', () => {
  test.each(['en', 'ur'])('%s: the player failed — the clip plays, ends, errors or is refused, and the screen stays until "I\'m ready"', async (lang) => {
    for (const how of ['ended', 'error']) {
      const p = room(lang, { pre: [LATE], routes: { 'ch/HUB.TOKEN/read': ok(SREAD(lang, { readalong: lang === 'ur' ? UR_TIMED : EN_TIMED })) }, scripts: { '/wq/wq-readalong.js': STUB } });
      await p.flush();
      await p.click('wqc-story-along');
      p.win.__fail();
      await p.flush();
      const a = aud(p)[0];
      expect(a.url).toBe(CLIP.url);
      a.fire(how);
      await p.runTimers();
      expect(p.screen()).toBe('story-along');     // today: the clip's end goes to the read by itself
      await p.click('wqc-along-read');
      expect(p.screen()).not.toBe('story-along');
    }
  });
  test('the player failed and there is no old clip: the passage stays on the along screen with "I\'m ready" (today: straight to the read)', async () => {
    const p = room('en', { pre: [LATE], routes: { 'ch/HUB.TOKEN/read': ok(SREAD('en', { readalong: EN_TIMED, story_clip: undefined })) }, scripts: { '/wq/wq-readalong.js': STUB } });
    await p.flush();
    await p.click('wqc-story-along');
    p.win.__fail();
    await p.flush();
    expect(p.screen()).toBe('story-along');
    expect(p.has('wqc-along-read')).toBe(true);
  });
  test('no word timings (the switch off): today\'s line-lit clip still goes to the read when it ends', async () => {
    const p = room('en', { routes: { 'ch/HUB.TOKEN/read': ok(SREAD('en')) } });
    await p.flush();
    await p.click('wqc-story-along');
    aud(p)[0].fire('ended');
    await p.flush();
    expect(p.screen()).not.toBe('story-along');
  });
});

// ── the result reaches the end card (its ranked next thing) ─────────────────────────────────────────
const FCSTUB = 'window.__fc = []; window.WQFC = { unheard: function () { return false; }, trailEnd: function (h, o) { window.__fc.push({ name: o.name, story: o.story, r: o.r }); return false; } };';
const NEXT = { kind: 'video', href: '/h/HUB.TOKEN?kid=KID1&from=next#watch', title: 'Watch: Plants', offer: 'video' };
const QS = { 'ch/qs': ok({ questions: [{ id: 'q1', prompt: 'Who made the sweet?', options: ['Ammi', 'Abbu'] }] }), 'ch/qa': ok({ ok: true, answer: 'Ammi' }) };
const UP = { 'ch/upload': ok({ put_url: 'https://store.test/put', content_type: 'audio/webm', key: 'k1' }), 'store.test': ok({}) };
const RESULT = (extra = {}) => ({ score: { correct: 9, attempted: 10 }, next_offer: NEXT, ...extra });
// a story read on the recording path (no live words): mic → read → Stop → the result answers
const readThrough = async (p) => {
  await p.flush();
  await p.click('wqc-story-read');
  await p.flush();
  for (let i = 0; i < 6 && !/^read-(rec|live)$/.test(p.screen()); i += 1) {
    if (p.has('wqc-notice-ok')) await p.click('wqc-notice-ok');
    else if (p.has('wqc-mic-go')) await p.click('wqc-mic-go');
    else if (p.has('wqc-go')) await p.click('wqc-go');
    else await p.runTimers();
    await p.flush();
  }
  if (p.has('wqc-done')) await p.click('wqc-done');
  else if (p.has('wqc-stop')) await p.click('wqc-stop');
  for (let i = 0; i < 3; i += 1) { await p.runTimers(); await p.flush(); }
};
const fcRoom = (lang, o = {}) => room(lang, { menuExtra: { card_v3: true }, ...o, pre: [FCSTUB, ...(o.pre || [])] });

describe('Story Time hands its result to the end card', () => {
  test.each(['en', 'ur'])('%s: the read\'s result (with its ranked next thing) reaches the card, and again after the story\'s questions', async (lang) => {
    const p = fcRoom(lang, { routes: { 'ch/HUB.TOKEN/read': ok(SREAD(lang, { questions_on: true })), ...UP, 'ch/result': ok(RESULT()), ...QS } });
    await readThrough(p);
    expect(p.screen()).toBe('read-result');
    const first = p.win.__fc.filter((x) => x.name === 'read-result').pop();
    expect(first.story).toBe(true);
    expect(first.r && first.r.next_offer).toEqual(NEXT);     // today: no result is handed over
    await p.click('wqc-qa');
    await p.flush();
    await p.click('wqc-o0');
    for (let i = 0; i < 3; i += 1) { await p.runTimers(); await p.flush(); }
    expect(p.screen()).toBe('qa-done');
    const after = p.win.__fc.filter((x) => x.name === 'qa-done').pop();
    expect(after.r && after.r.next_offer).toEqual(NEXT);
  });

  test('a live story read: the checked result (with its next thing) comes after the card and reaches it; without the card switch nothing is redrawn', async () => {
    const KEY = { api_key: 'temp:key-test-only', expires_at: 'x', ws: 'wss://stt.test/ws', model: 'stt-rt-v5', lang: 'en' };
    const LR3 = { meter: 'glow', done: true, done_from: 0, counted: false, finish: { pct: 0.8, quiet_ms: 4000, tail_ms: 1000, quiet: true } };
    const WS = 'var __socks = []; window.WebSocket = function (u) { this.url = u; this.sent = []; this.bufferedAmount = 0; __socks.push(this); };'
      + 'window.WebSocket.prototype.send = function (x) { this.sent.push(x); }; window.WebSocket.prototype.close = function () { this.closed = true; };'
      + 'window.dispatchEvent = function () { return true; }; CustomEvent = function (n, o) { this.type = n; this.detail = o && o.detail; };';
    const toks = (ws) => ws.map((w, k) => ({ text: (k === 0 ? '' : ' ') + w, start_ms: k * 1000, end_ms: k * 1000 + 800, is_final: true }));
    for (const card of [true, false]) {
      const clock = { t: 1000000 };
      const p = H.page({ menu: MENU('en', { lr3: true, ...(card ? { card_v3: true } : {}) }), lang: 'en', href: ROOM('en'), kid: 'KID1', freshEls: true, session: store(), clock,
        routes: { 'ch/HUB.TOKEN/read': ok(SREAD('en', { live: true, lr3: LR3 })), 'ch/live': ok(KEY), ...UP, 'ch/result': ok(RESULT()) },
        pre: [AUDIO, FCSTUB, LIVE_SRC, WS, LR_SRC, TRAIL_SRC] });
      await p.flush();
      await p.click('wqc-story-read');
      await p.flush();
      const s = p.ctx.__socks[0];
      s.onopen({});
      s.onmessage({ data: JSON.stringify({ tokens: toks(STORY.tokens) }) });
      await p.flush();
      clock.t += 1100;
      await p.runTimers((x) => x.ms === 1000);
      s.onmessage({ data: JSON.stringify({ tokens: [], finished: true }) });
      for (let i = 0; i < 4; i += 1) { await p.runTimers(); await p.flush(); }
      expect(p.screen()).toBe('read-result');
      const got = p.win.__fc.filter((x) => x.name === 'read-result');
      if (card) expect(got.some((x) => x.r && x.r.next_offer && x.r.next_offer.href === NEXT.href)).toBe(true);
      else expect(got.some((x) => x.r && x.r.next_offer)).toBe(false);
    }
  });
});
