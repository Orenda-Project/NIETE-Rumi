/**
 * Story Time on the Challenge page (public/wq/wq-trail.js, under v2, only with the story switch on the menu): the room
 * (?room=story&pid=<id>) asks the serve for that story as a practice run and plays it. Only the network is faked.
 *   - the story request carries room=story&pid=<id>, only in the room, only with the switch, and no other request does
 *   - a read asks "hear it from me first, or read it yourself" (two equal buttons, nothing preselected)
 *   - "Read along with Jugnu" plays the story clip with the line lit, then the normal read
 *   - no digit, score, words-a-minute or "N of M" on any story screen; the end card says "read it again" + the sticker
 *   - a refused story id (any 400), 404 or no network is the room's "on its way", never an error page
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

describe('the story request: room and pid, only in the room, only with the switch', () => {
  test('room + pid + switch → the read is asked for with room=story&pid=<id>, once; no other request carries them', async () => {
    const p = room({ routes: { 'ch/HUB.TOKEN/read': ok(SREAD()) } });
    await p.flush();
    expect(chUrls(p)).toEqual([`/api/wq/ch/HUB.TOKEN/read?lang=en&room=story&pid=${PID}`]);
    // read it to the end: the mic, the upload, the result, Home — none of them carries the story id
    const q = room({ routes: {
      'ch/HUB.TOKEN/read': ok(SREAD()), 'ch/upload': ok({ put_url: 'https://store.test/put', content_type: 'audio/webm', key: 'k1' }),
      'store.test': ok({}), 'ch/result': ok({ score: { correct: 9, attempted: 10 }, wcpm: 55 }), 'ch/HUB.TOKEN\\?': ok(MENU()),
    } });
    await q.flush();
    await q.click('wqc-story-read');
    q.w.stopRec('done_tap');
    await q.flush();
    await q.click('wqc-menu');
    const urls = q.fetches.map((f) => f.url).filter((u) => u !== '/api/wq/e');
    expect(urls.filter((u) => /pid=|room=/.test(u))).toEqual([`/api/wq/ch/HUB.TOKEN/read?lang=en&room=story&pid=${PID}`]);
    expect(urls.some((u) => /ch\/result/.test(u))).toBe(true);
    // back at the trail, the read stop is today's request
    expect(q.screen()).toBe('trail');
    q.w.open('read');
    await q.flush();
    expect(chUrls(q).pop()).toBe('/api/wq/ch/HUB.TOKEN/read?lang=en');
  });
  test('the shelf link says ex=listen → the listen stop is asked for with the story id', async () => {
    const p = room({ href: `${ROOM}&ex=listen`, routes: { 'ch/HUB.TOKEN/listen': ok(SLISTEN()) } });
    await p.flush();
    expect(chUrls(p)).toEqual([`/api/wq/ch/HUB.TOKEN/listen?lang=en&room=story&pid=${PID}`]);
  });
  test('switch off → the trail; nothing sends room or pid', async () => {
    const p = room({ menu: MENU(false), routes: { 'ch/HUB.TOKEN/read': ok(SREAD()) } });
    expect(p.screen()).toBe('trail');
    p.w.open('read');
    await p.flush();
    expect(chUrls(p)).toEqual(['/api/wq/ch/HUB.TOKEN/read?lang=en']);
  });
  test('no room on the link (switch on) → the trail and today\'s requests', async () => {
    const p = room({ href: 'https://portal.test/c/HUB.TOKEN', routes: { 'ch/HUB.TOKEN/read': ok(SREAD({ practice_round: false, story_clip: undefined })) } });
    expect(p.screen()).toBe('trail');
    p.w.open('read');
    await p.flush();
    expect(chUrls(p)).toEqual(['/api/wq/ch/HUB.TOKEN/read?lang=en']);
    expect(p.has('wqc-story-along')).toBe(false);
  });
  test('the room with no pid stays today\'s room: banner and "on its way", nothing requested', async () => {
    const p = room({ href: 'https://portal.test/c/HUB.TOKEN?room=story' });
    expect(p.screen()).toBe('story');
    expect(p.html()).toContain('A new story is on its way.');
    expect(chUrls(p)).toEqual([]);
  });
});

describe('a served story read: the ask, then read along or read', () => {
  test('the ask: banner, the line, two equal buttons, nothing preselected', async () => {
    const p = room({ routes: { 'ch/HUB.TOKEN/read': ok(SREAD()) } });
    await p.flush();
    expect(p.screen()).toBe('story-ask');
    const h = p.html();
    expect(h).toContain('Story Time: just for fun');
    expect(h).toContain('Hear it from me first, or read it yourself.');
    const btns = h.match(/<button[^>]*id="wqc-story-(along|read)"[^>]*>[^<]*<\/button>/g);
    expect(btns).toHaveLength(2);
    expect(btns[0]).toContain('Read along with Jugnu');
    expect(btns[1]).toContain("I'm ready");
    const cls = btns.map((b) => /class="([^"]+)"/.exec(b)[1]);
    expect(cls[0]).toBe(cls[1]);
    btns.forEach((b) => expect(b).not.toMatch(/aria-pressed|checked|selected|autofocus|wqc-on/));
    expect(aud(p)).toEqual([]);
    clean(h);
  });
  test('Urdu: the ask and its buttons, verbatim', async () => {
    const p = room({ lang: 'ur', menu: MENU(true, 'ur'), routes: { 'ch/HUB.TOKEN/read': ok(SREAD()) } });
    await p.flush();
    const h = p.html();
    expect(h).toContain('کہانی کا وقت: بس مزے کے لیے');
    expect(h).toContain('پہلے مجھ سے سن لیں، یا خود پڑھیں۔');
    expect(h).toContain('جگنو کے ساتھ ساتھ پڑھیں');
    expect(chUrls(p)[0]).toBe(`/api/wq/ch/HUB.TOKEN/read?lang=ur&room=story&pid=${PID}`);
  });
  test('read along: the story clip plays with the first line lit, the line follows the clip, then the normal read', async () => {
    const p = room({ routes: { 'ch/HUB.TOKEN/read': ok(SREAD()) } });
    await p.flush();
    await p.click('wqc-story-along');
    expect(p.screen()).toBe('story-along');
    const h0 = p.html();
    expect(h0).toContain('Story Time: just for fun');
    expect(h0).toContain('Read along with Jugnu');
    // line 1 (words 0–5) lit, line 2 not
    const lit = (h) => (h.match(/<span class="wqc-w[^"]*wqc-next[^"]*">[^<]*<\/span>/g) || []).map((s) => s.replace(/<[^>]+>/g, ''));
    expect(lit(h0)).toEqual(['Imran', 'woke', 'up', 'early', 'for', 'school.']);
    clean(h0);
    const au = aud(p);
    expect(au.map((x) => x.url)).toEqual([CLIP.url]);
    expect(au[0].playing).toBe(true);
    // half way through the clip → the second line is lit
    au[0].duration = 10; au[0].currentTime = 7;
    au[0].fire('timeupdate');
    expect(lit(`<x>${p.els['wqc-along-story'].innerHTML}</x>`)).toEqual(['He', 'washed', 'his', 'face.']);
    // the clip ends → the normal read (the microphone, then the story to read)
    au[0].fire('ended');
    await p.flush();
    expect(['mic-ask', 'read-ready', 'read-rec']).toContain(p.screen());
    expect(p.screen()).toBe('read-rec');
    expect(au[0].playing).toBe(false);
  });
  test('"I\'m ready" → straight to the normal read, no clip played', async () => {
    const p = room({ routes: { 'ch/HUB.TOKEN/read': ok(SREAD()) } });
    await p.flush();
    await p.click('wqc-story-read');
    expect(p.screen()).toBe('read-rec');
    expect(aud(p)).toEqual([]);
  });
});

describe('no number, score or words-a-minute on any story screen', () => {
  test('read: ask → read along → reading → end card: "read it again" + the sticker line, nothing counted', async () => {
    const p = room({ routes: {
      'ch/HUB.TOKEN/read': ok(SREAD({ live: true, previous_wcpm: 40 })), 'ch/upload': ok({ put_url: 'https://store.test/put', content_type: 'audio/webm', key: 'k1' }),
      'store.test': ok({}), 'ch/result': ok({ score: { correct: 88, attempted: 90, stopped: false }, wcpm: 90, previous: { wcpm: 80 } }),
    } });
    await p.flush();
    const seen = [p.html()];
    await p.click('wqc-story-along'); seen.push(p.html());
    aud(p)[0].fire('ended'); await p.flush(); seen.push(p.html());
    expect(p.screen()).toBe('read-rec');
    expect(p.html()).not.toContain('wqc-left');
    p.w.stopRec('done_tap'); await p.flush(); seen.push(p.html());
    expect(p.screen()).toBe('read-result');
    const end = p.html();
    expect(end).toContain('Read this story again any time.');
    expect(end).toContain('A sticker went into your Book.');
    expect(end).toContain('Story Time: just for fun');
    expect(end).not.toContain('You read the whole story!');
    seen.forEach(clean);
  });
  test('Urdu end card: the again line and the sticker line, verbatim', async () => {
    const p = room({ lang: 'ur', menu: MENU(true, 'ur'), routes: {
      'ch/HUB.TOKEN/read': ok(SREAD()), 'ch/upload': ok({ put_url: 'https://store.test/put', content_type: 'audio/webm', key: 'k1' }),
      'store.test': ok({}), 'ch/result': ok({ score: { correct: 3, attempted: 4 }, wcpm: 12 }),
    } });
    await p.flush();
    await p.click('wqc-story-read');
    p.w.stopRec('done_tap'); await p.flush();
    expect(p.html()).toContain('یہ کہانی جب چاہیں دوبارہ پڑھیں۔');
    expect(p.html()).toContain('آپ کی کتاب میں ایک اسٹیکر لگ گیا۔');
    clean(p.html());
  });
  test('listen: today\'s listen screens with the banner, questions with no "N of M", the same end card', async () => {
    const p = room({ href: `${ROOM}&ex=listen`, routes: {
      'ch/HUB.TOKEN/listen': ok(SLISTEN()),
      'ch/qs': ok({ questions: [{ id: 'q1', prompt: 'Who woke up?', options: ['Imran', 'Ali'] }, { id: 'q2', prompt: 'When?', options: ['Early', 'Late'] }] }),
      'ch/qa': ok({ ok: true, answer: 'Imran' }),
    } });
    await p.flush();
    expect(p.screen()).toBe('intro');
    const seen = [p.html()];
    await p.click('wqc-go'); seen.push(p.html());
    expect(p.screen()).toBe('listen-play');
    const a = aud(p).find((x) => x.url === CLIP.url);
    a.fire('ended'); await p.runTimers(); a.fire('ended'); await p.flush();
    expect(p.screen()).toBe('qa');
    seen.push(p.html());
    await p.click('wqc-o0'); await p.runTimers(); seen.push(p.html());
    await p.click('wqc-o0'); await p.runTimers(); seen.push(p.html());
    expect(p.screen()).toBe('qa-done');
    expect(p.html()).toContain('Read this story again any time.');
    expect(p.html()).toContain('A sticker went into your Book.');
    seen.forEach((h) => { expect(h).toContain('Story Time: just for fun'); clean(h); });
  });
});

describe('a story that is not there: the room\'s "on its way", never an error page', () => {
  const wait = (p, asked = chUrls(p)) => {
    // the story was asked for, and its refusal is the room's screen
    expect(asked).toEqual([`/api/wq/ch/HUB.TOKEN/read?lang=en&room=story&pid=${PID}`]);
    expect(p.screen()).toBe('story');
    expect(p.html()).toContain('Story Time: just for fun');
    expect(p.html()).toContain('A new story is on its way.');
    expect(p.html()).not.toContain('Something went wrong');
    expect(p.has('wqc-retry')).toBe(false);
  };
  test.each([
    ['400 story_pid', () => ({ status: 400, body: { error: 'story_pid' } })],
    ['400 not_story', () => ({ status: 400, body: { error: 'not_story' } })],
    ['400 bad_request', () => ({ status: 400, body: { error: 'bad_request' } })],
    ['404', () => ({ status: 404, body: { error: 'not_found' } })],
  ])('%s → on its way', async (_, fn) => {
    const p = room({ routes: { 'ch/HUB.TOKEN/read': fn } });
    await p.flush();
    wait(p);
  });
  test('no network → on its way', async () => {
    const p = room({ pre: [NO_NET] });
    await p.flush();
    wait(p, Array.from(p.ctx.__tried));
  });
  test('the serve answered with a counted run (no practice_round) → on its way; no counted run starts from the room', async () => {
    const p = room({ routes: { 'ch/HUB.TOKEN/read': ok(SREAD({ practice_round: false })) } });
    await p.flush();
    wait(p);
  });
  test('the serve says on_its_way → the room\'s screen', async () => {
    const p = room({ routes: { 'ch/HUB.TOKEN/read': ok({ ex: 'read', outcome: 'on_its_way' }) } });
    await p.flush();
    wait(p);
  });
});
