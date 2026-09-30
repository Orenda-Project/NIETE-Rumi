/**
 * P0.1 (bd-1hae7.1) — the playout jitter buffer.
 *
 * The Realtime API streams a reply's audio FASTER than real time, so the buffer
 * legitimately holds seconds of not-yet-spoken speech. Two failure modes this
 * encodes against, both learned from the R&D bridge:
 *   1. Dropping audio mid-response skips/overlaps speech — so the size cap is a
 *      pathological-growth guard (~60s), never a per-response trim.
 *   2. Draining per sample (Array.shift) is O(n²) and stutters — so reads are
 *      chunk-based with a read head.
 * Plus a prebuffer so a brief generation/network hiccup doesn't underrun into
 * the "unstable connection" stutter.
 */

const PlayoutBuffer = require('../../shared/calls/playout-buffer');

const FRAME = 480; // 10ms @ 48kHz

describe('PlayoutBuffer — jitter/prebuffer behaviour', () => {
  test('emits silence until the prebuffer threshold is reached', () => {
    const buf = new PlayoutBuffer({ frameSamples: FRAME, prebufferSamples: 960 });
    buf.push(new Int16Array(480).fill(7)); // below threshold
    const frame = buf.readFrame();
    expect(frame.length).toBe(FRAME);
    expect(Array.from(frame).every((s) => s === 0)).toBe(true); // still waiting
  });

  test('starts playing once the threshold is crossed and returns real audio', () => {
    const buf = new PlayoutBuffer({ frameSamples: FRAME, prebufferSamples: 960 });
    buf.push(new Int16Array(960).fill(7));
    expect(Array.from(buf.readFrame()).every((s) => s === 7)).toBe(true);
  });

  test('re-arms the prebuffer after an underrun (silence → wait again)', () => {
    const buf = new PlayoutBuffer({ frameSamples: FRAME, prebufferSamples: 480 });
    buf.push(new Int16Array(480).fill(3));
    expect(Array.from(buf.readFrame()).every((s) => s === 3)).toBe(true);
    expect(buf.buffered).toBe(0);
    buf.readFrame(); // underrun → stop playing
    buf.push(new Int16Array(240).fill(4)); // below threshold again
    expect(Array.from(buf.readFrame()).every((s) => s === 0)).toBe(true);
  });
});

describe('PlayoutBuffer — chunk-spanning reads', () => {
  test('a frame is assembled across several small chunks in order', () => {
    const buf = new PlayoutBuffer({ frameSamples: 4, prebufferSamples: 0 });
    buf.push(Int16Array.from([1, 2]));
    buf.push(Int16Array.from([3]));
    buf.push(Int16Array.from([4, 5, 6]));
    expect(Array.from(buf.readFrame())).toEqual([1, 2, 3, 4]);
    expect(buf.buffered).toBe(2);
  });

  test('a chunk larger than one frame is consumed across frames without loss', () => {
    const buf = new PlayoutBuffer({ frameSamples: 2, prebufferSamples: 0 });
    buf.push(Int16Array.from([1, 2, 3, 4, 5]));
    expect(Array.from(buf.readFrame())).toEqual([1, 2]);
    expect(Array.from(buf.readFrame())).toEqual([3, 4]);
    expect(Array.from(buf.readFrame())).toEqual([5, 0]); // tail zero-padded
  });

  test('a partially-drained chunk keeps its read head across pushes', () => {
    const buf = new PlayoutBuffer({ frameSamples: 2, prebufferSamples: 0 });
    buf.push(Int16Array.from([1, 2, 3]));
    buf.readFrame();
    buf.push(Int16Array.from([4, 5]));
    expect(Array.from(buf.readFrame())).toEqual([3, 4]);
  });

  test('buffered count stays accurate through partial reads', () => {
    const buf = new PlayoutBuffer({ frameSamples: 2, prebufferSamples: 0 });
    buf.push(new Int16Array(10));
    buf.readFrame();
    expect(buf.buffered).toBe(8);
  });
});

describe('PlayoutBuffer — bounds and flush', () => {
  test('drops the OLDEST audio only past the pathological cap', () => {
    const buf = new PlayoutBuffer({ frameSamples: 2, prebufferSamples: 0, maxSamples: 6 });
    buf.push(Int16Array.from([1, 1, 1, 1]));
    buf.push(Int16Array.from([2, 2, 2, 2]));
    expect(buf.buffered).toBeLessThanOrEqual(6);
    // The newest chunk survives; the stale head is what goes.
    expect(Array.from(buf.readFrame())).toEqual([2, 2]);
  });

  test('does not drop below the cap during a normal fast response', () => {
    const buf = new PlayoutBuffer({ frameSamples: 480, prebufferSamples: 0, maxSamples: 48000 });
    for (let i = 0; i < 20; i += 1) buf.push(new Int16Array(480).fill(1));
    expect(buf.buffered).toBe(9600); // nothing dropped
  });

  test('flush clears everything and re-arms the prebuffer (barge-in)', () => {
    const buf = new PlayoutBuffer({ frameSamples: 2, prebufferSamples: 4 });
    buf.push(new Int16Array(10).fill(5));
    buf.readFrame();
    buf.flush();
    expect(buf.buffered).toBe(0);
    buf.push(Int16Array.from([9, 9])); // below prebuffer → silence
    expect(Array.from(buf.readFrame())).toEqual([0, 0]);
  });

  test('pushing an empty chunk is a no-op', () => {
    const buf = new PlayoutBuffer({ frameSamples: 2, prebufferSamples: 0 });
    buf.push(new Int16Array(0));
    expect(buf.buffered).toBe(0);
  });
});
