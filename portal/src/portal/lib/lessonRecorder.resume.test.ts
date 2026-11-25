import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

vi.mock("fix-webm-duration", () => ({ default: vi.fn(async (blob: Blob) => blob) }));

import { LessonRecorder } from "./lessonRecorder";
import { bytesOf } from "./webmJoin";

/**
 * bd-ma9jiy (queue #262) — the shared lesson recorder (teacher DC, coach/principal observation, coach debrief):
 *  · a piece is saved to the phone every SECOND (was 5 s): a killed app loses at most about a second;
 *  · Resume after a kill continues the SAME recording: same id, the next piece numbers, the clock carried on, and Stop
 *    gives ONE file (real Chrome parts: the kept part A, then part B recorded after Resume);
 *  · every save carries a heartbeat sample, and a save that fails is told (it was dropped silently).
 * The child test keeps its own 5 s pieces (it passes sliceMs; the operator: student recordings unchanged tonight).
 */
const dir = resolve(__dirname, "../../../../tests/fixtures/audio/chrome-webm");
const A = new Uint8Array(readFileSync(resolve(dir, "partA.webm")));
const B = new Uint8Array(readFileSync(resolve(dir, "partB.webm")));

class FakeMR {
  static last: FakeMR | null = null;
  state: "inactive" | "recording" | "paused" = "inactive";
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  timeslice: number | undefined;
  constructor(public stream: unknown, public opts: { mimeType: string }) { FakeMR.last = this; }
  start(t?: number) { this.timeslice = t; this.state = "recording"; }
  pause() { this.state = "paused"; }
  resume() { this.state = "recording"; }
  stop() { this.state = "inactive"; this.onstop?.(); }
  emit(data: Uint8Array | string) { this.ondataavailable?.({ data: new Blob([data]) }); }
}

const store = () => ({
  createRecording: vi.fn().mockResolvedValue(undefined),
  appendChunk: vi.fn().mockResolvedValue(undefined),
  markFinished: vi.fn().mockResolvedValue(undefined),
  deleteRecording: vi.fn().mockResolvedValue(undefined),
});
const stream = () => ({ getTracks: () => [{ stop: vi.fn() }] }) as unknown as MediaStream;
const WEBM = { mimeType: "audio/webm;codecs=opus", ext: ".webm" as const };
const flush = () => new Promise((r) => setTimeout(r, 0));

function headers(b: Uint8Array): number {
  let n = 0;
  for (let i = 0; i + 3 < b.length; i += 1) if (b[i] === 0x1a && b[i + 1] === 0x45 && b[i + 2] === 0xdf && b[i + 3] === 0xa3) n += 1;
  return n;
}

beforeEach(() => { FakeMR.last = null; });

describe("LessonRecorder: 1 s saves, Resume into the same recording, a heartbeat on every save", () => {
  it("saves a piece every second by default", async () => {
    const rec = new LessonRecorder({ stream: stream(), type: WEBM, store: store(), MediaRecorder: FakeMR as unknown as typeof MediaRecorder });
    await rec.start();
    expect(FakeMR.last!.timeslice).toBe(1_000);
  });

  it("a caller can keep its own interval (the child test keeps 5 s)", async () => {
    const rec = new LessonRecorder({ stream: stream(), type: WEBM, store: store(), MediaRecorder: FakeMR as unknown as typeof MediaRecorder, sliceMs: 5_000 });
    await rec.start();
    expect(FakeMR.last!.timeslice).toBe(5_000);
  });

  it("Resume continues the kept recording: same id, the next piece number flagged as a new part, the clock carried on, ONE file at Stop", async () => {
    const s = store();
    let now = 1_000_000;
    const rec = new LessonRecorder({
      stream: stream(), type: WEBM, store: s, MediaRecorder: FakeMR as unknown as typeof MediaRecorder, now: () => now,
      id: "kept-1", resume: { prior: new Blob([A], { type: WEBM.mimeType }), nextSeq: 4, elapsedMs: 4_000 },
    });
    await rec.start();
    expect(s.createRecording).not.toHaveBeenCalled(); // the recording exists on the phone already
    expect(rec.id).toBe("kept-1");
    expect(rec.elapsedMs()).toBe(4_000);
    now += 3_000;
    FakeMR.last!.emit(B.subarray(0, 1603));
    FakeMR.last!.emit(B.subarray(1603));
    await flush();
    expect(s.appendChunk.mock.calls[0].slice(0, 2)).toEqual(["kept-1", 4]);
    expect(s.appendChunk.mock.calls[0][4]).toMatchObject({ first: true });
    expect(s.appendChunk.mock.calls[1][1]).toBe(5);
    expect(s.appendChunk.mock.calls[1][4]?.first).toBeFalsy();
    const out = await rec.stop();
    expect(out.id).toBe("kept-1");
    expect(out.durationMs).toBe(7_000);
    expect(headers(await bytesOf(out.blob))).toBe(1);
    expect(s.markFinished).toHaveBeenCalledWith("kept-1", 7_000);
  });

  it("each save carries the heart's sample; a failed save is told to the heart, never dropped silently", async () => {
    const s = store();
    s.appendChunk.mockResolvedValueOnce(undefined).mockRejectedValueOnce(Object.assign(new Error("full"), { name: "QuotaExceededError" }));
    const heart = { sample: vi.fn((x: { seq: number }) => ({ s: x.seq, t: 1 })), saved: vi.fn(), event: vi.fn(), dispose: vi.fn() };
    const rec = new LessonRecorder({ stream: stream(), type: WEBM, store: s, MediaRecorder: FakeMR as unknown as typeof MediaRecorder, heart });
    await rec.start();
    FakeMR.last!.emit("aa");
    FakeMR.last!.emit("bbb");
    await flush();
    expect(heart.sample).toHaveBeenCalledWith(expect.objectContaining({ seq: 0, size: 2, state: "recording" }));
    expect(s.appendChunk.mock.calls[0][4]).toMatchObject({ beat: { s: 0 } });
    expect(heart.saved).toHaveBeenNthCalledWith(1, { s: 0, t: 1 }, true, undefined);
    expect(heart.saved.mock.calls[1][1]).toBe(false);
    expect((heart.saved.mock.calls[1][2] as Error).name).toBe("QuotaExceededError");
    expect(heart.event).toHaveBeenCalledWith("start", expect.anything());
  });
});
