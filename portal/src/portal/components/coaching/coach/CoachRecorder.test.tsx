import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

// bd-5rz1v.8 — Back during a coach's recording (the lesson, or the talk) must not
// leave the page and stop the recorder: Chrome's back gesture, or the app's Back
// key (which navigates -1), asks "Finish recording?" instead.

vi.mock("../../../lib/keepAwake", () => ({ keepScreenOn: vi.fn().mockResolvedValue(async () => {}) }));
vi.mock("../../../lib/recordingSupport", async (orig) => ({
  ...(await orig<any>()),
  pickRecordingType: vi.fn(() => ({ mimeType: "audio/webm;codecs=opus", ext: ".webm" })),
}));
const recorder = {
  id: "rec-c1",
  start: vi.fn().mockResolvedValue(undefined),
  pause: vi.fn(), resume: vi.fn(),
  isPaused: vi.fn().mockReturnValue(false),
  elapsedMs: vi.fn().mockReturnValue(31 * 60_000),
  stop: vi.fn(),
};
vi.mock("../../../lib/lessonRecorder", () => ({ LessonRecorder: vi.fn(function LessonRecorder() { return recorder; }) }));

import CoachRecorder from "./CoachRecorder";

const copy = { hearing: "We can hear the class.", keepOpen: "Keep this screen open.", shortNote: "That is short." };

beforeEach(() => {
  vi.clearAllMocks();
  recorder.stop.mockResolvedValue({ blob: new Blob(["x"]), durationMs: 31 * 60_000, type: { mimeType: "audio/webm", ext: ".webm" }, id: "rec-c1" });
  Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [] }) }, configurable: true });
});

async function recording() {
  const onFinished = vi.fn();
  render(<CoachRecorder label="Observing: Ayesha Bibi" copy={copy} shortMs={600_000} onFinished={onFinished} onMicBlocked={() => {}} />);
  await screen.findByRole("button", { name: /^finish$/i });
  await vi.waitFor(() => expect(recorder.start).toHaveBeenCalled());
  return { onFinished };
}

describe("CoachRecorder — Back while recording", () => {
  it("Back asks 'Finish recording?' and the recorder keeps running", async () => {
    await recording();
    await vi.waitFor(() => expect(window.history.state && window.history.state.recordingGuard).toBe(true));
    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(await screen.findByRole("dialog", { name: /finish recording/i })).toBeInTheDocument();
    expect(recorder.stop).not.toHaveBeenCalled();
  });

  it("once finished, the guard is taken off so Back works as usual", async () => {
    const { onFinished } = await recording();
    await vi.waitFor(() => expect(window.history.state && window.history.state.recordingGuard).toBe(true));
    const back = vi.spyOn(window.history, "back").mockImplementation(() => {});
    fireEvent.click(screen.getByRole("button", { name: /^finish$/i }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: /yes, finish/i }));
    await vi.waitFor(() => expect(onFinished).toHaveBeenCalled());
    expect(back).toHaveBeenCalled();
    back.mockRestore();
  });
});
