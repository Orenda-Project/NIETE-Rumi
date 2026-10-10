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

const copy = {
  hearing: "We can hear the class.", keepOpen: "Keep this screen open.", shortNote: "That is short.",
  finishTitle: "Finish recording?", yesFinish: "Yes, finish", keepRecording: "Keep recording",
  recorded: (ms: number) => `You recorded ${Math.round(ms / 60_000)} minutes.`,
};
/** The sheet's words come from the copy prop: a screen in Urdu passes these (bd-fmf24g.41). */
const urdu = {
  ...copy, shortNote: "یہ مختصر ہے۔",
  finishTitle: "ریکارڈنگ ختم کریں؟", yesFinish: "جی، ختم کریں", keepRecording: "ریکارڈنگ جاری رکھیں",
  recorded: (ms: number) => `آپ نے ${Math.round(ms / 60_000)} منٹ ریکارڈ کیا۔`,
};

beforeEach(() => {
  vi.clearAllMocks();
  recorder.stop.mockResolvedValue({ blob: new Blob(["x"]), durationMs: 31 * 60_000, type: { mimeType: "audio/webm", ext: ".webm" }, id: "rec-c1" });
  Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [] }) }, configurable: true });
});

async function recording(words: typeof copy = copy, shortMs = 600_000) {
  const onFinished = vi.fn();
  render(<CoachRecorder label="Observing: Ayesha Bibi" copy={words} shortMs={shortMs} onFinished={onFinished} onMicBlocked={() => {}} />);
  await screen.findByRole("button", { name: /^finish$/i });
  await vi.waitFor(() => expect(recorder.start).toHaveBeenCalled());
  return { onFinished };
}

describe("CoachRecorder — Back while recording", () => {
  it("Back asks 'Finish recording?' and the recorder keeps running", async () => {
    await recording();
    await vi.waitFor(() => expect(window.history.state && window.history.state.recordingGuard).toBe(true));
    window.dispatchEvent(new PopStateEvent("popstate"));
    const sheet = await screen.findByRole("dialog", { name: /finish recording/i });
    // bd-fmf24g.41: the sheet Back opens is the kit's ConfirmTray, Yes over Keep recording, both full size.
    expect(stackedActions(sheet)).toEqual(["Yes, finish", "Keep recording"]);
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

/** The kit's ConfirmTray actions: full width, 56px, stacked in one column with a gap (never flex-1). Their labels, in order. */
function stackedActions(dialog: HTMLElement) {
  const box = within(dialog).getByTestId("confirm-tray-actions");
  expect(box.className.split(/\s+/)).toEqual(expect.arrayContaining(["flex", "flex-col", "gap-3"]));
  const buttons = within(box).getAllByRole("button");
  for (const b of buttons) {
    expect(b.className.split(/\s+/)).toEqual(expect.arrayContaining(["w-full", "min-h-[56px]"]));
    expect(b.className.split(/\s+/)).not.toContain("flex-1");
  }
  return buttons.map((b) => b.textContent);
}

describe("CoachRecorder — Finish asks first, in the kit's ConfirmTray (bd-fmf24g.41)", () => {
  it("the sheet's words are the copy prop's (Urdu here): title, how long, Yes over Keep recording, full size", async () => {
    await recording(urdu);
    fireEvent.click(screen.getByRole("button", { name: /^finish$/i }));
    const sheet = await screen.findByRole("dialog", { name: urdu.finishTitle });
    expect(sheet).toHaveTextContent(urdu.recorded(31 * 60_000));
    expect(stackedActions(sheet)).toEqual([urdu.yesFinish, urdu.keepRecording]);
    expect(within(sheet).queryByRole("note")).toBeNull();
  });

  it("Keep recording closes the sheet and the recorder keeps running", async () => {
    await recording();
    fireEvent.click(screen.getByRole("button", { name: /^finish$/i }));
    const sheet = await screen.findByRole("dialog", { name: "Finish recording?" });
    fireEvent.click(within(sheet).getByRole("button", { name: "Keep recording" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(recorder.stop).not.toHaveBeenCalled();
  });

  it("a short recording still warns, in the sheet, with the screen's words", async () => {
    await recording(copy, 60 * 60_000);
    fireEvent.click(screen.getByRole("button", { name: /^finish$/i }));
    const sheet = await screen.findByRole("dialog", { name: "Finish recording?" });
    expect(within(sheet).getByRole("note")).toHaveTextContent("That is short.");
  });
});
