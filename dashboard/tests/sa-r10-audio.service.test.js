'use strict';
/**
 * Round 10 (the reviewers' 6 Nov list), audio 3 and audio 4:
 *   3. "No audio on 'Which is bigger': the screen that explains the task plays no audio."
 *   4. "In the practice sections, the audio briefly cuts out just before we hear the correct answer."
 * One cause: Jugnu made a new <audio> for every clip. An Android WebView (the in-app browser) plays a NEW media element
 * only inside a tap (mediaPlaybackRequiresUserGesture, Chromium's user-gesture-required autoplay policy): a clip that
 * starts with no tap in the last few seconds (a screen that moves on by itself, the second clip of "The answer is: 17")
 * is refused (NotAllowedError), tried again 1.5 s later, refused again, and dropped. An element that has once played
 * inside a tap keeps playing later clips without one.
 *   sa_r10_bigger_audio (battery.ui.r10_bigger_audio, voice option unlock): Jugnu speaks through a few elements of his own,
 *     each unlocked by the child's first taps; a refused clip is reported (voice_held 'refused' / 'lost').
 *   sa_r10_practice_gap (battery.ui.r10_practice_gap, voice option warm): a practice task's answer clips are loaded into
 *     those elements before they are needed, so the answer starts the moment "The answer is:" ends.
 * OFF: a new element per clip, as today.
 */
const express = require('express');
const fs = require('fs');
const path = require('path');
const storeMod = require('../sa/sa-store');
const core = require('../sa/sa-core');
const { start } = require('../sa/sa-engine');
const { SWITCHES, applySwitches } = require('../routes/sa-battery-switches');

const VOICE = path.join(__dirname, '..', 'sa', 'sa-voice.js');

/** An Android WebView, as far as playing clips goes: an element plays only once a tap has unlocked it. */
function webview() {
  const log = [];
  const made = [];
  const doc = {
    visibilityState: 'visible',
    active: false, // the page's transient user activation (a tap in the last few seconds)
    ls: {},
    addEventListener(t, fn) { (this.ls[t] = this.ls[t] || []).push(fn); },
    removeEventListener(t, fn) { this.ls[t] = (this.ls[t] || []).filter((f) => f !== fn); },
  };
  class WVAudio {
    constructor(src) { this._src = src || ''; this.unlocked = false; this.paused = true; this.ended = false; this.muted = false; this.loads = 0; made.push(this); }
    get src() { return this._src; }
    set src(v) { this._src = v; this.ended = false; this.paused = true; }
    load() { this.loads += 1; }
    play() {
      if (!this.unlocked) {
        if (!doc.active) {
          log.push(['refused', this._src]);
          return Promise.reject(Object.assign(new Error('play() can only be initiated by a user gesture.'), { name: 'NotAllowedError' }));
        }
        this.unlocked = true;
      }
      this.paused = false;
      log.push(['play', this._src, this.muted]);
      const src = this._src;
      setTimeout(() => { if (!this.paused && this._src === src && this.onplaying) this.onplaying(); }, 10);
      return Promise.resolve();
    }
    pause() { this.paused = true; }
  }
  // the child taps: the page is activated and the tap's listeners run inside it; the activation then lapses
  const tap = () => { doc.active = true; ['pointerup', 'touchend', 'click', 'keydown'].forEach((t) => (doc.ls[t] || []).slice().forEach((fn) => fn({ type: t }))); };
  const lapse = () => { doc.active = false; };
  const end = (a) => { a.ended = true; a.paused = true; if (a.onpause) a.onpause(); if (a.onended) a.onended(); };
  const playing = () => made.filter((a) => !a.paused);
  return { WVAudio, doc, log, made, tap, lapse, end, playing };
}

function voice(w, extra) {
  const held = [], silent = [];
  jest.resetModules();
  // no phone voice for Urdu (most Android phones): a dropped clip is silence
  const synth = { getVoices: () => [{ lang: 'en-US' }], cancel() {}, speak() {} };
  class Utter { constructor(text) { this.text = text; } }
  const v = require(VOICE).create({ lang: 'ur', base: '/', Audio: w.WVAudio, document: w.doc, speechSynthesis: synth, SpeechSynthesisUtterance: Utter,
    onHeld: (e) => held.push(e.kind), onSilent: (e) => silent.push(e.text), ...extra });
  return { v, held, silent };
}

const AFTER = { text: 'شاباش پیارے دوست! اب اگلے حصے کی طرف چلتے ہیں۔', audio: 'sa/v4/ur/ba4ccaac7e62.mp3' };
const BIGGER = { text: 'ان دو نمبروں کو دیکھیں۔ جو نمبر بڑا ہے، اسے دبائیں۔', audio: 'sa/v4/ur/1989fc2b9419.mp3' };
const PREFIX = { text: 'جواب ہے:', audio: 'sa/v4/ur/25c432705c7b.mp3' };
const ANSWER = { text: '۱۷', audio: 'sa/v4/ur/3f44ffc4b7c0.mp3' };

describe('audio 3: the "Which is bigger" instruction, reached with no tap (the part before it ended by itself)', () => {
  beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(0); });
  afterEach(() => { jest.useRealTimers(); });

  /** The last tap (Next on the last number), the closing line, then the next part's instruction with no tap behind it. */
  async function run(extra) {
    const w = webview();
    const x = voice(w, extra);
    w.tap();
    x.v.speak(AFTER.text, AFTER.audio);
    await jest.advanceTimersByTimeAsync(50);
    w.end(w.playing()[0]);
    await jest.advanceTimersByTimeAsync(10);
    w.lapse(); // the closing line took its 3.6 s and the phone's tap no longer counts
    let ended = false;
    x.v.speak(BIGGER.text, BIGGER.audio).then(() => { ended = true; });
    await jest.advanceTimersByTimeAsync(5000);
    return { w, x, ended };
  }

  test('ON (unlock): the instruction plays, nothing refused, nothing left silent', async () => {
    const { w, x } = await run({ unlock: true });
    expect(w.log.filter((l) => l[0] === 'refused')).toEqual([]);
    expect(w.log.some((l) => l[0] === 'play' && l[1] === '/' + BIGGER.audio && !l[2])).toBe(true);
    expect(x.silent).toEqual([]);
  });

  test('OFF: today\'s page, the instruction is refused twice and dropped (the reviewers\' silent screen)', async () => {
    const { w, x, ended } = await run({});
    expect(w.log.filter((l) => l[0] === 'refused').map((l) => l[1])).toEqual(['/' + BIGGER.audio, '/' + BIGGER.audio]);
    expect(x.silent).toEqual([BIGGER.text]);
    expect(ended).toBe(true);
    expect(x.held).toEqual([]); // nothing on the record today
  });

  test('ON: the unlock never sounds (muted, and paused straight away) and never cuts a line that is playing', async () => {
    const w = webview();
    const x = voice(w, { unlock: true });
    w.tap();
    x.v.speak(AFTER.text, AFTER.audio);
    await jest.advanceTimersByTimeAsync(50);
    const live = w.playing();
    expect(live.map((a) => a.src)).toEqual(['/' + AFTER.audio]);
    expect(live[0].muted).toBe(false);
    w.tap(); // another tap while Jugnu speaks
    await jest.advanceTimersByTimeAsync(10);
    expect(w.playing().map((a) => a.src)).toEqual(['/' + AFTER.audio]);
    expect(w.log.filter((l) => l[0] === 'play' && !l[2]).map((l) => l[1])).toEqual(['/' + AFTER.audio]);
  });

  test('ON: a page with no tap yet still tries (a new element, as today) and reports what it lost', async () => {
    const w = webview();
    const x = voice(w, { unlock: true });
    x.v.speak(BIGGER.text, BIGGER.audio);
    await jest.advanceTimersByTimeAsync(5000);
    expect(x.silent).toEqual([BIGGER.text]);
    expect(x.held).toEqual(['refused', 'refused', 'lost']);
  });

  test('ON: stop() and a new line on a reused element never fire the old line\'s handlers', async () => {
    const w = webview();
    const x = voice(w, { unlock: true });
    w.tap();
    let firstDone = 0;
    x.v.speak(AFTER.text, AFTER.audio).then(() => { firstDone += 1; });
    await jest.advanceTimersByTimeAsync(50);
    const a = w.playing()[0];
    let secondDone = false;
    x.v.speak(BIGGER.text, BIGGER.audio).then(() => { secondDone = true; });
    await jest.advanceTimersByTimeAsync(50);
    expect(firstDone).toBe(1);
    expect(secondDone).toBe(false);
    const b = w.playing()[0];
    expect(b.src).toBe('/' + BIGGER.audio);
    w.end(b);
    await jest.advanceTimersByTimeAsync(10);
    expect(secondDone).toBe(true);
    expect(a === b || a.paused).toBe(true);
  });
});

describe('audio 4: "The answer is:" then the answer, in practice', () => {
  beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(0); });
  afterEach(() => { jest.useRealTimers(); });

  async function chain(extra) {
    const w = webview();
    const x = voice(w, extra);
    w.tap(); // Next onto the practice item
    if (x.v.warm) x.v.warm([ANSWER.audio]);
    x.v.speak(PREFIX.text, PREFIX.audio);
    await jest.advanceTimersByTimeAsync(50);
    const before = w.made.length; // the prefix may need a new element (the tap's own unlock is still under way)
    w.lapse(); // the practice line and the prompt took their time
    w.end(w.playing()[0]);
    x.v.speak(ANSWER.text, ANSWER.audio); // sayChain: the answer as soon as the prefix ends
    await jest.advanceTimersByTimeAsync(20);
    return { w, x, before };
  }

  test('ON (unlock + warm): the answer is already loaded, starts at once on an unlocked element, no new element', async () => {
    const { w, x, before } = await chain({ unlock: true, warm: true });
    const a = w.playing()[0];
    expect(a && a.src).toBe('/' + ANSWER.audio);
    expect(a.loads).toBeGreaterThanOrEqual(1); // loaded at warm(), before the prefix ended
    expect(w.made.length).toBe(before);
    expect(w.log.filter((l) => l[0] === 'refused')).toEqual([]);
    expect(x.silent).toEqual([]);
  });

  test('ON (unlock only): the answer plays without a tap (no refusal, no 1.5 s retry)', async () => {
    const { w, x } = await chain({ unlock: true });
    expect(w.playing().map((a) => a.src)).toEqual(['/' + ANSWER.audio]);
    expect(w.log.filter((l) => l[0] === 'refused')).toEqual([]);
    expect(x.silent).toEqual([]);
  });

  test('OFF: the answer is a new element, refused: a 1.5 s break, then dropped', async () => {
    const { w, x } = await chain({});
    expect(w.playing()).toEqual([]);
    expect(w.log.filter((l) => l[0] === 'refused').map((l) => l[1])).toEqual(['/' + ANSWER.audio]);
    await jest.advanceTimersByTimeAsync(1600);
    expect(w.log.filter((l) => l[0] === 'refused').length).toBe(2);
    expect(x.silent).toEqual([ANSWER.text]);
  });

  test('warm() is a no-op without the option, and never takes the element that is speaking', async () => {
    const w = webview();
    const off = voice(w, {});
    expect(() => off.v.warm && off.v.warm([ANSWER.audio])).not.toThrow();
    const w2 = webview();
    const on = voice(w2, { unlock: true, warm: true });
    w2.tap();
    on.v.speak(PREFIX.text, PREFIX.audio);
    await jest.advanceTimersByTimeAsync(50);
    on.v.warm([ANSWER.audio, 'sa/v4/ur/aaaaaaaaaaaa.mp3', 'sa/v4/ur/bbbbbbbbbbbb.mp3', 'sa/v4/ur/cccccccccccc.mp3']);
    expect(w2.playing().map((a) => a.src)).toEqual(['/' + PREFIX.audio]);
  });
});

describe('the engine passes the switches to the voice and warms a practice task\'s answers', () => {
  const battery = (ui) => ({ battery_id: 'm', ...(ui ? { ui } : {}), tasks: [{
    id: 'ma.add2i', mode: 'record', present: 'one_at_a_time', time_limit_s: 60, grid: ['5 + 12'],
    items: [{ id: 'i1', target: '17' }],
    practice: [{ id: 'p1', target: '17', model: [PREFIX, ANSWER], feedback: { correct: [{ text: 'شاباش', audio: 'sa/v4/ur/111111111111.mp3' }, ANSWER] } }],
  }] });
  async function made(ui) {
    const seen = [], warmed = [];
    const deps = {
      core,
      store: { open: () => storeMod.open({ idb: null }) },
      ui: { mount: () => ({ destroy() {} }) },
      voice: { create: (o) => { seen.push(o); return { speak: () => Promise.resolve(), stop() {}, setMuted() {}, warm: (l) => warmed.push(l) }; } },
      rec: { create: () => ({ ready: async () => true, start: () => true, stop: async () => null, release() {}, recording: () => false }) },
      now: (() => { let t = 0; return () => (t += 100); })(),
    };
    const eng = await start({ mount: {}, battery: battery(ui), mode: 'game', lang: 'ur', audio_check: false, warmup: false, oral_practice: false }, deps);
    return { o: seen[0], warmed, eng };
  }
  test('ON: unlock and warm; the task\'s answer clips are warmed when the task starts', async () => {
    const { o, warmed } = await made({ r10_bigger_audio: true, r10_practice_gap: true });
    expect(o.unlock).toBe(true);
    expect(o.warm).toBe(true);
    expect(warmed).toEqual([[ANSWER.audio]]);
  });
  test('OFF: neither, and nothing warmed', async () => {
    const { o, warmed } = await made(null);
    expect(o.unlock).toBeUndefined();
    expect(o.warm).toBeUndefined();
    expect(warmed).toEqual([]);
  });
  test('the gap switch alone: warm with unlock (a warmed element must be an unlocked one)', async () => {
    const { o } = await made({ r10_practice_gap: true });
    expect(o.unlock).toBe(true);
    expect(o.warm).toBe(true);
  });
});

describe('the switches sa_r10_bigger_audio and sa_r10_practice_gap', () => {
  const BATTERY = { battery_id: 'b', tasks: [{ id: 'ma.discrimination2', items: [] }] };
  test('named; ON puts battery.ui.r10_<flag>; OFF leaves the battery as it was', () => {
    expect(SWITCHES.r10BiggerAudio).toBe('sa_r10_bigger_audio');
    expect(SWITCHES.r10PracticeGap).toBe('sa_r10_practice_gap');
    expect(applySwitches(BATTERY, { r10BiggerAudio: true }).ui).toEqual({ r10_bigger_audio: true });
    expect(applySwitches(BATTERY, { r10PracticeGap: true }).ui).toEqual({ r10_practice_gap: true });
    expect(applySwitches(BATTERY, { r10BiggerAudio: false, r10PracticeGap: false })).toEqual(BATTERY);
  });
  async function served(flags) {
    const { createSaEngineRouter } = require('../routes/sa-engine.routes');
    const off = () => false;
    const app = express();
    app.use(createSaEngineRouter({ on: () => true, practiceAllMaths: off, passageRotation: off, voiceV2: off, ...flags }));
    const srv = app.listen(0);
    try {
      const name = fs.readdirSync(path.join(__dirname, '..', '..', 'bot', 'shared', 'data', 'child-test', 'sa')).find((n) => /^sa\.coach\..*\.ur\.json$/.test(n));
      const r = await fetch(`http://127.0.0.1:${srv.address().port}/sa/batteries/${name}`);
      return r.json();
    } finally { srv.close(); }
  }
  test('the engine route serves each ON, and neither OFF', async () => {
    const on = await served({ r10BiggerAudio: () => true, r10PracticeGap: () => true });
    expect(on.ui.r10_bigger_audio).toBe(true);
    expect(on.ui.r10_practice_gap).toBe(true);
    const off = await served({ r10BiggerAudio: () => false, r10PracticeGap: () => false });
    expect(off.ui && off.ui.r10_bigger_audio).toBeFalsy();
    expect(off.ui && off.ui.r10_practice_gap).toBeFalsy();
  });
});
