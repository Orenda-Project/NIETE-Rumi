'use strict';
/**
 * The mercy rule's ear (dashboard/sa/sa-rec.js onSilence, RULING #10b): while a read-aloud records, the mic's level is
 * read ten times a second; no voice for 12 s after the begin line → 'mercy' once; still none at 20 s →
 * 'early_stop_silence'. A voice at any point ends the watch: nothing fires.
 */
const storeMod = require('../sa/sa-store');
const rec = require('../sa/sa-rec');

class FakeMR {
  static isTypeSupported(t) { return t === 'audio/webm'; }
  start() {}
  stop() { if (this.onstop) this.onstop(); }
}

/** A fake AudioContext whose analyser hears `level(t)` (0..1) at the clock's time t (ms). */
function fakeAudio(clock, level, ctl) {
  return class {
    constructor() { if (ctl) { this.state = ctl.state; ctl.ctx = this; } }
    resume() { if (ctl) { ctl.resumes = (ctl.resumes || 0) + 1; if (ctl.resumeTo) this.state = ctl.resumeTo; } return Promise.resolve(); }
    createMediaStreamSource() { return { connect() {} }; }
    createAnalyser() {
      return {
        fftSize: 2048,
        getByteTimeDomainData(buf) { const a = Math.round(level(clock.t) * 127); for (let i = 0; i < buf.length; i++) buf[i] = 128 + (i % 2 ? a : -a); },
      };
    }
    close() { return Promise.resolve(); }
  };
}

function fakeInterval() {
  const fns = new Map();
  let n = 0;
  return { fns, set: (f) => { fns.set(++n, f); return n; }, clear: (h) => { fns.delete(h); } };
}

async function rig(level, ls, ctl) {
  const clock = { t: 0 };
  const iv = fakeInterval();
  const s = await storeMod.open({ idb: null });
  const r = rec.create({ store: s, session_id: 'x', MediaRecorder: FakeMR, getUserMedia: async () => ({ getTracks: () => [] }),
    now: () => clock.t, AudioContext: fakeAudio(clock, level, ctl), interval: iv, localStorage: ls || null });
  await r.ready();
  r.start('ur.story');
  const fired = [];
  const cancel = r.onSilence({ after_s: 12, total_s: 20 }, (e) => fired.push(e));
  const run = (ms) => { for (let x = 0; x < ms; x += 100) { clock.t += 100; [...iv.fns.values()].forEach((f) => f()); } };
  return { r, fired, run, iv, cancel };
}

test('a silent mic: mercy at 12 s, then early_stop_silence at 20 s, then nothing more', async () => {
  const { fired, run, iv } = await rig(() => 0);
  run(11900);
  expect(fired).toEqual([]);
  run(100);
  expect(fired).toEqual([{ kind: 'mercy', silence_s: 12 }]);
  run(8000);
  expect(fired).toEqual([{ kind: 'mercy', silence_s: 12 }, { kind: 'early_stop_silence', silence_s: 20 }]);
  expect(iv.fns.size).toBe(0);
  run(5000);
  expect(fired.length).toBe(2);
});

test('a voice at 8 s: neither fires', async () => {
  const { fired, run, iv } = await rig((t) => (t >= 8000 && t < 9500 ? 0.3 : 0.001));
  run(25000);
  expect(fired).toEqual([]);
  expect(iv.fns.size).toBe(0);
});

test('a quiet room hum is not a voice; the threshold follows the room (2x its floor)', async () => {
  const { fired, run } = await rig(() => 0.04);
  run(12000);
  expect(fired).toEqual([{ kind: 'mercy', silence_s: 12 }]);
});

test('a child who starts reading at once (voice from 0 s, never a quiet second) is a voice, not the room', async () => {
  const { fired, run, iv } = await rig((t) => 0.25 + 0.05 * Math.sin(t / 37));
  run(25000);
  expect(fired).toEqual([]);
  expect(iv.fns.size).toBe(0);
});

test('a suspended AudioContext (Android, no gesture) is no ear, never silence: ear_unavailable, no mercy, no stop', async () => {
  const ctl = { state: 'suspended' };
  const { r, fired, run, iv } = await rig(() => 0, null, ctl);
  expect(ctl.resumes).toBeGreaterThan(0);
  run(25000);
  expect(fired).toEqual([{ kind: 'ear_unavailable' }]);
  expect(iv.fns.size).toBe(0);
  expect(r.ear()).toBe('unavailable');
});

test('a context that resumes on the tap hears normally; wake() resumes it', async () => {
  const ctl = { state: 'suspended', resumeTo: 'running' };
  const { r, fired, run } = await rig(() => 0, null, ctl);
  run(12000);
  expect(fired).toEqual([{ kind: 'mercy', silence_s: 12 }]);
  expect(r.ear()).toBe('running');
  ctl.ctx.state = 'suspended';
  r.wake();
  expect(ctl.ctx.state).toBe('running');
});

test('stop() ends the watch; the module-level SAE.rec.onSilence uses the last recorder', async () => {
  const { r, fired, run, iv } = await rig(() => 0);
  run(5000);
  await r.stop();
  expect(iv.fns.size).toBe(0);
  run(20000);
  expect(fired).toEqual([]);
  const seen = [];
  r.start('ur.story2');
  rec.onSilence({ after_s: 1, total_s: 2 }, (e) => seen.push(e.kind));
  run(2000);
  expect(seen).toEqual(['mercy', 'early_stop_silence']);
});

test('no microphone: a no-op cancel, nothing fires', async () => {
  const s = await storeMod.open({ idb: null });
  const r = rec.create({ store: s, session_id: 'x', MediaRecorder: FakeMR, getUserMedia: async () => { throw new Error('denied'); } });
  await r.ready();
  const cancel = r.onSilence({ after_s: 12, total_s: 20 }, () => { throw new Error('must not fire'); });
  expect(typeof cancel).toBe('function');
  cancel();
});

test('the probe peak caps the threshold: a child as loud as half the probe counts as a voice', () => {
  const ls = { getItem: (k) => (k === 'sa:mic_ok' ? JSON.stringify({ mic_ok: true, mic_rms: 0.1, at: 1 }) : null) };
  expect(rec.thresholdFor(0.2, ls)).toBeCloseTo(0.05);
  expect(rec.thresholdFor(0.001, ls)).toBeCloseTo(0.02);
  expect(rec.thresholdFor(0.001, null)).toBeCloseTo(0.02);
  const game = { getItem: (k) => (k === 'sa:mic_rms' ? '0.3' : null) };
  expect(rec.thresholdFor(0.1, game)).toBeCloseTo(0.06); // never above the ceiling: speech is never the room
  expect(rec.thresholdFor(0.01, game)).toBeCloseTo(0.02);
});
