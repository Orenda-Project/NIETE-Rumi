import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { joinWebmParts, splitParts, startsWebm, concatBytes } from "./webmJoin";

/**
 * bd-ma9jiy — a cut recording resumed is ONE file. The parts are REAL Chrome MediaRecorder recordings (opus 32 kb/s,
 * 1 s slices, the portal's settings; tests/fixtures/audio/chrome-webm, made by the work folder's make-fixtures.cjs):
 * partA (4 s) then partB (3 s), two MediaRecorder sessions as a kill and a Resume make them.
 */
const dir = resolve(__dirname, "../../../../tests/fixtures/audio/chrome-webm");
const A = new Uint8Array(readFileSync(resolve(dir, "partA.webm")));
const B = new Uint8Array(readFileSync(resolve(dir, "partB.webm")));

/** Every Cluster's Timecode in a file, in order (a small reader of its own, so the test does not trust the code under test). */
function clusterTimes(b: Uint8Array): number[] {
  const out: number[] = [];
  for (let i = 0; i + 6 < b.length; i += 1) {
    if (b[i] === 0x1f && b[i + 1] === 0x43 && b[i + 2] === 0xb6 && b[i + 3] === 0x75) {
      const sizeLen = (() => { let m = 0x80, n = 1; while (!(b[i + 4] & m)) { m >>= 1; n += 1; } return n; })();
      const tc = i + 4 + sizeLen;
      if (b[tc] === 0xe7) {
        const n = b[tc + 1] & 0x7f;
        let v = 0;
        for (let k = 0; k < n; k += 1) v = v * 256 + b[tc + 2 + k];
        out.push(v);
      }
    }
  }
  return out;
}

function countHeaders(b: Uint8Array): number {
  let n = 0;
  for (let i = 0; i + 3 < b.length; i += 1) if (b[i] === 0x1a && b[i + 1] === 0x45 && b[i + 2] === 0xdf && b[i + 3] === 0xa3) n += 1;
  return n;
}

describe("joinWebmParts (real Chrome parts)", () => {
  it("makes one file: one header, the second part's clusters carried on after the first part's audio", () => {
    const r = joinWebmParts([A, B]);
    if ("error" in r) throw new Error(r.error);
    expect(countHeaders(r.bytes)).toBe(1);
    const times = clusterTimes(r.bytes);
    const aTimes = clusterTimes(A);
    const bTimes = clusterTimes(B);
    expect(times.length).toBe(aTimes.length + bTimes.length);
    // strictly increasing: no clock jump back to 0 at the join
    for (let i = 1; i < times.length; i += 1) expect(times[i]).toBeGreaterThan(times[i - 1]);
    // part B starts where part A's audio ends (about 4 s), and the whole is about 7 s
    expect(r.partStartsMs[1]).toBeGreaterThan(3500);
    expect(r.partStartsMs[1]).toBeLessThan(4600);
    expect(times[aTimes.length]).toBe(r.partStartsMs[1] + bTimes[0]);
    expect(r.durationMs).toBeGreaterThan(6500);
    expect(r.durationMs).toBeLessThan(7600);
    // part A is kept byte for byte
    expect(Array.from(r.bytes.subarray(0, 64))).toEqual(Array.from(A.subarray(0, 64)));
  });

  it("a kill mid-write (half a block at the end of part A) is cut back to the last whole block", () => {
    const cut = A.subarray(0, A.length - 7);
    const r = joinWebmParts([cut, B]);
    if ("error" in r) throw new Error(r.error);
    expect(countHeaders(r.bytes)).toBe(1);
    const times = clusterTimes(r.bytes);
    for (let i = 1; i < times.length; i += 1) expect(times[i]).toBeGreaterThan(times[i - 1]);
  });

  it("three parts join in order", () => {
    const r = joinWebmParts([A, B, B]);
    if ("error" in r) throw new Error(r.error);
    expect(r.partStartsMs).toHaveLength(3);
    expect(r.partStartsMs[2]).toBeGreaterThan(r.partStartsMs[1]);
    expect(countHeaders(r.bytes)).toBe(1);
  });

  it("refuses bytes that are not a WebM (an MP4 recording), so the caller keeps its fallback", () => {
    const mp4 = new Uint8Array([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
    expect(joinWebmParts([mp4, B])).toEqual({ error: "not_webm", part: 0 });
  });

  it("splitParts finds each MediaRecorder session's first chunk in a recording's chunks", () => {
    const chunks = [A.subarray(0, 1603), A.subarray(1603), B.subarray(0, 1603), B.subarray(1603, 3000), B.subarray(3000)];
    const parts = splitParts(chunks);
    expect(parts.map((p) => p.length)).toEqual([2, 3]);
    expect(startsWebm(parts[1][0])).toBe(true);
    expect(concatBytes(parts[0])).toEqual(A);
  });
});
