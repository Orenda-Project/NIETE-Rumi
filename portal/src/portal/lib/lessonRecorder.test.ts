import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("fix-webm-duration", () => ({
  default: vi.fn(async (blob: Blob, ms: number) => new Blob([blob, `|duration=${ms}`], { type: blob.type })),
}));

import fixWebmDuration from "fix-webm-duration";
import { LessonRecorder } from "./lessonRecorder";

/** jsdom's Blob is not the one `Response` understands; FileReader reads it. */
function readText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsText(blob);
  });
}


// bd-5rz1v — the recorder behind "Record now".
//
//  · chunks are saved to the phone as they arrive (recordingStore), so nothing
//    lives only in memory;
//  · Pause stops the clock — the duration is time actually recorded;
//  · MediaRecorder's WebM has NO duration in its header, and ffprobe then reports
//    "N/A", so the pipeline would store no length and the short-recording
//    warning would never fire. The recorder writes the real duration in.

class FakeMediaRecorder {
  static instances: FakeMediaRecorder[] = [];
  state: "inactive" | "recording" | "paused" = "inactive";
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  timeslice: number | undefined;
  constructor(public stream: unknown, public opts: { mimeType: string }) { FakeMediaRecorder.instances.push(this); }
  start(timeslice?: number) { this.timeslice = timeslice; this.state = "recording"; }
  pause() { this.state = "paused"; }
  resume() { this.state = "recording"; }
  stop() {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["last"]) });
    this.onstop?.();
  }
  emit(text: string) { this.ondataavailable?.({ data: new Blob([text]) }); }
}

function fakeStore() {
  return {
    createRecording: vi.fn().mockResolvedValue(undefined),
    appendChunk: vi.fn().mockResolvedValue(undefined),
    markFinished: vi.fn().mockResolvedValue(undefined),
    deleteRecording: vi.fn().mockResolvedValue(undefined),
  };
}

function fakeStream() {
  const track = { stop: vi.fn() };
  return { stream: { getTracks: () => [track] } as unknown as MediaStream, track };
}

let clock = 0;
const now = () => clock;

beforeEach(() => {
  FakeMediaRecorder.instances = [];
  clock = 1_000_000;
  vi.mocked(fixWebmDuration).mockClear();
});

function make(type = { mimeType: "audio/webm;codecs=opus", ext: ".webm" as const }) {
  const store = fakeStore();
  const { stream, track } = fakeStream();
  const rec = new LessonRecorder({
    stream, type, store, now, id: "rec-1",
    MediaRecorder: FakeMediaRecorder as unknown as typeof MediaRecorder,
    startedAt: () => "2026-10-02T10:00:00.000Z",
  });
  return { rec, store, track };
}

describe("LessonRecorder", () => {
  it("records in short slices and saves each one to the phone as it arrives", async () => {
    const { rec, store } = make();
    await rec.start();
    const mr = FakeMediaRecorder.instances[0];

    expect(mr.opts.mimeType).toBe("audio/webm;codecs=opus");
    expect(mr.timeslice).toBe(5_000);
    expect(store.createRecording).toHaveBeenCalledWith({
      id: "rec-1", mimeType: "audio/webm;codecs=opus", ext: ".webm", startedAt: "2026-10-02T10:00:00.000Z",
    });

    clock += 5_000; mr.emit("a");
    clock += 5_000; mr.emit("b");
    await Promise.resolve();
    expect(store.appendChunk).toHaveBeenNthCalledWith(1, "rec-1", 0, expect.any(Blob), 5_000);
    expect(store.appendChunk).toHaveBeenNthCalledWith(2, "rec-1", 1, expect.any(Blob), 10_000);
  });

  it("does not count paused time", async () => {
    const { rec } = make();
    await rec.start();
    clock += 60_000;
    rec.pause();
    clock += 300_000;              // five minutes paused
    expect(rec.elapsedMs()).toBe(60_000);
    expect(rec.isPaused()).toBe(true);
    rec.resume();
    clock += 30_000;
    expect(rec.elapsedMs()).toBe(90_000);
  });

  it("on stop: one blob of everything, the real duration written into the WebM, the microphone released", async () => {
    const { rec, store, track } = make();
    await rec.start();
    const mr = FakeMediaRecorder.instances[0];
    clock += 5_000; mr.emit("a");
    clock += 2_000;

    const out = await rec.stop();

    expect(fixWebmDuration).toHaveBeenCalledWith(expect.any(Blob), 7_000, { logger: false });
    expect(await readText(out.blob)).toBe("alast|duration=7000");
    expect(out).toMatchObject({ durationMs: 7_000, id: "rec-1", type: { ext: ".webm" } });
    expect(store.markFinished).toHaveBeenCalledWith("rec-1", 7_000);
    expect(track.stop).toHaveBeenCalled();
  });

  it("leaves an MP4 recording alone — its header already carries the duration", async () => {
    const { rec } = make({ mimeType: "audio/mp4", ext: ".m4a" as never });
    await rec.start();
    clock += 3_000;
    const out = await rec.stop();
    expect(fixWebmDuration).not.toHaveBeenCalled();
    expect(await readText(out.blob)).toBe("last");
  });

  it("still records if the phone's storage refuses a chunk", async () => {
    const { rec, store } = make();
    store.appendChunk.mockRejectedValue(new Error("QuotaExceededError"));
    await rec.start();
    const mr = FakeMediaRecorder.instances[0];
    clock += 5_000; mr.emit("a");
    clock += 1_000;
    const out = await rec.stop();
    expect(await readText(out.blob)).toContain("alast");
  });

  it("discard deletes the saved recording and releases the microphone", async () => {
    const { rec, store, track } = make();
    await rec.start();
    await rec.discard();
    expect(store.deleteRecording).toHaveBeenCalledWith("rec-1");
    expect(track.stop).toHaveBeenCalled();
  });
});
