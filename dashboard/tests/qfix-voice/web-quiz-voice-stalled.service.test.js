/**
 * Web quiz page voice: how long a slow clip is waited for before it is given up as stalled
 * (public/wq/wq.js speak; GAP_SLOW = the slow-clip switch). Runs the page's OWN voice block, cut from the shipped
 * file between its markers, in a vm with the browser's audio boundary faked, so each test executes the real speak()
 * and the real give-up timers.
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
