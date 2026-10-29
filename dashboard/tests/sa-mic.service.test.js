'use strict';
/**
 * The phone's microphone record (dashboard/sa/sa-mic.js): read the way both writers store it (the game's mic check
 * '1'/'0', the coach pre-flight's JSON), written by the game's check, unknown when nothing is stored.
 */
const mic = require('../sa/sa-mic');

function mem(init) { const m = Object.assign({}, init); return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: (k) => { delete m[k]; }, m }; }

test('reads both writers; anything else is unknown', () => {
  expect(mic.state(mem({}))).toBe('unknown');
  expect(mic.state(mem({ 'sa:mic_ok': '1' }))).toBe('ok');
  expect(mic.state(mem({ 'sa:mic_ok': '0' }))).toBe('no');
  expect(mic.state(mem({ 'sa:mic_ok': JSON.stringify({ ok: true, mic_rms: 0.2 }) }))).toBe('ok');
  expect(mic.state(mem({ 'sa:mic_ok': JSON.stringify({ mic_ok: false }) }))).toBe('no');
  expect(mic.state(mem({ 'sa:mic_ok': 'garbage' }))).toBe('unknown');
});

test('the game check is remembered with its level', () => {
  const s = mem({});
  mic.remember(true, 0.034567, s);
  expect(s.m).toEqual({ 'sa:mic_ok': '1', 'sa:mic_rms': '0.0346' });
  expect(mic.state(s)).toBe('ok');
});

test('the RMS of 8-bit samples (128 = silence)', () => {
  expect(mic.rmsOf(new Uint8Array([128, 128, 128]))).toBe(0);
  expect(mic.rmsOf(new Uint8Array([192, 64]))).toBeCloseTo(0.5, 5);
});

test('a failed game check is not kept (asked again next run); a pass stays', () => {
  const s = mem({});
  mic.remember(false, 0, s);
  expect(mic.state(s)).toBe('unknown');
  mic.remember(true, 0.05, s);
  mic.remember(false, 0, s);
  expect(mic.state(s)).toBe('ok');
});

// sa_r8_ios_mic: on an iPhone an AudioContext made after the microphone answers (outside the tap) can start suspended and
// its meter reads silence, so a working microphone fails the game's check (ok needs a peak over FLOOR). With { ios: true }
// the context is made inside the tap, before the microphone is asked for, and resumed. Without it, today's order.
describe('probe on an iPhone (opts.ios)', () => {
  let order;
  let made;
  let gumAt;
  function deps() {
    order = 0; made = []; gumAt = 0;
    class AC {
      constructor() { this.state = 'suspended'; this.at = (order += 1); made.push(this); }
      resume() { this.state = 'running'; return Promise.resolve(); }
      close() { this.state = 'closed'; return Promise.resolve(); }
      createAnalyser() { const self = this; return { fftSize: 1024, getByteTimeDomainData: (b) => b.fill(self.state === 'running' ? 160 : 128) }; }
      createMediaStreamSource() { return { connect() {} }; }
    }
    class MR {
      constructor() { this.state = 'inactive'; }
      start() { this.state = 'recording'; }
      stop() { this.state = 'inactive'; if (this.onstop) this.onstop(); }
    }
    const stream = { getTracks: () => [{ stop() {} }] };
    return { AudioContext: AC, MediaRecorder: MR, getUserMedia: () => { gumAt = (order += 1); return Promise.resolve(stream); } };
  }
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());
  async function run(o) {
    const p = mic.probe(2000, o);
    for (let i = 0; i < 10; i++) await Promise.resolve(); // the microphone's answer, then the recorder starts
    jest.advanceTimersByTime(2100);
    return p;
  }

  test('ios: the context is made before the microphone is asked for, resumed, and a voice passes', async () => {
    const r = await run({ ios: true, ...deps() });
    expect(made).toHaveLength(1);
    expect(made[0].at).toBeLessThan(gumAt);
    expect(r.ok).toBe(true);
    expect(r.peak).toBeGreaterThan(mic.FLOOR);
  });

  test('without ios: today, the context after the microphone, never resumed (a suspended meter reads silence)', async () => {
    const r = await run(deps());
    expect(made[0].at).toBeGreaterThan(gumAt);
    expect(r.ok).toBe(false);
  });
});
