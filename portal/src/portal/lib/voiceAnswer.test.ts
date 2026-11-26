import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { readFileSync } from "fs";
import { resolve } from "path";

/**
 * bd-eygg2f — ICT feedback (IAB Experience View, row 5): she can answer the reflection question by speaking.
 *
 *   useVoiceAnswer   tap to record, tap to stop; a cap so a forgotten mic stops itself; a refused mic is "blocked",
 *                    never a throw. With no session (the coach's feedback note) nothing is kept on the phone.
 *   sendVoiceAnswer  the lesson upload's own path — presign (kind reflection_audio) → PUT to R2 → the
 *                    reflection endpoint with the key; the bot transcribes it
 *
 * bd-ma9jiy.5: the recorder is the shared LessonRecorder now and a take with no audio frame is never a clip, so the
 * fake recorder hands over real WebM audio (a Cluster), not the bytes "voice". The reflection's own cases (kept on the
 * phone, resume, the 110-byte header) are in voiceAnswer.shared.test.ts.
 */

const portal = vi.hoisted(() => ({
  presignCoachingUpload: vi.fn(),
  uploadToR2: vi.fn(),
  submitCoachingVoiceReflection: vi.fn(),
}));
vi.mock("../services/api", () => ({ default: {}, portal }));
vi.mock("fix-webm-duration", () => ({ default: vi.fn(async (b: Blob) => b) }));
const store = vi.hoisted(() => ({ deleteRecording: vi.fn(async () => {}), createRecording: vi.fn(async () => {}) }));
vi.mock("./recordingStore", async (orig) => ({ ...(await orig<typeof import("./recordingStore")>()), ...store }));
const beat = vi.hoisted(() => ({ tellSent: vi.fn() }));
vi.mock("./recordingBeat", async (orig) => ({ ...(await orig<typeof import("./recordingBeat")>()), ...beat }));

import { sendVoiceAnswer, useVoiceAnswer, VOICE_ANSWER_MAX_MS } from "./voiceAnswer";

const REAL = new Uint8Array(readFileSync(resolve(__dirname, "../../../../tests/fixtures/audio/chrome-webm/one.webm")));

class FakeRecorder {
  static last: FakeRecorder | null = null;
  static isTypeSupported = (t: string) => t.startsWith("audio/webm");
  state = "inactive";
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor(public stream: unknown, public options: { mimeType?: string }) { FakeRecorder.last = this; }
  start() { this.state = "recording"; }
  pause() { this.state = "paused"; }
  resume() { this.state = "recording"; }
  stop() {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob([REAL], { type: "audio/webm" }) });
    this.onstop?.();
  }
}

const track = { stop: vi.fn() };
const getUserMedia = vi.fn();
let clock = 1_000_000;

beforeEach(() => {
  vi.clearAllMocks();
  FakeRecorder.last = null;
  clock = 1_000_000;
  vi.stubGlobal("MediaRecorder", FakeRecorder);
  Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia }, configurable: true });
  getUserMedia.mockResolvedValue({ getTracks: () => [track] });
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("useVoiceAnswer", () => {
  it("records, stops into a clip, frees the mic, and can be thrown away", async () => {
    vi.spyOn(Date, "now").mockImplementation(() => clock);
    const { result } = renderHook(() => useVoiceAnswer());
    expect(result.current.state).toBe("idle");

    await act(async () => { await result.current.start(); });
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true });
    expect(FakeRecorder.last!.options.mimeType).toBe("audio/webm;codecs=opus");
    expect(result.current.state).toBe("recording");

    clock += 6_000;
    await act(async () => { await result.current.stop(); });
    expect(result.current.state).toBe("recorded");
    expect(result.current.clip).toMatchObject({ mimeType: "audio/webm;codecs=opus", ext: ".webm" });
    expect(result.current.clip!.blob.size).toBeGreaterThan(0);
    expect(track.stop).toHaveBeenCalled();
    // The coach's note (no session): nothing kept on the phone, so no id to keep or delete.
    expect(store.createRecording).not.toHaveBeenCalled();
    expect(result.current.clip!.recordingId).toBeNull();

    act(() => { result.current.discard(); });
    expect(result.current.state).toBe("idle");
    expect(result.current.clip).toBeNull();
    expect(store.deleteRecording).not.toHaveBeenCalled();
  });

  it("stops itself at the cap", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useVoiceAnswer());
    await act(async () => { await result.current.start(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(VOICE_ANSWER_MAX_MS + 1000); });
    expect(result.current.state).toBe("recorded");
  });

  it("a refused microphone is 'blocked', not an error", async () => {
    getUserMedia.mockRejectedValue(Object.assign(new Error("denied"), { name: "NotAllowedError" }));
    const { result } = renderHook(() => useVoiceAnswer());
    await act(async () => { await result.current.start(); });
    expect(result.current.state).toBe("blocked");
  });
});

describe("sendVoiceAnswer", () => {
  it("presigns a reflection_audio upload, PUTs the clip, then answers with the key", async () => {
    portal.presignCoachingUpload.mockResolvedValue({ key: "reflection_audio/u/2026-10/portal_a.webm", uploadUrl: "https://r2/put", contentType: "audio/webm" });
    portal.uploadToR2.mockResolvedValue(undefined);
    portal.submitCoachingVoiceReflection.mockResolvedValue({ done: true, acknowledgement: "Thank you." });
    const blob = new Blob([REAL], { type: "audio/webm" });

    const out = await sendVoiceAnswer("cs-1", { blob, mimeType: "audio/webm;codecs=opus", ext: ".webm" });

    expect(portal.presignCoachingUpload).toHaveBeenCalledWith({ filename: "answer.webm", sizeBytes: blob.size, kind: "reflection_audio" });
    expect(portal.uploadToR2).toHaveBeenCalledWith("https://r2/put", blob, "audio/webm");
    expect(portal.submitCoachingVoiceReflection).toHaveBeenCalledWith("cs-1", "reflection_audio/u/2026-10/portal_a.webm");
    expect(out).toMatchObject({ acknowledgement: "Thank you." });
    expect(beat.tellSent).not.toHaveBeenCalled(); // no kept id: nothing to mark sent
  });

  it("a kept answer, once sent, is marked sent for its session (kind reflection)", async () => {
    portal.presignCoachingUpload.mockResolvedValue({ key: "k", uploadUrl: "https://r2/put", contentType: "audio/webm" });
    portal.uploadToR2.mockResolvedValue(undefined);
    portal.submitCoachingVoiceReflection.mockResolvedValue({ done: true });
    await sendVoiceAnswer("cs-1", { blob: new Blob([REAL], { type: "audio/webm" }), mimeType: "audio/webm", ext: ".webm", recordingId: "rf-1" });
    expect(beat.tellSent).toHaveBeenCalledWith("rf-1", { kind: "reflection", observationId: "cs-1" }, "cs-1");
  });
});
