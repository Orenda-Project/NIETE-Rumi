/**
 * Web quiz page voice: a clip given up as stalled says what the element held at that moment
 * (public/wq/wq.js speak → audio_fallback{stalled} / audio_slow{stalled}; always on, telemetry only).
 *
 * Runs the page's OWN voice block, cut from the shipped file between its markers, in a vm with the browser's audio
 * boundary faked, so each test executes the real speak() and the real give-up timers.
 *
 * The gap (production, 16-23 Nov 2026): the stalled class is the child's connection, but audio_fallback{stalled}
 * named only how long it waited. A clip whose bytes never came and one that had data but never started read the same,
 * so a longer give-up, or a canary, could not tell "nothing arrived" from "arrived and sat there". rs = readyState
 * (0-4), ns = networkState (0-3), buf = seconds the element had buffered (summed over its ranges, one decimal).
 * No behaviour change: the same lines are held, retried or let go as before.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'wq', 'wq.js'), 'utf8');
const START = SRC.indexOf('  var player = null;');
const END = SRC.indexOf('  /* ---------------- tiny DOM helpers');

const R2_CLIP = 'https://acct0123.r2.cloudflarestorage.com/digital-coach-audio/quiz-audio/production/0b8f0c39-5d3c-4a7e-9a55-2d1f9e0a1b2c/en/7d1e2c3b-4a5f-4e6d-8c7b-9a8b7c6d5e4f/q-reyna-1a2b3c4d.ogg?X-Amz-Signature=abc';

const ranges = (list) => ({ length: list.length, start: (i) => list[i][0], end: (i) => list[i][1] });

function harness({ gapSlow = false, held = {}, lang = 'en', voices = [] } = {}) {
  const events = [];
  const timers = [];
  const clips = [];
  class FakeAudio {
    constructor(url) {
      this.url = url; this.paused = true; this.listeners = {}; clips.push(this);
      this.readyState = 0; this.networkState = 2; this.buffered = ranges([]);
      Object.assign(this, held);
    }
    set src(v) { this.url = v; }
    get src() { return this.url; }
    addEventListener(name, fn) { (this.listeners[name] = this.listeners[name] || []).push(fn); }
    play() { this.paused = false; return new Promise((resolve, reject) => { this.resolvePlay = resolve; this.rejectPlay = reject; }); }
    pause() { this.paused = true; }
  }
  const ctx = {
    LANG: lang, VLANG: lang, SOUND: true, ONE_VOICE: true, GAP_PHONE: gapSlow, GAP_SLOW: gapSlow,
    B: { voice_v2: false },
    ROOT: { classList: { add: () => {}, remove: () => {} } },
    speakable: (t) => /[A-Za-z0-9؀-ۿ]/.test(String(t || '')),
    ev: (name, data) => events.push({ name, data: JSON.parse(JSON.stringify(data)) }),
    document: { visibilityState: 'visible', createElement: () => ({ canPlayType: () => 'probably' }), addEventListener: () => {}, removeEventListener: () => {} },
    location: { origin: 'https://quiz.example.test' },
    navigator: { connection: { effectiveType: '3g' } },
    Date: { now: () => 1000 },
    URL,
    Audio: FakeAudio,
    SpeechSynthesisUtterance: function SpeechSynthesisUtterance(text) { this.text = text; },
    speechSynthesis: { speak: () => {}, cancel: () => {}, getVoices: () => voices },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeout: (id) => { if (timers[id - 1]) timers[id - 1].ran = true; },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(`${SRC.slice(START, END)}\nthis.speak = speak;`, ctx);
  const runTimers = (ms) => timers.filter((t) => t.ms === ms && !t.ran).forEach((t) => { t.ran = true; t.fn(); });
  const of = (name) => events.filter((e) => e.name === name).map((e) => e.data);
  return { ctx, events, clips, runTimers, of };
}

describe('audio_fallback{stalled} names what the element held when it was given up', () => {
  test('nothing arrived: readyState 0, still loading, 0 s buffered', () => {
    const h = harness();
    h.ctx.speak('Which part of a plant takes in water?', R2_CLIP, null, { part: 'q', qid: 'q1aaaaaaaa' });
    h.runTimers(8000);
    const fb = h.of('audio_fallback');
    expect(fb).toHaveLength(1);
    expect(fb[0]).toMatchObject({ reason: 'stalled', part: 'q', qid: 'q1aaaaaaaa', rs: 0, ns: 2, buf: 0 });
  });

  test('data arrived and sat there: its readyState, network state and seconds buffered summed over ranges', () => {
    const h = harness({ held: { readyState: 2, networkState: 1, buffered: ranges([[0, 1.2], [3, 3.4]]) } });
    h.ctx.speak('Which part of a plant takes in water?', R2_CLIP, null, { part: 'q', qid: 'q1aaaaaaaa' });
    h.runTimers(8000);
    expect(h.of('audio_fallback')[0]).toMatchObject({ reason: 'stalled', rs: 2, ns: 1, buf: 1.6 });
  });

  test('a gap-slow phone gives up at 5 s with the same three fields', () => {
    const h = harness({ gapSlow: true, held: { readyState: 1, networkState: 2, buffered: ranges([[0, 0.25]]) } });
    h.ctx.speak('Which part of a plant takes in water?', R2_CLIP, null, { part: 'opt', qid: 'q1aaaaaaaa' });
    h.runTimers(5000);
    expect(h.of('audio_fallback')[0]).toMatchObject({ reason: 'stalled', rs: 1, ns: 2, buf: 0.3 });
  });

  test('an element that cannot say (no buffered, odd values) still sends the event, without the fields it could not read', () => {
    const h = harness({ held: { readyState: 'x', networkState: undefined, buffered: null } });
    h.ctx.speak('Which part of a plant takes in water?', R2_CLIP, null, { part: 'q' });
    h.runTimers(8000);
    const fb = h.of('audio_fallback')[0];
    expect(fb.reason).toBe('stalled');
    expect(fb.rs).toBeUndefined();
    expect(fb.ns).toBeUndefined();
    expect(fb.buf).toBeUndefined();
  });
});

describe('the late-start line of a gap-slow stall carries the same fields; nothing else changes', () => {
  test('audio_slow{stalled} (started muted after the give-up) says what it held when it started', () => {
    const h = harness({ gapSlow: true });
    h.ctx.speak('Which part of a plant takes in water?', R2_CLIP, null, { part: 'q', qid: 'q1aaaaaaaa' });
    h.runTimers(5000);
    Object.assign(h.clips[0], { readyState: 4, networkState: 1, buffered: ranges([[0, 2.5]]) });
    h.clips[0].listeners.playing.forEach((fn) => fn());
    const slow = h.of('audio_slow');
    expect(slow).toHaveLength(1);
    expect(slow[0]).toMatchObject({ reason: 'stalled', rs: 4, ns: 1, buf: 2.5 });
  });

  test('a refused start and an erroring clip carry none of the three (they are not stalls)', () => {
    const h = harness({ held: { readyState: 1, networkState: 2, buffered: ranges([[0, 1]]) } });
    h.ctx.speak('Well done!', R2_CLIP, null, { part: 'fb' });
    h.clips[0].error = { code: 2 };
    h.clips[0].onerror();
    const fb = h.of('audio_fallback')[0];
    expect(fb).toMatchObject({ reason: 'error', err: 'media_err_2' });
    expect(['rs', 'ns', 'buf'].filter((k) => k in fb)).toEqual([]);
  });
});

/*
 * Bug (production, 23-24 Nov 2026): the 5 s give-up (voice_gap_slow, on since 20 Oct) exists so the phone's
 * own voice can read a slow line. On a phone with no voice for the language (Urdu on Android Chrome) nothing reads it:
 * the clip was muted at 5 s and thrown away even when it started at 6 s, and the child heard nothing. 40 of 204 lost
 * sittings on 24 Nov (32 of 165 on 23 Nov) lost only clips that started between 5 and 8 s (audio_slow{stalled}).
 * Fix: the 5 s give-up only where the phone can read the line; elsewhere the clip gets the full 8 s.
 */
describe('a phone with no voice for the language waits the full 8 s for a slow clip', () => {
  const NO_URDU = [{ lang: 'en-US' }];
  test('no Urdu voice: nothing is given up at 5 s, and a clip that starts at 6 s is heard (not muted)', () => {
    const h = harness({ gapSlow: true, lang: 'ur', voices: NO_URDU });
    h.ctx.speak('پودا پانی کس حصے سے لیتا ہے؟', R2_CLIP, null, { part: 'q', qid: 'q1aaaaaaaa' });
    h.runTimers(5000);
    expect(h.of('audio_fallback')).toHaveLength(0);
    h.clips[0].listeners.playing.forEach((fn) => fn());
    expect(h.clips[0].muted).not.toBe(true);
    expect(h.clips[0].paused).toBe(false);
    h.runTimers(8000);
    expect(h.of('audio_fallback')).toHaveLength(0);
  });

  test('no Urdu voice: a clip that never starts is given up at 8 s, as stalled', () => {
    const h = harness({ gapSlow: true, lang: 'ur', voices: NO_URDU });
    h.ctx.speak('پودا پانی کس حصے سے لیتا ہے؟', R2_CLIP, null, { part: 'q', qid: 'q1aaaaaaaa' });
    h.runTimers(5000);
    h.runTimers(8000);
    expect(h.of('audio_fallback')).toEqual([expect.objectContaining({ reason: 'stalled', part: 'q' })]);
  });

  test('a phone that has an Urdu voice still hands a slow line to it at 5 s', () => {
    const h = harness({ gapSlow: true, lang: 'ur', voices: [{ lang: 'ur-PK' }] });
    h.ctx.speak('پودا پانی کس حصے سے لیتا ہے؟', R2_CLIP, null, { part: 'q', qid: 'q1aaaaaaaa' });
    h.runTimers(5000);
    expect(h.of('audio_fallback')).toEqual([expect.objectContaining({ reason: 'stalled' })]);
  });
});
