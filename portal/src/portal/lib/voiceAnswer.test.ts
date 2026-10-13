import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";

/**
 * bd-eygg2f — ICT feedback (IAB Experience View, row 5): she can answer the reflection question by speaking.
 *
 *   useVoiceAnswer   tap to record, tap to stop, a short clip held in memory (no IndexedDB, no wake-lock:
 *                    this is a minute of speech, not a lesson); a cap so a forgotten mic stops itself;
 *                    a refused mic is "blocked", never a throw
 *   sendVoiceAnswer  the lesson upload's own path — presign (kind reflection_audio) → PUT to R2 → the
 *                    reflection endpoint with the key; the bot transcribes it
 */

const portal = vi.hoisted(() => ({
  presignCoachingUpload: vi.fn(),
  uploadToR2: vi.fn(),
  submitCoachingVoiceReflection: vi.fn(),
}));
vi.mock("../services/api", () => ({ default: {}, portal }));

import { sendVoiceAnswer, useVoiceAnswer, VOICE_ANSWER_MAX_MS } from "./voiceAnswer";

class FakeRecorder {
  static last: FakeRecorder | null = null;
  static isTypeSupported = (t: string) => t.startsWith("audio/webm");
  state = "inactive";
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor(public stream: unknown, public options: { mimeType?: string }) { FakeRecorder.last = this; }
  start() { this.state = "recording"; }
  stop() {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["voice"], { type: "audio/webm" }) });
    this.onstop?.();
  }
}

const track = { stop: vi.fn() };
const getUserMedia = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  FakeRecorder.last = null;
  vi.stubGlobal("MediaRecorder", FakeRecorder);
  Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia }, configurable: true });
  getUserMedia.mockResolvedValue({ getTracks: () => [track] });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("useVoiceAnswer", () => {
  it("records, stops into a clip, frees the mic, and can be thrown away", async () => {
    const { result } = renderHook(() => useVoiceAnswer());
    expect(result.current.state).toBe("idle");

    await act(async () => { await result.current.start(); });
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true });
    expect(FakeRecorder.last!.options.mimeType).toBe("audio/webm;codecs=opus");
    expect(result.current.state).toBe("recording");

    act(() => { result.current.stop(); });
    expect(result.current.state).toBe("recorded");
    expect(result.current.clip).toMatchObject({ mimeType: "audio/webm;codecs=opus", ext: ".webm" });
    expect(result.current.clip!.blob.size).toBeGreaterThan(0);
    expect(track.stop).toHaveBeenCalled();

    act(() => { result.current.discard(); });
    expect(result.current.state).toBe("idle");
    expect(result.current.clip).toBeNull();
  });

  it("stops itself at the cap", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useVoiceAnswer());
    await act(async () => { await result.current.start(); });
    act(() => { vi.advanceTimersByTime(VOICE_ANSWER_MAX_MS + 1000); });
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
    const blob = new Blob(["voice"], { type: "audio/webm" });

    const out = await sendVoiceAnswer("cs-1", { blob, mimeType: "audio/webm;codecs=opus", ext: ".webm" });

    expect(portal.presignCoachingUpload).toHaveBeenCalledWith({ filename: "answer.webm", sizeBytes: blob.size, kind: "reflection_audio" });
    expect(portal.uploadToR2).toHaveBeenCalledWith("https://r2/put", blob, "audio/webm");
    expect(portal.submitCoachingVoiceReflection).toHaveBeenCalledWith("cs-1", "reflection_audio/u/2026-10/portal_a.webm");
    expect(out).toMatchObject({ acknowledgement: "Thank you." });
  });
});
