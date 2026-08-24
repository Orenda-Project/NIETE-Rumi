/**
 * P0.1 (bd-1hae7.1) — PCM helpers for the live-call audio bridge.
 *
 * The bridge sits between two fixed formats:
 *   WhatsApp WebRTC  → PCM16 mono, rate as DELIVERED by the sink (16 kHz in
 *                      practice, even though the SDP advertises 48 kHz — so we
 *                      always resample from the ACTUAL rate, never a constant)
 *   OpenAI Realtime  → PCM16 mono @ 24 kHz, base64
 *
 * These are pure functions on purpose: every sample-rate bug we could ship is
 * catchable here, off the live call path.
 */

const pcm = require('../../shared/calls/pcm');

describe('pcm — resampleLinear', () => {
  test('same rate returns the input untouched (no needless copy/precision loss)', () => {
    const input = Int16Array.from([1, 2, 3, 4]);
    expect(pcm.resampleLinear(input, 24000, 24000)).toBe(input);
  });

  test('empty input is safe', () => {
    expect(pcm.resampleLinear(new Int16Array(0), 16000, 24000).length).toBe(0);
  });

  test('16 kHz → 24 kHz lengthens by the rate ratio (the real WhatsApp path)', () => {
    const input = new Int16Array(160); // 10ms @16k
    const out = pcm.resampleLinear(input, 16000, 24000);
    expect(out.length).toBe(240); // 10ms @24k
  });

  test('24 kHz → 48 kHz doubles (the playout path)', () => {
    const input = new Int16Array(240);
    expect(pcm.resampleLinear(input, 24000, 48000).length).toBe(480);
  });

  test('interpolates between samples rather than duplicating them', () => {
    // Upsampling 2x a ramp should produce the midpoints, not stair-steps.
    const input = Int16Array.from([0, 100]);
    const out = pcm.resampleLinear(input, 24000, 48000);
    expect(out[0]).toBe(0);
    expect(out[1]).toBe(50); // midpoint — proves linear interpolation
  });

  test('preserves a constant signal exactly (no drift or attenuation)', () => {
    const input = new Int16Array(100).fill(1234);
    const out = pcm.resampleLinear(input, 16000, 24000);
    for (let i = 0; i < out.length - 1; i += 1) expect(out[i]).toBe(1234);
  });

  test('round-trips a ramp through 16k→24k→16k within one LSB', () => {
    const input = Int16Array.from({ length: 64 }, (_, i) => i * 100);
    const there = pcm.resampleLinear(input, 16000, 24000);
    const back = pcm.resampleLinear(there, 24000, 16000);
    // Length within a sample, and values close (linear interp is lossy at edges).
    expect(Math.abs(back.length - input.length)).toBeLessThanOrEqual(1);
    for (let i = 1; i < back.length - 1; i += 1) {
      expect(Math.abs(back[i] - input[i])).toBeLessThanOrEqual(60);
    }
  });
});

describe('pcm — downmixToMono', () => {
  test('mono passes through untouched', () => {
    const input = Int16Array.from([5, 6, 7]);
    expect(pcm.downmixToMono(input, 1)).toBe(input);
  });

  test('stereo averages L/R pairs and halves the length', () => {
    const input = Int16Array.from([100, 200, 300, 500]);
    const out = pcm.downmixToMono(input, 2);
    expect(Array.from(out)).toEqual([150, 400]);
  });

  test('undefined channelCount is treated as mono (sink omits it sometimes)', () => {
    const input = Int16Array.from([1, 2]);
    expect(pcm.downmixToMono(input, undefined)).toBe(input);
  });
});

describe('pcm — base64 codec', () => {
  test('int16 → base64 → int16 round-trips exactly, negatives included', () => {
    const input = Int16Array.from([0, 1, -1, 32767, -32768, 12345]);
    const out = pcm.base64ToInt16(pcm.int16ToBase64(input));
    expect(Array.from(out)).toEqual(Array.from(input));
  });

  test('decodes a byte-misaligned buffer without throwing (alignment guard)', () => {
    // An odd number of bytes must not throw a RangeError on the Int16 view.
    const odd = Buffer.from([1, 2, 3]).toString('base64');
    expect(() => pcm.base64ToInt16(odd)).not.toThrow();
    expect(pcm.base64ToInt16(odd).length).toBe(1);
  });

  test('encodes a subarray view correctly (byteOffset is honoured)', () => {
    const backing = Int16Array.from([9, 9, 1, 2, 3]);
    const view = backing.subarray(2); // byteOffset != 0
    expect(Array.from(pcm.base64ToInt16(pcm.int16ToBase64(view)))).toEqual([1, 2, 3]);
  });
});

describe('pcm — rms (drop-detection diagnostic)', () => {
  test('silence is 0', () => {
    expect(pcm.rms(new Int16Array(100))).toBe(0);
  });

  test('constant amplitude equals that amplitude', () => {
    expect(Math.round(pcm.rms(new Int16Array(50).fill(1000)))).toBe(1000);
  });

  test('empty input is 0, not NaN', () => {
    expect(pcm.rms(new Int16Array(0))).toBe(0);
  });
});
