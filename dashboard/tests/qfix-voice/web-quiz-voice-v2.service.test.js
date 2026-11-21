/**
 * Web quiz page voice: no clip leaves a child in silence (public/wq/wq.js speak, web_quiz_voice_v2).
 *
 * Runs the page's OWN voice block, cut from the shipped file between its markers, in a vm with the browser's audio
 * boundary faked (Audio, speechSynthesis, timers, document clicks), so each test executes the real speak().
 *
 * The bug (production, Nov 2026): one page sitting in ten lost at least one clip, and the event said only why
 * ("stalled", "reject", "unsupported", "error"), never which part, which host, how long, or whether the page was in
 * view. A refused or stalled clip ended with no retry; on a phone with no voice for the language the child got
 * silence. An iPhone could never play the per-quiz clips (Ogg Opus) and fell back on every one.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'wq', 'wq.js'), 'utf8');
const START = SRC.indexOf('  var player = null;');
const END = SRC.indexOf('  /* ---------------- tiny DOM helpers');

const R2_CLIP = 'https://acct0123.r2.cloudflarestorage.com/digital-coach-audio/quiz-audio/production/0b8f0c39-5d3c-4a7e-9a55-2d1f9e0a1b2c/en/7d1e2c3b-4a5f-4e6d-8c7b-9a8b7c6d5e4f/q-reyna-1a2b3c4d.ogg?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=abc';
const SAME_CLIP = '/wq/voice/one/sx-reyna-68567f-en/right-0.mp3?v=1';

function harness({ v2 = false, gapPhone = true, gapSlow = true, oneVoice = true, voices = [], safari = false, now = 1000 } = {}) {
  const events = [];
  const timers = [];
  const clips = [];
  const utts = [];
  const cls = new Set();
  const docListeners = {};
  let clock = now;
  class FakeAudio {
    constructor(url) { this.url = url; this.paused = true; this.listeners = {}; clips.push(this); }
    addEventListener(name, fn) { (this.listeners[name] = this.listeners[name] || []).push(fn); }
    play() {
      this.paused = false;
      return new Promise((resolve, reject) => { this.resolvePlay = resolve; this.rejectPlay = reject; });
    }
    start() { (this.listeners.playing || []).forEach((f) => f()); }
    pause() { this.paused = true; }
  }
  const canPlay = (t) => (safari && /ogg/.test(t) ? '' : 'probably');
  const ctx = {
    LANG: 'en', VLANG: 'en', SOUND: true,
    ONE_VOICE: oneVoice, GAP_PHONE: gapPhone, GAP_SLOW: gapPhone && gapSlow,
    B: { voice_v2: v2 },
    ROOT: { classList: { add: (c) => cls.add(c), remove: (c) => cls.delete(c) } },
    speakable: (t) => /[A-Za-z0-9؀-ۿ]/.test(String(t || '')),
    ev: (name, data) => events.push({ name, data }),
    document: {
      visibilityState: 'visible',
      createElement: () => ({ canPlayType: canPlay }),
      addEventListener: (n, fn) => { (docListeners[n] = docListeners[n] || []).push(fn); },
      removeEventListener: (n, fn) => { docListeners[n] = (docListeners[n] || []).filter((f) => f !== fn); },
    },
    location: { origin: 'https://quiz.example.test' },
    navigator: { connection: { effectiveType: '3g' } },
    Date: { now: () => clock },
    URL,
    Audio: FakeAudio,
    SpeechSynthesisUtterance: function SpeechSynthesisUtterance(text) { this.text = text; },
    speechSynthesis: { speak: (u) => utts.push(u), cancel: () => {}, getVoices: () => voices },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(`${SRC.slice(START, END)}\nthis.speak = speak; this.stopVoice = stopVoice;`, ctx);
  const runTimers = (ms) => timers.filter((t) => t.ms === ms && !t.ran).forEach((t) => { t.ran = true; t.fn(); });
  // a tap anywhere on the page (the capture listener the page adds on document), then the page's zero-delay timers
  const tap = () => {
    ['pointerdown', 'click'].forEach((n) => (docListeners[n] || []).slice().forEach((fn) => fn({ target: {} })));
    runTimers(0);
  };
  const tick = (ms) => { clock += ms; };
  return { ctx, events, clips, utts, cls, runTimers, tap, tick, fallbacks: () => events.filter((e) => e.name === 'audio_fallback') };
}
const flush = () => new Promise((r) => setImmediate(r));
const refuse = () => Object.assign(new Error('play() failed because the user did not interact first'), { name: 'NotAllowedError' });

describe('the fallback event says which part failed, where from, after how long, and in what state (always on)', () => {
  test('a stalled question clip names its part, question, host, format, time to failure, view state and network', () => {
    const h = harness();
    h.ctx.speak('Which part of a plant takes in water?', R2_CLIP, null, { qid: 'q1aaaaaaaa', part: 'q' });
    h.tick(5000);
    h.runTimers(5000);
    const fb = h.fallbacks();
    expect(fb).toHaveLength(1);
    expect(fb[0].data).toMatchObject({ reason: 'stalled', part: 'q', qid: 'q1aaaaaaaa', host: 'r2', fmt: 'ogg', vis: 'visible', net: '3g' });
    expect(fb[0].data.ms).toBe(5000);
  });

  test('a clip that errors names the browser\'s media error code; a same-origin line names its host as ours', () => {
    const h = harness();
    h.ctx.speak('Well done!', SAME_CLIP, null);
    h.clips[0].error = { code: 2 };
    h.clips[0].onerror();
    expect(h.fallbacks()[0].data).toMatchObject({ reason: 'error', err: 'media_err_2', host: 'self', fmt: 'mp3', part: 'line' });
  });

  test('a refused start says how long ago the child last touched the page (gms; -1 = never on this page)', async () => {
    const h = harness();
    h.ctx.speak('Which month comes after January?', R2_CLIP, null, { qid: 'q1aaaaaaaa', part: 'q' });
    h.clips[0].rejectPlay(refuse());
    await flush();
    expect(h.fallbacks()[0].data).toMatchObject({ reason: 'reject', err: 'notallowederror', gms: -1 });
  });
});

describe('web_quiz_voice_v2 on: a refused or stalled clip is retried on the child\'s next tap, and never blocks the answer', () => {
  test('a refused start keeps the words big with the speaker asking for a tap; the next tap plays the clip, logged ok', async () => {
    const h = harness({ v2: true });
    let done = 0;
    h.ctx.speak('Which month comes after January?', R2_CLIP, () => { done += 1; }, { qid: 'q1aaaaaaaa', part: 'q' });
    h.clips[0].rejectPlay(refuse());
    await flush();
    expect(done).toBe(1); // the line ends at once: nothing waits on the voice
    expect(h.cls.has('wq-tap')).toBe(true);
    expect(h.cls.has('wq-novoice')).toBe(true);
    h.tick(1200);
    h.tap();
    expect(h.clips).toHaveLength(2);
    expect(h.clips[1].url).toBe(R2_CLIP);
    h.clips[1].start();
    expect(h.events.filter((e) => e.name === 'audio_retry').map((e) => e.data)).toEqual([expect.objectContaining({ part: 'q', qid: 'q1aaaaaaaa', ok: true })]);
    expect(h.cls.has('wq-tap')).toBe(false);
  });

  test('a question read as several parts that were all refused replays them all, in order, on one tap', async () => {
    const h = harness({ v2: true });
    const parts = [['Which one is a fruit?', R2_CLIP.replace('q-reyna', 'q-reyna'), 'q'], ['Apple', R2_CLIP.replace('q-reyna', 'a-reyna'), 'opt']];
    let i = 0;
    const next = () => { if (i < parts.length) { const [t, u, p] = parts[i++]; h.ctx.speak(t, u, next, { qid: 'q1aaaaaaaa', part: p }); } };
    next();
    h.clips[0].rejectPlay(refuse()); await flush();
    h.clips[1].rejectPlay(refuse()); await flush();
    h.tap();
    expect(h.clips.slice(2).map((c) => c.url)).toEqual([parts[0][1]]);
    h.clips[2].start(); h.clips[2].onended();
    expect(h.clips.slice(2).map((c) => c.url)).toEqual([parts[0][1], parts[1][1]]);
  });

  test('a stalled clip on a phone with no voice for the language: big words and the tap; one retry only, then the words stay', () => {
    const h = harness({ v2: true, voices: [{ lang: 'fr-FR' }] });
    h.ctx.speak('Which month comes after January?', R2_CLIP, null, { qid: 'q1aaaaaaaa', part: 'q' });
    h.runTimers(5000);
    expect(h.cls.has('wq-novoice')).toBe(true);
    expect(h.cls.has('wq-tap')).toBe(true);
    h.tap();
    expect(h.clips).toHaveLength(2);
    h.runTimers(5000); // the retry stalls too
    expect(h.events.filter((e) => e.name === 'audio_retry').map((e) => e.data.ok)).toEqual([false]);
    h.tap();
    expect(h.clips).toHaveLength(2); // never a second retry
    expect(h.cls.has('wq-novoice')).toBe(true);
  });

  test('a line stopped by the next screen (the child answered) is never retried by a later tap', async () => {
    const h = harness({ v2: true });
    h.ctx.speak('Which month comes after January?', R2_CLIP, null, { qid: 'q1aaaaaaaa', part: 'q' });
    h.clips[0].rejectPlay(refuse()); await flush();
    h.ctx.stopVoice();
    h.tap();
    expect(h.clips).toHaveLength(1);
  });

  test('off: a refused clip is not retried by a tap (today\'s page)', async () => {
    const h = harness({ v2: false });
    h.ctx.speak('Which month comes after January?', R2_CLIP, null, { qid: 'q1aaaaaaaa', part: 'q' });
    h.clips[0].rejectPlay(refuse()); await flush();
    h.tap();
    expect(h.clips).toHaveLength(1);
  });
});

describe('web_quiz_voice_v2 on: an iPhone plays the per-quiz voice (Ogg Opus clips get an mp3 twin from our origin)', () => {
  test('a phone that cannot play Ogg Opus asks our origin for the same clip as mp3, by its storage key', () => {
    const h = harness({ v2: true, safari: true });
    h.ctx.speak('Which part of a plant takes in water?', R2_CLIP, null, { qid: 'q1aaaaaaaa', part: 'q' });
    expect(h.fallbacks()).toEqual([]);
    expect(h.clips.map((c) => c.url)).toEqual(['/wq/clip/quiz-audio/production/0b8f0c39-5d3c-4a7e-9a55-2d1f9e0a1b2c/en/7d1e2c3b-4a5f-4e6d-8c7b-9a8b7c6d5e4f/q-reyna-1a2b3c4d.mp3']);
  });

  test('a phone that plays Ogg Opus keeps the stored clip, untouched', () => {
    const h = harness({ v2: true });
    h.ctx.speak('Which part of a plant takes in water?', R2_CLIP, null, { qid: 'q1aaaaaaaa', part: 'q' });
    expect(h.clips.map((c) => c.url)).toEqual([R2_CLIP]);
  });

  test('off: an iPhone falls back as today ("unsupported") and asks for no twin', () => {
    const h = harness({ v2: false, safari: true });
    h.ctx.speak('Which part of a plant takes in water?', R2_CLIP, null, { qid: 'q1aaaaaaaa', part: 'q' });
    expect(h.fallbacks().map((e) => e.data.reason)).toEqual(['unsupported']);
    expect(h.clips).toHaveLength(0);
  });

  test('an Ogg clip whose address is not a stored quiz clip is never rewritten (it falls back as today)', () => {
    const h = harness({ v2: true, safari: true });
    h.ctx.speak('Hello', 'https://elsewhere.example/x/hello.ogg', null);
    expect(h.fallbacks().map((e) => e.data.reason)).toEqual(['unsupported']);
  });
});

describe('a clip that starts late says when (audio_slow, always on): the meter for "stalled" at 5 s vs 8 s', () => {
  test('a clip that starts at 6.2 s logs audio_slow with its start time, part, question, host and format', () => {
    const h = harness({ gapSlow: false }); // the 8 s give-up: a clip may start between 5 and 8 s
    h.ctx.speak('Which part of a plant takes in water?', R2_CLIP, null, { qid: 'q1aaaaaaaa', part: 'q' });
    h.tick(6200);
    h.clips[0].start();
    expect(h.events.filter((e) => e.name === 'audio_slow').map((e) => e.data)).toEqual([expect.objectContaining({ ms: 6200, part: 'q', qid: 'q1aaaaaaaa', host: 'r2', fmt: 'ogg' })]);
  });
  test('a clip that starts within 2 s logs nothing new', () => {
    const h = harness();
    h.ctx.speak('Which part of a plant takes in water?', R2_CLIP, null, { qid: 'q1aaaaaaaa', part: 'q' });
    h.tick(900);
    h.clips[0].start();
    expect(h.events.filter((e) => e.name === 'audio_slow')).toEqual([]);
  });
});
