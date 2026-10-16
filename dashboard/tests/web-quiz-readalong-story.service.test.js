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
    expect(p.win.__ra.o.labels).toEqual({ play: 'چلائیں', pause: 'روکیں', replay: 'دوبارہ سنیں' });
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
