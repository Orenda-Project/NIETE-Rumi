import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { VoiceNote } from "./VoiceNote";

// jsdom has no PointerEvent (as newui/audioPlayer.test.tsx): a MouseEvent with a pointerId carries clientX.
class FakePointerEvent extends MouseEvent {
  pointerId: number;
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 1;
  }
}
beforeAll(() => {
  if (!("PointerEvent" in window)) Object.defineProperty(window, "PointerEvent", { value: FakePointerEvent, configurable: true });
});

/**
 * bd-bmc9a0.4 — ICT feedback (IAB Experience View, Quratulain) on the Digital Coach's voice notes:
 *
 *   row 33   playback speed on every voice note: 1×, 1.5×, 2× — as WhatsApp's, while it plays the avatar's place is
 *            one 56px speed button that steps through them
 *   row 34   "the audio is 1–2 minutes but the player shows 15 minutes, and I can't skip ahead": once it plays it says
 *            how far it has played OF its real length, and the waveform is a slider — a tap or a drag jumps there,
 *            the arrow keys move 5 s
 */

beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function play(this: HTMLMediaElement) {
    this.dispatchEvent(new Event("play"));
    return Promise.resolve();
  });
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(function pause(this: HTMLMediaElement) {
    this.dispatchEvent(new Event("pause"));
  });
});

/** A note whose file says it is `length` seconds long, with currentTime and playbackRate that remember. */
function note(length = 102) {
  const view = render(<VoiceNote from="Digital Coach" duration="" time="" src="/v.mp3" />);
  const audio = view.container.querySelector("audio")!;
  let t = 0;
  let rate = 1;
  Object.defineProperty(audio, "duration", { value: length, configurable: true });
  Object.defineProperty(audio, "currentTime", { get: () => t, set: (v: number) => { t = v; }, configurable: true });
  Object.defineProperty(audio, "playbackRate", { get: () => rate, set: (v: number) => { rate = v; }, configurable: true });
  return { ...view, audio, now: () => t, rate: () => rate };
}

describe("row 33 — playback speed", () => {
  it("before it plays: the avatar, no speed button", () => {
    note();
    expect(screen.queryByRole("button", { name: /Playback speed/ })).toBeNull();
    expect(screen.getByTestId("mic-badge")).toBeInTheDocument();
  });

  // bd-bmc9a0.6 — WhatsApp's own steps (operator, 29 Oct: "more like the WhatsApp audio button of 1x, 1.5x"): no 1.25×.
  it("while it plays, one chip steps 1× → 1.5× → 2× → 1× (WhatsApp's steps), and the audio plays at it", () => {
    const { rate } = note();
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    const chip = screen.getByRole("button", { name: /Playback speed/ });
    expect(chip.textContent).toBe("1×");
    fireEvent.click(chip);
    expect(chip.textContent).toBe("1.5×");
    expect(rate()).toBe(1.5);
    fireEvent.click(chip);
    expect(chip.textContent).toBe("2×");
    expect(rate()).toBe(2);
    fireEvent.click(chip);
    expect(chip.textContent).toBe("1×");
    expect(rate()).toBe(1);
  });

  it("the chosen speed holds when the file loads (a browser resets it to 1 on load)", () => {
    const { audio, rate } = note();
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    fireEvent.click(screen.getByRole("button", { name: /Playback speed/ }));
    audio.playbackRate = 1; // the browser loading the file puts it back to 1
    fireEvent(audio, new Event("loadedmetadata"));
    expect(rate()).toBe(1.5);
  });
});

describe("row 34 — its real length, and skipping ahead", () => {
  it("once it plays: how far OF its length (0:26 / 1:42), never a clock of the day", () => {
    const { audio } = note(102);
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    fireEvent(audio, new Event("loadedmetadata"));
    audio.currentTime = 26;
    fireEvent(audio, new Event("timeupdate"));
    expect(screen.getByText("0:26 / 1:42")).toBeInTheDocument();
  });

  it("the waveform is a slider: ArrowRight skips 5 s ahead, End jumps to the end", () => {
    const { audio, now } = note(102);
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    fireEvent(audio, new Event("loadedmetadata"));
    const track = screen.getByRole("slider", { name: "Digital Coach" });
    fireEvent.keyDown(track, { key: "ArrowRight" });
    expect(now()).toBe(5);
    fireEvent.keyDown(track, { key: "End" });
    expect(now()).toBe(102);
  });

  it("a tap on the waveform jumps there (halfway along → halfway through)", () => {
    const { audio, now } = note(100);
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    fireEvent(audio, new Event("loadedmetadata"));
    const track = screen.getByRole("slider", { name: "Digital Coach" });
    track.getBoundingClientRect = () => ({ left: 0, width: 200, top: 0, height: 30, right: 200, bottom: 30, x: 0, y: 0, toJSON: () => ({}) });
    fireEvent.pointerDown(track, { clientX: 100, pointerId: 1 });
    expect(now()).toBe(50);
  });

  it("a tap before it has ever played starts it and lands where she tapped", () => {
    const { audio, now } = note(100);
    const track = screen.getByRole("slider", { name: "Digital Coach" });
    track.getBoundingClientRect = () => ({ left: 0, width: 200, top: 0, height: 30, right: 200, bottom: 30, x: 0, y: 0, toJSON: () => ({}) });
    fireEvent.pointerDown(track, { clientX: 150, pointerId: 1 });
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
    fireEvent(audio, new Event("loadedmetadata"));
    expect(now()).toBe(75);
  });
});
