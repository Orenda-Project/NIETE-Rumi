'use strict';
/**
 * The page is hidden mid-line (another tab, another app, the screen off) and comes back (tester, 28 Oct): the practice
 * words stopped, Next did nothing, then the instructions came in the phone's own (male) voice for ~30 s.
 *   (A) a clip the browser pauses while the page is hidden ('pause', never 'ended') waits, and resume() (the page is
 *       visible again) plays it on from where it stopped; the line ends when the clip ends
 *   (B) a clip left paused on a visible page never holds the line (and Next behind it) for long: after stall_ms it is
 *       tried once more, and if it still will not play the words stay on screen (onSilent) and the line ends
 *   (C) a clip refused or failing while the page is hidden never goes to the phone's own voice: the line waits, and on
 *       resume() Jugnu's own clip plays
 *   (D) onHeld({ kind }) reports each of these, so the session keeps a record of it
 */
const path = require('path');

const VOICE = path.join(__dirname, '..', 'sa', 'sa-voice.js');

function env(o) {
  o = o || {};
  const log = [];
  const doc = { visibilityState: 'visible' };
  const clips = [];
  class FakeAudio {
    constructor(src) { this.src = src; this.paused = true; this.ended = false; this.plays = 0; clips.push(this); log.push(['audio', src]); }
    play() {
      this.plays += 1;
      log.push(['play', this.src, this.plays]);
      if (doc.visibilityState === 'hidden' && o.holdHidden) return new Promise(() => {}); // the load is held back: never 'playing'
      if (doc.visibilityState === 'hidden' && o.refuseHidden !== false) return Promise.reject(Object.assign(new Error('not allowed'), { name: 'NotAllowedError' }));
      if (o.refuseReplay && this.plays > 1) return Promise.reject(Object.assign(new Error('not allowed'), { name: 'NotAllowedError' }));
      this.paused = false;
      setTimeout(() => { if (this.onplaying) this.onplaying(); }, 10);
      return Promise.resolve();
    }
    pause() { this.paused = true; }
  }
  // what the browser does: pause a playing clip on its own (a 'pause' event, no 'ended'), or play it to its end
  const osPause = (a) => { a.paused = true; if (a.onpause) a.onpause(); };
  const end = (a) => { a.ended = true; a.paused = true; if (a.onpause) a.onpause(); if (a.onended) a.onended(); };
  class Utter { constructor(text) { this.text = text; } }
  const synth = { getVoices: () => [{ lang: 'ur-PK' }, { lang: 'en-IN' }], cancel() {}, speak(u) { log.push(['tts', u.text]); setTimeout(() => u.onend && u.onend(), 50); } };
  const held = [], silent = [];
  jest.resetModules();
  const v = require(VOICE).create({ lang: 'ur', base: '/', Audio: FakeAudio, speechSynthesis: synth, SpeechSynthesisUtterance: Utter, document: doc,
    onHeld: (e) => held.push(e.kind), onSilent: (e) => silent.push(e.text) });
  return { v, log, doc, clips, osPause, end, held, silent };
}
const LINE = { ur: 'ہر لفظ بولیں، پھر آگے دبائیں', en: 'Say each word, then press Next' };

describe('a line when the page is hidden and shown again', () => {
  beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(0); });
  afterEach(() => { jest.useRealTimers(); });

  test('(A) paused by the browser on hide: it waits; resume() plays the same clip on; the line ends with it', async () => {
    const x = env();
    let done = false;
    const p = x.v.speak(LINE, 'sa/v1/ur/say_next.mp3').then(() => { done = true; });
    await jest.advanceTimersByTimeAsync(100);
    const a = x.clips[0];
    x.doc.visibilityState = 'hidden';
    x.osPause(a);
    await jest.advanceTimersByTimeAsync(20000);
    expect(done).toBe(false); // the child did not hear the end: the line is not over
    x.doc.visibilityState = 'visible';
    x.v.resume();
    await jest.advanceTimersByTimeAsync(100);
    expect(a.plays).toBe(2); // the same clip, on from where it stopped
    expect(x.clips).toHaveLength(1);
    x.end(a);
    await jest.advanceTimersByTimeAsync(10);
    await p;
    expect(done).toBe(true);
    expect(x.log.some((l) => l[0] === 'tts')).toBe(false);
    expect(x.held).toEqual(['paused', 'resumed']);
  });

  test('(B) left paused on a visible page: tried once more, then the words on screen and the line ends, within 10 s', async () => {
    const x = env({ refuseReplay: true });
    let done = false;
    const p = x.v.speak(LINE, 'sa/v1/ur/say_next.mp3').then(() => { done = true; });
    await jest.advanceTimersByTimeAsync(100);
    x.osPause(x.clips[0]); // visible: e.g. a call took the audio, the page never went hidden
    await jest.advanceTimersByTimeAsync(10000);
    expect(done).toBe(true); // before: held until the 60-s guard, the Next gate until its 30-s cap
    await p;
    expect(x.clips[0].plays).toBe(2);
    expect(x.log.some((l) => l[0] === 'tts')).toBe(false);
    expect(x.silent).toEqual([LINE.ur]);
    expect(x.held).toEqual(['paused', 'gave_up']);
  });

  test('(C) refused while hidden: never the phone\'s voice; on resume() Jugnu\'s own clip plays and ends the line', async () => {
    const x = env();
    x.doc.visibilityState = 'hidden'; // a timed task starts again on hide: its instruction is said while hidden
    let done = false;
    const p = x.v.speak(LINE, 'sa/v1/ur/say_next.mp3').then(() => { done = true; });
    await jest.advanceTimersByTimeAsync(20000);
    expect(x.log.some((l) => l[0] === 'tts')).toBe(false); // before: two refusals, then the phone's (male) voice
    expect(done).toBe(false);
    x.doc.visibilityState = 'visible';
    x.v.resume();
    await jest.advanceTimersByTimeAsync(100);
    const last = x.clips[x.clips.length - 1];
    expect(last.src).toBe('/sa/v1/ur/say_next.mp3');
    expect(last.paused).toBe(false);
    x.end(last);
    await jest.advanceTimersByTimeAsync(10);
    await p;
    expect(done).toBe(true);
    expect(x.log.some((l) => l[0] === 'tts')).toBe(false);
    expect(x.held).toEqual(['parked', 'resumed']);
  });

  test('(C) a clip that never starts while hidden (the load is held back): no phone voice, it plays on resume()', async () => {
    const x = env({ holdHidden: true });
    x.doc.visibilityState = 'hidden';
    const p = x.v.speak(LINE, 'sa/v1/ur/say_next.mp3');
    const first = x.clips[0];
    await jest.advanceTimersByTimeAsync(20000);
    expect(x.log.some((l) => l[0] === 'tts')).toBe(false);
    x.doc.visibilityState = 'visible';
    x.v.resume();
    await jest.advanceTimersByTimeAsync(100);
    const last = x.clips[x.clips.length - 1];
    expect(last).not.toBe(first);
    x.end(last);
    await jest.advanceTimersByTimeAsync(10);
    await expect(p).resolves.toBeUndefined();
    expect(x.log.some((l) => l[0] === 'tts')).toBe(false);
  });

  test('resume() with nothing held, or after stop(), does nothing and never throws', async () => {
    const x = env();
    expect(() => x.v.resume()).not.toThrow();
    const p = x.v.speak(LINE, 'sa/v1/ur/say_next.mp3');
    await jest.advanceTimersByTimeAsync(100);
    x.doc.visibilityState = 'hidden';
    x.osPause(x.clips[0]);
    x.v.stop();
    await p;
    x.doc.visibilityState = 'visible';
    x.v.resume();
    expect(x.clips[0].plays).toBe(1);
  });

  test('a clip that plays to its end is not "paused by the browser" (its pause event comes with ended)', async () => {
    const x = env();
    const p = x.v.speak(LINE, 'sa/v1/ur/say_next.mp3');
    await jest.advanceTimersByTimeAsync(100);
    x.end(x.clips[0]);
    await p;
    expect(x.held).toEqual([]);
  });
});

describe('the engine (sa-engine.js): the page shown again resumes the line; a held line is a kept event', () => {
  const core = require('../sa/sa-core');
  const storeMod = require('../sa/sa-store');
  const { start } = require('../sa/sa-engine');
  const tap = (id, n) => ({ id, mode: 'tap', items: Array.from({ length: n }, (_, i) => ({ id: `${id}${i}`, target: 'a', options: ['a', 'b'] })) });

  test('visibilitychange to visible calls voice.resume(); to hidden it does not; onHeld leaves voice_held', async () => {
    const s = await storeMod.open({ idb: null });
    const listeners = {};
    const doc = { visibilityState: 'visible', addEventListener: (t, fn) => { listeners[t] = fn; }, removeEventListener() {} };
    let voiceOpts = null;
    const resume = jest.fn();
    const deps = {
      core, store: { open: () => Promise.resolve(s) }, doc,
      ui: { mount: () => ({ destroy() {}, render() {} }) },
      voice: { create: (o) => { voiceOpts = o; return { speak: () => Promise.resolve(), stop() {}, setMuted() {}, resume }; } },
      now: (() => { let t = 0; return () => (t += 100); })(),
    };
    const b = { battery_id: 'vis', tasks: [tap('ur.a', 2)] };
    const e = await start({ mount: {}, battery: b, mode: 'proctored', lang: 'ur', session_id: 's-vis', audio_check: false, warmup: false }, deps);
    e.runner.start();
    doc.visibilityState = 'hidden'; listeners.visibilitychange();
    expect(resume).not.toHaveBeenCalled();
    doc.visibilityState = 'visible'; listeners.visibilitychange();
    expect(resume).toHaveBeenCalledTimes(1);
    voiceOpts.onHeld({ kind: 'parked' });
    await e.flushed();
    const ev = (await s.events('s-vis')).filter((x) => x.type === 'voice_held' || x.type === 'visibility_lost');
    expect(ev.map((x) => [x.type, x.value])).toEqual([['visibility_lost', { phase: 'instruction' }], ['voice_held', { kind: 'parked' }]]);
  });
});
