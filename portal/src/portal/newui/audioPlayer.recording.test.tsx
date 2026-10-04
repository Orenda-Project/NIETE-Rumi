import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { useState } from "react";
import { render, screen, fireEvent, act, within, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * bd-5rz1v.26.4 — listening never touches the lesson being recorded.
 *
 * A teacher can be recording a lesson (the session lives above the routes, bd-5rz1v.10) and open
 * an earlier lesson's report to play its audio. Whatever she does with the player — play, pause,
 * seek, let it end, a file that fails, leaving the page — the recorder is not paused, resumed or
 * stopped, the microphone stream is not stopped or asked for again, no AudioContext is made (the
 * sound bars' own), and the session stays live. The player also never pauses media that is not a
 * kit player.
 */

vi.mock("../lib/recordingSupport", async (orig) => ({
  ...(await orig<typeof import("../lib/recordingSupport")>()),
  pickRecordingType: vi.fn(() => ({ mimeType: "audio/webm;codecs=opus", ext: ".webm" })),
}));
const releaseScreen = vi.fn(async () => {});
vi.mock("../lib/keepAwake", () => ({ keepScreenOn: vi.fn(async () => releaseScreen) }));

const recorder = vi.hoisted(() => ({
  id: "rec-live",
  start: vi.fn(),
  pause: vi.fn(), resume: vi.fn(),
  isPaused: vi.fn(),
  elapsedMs: vi.fn(),
  stop: vi.fn(),
  discard: vi.fn(),
}));
vi.mock("../lib/lessonRecorder", () => ({ LessonRecorder: vi.fn(function LessonRecorder() { return recorder; }) }));

import { RecordingSessionProvider, useRecordingSession } from "../lib/recordingSession";
import { AudioPlayer } from "./AudioPlayer";

const track = { stop: vi.fn() };
const getUserMedia = vi.fn();
const AudioContextSpy = vi.fn();

/** The report page: the player, until she leaves it (the session above stays). */
function Report() {
  const [open, setOpen] = useState(true);
  return (
    <div>
      <button type="button" onClick={() => setOpen(false)}>test: leave the report</button>
      {open ? <AudioPlayer src="https://r2/lesson.webm" label="Your recording" durationHint={1680} /> : null}
    </div>
  );
}

function Probe() {
  const session = useRecordingSession()!;
  return (
    <div>
      <button type="button" onClick={() => { void session.start({ returnTo: "/portal/coaching/new" }); }}>test: record</button>
      <output data-testid="session">{session.active ? (session.paused ? "paused" : "recording") : "idle"}</output>
    </div>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  recorder.start.mockResolvedValue(undefined);
  recorder.isPaused.mockReturnValue(false);
  recorder.elapsedMs.mockReturnValue(4 * 60_000);
  recorder.discard.mockResolvedValue(undefined);
  getUserMedia.mockResolvedValue({ getTracks: () => [track] });
  Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia }, configurable: true });
  Object.defineProperty(window, "AudioContext", { value: AudioContextSpy, configurable: true, writable: true });
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(() => Promise.resolve());
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(function pauseStub(this: HTMLMediaElement) { this.dispatchEvent(new Event("pause")); });
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
});

afterEach(() => { vi.restoreAllMocks(); });

describe("playing a report's audio while a lesson records", () => {
  it("play, pause, seek, end, a failure and leaving the page never touch the recording", async () => {
    render(
      <MemoryRouter>
        <RecordingSessionProvider>
          <Probe />
          <Report />
          {/* Not a kit player (the record page's own Listen, a video): never paused by one. */}
          <audio data-testid="not-a-kit-player" src="https://r2/other.mp3" />
        </RecordingSessionProvider>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: "test: record" }));
    await waitFor(() => expect(screen.getByTestId("session")).toHaveTextContent("recording"));
    expect(getUserMedia).toHaveBeenCalledTimes(1);

    const root = screen.getByTestId("newui-audio");
    const audio = root.querySelector("audio")!;
    const button = within(root).getByRole("button");
    const slider = within(root).getByRole("slider");
    const other = screen.getByTestId("not-a-kit-player") as HTMLAudioElement;
    const fire = (type: string) => act(() => { audio.dispatchEvent(new Event(type)); });

    fireEvent.click(button);
    fire("play");
    fire("playing");
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    fireEvent.keyDown(slider, { key: "End" });
    fireEvent.keyDown(slider, { key: " " });
    fireEvent.click(button);
    fire("ended");
    fire("error");
    fireEvent.click(button);
    fireEvent.click(screen.getByRole("button", { name: "test: leave the report" }));
    expect(screen.queryByTestId("newui-audio")).toBeNull();
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });

    expect(recorder.pause).not.toHaveBeenCalled();
    expect(recorder.resume).not.toHaveBeenCalled();
    expect(recorder.stop).not.toHaveBeenCalled();
    expect(recorder.discard).not.toHaveBeenCalled();
    expect(track.stop).not.toHaveBeenCalled();
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(AudioContextSpy).not.toHaveBeenCalled();
    expect(releaseScreen).not.toHaveBeenCalled();
    expect(vi.mocked(HTMLMediaElement.prototype.pause).mock.contexts).not.toContain(other);
    expect(screen.getByTestId("session")).toHaveTextContent("recording");
  });

  it("the session is still recording while she listens", async () => {
    render(
      <MemoryRouter>
        <RecordingSessionProvider>
          <Probe />
          <AudioPlayer src="https://r2/debrief.mp3" label="Digital Coach" />
        </RecordingSessionProvider>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: "test: record" }));
    await waitFor(() => expect(screen.getByTestId("session")).toHaveTextContent("recording"));
    const root = screen.getByTestId("newui-audio");
    fireEvent.click(within(root).getByRole("button"));
    act(() => { root.querySelector("audio")!.dispatchEvent(new Event("playing")); });
    expect(screen.getByTestId("session")).toHaveTextContent("recording");
  });

  it("the player's source knows nothing of the recorder, the microphone or Web Audio", () => {
    const source = readFileSync(resolve(__dirname, "AudioPlayer.tsx"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(source).not.toMatch(/recordingSession|useRecordingSession|getUserMedia|AudioContext|mediaSession|querySelectorAll\(['"`](audio|video)/);
  });
});
