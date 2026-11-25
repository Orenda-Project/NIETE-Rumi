'use strict';
/**
 * The silence stop's own floor (dashboard/sa/sa-rec.js onSilence, STOP_FLOOR): a child on a quiet phone answers at
 * about -37 to -44 dBFS (rms 0.006-0.014 on the 8-bit analyser scale), under the ear's voice floor FLOOR = 0.02
 * (about -34 dBFS). With FLOOR as the stop's minimum such a child was never heard, and the task was ended as
 * early_stop_silence at 20 s while the child was answering. onSilence now judges a voice against STOP_FLOOR = 0.004
 * (about -48 dBFS), computed exactly like thresholdFor otherwise; onVoice (story reading position, cell pacing) keeps
 * FLOOR unchanged. Synthetic level series only: no audio, no recordings.
 */
const storeMod = require('../sa/sa-store');
const rec = require('../sa/sa-rec');

class FakeMR {
  static isTypeSupported(t) { return t === 'audio/webm'; }
  start() {}
  stop() { if (this.onstop) this.onstop(); }
}

/**
 * 8-bit time-domain samples whose rms (as rmsOf reads them) is `level`: each sample is 128 ± a or 128 ± (a + 1), the
 * share of the larger chosen so the mean square is exact. A level of 0 is a flat line.
 */
function fillAt(buf, level) {
  const ms = (level * 128) ** 2;
  const a = Math.floor(Math.sqrt(ms));
  const b = a + 1;
  const p = (ms - a * a) / (b * b - a * a);
  const big = Math.round(p * buf.length);
  for (let i = 0; i < buf.length; i++) {
    const amp = i < big ? b : a;
    buf[i] = 128 + (i % 2 ? amp : -amp);
  }
}

/** A fake AudioContext whose analyser reads `level(t)` at the clock's time t (ms). */
function fakeAudio(clock, level) {
  return class {
    createMediaStreamSource() { return { connect() {} }; }
    createAnalyser() { return { fftSize: 2048, getByteTimeDomainData(buf) { fillAt(buf, level(clock.t)); } }; }
    close() { return Promise.resolve(); }
  };
}

async function rig(level, ls) {
  const clock = { t: 0 };
  const fns = new Map();
  let n = 0;
  const iv = { fns, set: (f) => { fns.set(++n, f); return n; }, clear: (h) => { fns.delete(h); } };
  const s = await storeMod.open({ idb: null });
  const r = rec.create({ store: s, session_id: 'x', MediaRecorder: FakeMR, getUserMedia: async () => ({ getTracks: () => [] }),
    now: () => clock.t, AudioContext: fakeAudio(clock, level), interval: iv, localStorage: ls || null });
  await r.ready();
  r.start('ma.add2i');
  const run = (ms) => { for (let x = 0; x < ms; x += 100) { clock.t += 100; [...fns.values()].forEach((f) => f()); } };
  return { r, run, iv, clock };
}

// a deterministic wobble in [lo, hi] per 100 ms tick (no Math.random: the series is the same on every run)
const wobble = (lo, hi) => (t) => lo + (hi - lo) * ((Math.floor(t / 100) * 7919) % 101) / 100;
const room = wobble(0, 0.002);
const speech = wobble(0.007, 0.012);
/**
 * A quiet child answering from `from` ms: short bursts of speech (4-5 ticks) with gaps at the room's level between
 * them (2-3 ticks), until `to` ms; the room before and after.
 */
function quietChild(from, to) {
  return (t) => {
    if (t < from || t >= to) return room(t);
    const k = Math.floor((t - from) / 100) % 7;
    return k < 4 + (Math.floor((t - from) / 700) % 2) ? speech(t) : room(t);
  };
}

describe('onSilence: the stop decision hears a quiet child (STOP_FLOOR)', () => {
  test('a quiet child answering from 1.2 s (speech ticks at rms 0.007-0.012, gaps between): no early_stop_silence', async () => {
    const { r, run, iv } = await rig(quietChild(1200, 15000));
    const fired = [];
    r.onSilence({ after_s: 12, total_s: 20 }, (e) => fired.push(e));
    run(25000);
    expect(fired.map((e) => e.kind)).not.toContain('early_stop_silence');
    expect(fired).toEqual([]);
    expect(iv.fns.size).toBe(0); // the voice ended the watch
  });

  test('a quiet child who starts at 7.9 s: heard before the 12 s mercy and never stopped at 20 s', async () => {
    const { r, run } = await rig(quietChild(7900, 19000));
    const fired = [];
    r.onSilence({ after_s: 12, total_s: 20 }, (e) => fired.push(e));
    run(25000);
    expect(fired).toEqual([]);
  });

  test('the same quiet child under a quiet phone\'s probe peak (mic check rms 0.008): still heard', async () => {
    const ls = { getItem: (k) => (k === 'sa:mic_ok' ? JSON.stringify({ mic_ok: true, mic_rms: 0.008, at: 1 }) : null) };
    const { r, run } = await rig(quietChild(1200, 15000), ls);
    const fired = [];
    r.onSilence({ after_s: 12, total_s: 20 }, (e) => fired.push(e));
    run(25000);
    expect(fired).toEqual([]);
  });

  test('a silent series (every tick at rms <= 0.002): mercy at 12 s, early_stop_silence at 20 s, as before', async () => {
    const { r, run, iv } = await rig(room);
    const fired = [];
    r.onSilence({ after_s: 12, total_s: 20 }, (e) => fired.push(e));
    run(19900);
    expect(fired).toEqual([{ kind: 'mercy', silence_s: 12 }]);
    run(100);
    expect(fired).toEqual([{ kind: 'mercy', silence_s: 12 }, { kind: 'early_stop_silence', silence_s: 20 }]);
    expect(iv.fns.size).toBe(0);
  });

  test('a room hum (rms 0.04) is still the room, not a voice: the stop floor never undercuts 2x the room', async () => {
    const { r, run } = await rig(() => 0.04);
    const fired = [];
    r.onSilence({ after_s: 12, total_s: 20 }, (e) => fired.push(e));
    run(20000);
    expect(fired.map((e) => e.kind)).toEqual(['mercy', 'early_stop_silence']);
  });

  test('stopThresholdFor: thresholdFor with STOP_FLOOR in place of FLOOR (the outer max and the probe cap)', () => {
    expect(rec.STOP_FLOOR).toBe(0.004);
    expect(rec.stopThresholdFor(0, null)).toBeCloseTo(0.004);
    expect(rec.stopThresholdFor(0.001, null)).toBeCloseTo(0.004);
    expect(rec.stopThresholdFor(0.003, null)).toBeCloseTo(0.006); // 2x the room
    expect(rec.stopThresholdFor(0.1, null)).toBeCloseTo(0.06); // never above the ceiling
    const probe = (rms) => ({ getItem: (k) => (k === 'sa:mic_ok' ? JSON.stringify({ mic_ok: true, mic_rms: rms, at: 1 }) : null) });
    expect(rec.stopThresholdFor(0.003, probe(0.01))).toBeCloseTo(0.005); // half the probe's peak
    expect(rec.stopThresholdFor(0.001, probe(0.004))).toBeCloseTo(0.004); // the probe cap never goes under STOP_FLOOR
    expect(rec.stopThresholdFor(0.1, { getItem: (k) => (k === 'sa:mic_rms' ? '0.3' : null) })).toBeCloseTo(0.06);
  });
});

describe('onVoice and thresholdFor keep FLOOR = 0.02 (story reading position, cell pacing unchanged)', () => {
  test('FLOOR and thresholdFor are as before', () => {
    expect(rec.FLOOR).toBe(0.02);
    expect(rec.thresholdFor(0, null)).toBeCloseTo(0.02);
    expect(rec.thresholdFor(0.001, null)).toBeCloseTo(0.02);
    const probe = { getItem: (k) => (k === 'sa:mic_ok' ? JSON.stringify({ mic_ok: true, mic_rms: 0.008, at: 1 }) : null) };
    expect(rec.thresholdFor(0.001, probe)).toBeCloseTo(0.02);
  });

  test('onVoice does not call back for the quiet child\'s speech ticks (0.007-0.012 is under FLOOR)', async () => {
    const { r, run } = await rig(quietChild(1200, 15000));
    let voiced = 0;
    const cancel = r.onVoice(() => { voiced += 1; });
    run(16000);
    expect(voiced).toBe(0);
    cancel();
  });

  test('onVoice still calls back on a voice over FLOOR (rms 0.03 from 2 s to 3 s)', async () => {
    const { r, run, clock } = await rig((t) => (t >= 2000 && t < 3000 ? 0.03 : 0.001));
    const at = [];
    const cancel = r.onVoice(() => at.push(clock.t));
    run(5000);
    expect(at.length).toBeGreaterThan(3);
    expect(Math.min(...at)).toBeGreaterThanOrEqual(2000);
    expect(Math.max(...at)).toBeLessThan(3100);
    cancel();
  });
});
