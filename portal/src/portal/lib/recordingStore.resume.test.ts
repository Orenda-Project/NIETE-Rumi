// @vitest-environment node
// Node's own Blob: IndexedDB (fake-indexeddb here, the browser in real life) stores it as a Blob.
import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { createRecording, appendChunk, latestUnsent, readKept, __resetForTests } from "./recordingStore";

/**
 * bd-ma9jiy — a cut recording is kept as pieces from one or more MediaRecorder sessions (a kill, then Resume into the
 * same recording). Read back, it is ONE WebM (one header, the clock carried on), with every save's heartbeat sample and
 * where the next piece goes. Real Chrome recordings (tests/fixtures/audio/chrome-webm).
 */
const dir = resolve(__dirname, "../../../../tests/fixtures/audio/chrome-webm");
const A = new Uint8Array(readFileSync(resolve(dir, "partA.webm")));
const B = new Uint8Array(readFileSync(resolve(dir, "partB.webm")));

function headers(b: Uint8Array): number {
  let n = 0;
  for (let i = 0; i + 3 < b.length; i += 1) if (b[i] === 0x1a && b[i + 1] === 0x45 && b[i + 2] === 0xdf && b[i + 3] === 0xa3) n += 1;
  return n;
}
const bytes = async (blob: Blob) => new Uint8Array(await blob.arrayBuffer());

beforeEach(async () => {
  await __resetForTests();
});

describe("recordingStore: a recording made of two sessions (cut, then resumed)", () => {
  async function twoSessions() {
    await createRecording({ id: "r1", mimeType: "audio/webm;codecs=opus", ext: ".webm", startedAt: "2026-11-25T05:00:00Z" });
    await appendChunk("r1", 0, new Blob([A.subarray(0, 1603)]), 1_000, { beat: { t: 1000, s: 0 } });
    await appendChunk("r1", 1, new Blob([A.subarray(1603)]), 4_000, { beat: { t: 4000, s: 1 } });
    // Resume: the next session's first piece is a whole new WebM file, flagged as a new part.
    await appendChunk("r1", 2, new Blob([B.subarray(0, 1603)]), 5_000, { beat: { t: 90_000, s: 2 }, first: true });
    await appendChunk("r1", 3, new Blob([B.subarray(1603)]), 7_000, { beat: { t: 92_000, s: 3 } });
  }

  it("readKept: one WebM out of both sessions, the next seq, every beat, the last beat's time", async () => {
    await twoSessions();
    const kept = await readKept("r1");
    expect(kept).not.toBeNull();
    const b = await bytes(kept!.blob);
    expect(headers(b)).toBe(1);
    expect(b.length).toBeGreaterThan(A.length + B.length - 2_000);
    expect(kept!.nextSeq).toBe(4);
    expect(kept!.parts).toBe(2);
    expect(kept!.beats.map((x) => x.s)).toEqual([0, 1, 2, 3]);
    expect(kept!.meta.elapsedMs).toBe(7_000);
  });

  it("latestUnsent hands back the same joined file (Send saved recording sends one recording, not two glued files)", async () => {
    await twoSessions();
    const got = await latestUnsent();
    expect(headers(await bytes(got!.blob))).toBe(1);
  });

  it("a recording from before this change (no beats, no part flags) reads back exactly as it was saved", async () => {
    await createRecording({ id: "old", mimeType: "audio/webm", ext: ".webm", startedAt: "2026-11-20T05:00:00Z" });
    await appendChunk("old", 0, new Blob(["aa"]), 5_000);
    await appendChunk("old", 1, new Blob(["bb"]), 10_000);
    const kept = await readKept("old");
    expect(await kept!.blob.text()).toBe("aabb");
    expect(kept!.nextSeq).toBe(2);
    expect(kept!.parts).toBe(1);
    expect(kept!.beats).toEqual([]);
  });

  it("readKept of a recording with no audio, or none at all, is null", async () => {
    await createRecording({ id: "empty", mimeType: "audio/webm", ext: ".webm", startedAt: "2026-11-25T05:00:00Z" });
    expect(await readKept("empty")).toBeNull();
    expect(await readKept("nope")).toBeNull();
  });
});
