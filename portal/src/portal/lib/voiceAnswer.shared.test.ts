import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { readFileSync } from "fs";
import { resolve } from "path";

/**
 * bd-ma9jiy.5 (queue #262; the operator 26 Nov ~22:20: "It should work similar to the main coaching recorder. Yes, fix
 * pls."). The teacher's spoken reflection answer was recorded by its own MediaRecorder with no timeslice and uploaded
 * whatever came out: 29 November uploads from 17 teachers were a WebM HEADER and nothing else (110 bytes, no audio frame),
 * which Soniox and Whisper refuse as "invalid audio file / may be corrupt". Now it is the ONE shared recorder:
 *
 *   saved on the phone every second (LessonRecorder), linked to the session it answers (kind reflection)
 *   an empty take (no audio frame) is never a clip and never uploaded: "Nothing was recorded"
 *   a stopped answer not sent comes back to send (re-send after a failed upload); a cut one comes back paused, and
 *   Resume carries on in the SAME recording
 *   the heartbeat says kind reflection and the session
 */
const portal = vi.hoisted(() => ({ presignCoachingUpload: vi.fn(), uploadToR2: vi.fn(), submitCoachingVoiceReflection: vi.fn() }));
vi.mock("../services/api", () => ({ default: {}, portal }));
vi.mock("fix-webm-duration", () => ({ default: vi.fn(async (b: Blob) => b) }));
const kept = vi.hoisted(() => ({ list: [] as any[] }));
const store = vi.hoisted(() => ({
  createRecording: vi.fn(async (meta: any) => { kept.list.push({ meta: { ...meta, elapsedMs: 0, finished: false }, chunks: [] }); }),
  appendChunk: vi.fn(async () => {}),
  markFinished: vi.fn(async () => {}),
  deleteRecording: vi.fn(async (id: string) => { kept.list = kept.list.filter((k) => k.meta.id !== id); }),
  latestUnsent: vi.fn(async (accept?: (m: any) => boolean) => kept.list.find((k) => k.blob && (!accept || accept(k.meta))) ?? null),
}));
vi.mock("./recordingStore", async (orig) => ({ ...(await orig<typeof import("./recordingStore")>()), ...store }));
const hearts = vi.hoisted(() => ({ list: [] as { ctx: any; events: [string, any][] }[] }));
vi.mock("./recordingBeat", async (orig) => ({
  ...(await orig<typeof import("./recordingBeat")>()),
  RecordingHeart: class {
    rec: { ctx: any; events: [string, any][] };
    constructor({ ctx }: { ctx: unknown }) { this.rec = { ctx, events: [] }; hearts.list.push(this.rec); }
    sample() { return {}; }
    saved() {}
    event(k: string, f: unknown) { this.rec.events.push([k, f]); }
    flush() { return Promise.resolve(); }
    dispose() { return Promise.resolve(); }
  },
  tellSent: vi.fn(),
}));

import { sendVoiceAnswer, useVoiceAnswer } from "./voiceAnswer";

const fixtures = resolve(__dirname, "../../../../tests/fixtures/audio");
const HEADER = new Uint8Array(readFileSync(resolve(fixtures, "reflection/header-only-110.webm")));
const REAL = new Uint8Array(readFileSync(resolve(fixtures, "chrome-webm/one.webm")));

class FakeRecorder {
  static last: FakeRecorder | null = null;
  static deliver: Uint8Array = REAL;
  static isTypeSupported = (t: string) => t.startsWith("audio/webm");
  state = "inactive";
  slice: number | undefined;
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor(public stream: unknown, public options: { mimeType?: string }) { FakeRecorder.last = this; }
  start(slice?: number) { this.state = "recording"; this.slice = slice; }
  pause() { this.state = "paused"; }
  resume() { this.state = "recording"; }
  stop() {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob([FakeRecorder.deliver], { type: "audio/webm" }) });
    this.onstop?.();
  }
}
const getUserMedia = vi.fn();
let clock = 1_000_000;

beforeEach(() => {
  vi.clearAllMocks();
  kept.list = [];
  hearts.list = [];
  FakeRecorder.last = null;
  FakeRecorder.deliver = REAL;
  clock = 1_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => clock);
  vi.stubGlobal("MediaRecorder", FakeRecorder);
  Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia }, configurable: true });
  getUserMedia.mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function recordFor(result: { current: ReturnType<typeof useVoiceAnswer> }, ms: number) {
  await act(async () => { await result.current.start(); });
  clock += ms;
  await act(async () => { await result.current.stop(); });
}

describe("the reflection answer on the shared recorder", () => {
  it("THE PROD CASE: the recorder gives only a WebM header (110 bytes): no clip, 'nothing recorded', the take thrown away", async () => {
    FakeRecorder.deliver = HEADER;
    const { result } = renderHook(() => useVoiceAnswer({ sessionId: "cs-1" }));
    await recordFor(result, 4_000);
    expect(result.current.clip).toBeNull();
    expect(result.current.state).toBe("idle");
    expect(result.current.empty).toBe(true);
    expect(store.deleteRecording).toHaveBeenCalled();
    expect(hearts.list[0].events.map(([k]) => k)).toContain("empty");
  });

  it("a real answer: saved every second, linked to its session (kind reflection), a clip to send", async () => {
    const { result } = renderHook(() => useVoiceAnswer({ sessionId: "cs-1" }));
    await recordFor(result, 8_000);
    expect(FakeRecorder.last!.slice).toBe(1000);
    expect(store.createRecording).toHaveBeenCalledWith(expect.objectContaining({ link: { kind: "reflection", observationId: "cs-1" } }));
    expect(hearts.list[0].ctx).toEqual({ kind: "reflection", observationId: "cs-1" });
    expect(result.current.state).toBe("recorded");
    expect(result.current.clip?.recordingId).toBeTruthy();
    expect(result.current.empty).toBe(false);
  });

  it("sendVoiceAnswer never uploads a take with no audio frame", async () => {
    const clip = { blob: new Blob([HEADER], { type: "audio/webm" }), mimeType: "audio/webm", ext: ".webm" };
    await expect(sendVoiceAnswer("cs-1", clip)).rejects.toMatchObject({ name: "NoAudio" });
    expect(portal.presignCoachingUpload).not.toHaveBeenCalled();
  });

  it("an answer stopped but not sent (a failed upload, the page closed) comes back ready to send — its session only", async () => {
    kept.list = [
      { meta: { id: "rf-other", mimeType: "audio/webm", ext: ".webm", startedAt: "2026-11-26T05:00:00Z", elapsedMs: 9000, finished: true, link: { kind: "reflection", observationId: "cs-2" } }, blob: new Blob([REAL], { type: "audio/webm" }), nextSeq: 9, parts: 1, beats: [] },
      { meta: { id: "rf-mine", mimeType: "audio/webm", ext: ".webm", startedAt: "2026-11-26T05:00:00Z", elapsedMs: 12000, finished: true, link: { kind: "reflection", observationId: "cs-1" } }, blob: new Blob([REAL], { type: "audio/webm" }), nextSeq: 12, parts: 1, beats: [] },
    ];
    const { result } = renderHook(() => useVoiceAnswer({ sessionId: "cs-1" }));
    await waitFor(() => expect(result.current.state).toBe("recorded"));
    expect(result.current.clip?.recordingId).toBe("rf-mine");
  });

  it("an answer cut mid-way comes back paused; Resume carries on in the SAME recording", async () => {
    kept.list = [
      { meta: { id: "rf-cut", mimeType: "audio/webm;codecs=opus", ext: ".webm", startedAt: "2026-11-26T05:00:00Z", elapsedMs: 20000, finished: false, link: { kind: "reflection", observationId: "cs-1" } }, blob: new Blob([REAL], { type: "audio/webm" }), nextSeq: 20, parts: 1, beats: [] },
    ];
    const { result } = renderHook(() => useVoiceAnswer({ sessionId: "cs-1" }));
    await waitFor(() => expect(result.current.state).toBe("paused"));
    expect(result.current.elapsedMs).toBe(20000);
    await act(async () => { await result.current.start(); });
    expect(store.createRecording).not.toHaveBeenCalled(); // the same recording, not a new one
    expect(result.current.state).toBe("recording");
    clock += 5_000;
    await act(async () => { await result.current.stop(); });
    expect(result.current.clip?.recordingId).toBe("rf-cut");
  });

  it("a take kept with no audio frame is thrown away on arrival, never offered", async () => {
    kept.list = [
      { meta: { id: "rf-empty", mimeType: "audio/webm", ext: ".webm", startedAt: "2026-11-26T05:00:00Z", elapsedMs: 3000, finished: true, link: { kind: "reflection", observationId: "cs-1" } }, blob: new Blob([HEADER], { type: "audio/webm" }), nextSeq: 3, parts: 1, beats: [] },
    ];
    const { result } = renderHook(() => useVoiceAnswer({ sessionId: "cs-1" }));
    await waitFor(() => expect(store.deleteRecording).toHaveBeenCalledWith("rf-empty"));
    expect(result.current.state).toBe("idle");
    expect(result.current.clip).toBeNull();
  });
});
