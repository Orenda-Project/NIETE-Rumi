'use strict';
/**
 * A recorded clip that will not play, while one voice and `web_quiz_voice_gap_phone` are on: the page's speak()
 * (dashboard/public/wq/wq.js) hands the line to the phone's own voice instead of leaving it silent.
 *  - a clip that has not started after CLIP_SLOW_MS (2 s) is read by the phone at 2 s (today: 8 s, then silence);
 *  - a clip whose play() is refused for any reason but autoplay (AbortError, NotSupportedError …) is read by the phone
 *    (today: the tap pulse, then silence);
 *  - a play() refused for autoplay (NotAllowedError) keeps the tap pulse; a line that was stopped stays quiet.
 * Off: today's behaviour, call for call.
 *
 * The page code runs for real in a vm; the boundaries faked are Audio, speechSynthesis, the timers and the log.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', '..', '..', '..', 'dashboard', 'public', 'wq', 'wq.js'), 'utf8');
const START = SRC.indexOf('  var player = null;');
const END = SRC.indexOf('  /* ---------------- tiny DOM helpers');
const LINE = 'February';
const CLIP = 'https://clips.example/quiz-audio/z/ur/q1/a-sx-reyna-68567f-941dafb1.ogg?sig=1';

function harness(gap) {
  const trace = []; const timers = []; const audios = [];
  function Audio(url) {
    const a = this; a.url = url; a.on = {};
    a.addEventListener = (k, fn) => { a.on[k] = fn; };
    a.pause = () => trace.push(['pause']);
    a.play = () => new Promise((res, rej) => { a.resolve = res; a.reject = rej; });
    audios.push(a);
  }
  const ctx = {
    LANG: 'ur', VLANG: 'ur', SOUND: true, ONE_VOICE: true, GAP_PHONE: gap,
    ROOT: { classList: { add: (c) => trace.push(['class', c]), remove() {} } },
    speakable: (t) => /[A-Za-z0-9؀-ۿ]/.test(String(t || '')),
    ev: (k, d) => trace.push(['ev', k, d]),
    document: { createElement: () => ({ canPlayType: () => 'probably' }) },
    Audio,
    SpeechSynthesisUtterance: function SpeechSynthesisUtterance(text) { this.text = text; },
    speechSynthesis: { speak: (u) => trace.push(['phone', u.text]), cancel: () => {}, getVoices: () => [{ lang: 'ur-PK' }] },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); trace.push(['timer', ms]); return timers.length; },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(`${SRC.slice(START, END)}\nthis.speak = speak; this.stopVoice = stopVoice;`, ctx);
  const done = { n: 0 };
  // fire the timers set so far, at or before `ms` (in the order set), and only once each
  const fired = new Set();
  const until = (ms) => timers.forEach((t, i) => { if (t.ms <= ms && !fired.has(i)) { fired.add(i); t.fn(); } });
  const say = () => ctx.speak(LINE, CLIP, () => { done.n += 1; }, { qid: 'q1', part: 'a' });
  const flush = () => new Promise((r) => setImmediate(r));
  const err = (name) => Object.assign(new Error(name), { name });
  return { ctx, trace, timers, audios, done, until, say, flush, err };
}
const phone = (h) => h.trace.filter((t) => t[0] === 'phone').map((t) => t[1]);
const classes = (h) => h.trace.filter((t) => t[0] === 'class').map((t) => t[1]);
const reasons = (h) => h.trace.filter((t) => t[0] === 'ev' && t[1] === 'audio_fallback').map((t) => t[2].reason);

describe('switch on: a clip that will not play is read by the phone, never left silent', () => {
  test('a clip that has not started at 2 s: the phone reads the line at 2 s, the clip is stopped', () => {
    const h = harness(true);
    h.say();
    expect(h.timers.map((t) => t.ms)).toEqual([2000]);   // one wait, at CLIP_SLOW_MS; no 8 s wait
    h.until(2000);
    expect(phone(h)).toEqual([LINE]);
    expect(reasons(h)).toEqual(['stalled']);
    expect(h.trace).toContainEqual(['pause']);
    expect(classes(h)).toContain('wq-phonevoice');
    expect(classes(h)).not.toContain('wq-novoice');
  });
  test('the stopped clip\'s own AbortError (from that pause) does not read the line twice', async () => {
    const h = harness(true);
    h.say(); h.until(2000);
    h.audios[0].reject(h.err('AbortError')); await h.flush();
    expect(phone(h)).toEqual([LINE]);
    expect(reasons(h)).toEqual(['stalled']);
  });
  test.each([['AbortError'], ['NotSupportedError'], ['Error']])('play() refused with %s: the phone reads the line at once', async (name) => {
    const h = harness(true);
    h.say();
    h.audios[0].reject(h.err(name)); await h.flush();
    expect(phone(h)).toEqual([LINE]);
    expect(reasons(h)).toEqual(['reject']);
    expect(classes(h)).not.toContain('wq-tap');
    h.until(99999);                                       // the 2 s wait that follows changes nothing
    expect(phone(h)).toEqual([LINE]);
  });
  test('play() refused for autoplay (NotAllowedError): the tap pulse, as today; the phone stays silent', async () => {
    const h = harness(true);
    h.say();
    h.audios[0].reject(h.err('NotAllowedError')); await h.flush();
    expect(phone(h)).toEqual([]);
    expect(classes(h)).toContain('wq-tap');
    expect(h.done.n).toBe(1);
  });
  test('a line stopped by the next screen stays quiet: no phone voice, no done()', async () => {
    const h = harness(true);
    h.say();
    h.ctx.stopVoice();
    h.audios[0].reject(h.err('AbortError')); await h.flush();
    h.until(99999);
    expect(phone(h)).toEqual([]);
    expect(reasons(h)).toEqual([]);
    expect(h.done.n).toBe(0);
  });
  test('a clip that starts inside 2 s plays; the wait does nothing', () => {
    const h = harness(true);
    h.say();
    h.audios[0].on.playing();
    h.until(99999);
    expect(phone(h)).toEqual([]);
    h.audios[0].onended();
    expect(h.done.n).toBe(1);
  });
});

describe('switch off: today, call for call', () => {
  test('a clip that never starts: words big at 2 s, let go quietly at 8 s', () => {
    const h = harness(false);
    h.say();
    h.until(99999);
    expect(h.trace).toEqual([
      ['timer', 2000], ['timer', 8000],
      ['class', 'wq-novoice'],
      ['pause'], ['ev', 'audio_fallback', { reason: 'stalled' }],
    ]);
    expect(h.done.n).toBe(1);
  });
  test('play() refused with AbortError: the tap pulse and silence', async () => {
    const h = harness(false);
    h.say();
    h.audios[0].reject(h.err('AbortError')); await h.flush();
    expect(h.trace).toEqual([
      ['timer', 2000], ['timer', 8000],
      ['pause'], ['ev', 'audio_fallback', { reason: 'reject' }], ['class', 'wq-tap'],
    ]);
    expect(h.done.n).toBe(1);
  });
});
