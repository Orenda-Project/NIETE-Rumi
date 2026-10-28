/**
 * The word-by-word read-along in Story Time (public/wq/wq-trail.js + wq-readalong.js, switch web_quiz_readalong on
 * the server): a story serve that carries `readalong` fetches the player before the child's tap; "Read along with
 * Jugnu" mounts it on the timing data and starts the voice inside that tap; "I'm ready" drops it and goes to the
 * normal read. A serve without `readalong` (the switch off) loads nothing new and plays today's line-lit read-along.
 * The player is a stub here (its own behaviour: web-quiz-readalong.service.test.js); only the network is faked.
 */
const fs = require('fs');
const path = require('path');
const H = require('./wqc-page-harness');
const { ok, CLIPS, STORY } = H;

const TRAIL_SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'wq-trail.js'), 'utf8');
const TC = {
  title: "{name}'s Trail", sub: '{done} of {total} stops done.', allDone: 'All done', badge: 'Done', next: 'Next', mic: 'uses the microphone',
  needsMic: 'needs a microphone', micWait: 'wait', other: 'Go to another stop', back: 'Back to the trail', practice: 'Practice round.', stopDone: 'Stop done!',
};
const EXS = [
  { id: 'read', name: 'Read aloud', mins: 2, done: false, last: null, badge: false, mic: true },
  { id: 'listen', name: 'Listen', mins: 2, done: false, last: null, badge: false },
];
const V2 = (story) => ({ pool: true, story, consent: false });
const MENU = (story = true, lang = 'en') => ({ lang, form: 'G3', record: true, trail: true, trail_copy: TC, exercises: EXS, v2: V2(story) });
const PID = 'en.read.1.kite';
const ROOM = `https://portal.test/c/HUB.TOKEN?kid=&lang=en&room=story&pid=${PID}`;
const CLIP = { url: '/clips/story-kite.mp3' };
// the serve's story payload: today's read / listen payload + practice_round + mode practice (+ the story flag)
const SREAD = (extra = {}) => ({ ex: 'read', ct: 'CTS', secs: 60, clips: CLIPS, story: STORY, story_clip: CLIP, trail: true, trail_copy: TC, v2: V2(true), practice_round: true, mode: 'practice', questions_on: false, ...extra });
const SLISTEN = (extra = {}) => ({ ex: 'listen', ct: 'CTL', clips: CLIPS, story_clip: CLIP, read_times: 2, trail: true, trail_copy: TC, v2: V2(true), practice_round: true, mode: 'practice', story: true, ...extra });
// the browser's audio, held so a test can say "the clip ended" / "the clip is half way"
const AUDIO = 'var __aud = []; Audio = function (u) { this.url = u; this.l = {}; this.currentTime = 0; this.duration = NaN; __aud.push(this); };'
  + 'Audio.prototype.addEventListener = function (n, fn) { (this.l[n] = this.l[n] || []).push(fn); };'
  + 'Audio.prototype.play = function () { this.playing = true; return Promise.resolve(); };'
  + 'Audio.prototype.pause = function () { this.playing = false; };'
  + 'Audio.prototype.fire = function (n) { (this.l[n] || []).forEach(function (fn) { fn({}); }); };';
const NO_NET = 'var __f = fetch; var __tried = []; fetch = function (u, i) { if (/room=story/.test(u)) { __tried.push(u); return Promise.reject(new TypeError("Failed to fetch")); } return __f(u, i); };';
const store = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
const room = (o = {}) => H.page({ menu: MENU(), href: ROOM, freshEls: true, session: store(), ...o, pre: [AUDIO, ...(o.pre || []), TRAIL_SRC] });
const chUrls = (p) => p.fetches.map((f) => f.url).filter((u) => /^\/api\/wq\/ch/.test(u));
const text = (h) => h.replace(/<[^>]+>/g, ' ');
const aud = (p) => p.ctx.__aud;
// every story screen: no number at all, no score / words-a-minute / "N of M" / record line
const clean = (h) => {
  const s = text(h);
  expect(s).not.toMatch(/[0-9۰-۹]/);
  expect(s).not.toMatch(/words a minute|words in a minute|last time| of |record/i);
  expect(h).not.toContain('wqc-score');
  expect(h).not.toContain('wqc-wpm');
};


const crypto = require('crypto');
const RA_FILE = path.join(__dirname, '..', 'public', 'wq', 'wq-readalong.js');
// a stand-in player: records what it was given and what was asked of it
const STUB = 'window.WQReadAlong = { mount: function (el, d, o) { var r = window.__ra = { el: el, d: d, o: o, plays: 0, destroyed: 0 };'
  + ' return { play: function () { r.plays += 1; }, destroy: function () { r.destroyed += 1; } }; } };';
const TIMED = { v: 1, id: PID, lang: 'en', dir: 'ltr', audio: { url: 'https://signed.test/readalong/a.ogg', ms: 9000, mime: 'audio/ogg; codecs=opus' },
  words: STORY.text.split(/\s+/).map((t, i) => ({ i, t, s_ms: i * 500, e_ms: i * 500 + 400 })), pace_wpm: 100 };
const raLoads = (p) => p.loaded.filter((s) => /wq-readalong\.js/.test(s));

describe('a story serve with `readalong`', () => {
  test('the player is fetched when the story opens (before any tap), at its own content version', async () => {
    const p = room({ routes: { 'ch/HUB.TOKEN/read': ok(SREAD({ readalong: TIMED })) }, scripts: { '/wq/wq-readalong.js': STUB } });
    await p.flush();
    expect(p.screen()).toBe('story-ask');
    const v = crypto.createHash('sha256').update(fs.readFileSync(RA_FILE)).digest('hex').slice(0, 10);
    expect(raLoads(p)).toEqual([`/wq/wq-readalong.js?v=${v}`]);
  });

  test('"Read along with Jugnu" mounts the player on the timing data and plays inside the tap; no old clip plays', async () => {
    const p = room({ routes: { 'ch/HUB.TOKEN/read': ok(SREAD({ readalong: TIMED })) }, scripts: { '/wq/wq-readalong.js': STUB } });
    await p.flush();
    await p.click('wqc-story-along');
    expect(p.screen()).toBe('story-along');
    const ra = p.win.__ra;
    expect(ra.d).toEqual(TIMED);
    expect(ra.el).toBe(p.els['wqc-along-ra']);
    expect(ra.plays).toBe(1);
    expect(ra.o.labels).toEqual({ play: 'Play', pause: 'Pause', replay: 'Hear it again' });
    expect(aud(p)).toEqual([]);           // the line-lit clip is not played
    clean(p.html());
    // nothing moves on by itself; "I'm ready" drops the player and goes to the normal read
    await p.runTimers();
    expect(p.screen()).toBe('story-along');
    await p.click('wqc-along-read');
    expect(ra.destroyed).toBe(1);
    expect(['mic-ask', 'read-ready', 'read-rec']).toContain(p.screen());
  });

  test('Urdu: the player\'s labels are the Urdu ones', async () => {
    const p = room({ menu: MENU(true, 'ur'), lang: 'ur', href: ROOM.replace('lang=en', 'lang=ur'),
      routes: { 'ch/HUB.TOKEN/read': ok(SREAD({ readalong: { ...TIMED, lang: 'ur', dir: 'rtl' } })) }, scripts: { '/wq/wq-readalong.js': STUB } });
    await p.flush();
    await p.click('wqc-story-along');
    expect(p.win.__ra.o.labels).toEqual({ play: 'سنیں', pause: 'روکیں', replay: 'دوبارہ سنیں' });
  });

  test('`readalong` without the old clip still offers "Read along with Jugnu"', async () => {
    const p = room({ routes: { 'ch/HUB.TOKEN/read': ok(SREAD({ readalong: TIMED, story_clip: undefined })) }, scripts: { '/wq/wq-readalong.js': STUB } });
    await p.flush();
    expect(p.screen()).toBe('story-ask');
    await p.click('wqc-story-along');
    expect(p.win.__ra.plays).toBe(1);
  });

  test('the player did not arrive (blocked, offline): the line-lit read-along plays as today', async () => {
    const p = room({ routes: { 'ch/HUB.TOKEN/read': ok(SREAD({ readalong: TIMED })) } });   // no script: the load fails
    await p.flush();
    await p.click('wqc-story-along');
    expect(aud(p).map((x) => x.url)).toEqual([CLIP.url]);
  });
});

describe('a story serve without `readalong` (the switch off): today\'s page', () => {
  test('nothing new is fetched and the line-lit clip plays', async () => {
    const p = room({ routes: { 'ch/HUB.TOKEN/read': ok(SREAD()) }, scripts: { '/wq/wq-readalong.js': STUB } });
    await p.flush();
    await p.click('wqc-story-along');
    expect(raLoads(p)).toEqual([]);
    expect(p.win.__ra).toBeUndefined();
    expect(aud(p).map((x) => x.url)).toEqual([CLIP.url]);
  });
});

// The same player on practice runs outside Story Time's read: a replayed read's "hear it first" (`hear_first`, inlined)
// and a practice listen's "Show me the words" after its questions (`show_words`: a flag; the words come by the run
// token only once the questions are done). Never on a counted run or a class round.
const TRAIL_HREF = 'https://portal.test/c/HUB.TOKEN?kid=&lang=en';
const trail = (o = {}) => H.page({ menu: MENU(false), href: TRAIL_HREF, freshEls: true, session: store(), ...o, pre: [AUDIO, ...(o.pre || []), TRAIL_SRC] });
const PREAD = (extra = {}) => ({ ex: 'read', ct: 'CTP', secs: 60, clips: CLIPS, story: STORY, trail: true, trail_copy: TC, v2: V2(false), practice_round: true, mode: 'practice', questions_on: false, ...extra });
const QS = { 'ch/qs': ok({ questions: [{ id: 'q1', prompt: 'Who woke up?', options: ['Imran', 'Ali'] }] }), 'ch/qa': ok({ ok: true, answer: 'Imran' }) };
const toQaDone = async (p) => {
  await p.click('wqc-go');
  const a = aud(p).find((x) => x.url === CLIP.url);
  a.fire('ended'); await p.runTimers(); a.fire('ended'); await p.flush();
  await p.click('wqc-o0'); await p.runTimers(); await p.flush();
  await p.runTimers(); await p.flush();   // the words' answer, then the card drawn again with the button
};
const wordsAsked = (p) => p.fetches.map((f) => f.url).filter((u) => /ch\/words\//.test(u));

describe('(b) a practice read: "hear it first"', () => {
  test('a replayed read with `hear_first`: the player is fetched, the child is asked (hear it or read it); "Read along" plays it inside the tap; "I\'m ready" goes on to the read\'s intro', async () => {
    const p = trail({ routes: { 'ch/HUB.TOKEN/read': ok(PREAD({ hear_first: TIMED })) }, scripts: { '/wq/wq-readalong.js': STUB } });
    await p.flush();
    await p.click('wqc-ex-read');
    expect(raLoads(p)).toHaveLength(1);
    expect(p.screen()).toBe('hear-ask');
    expect(p.html()).toContain('Hear it from me first, or read it yourself.');
    await p.click('wqc-hear-along');
    expect(p.screen()).toBe('story-along');
    expect(p.win.__ra.d).toEqual(TIMED);
    expect(p.win.__ra.plays).toBe(1);
    await p.click('wqc-along-read');
    expect(p.win.__ra.destroyed).toBe(1);
    expect(p.screen()).toBe('intro');
  });
  test('"I\'m ready" on the ask goes straight to the intro; nothing plays', async () => {
    const p = trail({ routes: { 'ch/HUB.TOKEN/read': ok(PREAD({ hear_first: TIMED })) }, scripts: { '/wq/wq-readalong.js': STUB } });
    await p.flush();
    await p.click('wqc-ex-read');
    await p.click('wqc-hear-read');
    expect(p.screen()).toBe('intro');
    expect(p.win.__ra).toBeUndefined();
  });
  test('without `hear_first` (switch off), on a counted read, or in a class round: today\'s intro, nothing fetched', async () => {
    for (const d of [PREAD(), PREAD({ hear_first: TIMED, practice_round: undefined, mode: 'check' }), PREAD({ hear_first: TIMED, practice_round: undefined, round_turn: true })]) {
      const p = trail({ routes: { 'ch/HUB.TOKEN/read': ok(d) }, scripts: { '/wq/wq-readalong.js': STUB }, session: (() => { const s = store(); s.setItem('wqc_helped_v2:', 'self'); return s; })() });
      await p.flush();
      await p.click('wqc-ex-read');
      expect(['intro', 'help-ask']).toContain(p.screen());
      expect(raLoads(p)).toHaveLength(0);
    }
  });
  test('the player cannot load: "Read along" falls through to the intro, never a dead end', async () => {
    const p = trail({ routes: { 'ch/HUB.TOKEN/read': ok(PREAD({ hear_first: TIMED })) } });
    await p.flush();
    await p.click('wqc-ex-read');
    await p.click('wqc-hear-along');
    expect(p.screen()).toBe('intro');
  });
});

describe('(d) a practice listen: "Show me the words" after the questions', () => {
  test('Story Time listen with `show_words`: nothing asked before the questions end; then the words come by the run token and the button mounts the player inside the tap', async () => {
    const p = room({ href: `${ROOM}&ex=listen`, scripts: { '/wq/wq-readalong.js': STUB },
      routes: { 'ch/HUB.TOKEN/listen': ok(SLISTEN({ show_words: true })), 'ch/words/CTL': ok({ readalong: TIMED }), ...QS } });
    await p.flush();
    expect(wordsAsked(p)).toHaveLength(0);
    await p.click('wqc-go');
    expect(wordsAsked(p)).toHaveLength(0);   // never while the story is heard or its questions asked
    await toQaDoneFromPlay(p);
    expect(p.screen()).toBe('qa-done');
    expect(wordsAsked(p)).toEqual(['/api/wq/ch/words/CTL?lang=en']);
    expect(p.html()).toContain('Show me the words');
    await p.click('wqc-show-words');
    expect(p.screen()).toBe('listen-words');
    expect(p.win.__ra.d).toEqual(TIMED);
    expect(p.win.__ra.plays).toBe(1);
    await p.click('wqc-menu');
  });
  test('a trail practice listen (not Story Time) gets the same button on its end card', async () => {
    const p = trail({ scripts: { '/wq/wq-readalong.js': STUB },
      routes: { 'ch/HUB.TOKEN/listen': ok(SLISTEN({ show_words: true, story: undefined, v2: V2(false) })), 'ch/words/CTL': ok({ readalong: TIMED }), ...QS } });
    await p.flush();
    await p.click('wqc-ex-listen');
    await toQaDone(p);
    expect(p.screen()).toBe('qa-done');
    expect(p.html()).toContain('Show me the words');
    await p.click('wqc-show-words');
    expect(p.screen()).toBe('listen-words');
  });
  test('with the finish card\'s hook on the page: the end card calls it (it draws nothing on a practice run) and still gets the button', async () => {
    const FC = 'window.__fc = []; window.WQFC = { trailEnd: function (h, o) { window.__fc.push(o.name); return false; } };';
    const p = trail({ pre: [FC], scripts: { '/wq/wq-readalong.js': STUB },
      routes: { 'ch/HUB.TOKEN/listen': ok(SLISTEN({ show_words: true, story: undefined, v2: V2(false) })), 'ch/words/CTL': ok({ readalong: TIMED }), ...QS } });
    await p.flush();
    await p.click('wqc-ex-listen');
    await toQaDone(p);
    expect(p.screen()).toBe('qa-done');
    expect(p.win.__fc.length).toBeGreaterThanOrEqual(1);   // the merged line runs on every draw of the card
    expect(p.html()).toContain('Show me the words');
    await p.click('wqc-show-words');
    expect(p.screen()).toBe('listen-words');
  });
  test('no `show_words`, a counted listen, or the words refused: today\'s end card, no button', async () => {
    for (const [d, words] of [[SLISTEN(), ok({ readalong: TIMED })], [SLISTEN({ show_words: true }), () => ({ status: 404, body: { error: 'no_words' } })]]) {
      const p = room({ href: `${ROOM}&ex=listen`, scripts: { '/wq/wq-readalong.js': STUB }, routes: { 'ch/HUB.TOKEN/listen': ok(d), 'ch/words/CTL': words, ...QS } });
      await p.flush();
      await p.click('wqc-go');
      await toQaDoneFromPlay(p);
      expect(p.screen()).toBe('qa-done');
      expect(p.html()).not.toContain('Show me the words');
      expect(p.has('wqc-show-words')).toBe(false);
    }
    const c = trail({ scripts: { '/wq/wq-readalong.js': STUB },
      routes: { 'ch/HUB.TOKEN/listen': ok(SLISTEN({ show_words: true, story: undefined, v2: V2(false), practice_round: undefined, mode: 'check' })), 'ch/words/CTL': ok({ readalong: TIMED }), ...QS },
      session: (() => { const s = store(); s.setItem('wqc_helped_v2:', 'self'); return s; })() });
    await c.flush();
    await c.click('wqc-ex-listen');
    if (c.screen() === 'help-ask') await c.click('wqc-help-self');
    await toQaDone(c);
    expect(wordsAsked(c)).toHaveLength(0);
    expect(c.has('wqc-show-words')).toBe(false);
  });
  test('Urdu: the button reads in Urdu', async () => {
    const p = room({ menu: MENU(true, 'ur'), lang: 'ur', href: `${ROOM.replace('lang=en', 'lang=ur')}&ex=listen`, scripts: { '/wq/wq-readalong.js': STUB },
      routes: { 'ch/HUB.TOKEN/listen': ok(SLISTEN({ show_words: true })), 'ch/words/CTL\\?lang=ur': ok({ readalong: { ...TIMED, lang: 'ur' } }), ...QS } });
    await p.flush();
    await p.click('wqc-go');
    await toQaDoneFromPlay(p);
    expect(p.html()).toContain(URDU_SHOW_WORDS);
  });
});
async function toQaDoneFromPlay(p) {
  const a = aud(p).find((x) => x.url === CLIP.url);
  a.fire('ended'); await p.runTimers(); a.fire('ended'); await p.flush();
  await p.click('wqc-o0'); await p.runTimers(); await p.flush();
  await p.runTimers(); await p.flush();
}
const URDU_SHOW_WORDS = 'الفاظ دکھائیں';

// The first sound: on the ask screen (where the story is listened to) the mounted item's clip is warmed once the
// player script is here — WQReadAlong.preload(timing): one request, no decode, no play. Nothing else preloads.
const PRE_STUB = STUB + 'window.__pre = []; window.WQReadAlong.preload = function (d) { window.__pre.push(d); return {}; };';
describe('the first sound: the clip is warmed on the ask screen, never played', () => {
  test('Story Time read: the ask screen warms `readalong` once the player arrives; still nothing plays until the tap', async () => {
    const p = room({ routes: { 'ch/HUB.TOKEN/read': ok(SREAD({ readalong: TIMED })) }, scripts: { '/wq/wq-readalong.js': PRE_STUB } });
    await p.flush();
    expect(p.screen()).toBe('story-ask');
    expect(p.win.__pre).toEqual([TIMED]);
    expect(p.win.__ra).toBeUndefined();
    await p.click('wqc-story-along');
    expect(p.win.__ra.plays).toBe(1);
    expect(p.win.__pre).toHaveLength(1);   // warmed once, never again
  });
  test('a replayed read: the hear-first ask warms `hear_first`', async () => {
    const p = trail({ routes: { 'ch/HUB.TOKEN/read': ok(PREAD({ hear_first: TIMED })) }, scripts: { '/wq/wq-readalong.js': PRE_STUB } });
    await p.flush();
    await p.click('wqc-ex-read');
    expect(p.screen()).toBe('hear-ask');
    expect(p.win.__pre).toEqual([TIMED]);
  });
  test('the warmed element is let go once the ask is answered (after the player plays, or at once on "I\'m ready")', async () => {
    const REL = STUB + 'window.__rel = []; window.WQReadAlong.preload = function (d) { var a = { d: d, removeAttribute: function (k) { window.__rel.push("drop:" + k); }, load: function () { window.__rel.push("load"); } }; return a; };';
    const p = room({ routes: { 'ch/HUB.TOKEN/read': ok(SREAD({ readalong: TIMED })) }, scripts: { '/wq/wq-readalong.js': REL } });
    await p.flush();
    expect(p.win.__rel).toEqual([]);
    await p.click('wqc-story-along');
    expect(p.win.__ra.plays).toBe(1);
    expect(p.win.__rel).toEqual(['drop:src', 'load']);
    const q = room({ routes: { 'ch/HUB.TOKEN/read': ok(SREAD({ readalong: TIMED })) }, scripts: { '/wq/wq-readalong.js': REL } });
    await q.flush();
    await q.click('wqc-story-read');
    expect(q.win.__rel).toEqual(['drop:src', 'load']);
    const r = trail({ routes: { 'ch/HUB.TOKEN/read': ok(PREAD({ hear_first: TIMED })) }, scripts: { '/wq/wq-readalong.js': REL } });
    await r.flush();
    await r.click('wqc-ex-read');
    expect(r.screen()).toBe('hear-ask');
    await r.click('wqc-hear-along');
    expect(r.win.__rel).toEqual(['drop:src', 'load']);
  });
  test('no ask screen (no timing, or a counted read): nothing is warmed', async () => {
    const p = trail({ routes: { 'ch/HUB.TOKEN/read': ok(PREAD()) }, scripts: { '/wq/wq-readalong.js': PRE_STUB } });
    await p.flush();
    await p.click('wqc-ex-read');
    expect(p.win.__pre).toBeUndefined();
  });
  test('the player already on the page: the trail menu, a counted read\'s intro and a practice listen\'s end card (its words fetched) warm nothing', async () => {
    const helped = () => { const s = store(); s.setItem('wqc_helped_v2:', 'self'); return s; };
    const c = trail({ pre: [PRE_STUB], session: helped(), routes: { 'ch/HUB.TOKEN/read': ok(PREAD({ hear_first: TIMED, practice_round: undefined, mode: 'check' })) } });
    await c.flush();
    expect(c.win.WQReadAlong.preload).toBeDefined();
    expect(c.win.__pre).toEqual([]);          // the menu
    await c.click('wqc-ex-read');
    expect(['intro', 'help-ask']).toContain(c.screen());
    expect(c.win.__pre).toEqual([]);          // a counted read's intro
    const l = trail({ pre: [PRE_STUB], routes: { 'ch/HUB.TOKEN/listen': ok(SLISTEN({ show_words: true, story: undefined, v2: V2(false) })), 'ch/words/CTL': ok({ readalong: TIMED }), ...QS } });
    await l.flush();
    await l.click('wqc-ex-listen');
    await toQaDone(l);
    expect(l.screen()).toBe('qa-done');
    expect(wordsAsked(l)).toEqual(['/api/wq/ch/words/CTL?lang=en']);
    expect(l.win.__pre).toEqual([]);          // the end card, the words in hand: still nothing warmed
  });
});

// ONE primary on a screen (ORG: every screen has one primary action): with the sound kit on (web_quiz_juice),
// «Read along with Jugnu» is the one filled button and «I'm ready» the outlined one; off, today's two buttons.
describe('story-ask: one primary with the kit on', () => {
  const KIT = 'window.WQJ = { correct: function () {}, wrong: function () {}, finish: function () {} };';
  const prim = (h) => (h.match(/data-primary/g) || []).length;
  test('kit on: «Read along with Jugnu» is the one data-primary; «I\'m ready» is outlined', async () => {
    const p = room({ pre: [KIT], routes: { 'ch/HUB.TOKEN/read': ok(SREAD({ readalong: TIMED })) }, scripts: { '/wq/wq-readalong.js': STUB } });
    await p.flush();
    expect(p.screen()).toBe('story-ask');
    expect(prim(p.html())).toBe(1);
    expect(p.html()).toMatch(/<button class="wq-btn wq-go" id="wqc-story-along" type="button" data-primary>/);
    expect(p.html()).toMatch(/<button class="wq-btn wq-soft" id="wqc-story-read" type="button">/);
  });
  test('kit off: today\'s two buttons, no mark', async () => {
    const p = room({ routes: { 'ch/HUB.TOKEN/read': ok(SREAD({ readalong: TIMED })) }, scripts: { '/wq/wq-readalong.js': STUB } });
    await p.flush();
    expect(prim(p.html())).toBe(0);
    expect(p.html()).toMatch(/<button class="wq-btn wq-go" id="wqc-story-read" type="button">/);
  });
});


describe('a grown-up\'s preview that plays (the serve\'s practice_play): the read-along, never the microphone', () => {
  test('one answer (Jugnu reads it), then the story\'s end card; no "read it yourself", no recording asked for', async () => {
    const p = room({ routes: { 'ch/HUB.TOKEN/read': ok(SREAD({ readalong: TIMED, practice_play: 1, teacher_preview: true, live: false })) }, scripts: { '/wq/wq-readalong.js': STUB } });
    await p.flush();
    expect(p.screen()).toBe('story-ask');
    expect(p.els['wqc-story-read']).toBeUndefined();
    await p.click('wqc-story-along');
    expect(p.screen()).toBe('story-along');
    expect(p.win.__ra.plays).toBe(1);
    await p.click('wqc-along-read');
    expect(p.screen()).toBe('read-result');
    expect(['mic-ask', 'read-ready', 'read-rec']).not.toContain(p.screen());
    expect(chUrls(p).filter((u) => /ch\/(upload|live|result)/.test(u))).toEqual([]);
  });
  test('the line-lit read-along (no player): it ends on the story\'s end card too', async () => {
    const p = room({ routes: { 'ch/HUB.TOKEN/read': ok(SREAD({ practice_play: 1, live: false })) } });
    await p.flush();
    await p.click('wqc-story-along');
    aud(p)[0].fire('ended');
    await p.flush();
    expect(p.screen()).toBe('read-result');
  });
});

describe('bd-5gyspy.13: the lit word stays above the "I\'m ready" dock', () => {
  // design-qa-r5 155050: at 390 px a passage runs under the sticky dock, and nothing scrolled the lit word into view.
  // The browser's layout is the boundary faked here: the lit span's and the dock's rects, and window.scrollBy.
  const lay = (p, litTop, litBottom) => {
    p.els['wqc-along-ra'].querySelector = (s) => (s === '.wqra-on' ? { getBoundingClientRect: () => ({ top: litTop, bottom: litBottom }) } : null);
    p.els['wqc-along-read'].getBoundingClientRect = () => ({ top: 770, bottom: 830 });
    p.win.innerHeight = 844;
    p.win.__sb = [];
    p.win.scrollBy = (x, y) => p.win.__sb.push(y);
  };
  test('a lit word behind the dock is scrolled up above it; a lit word in view is left alone; one above the top comes back down', async () => {
    const p = room({ routes: { 'ch/HUB.TOKEN/read': ok(SREAD({ readalong: TIMED })) }, scripts: { '/wq/wq-readalong.js': STUB } });
    await p.flush();
    await p.click('wqc-story-along');
    expect(p.screen()).toBe('story-along');
    const onWord = p.win.__ra.o.onWord;
    expect(typeof onWord).toBe('function');
    lay(p, 760, 800);
    onWord(9);
    expect(p.win.__sb).toEqual([800 - 770 + 24]);
    lay(p, 300, 340);
    onWord(10);
    expect(p.win.__sb).toEqual([]);
    lay(p, -40, 0);
    onWord(0);
    expect(p.win.__sb).toEqual([-40 - 16]);
  });
});

describe('bd-5gyspy.14: the lit word stays above the dock\'s fade, not only above its button', () => {
  // redteam 192100 LOW-1: .wqc-sticky fades in 14 px above its button (wq-challenge.js:328), and keepLit measured the
  // button, so a word lit 9-14 px above the button sat under the fade. The dock (the button's parent) is the limit.
  test('a lit word inside the fade band (above the button, below the dock top) is scrolled above the dock', async () => {
    const p = room({ routes: { 'ch/HUB.TOKEN/read': ok(SREAD({ readalong: TIMED })) }, scripts: { '/wq/wq-readalong.js': STUB } });
    await p.flush();
    await p.click('wqc-story-along');
    const onWord = p.win.__ra.o.onWord;
    p.els['wqc-along-ra'].querySelector = (s) => (s === '.wqra-on' ? { getBoundingClientRect: () => ({ top: 720, bottom: 760 }) } : null);
    p.els['wqc-along-read'].getBoundingClientRect = () => ({ top: 770, bottom: 830 });
    p.els['wqc-along-read'].parentNode = { getBoundingClientRect: () => ({ top: 756, bottom: 844 }) };
    p.win.innerHeight = 844;
    p.win.__sb = [];
    p.win.scrollBy = (x, y) => p.win.__sb.push(y);
    onWord(9);
    expect(p.win.__sb).toEqual([760 - 756 + 24]);
  });
});
