// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import BlockRecorder from "./BlockRecorder";
import { COPY } from "../../lib/childTest/copy";
import * as Store from "../../lib/childTest/recordings";
import type { ReadingCard, MathsCard } from "../../types/childTest";

// bd-s1oo0.7 — one block on the coach app: the card in large print, a big
// Start, a visible 60-second countdown with a tone at 60 s, Stop, re-record and
// Send. MediaRecorder and the network are mocked; the state machine, the
// recorder (LessonRecorder) and the phone store (IndexedDB, faked) are real.

class FakeMediaRecorder {
  static isTypeSupported = (t: string) => t.startsWith("audio/webm");
  static instances: FakeMediaRecorder[] = [];
  state: "inactive" | "recording" | "paused" = "inactive";
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor(public stream: unknown, public opts: unknown) { FakeMediaRecorder.instances.push(this); }
  start() { this.state = "recording"; }
  pause() { this.state = "paused"; }
  resume() { this.state = "recording"; }
  stop() {
    this.ondataavailable?.({ data: new Blob(["voice"], { type: "audio/webm" }) });
    this.state = "inactive";
    this.onstop?.();
  }
}

const urduCard: ReadingCard = {
  block: "urdu", grade: 3, form: "A", timedSeconds: 60, cue: { start: "اب شروع کریں", stop: "بس، شکریہ" },
  child: {
    story: { id: "u3A-story", title: "دریا کی سیر", text: "آج بلال اپنے والد کے ساتھ دریا گیا۔" },
    nonwords: [{ id: "nw1", text: "تامو" }, { id: "nw2", text: "نوپی" }],
    fallback: { letters: ["ر", "د"], words: ["بچہ", "پانی"] },
  },
  coach: { questions: [{ id: "q1", prompt: "بلال کس کے ساتھ گیا؟" }], firstSounds: [{ id: "fs1", word: "مچھلی" }] },
};

const mathsCard: MathsCard = {
  block: "maths", grade: 3, form: "A", timedSeconds: 60, cue: { start: null, stop: null },
  child: { numbers: [6, 13, 20, 47], quickSums: ["3 + 1", "5 + 1"], written: ["34 + 28"] },
  coach: { numbersStopRule: "stop after 4 wrong in a row", numberIds: ["n1"], writtenIds: ["w1"], wordProblem: null },
};

function makeApi() {
  return {
    presignBlockUpload: vi.fn(async (_s: string, a: { block: string; kind: string }) => ({
      key: `child-test/sandbox/sch/s1/${a.kind === "photo" ? "maths-strip.jpg" : `${a.block}.webm`}`, uploadUrl: "https://r2/put", contentType: "audio/webm",
    })),
    uploadToR2: vi.fn(async () => undefined),
    registerBlockMedia: vi.fn(async () => ({ scoring: "started" })),
  };
}

let api: ReturnType<typeof makeApi>;
let tone: ReturnType<typeof vi.fn>;
let gum: ReturnType<typeof vi.fn>;
let onSent: ReturnType<typeof vi.fn>;

function renderBlock(card: ReadingCard | MathsCard = urduCard) {
  return render(
    <BlockRecorder
      card={card}
      sessionId="s1"
      copy={COPY.en}
      onSent={onSent}
      deps={{ api, playTone: tone, getUserMedia: gum, MediaRecorder: FakeMediaRecorder as unknown as typeof MediaRecorder, keepScreenOn: async () => async () => {} }}
    />,
  );
}

async function tick(ms: number) {
  await act(async () => { vi.advanceTimersByTime(ms); });
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
  vi.setSystemTime(new Date("2026-10-02T09:00:00Z"));
  await Store.__resetForTests();
  FakeMediaRecorder.instances = [];
  api = makeApi();
  tone = vi.fn();
  gum = vi.fn(async () => ({ getTracks: () => [{ stop: vi.fn() }] }));
  onSent = vi.fn();
  (URL as unknown as { createObjectURL: () => string }).createObjectURL = () => "blob:rec";
  (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => {};
});

afterEach(() => {
  vi.useRealTimers();
});

describe("reading block", () => {
  it("shows the story in large print with no item numbers, and a big Start", () => {
    renderBlock();
    const story = screen.getByTestId("story-text");
    expect(story).toHaveTextContent("آج بلال اپنے والد کے ساتھ دریا گیا۔");
    expect(story).toHaveAttribute("dir", "rtl");
    expect(story.textContent).not.toMatch(/\b1\.|\(1\)/);
    expect(screen.getByRole("button", { name: "Start" })).toBeInTheDocument();
    expect(screen.getByText(/Say «اب شروع کریں»/)).toBeInTheDocument();
  });

  it("Start records and counts down 60 s; the tone plays once at 60 s and the questions appear", async () => {
    renderBlock();
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    await waitFor(() => expect(FakeMediaRecorder.instances[0]?.state).toBe("recording"));
    expect(screen.getByTestId("countdown")).toHaveTextContent("60");
    await tick(30_000);
    expect(screen.getByTestId("countdown")).toHaveTextContent("30");
    expect(tone).not.toHaveBeenCalled();
    await tick(30_000);
    expect(tone).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Time is up")).toBeInTheDocument();
    expect(screen.getByText("بلال کس کے ساتھ گیا؟")).toBeInTheDocument();
    expect(screen.getByText("تامو")).toBeInTheDocument();
    await tick(10_000);
    expect(tone).toHaveBeenCalledTimes(1);
    expect(FakeMediaRecorder.instances[0].state).toBe("recording");
  });

  it("Stop → review → Send uploads with the timed-minute offsets and reports sent", async () => {
    renderBlock();
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    await waitFor(() => expect(FakeMediaRecorder.instances[0]?.state).toBe("recording"));
    await tick(42_000);
    fireEvent.click(screen.getByRole("button", { name: "Child finished" }));
    await tick(20_000);
    expect(tone).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    await screen.findByRole("button", { name: "Send" });
    expect(screen.getByRole("button", { name: "Record again" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(onSent).toHaveBeenCalled());
    expect(api.presignBlockUpload).toHaveBeenCalledWith("s1", expect.objectContaining({ block: "urdu", kind: "audio" }));
    expect(api.registerBlockMedia).toHaveBeenCalledWith("s1", expect.objectContaining({
      block: "urdu",
      audioKey: "child-test/sandbox/sch/s1/urdu.webm",
      timing: expect.objectContaining({ timedStartMs: 0, timedEndMs: 42_000, finishedEarly: true, fallback: false, startedAt: "2026-10-02T09:00:00.000Z" }),
    }));
    expect(await Store.listPending("s1")).toEqual([]);
  });

  it("a stopped take is already on the phone, tagged for this block, before Send is tapped", async () => {
    renderBlock();
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    await waitFor(() => expect(FakeMediaRecorder.instances[0]?.state).toBe("recording"));
    await tick(65_000);
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    await screen.findByRole("button", { name: "Send" });
    const pending = await Store.listPending("s1");
    expect(pending.map((p) => [p.meta.block, p.meta.kind])).toEqual([["urdu", "audio"]]);
    expect(pending[0].meta.timing).toMatchObject({ timedStartMs: 0, timedEndMs: 60_000, finishedEarly: false });
  });

  it("Record again throws the take away and starts fresh", async () => {
    renderBlock();
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    await waitFor(() => expect(FakeMediaRecorder.instances[0]?.state).toBe("recording"));
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    fireEvent.click(await screen.findByRole("button", { name: "Record again" }));
    expect(await screen.findByRole("button", { name: "Start" })).toBeInTheDocument();
    expect(api.presignBlockUpload).not.toHaveBeenCalled();
  });

  it("a failed send keeps the recording on the phone and says so; Send again works", async () => {
    api.uploadToR2.mockRejectedValueOnce(new Error("offline"));
    renderBlock();
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    await waitFor(() => expect(FakeMediaRecorder.instances[0]?.state).toBe("recording"));
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    fireEvent.click(await screen.findByRole("button", { name: "Send" }));
    expect(await screen.findByText(/Saved on this phone/)).toBeInTheDocument();
    expect(await Store.listPending("s1")).toHaveLength(1);
    expect(onSent).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(onSent).toHaveBeenCalled());
  });

  it("a blocked microphone says how to allow it, and records nothing", async () => {
    gum.mockRejectedValueOnce(Object.assign(new Error("denied"), { name: "NotAllowedError" }));
    renderBlock();
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    expect(await screen.findByText(/microphone cannot be used/)).toBeInTheDocument();
    expect(FakeMediaRecorder.instances).toHaveLength(0);
  });

  it("cannot read the first line → the letters and words card replaces the story", async () => {
    renderBlock();
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    await waitFor(() => expect(FakeMediaRecorder.instances[0]?.state).toBe("recording"));
    fireEvent.click(screen.getByRole("button", { name: "Cannot read line 1" }));
    expect(screen.queryByTestId("story-text")).not.toBeInTheDocument();
    expect(screen.getByText("پانی")).toBeInTheDocument();
    expect(screen.queryByText("Time is up")).not.toBeInTheDocument();
    expect(screen.getByText("Letters, then words")).toBeInTheDocument();
  });
});

describe("maths block", () => {
  it("numbers first (untimed), then the quick-sums minute, then a strip photo is needed before Send", async () => {
    renderBlock(mathsCard);
    expect(screen.getByText("47")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    await waitFor(() => expect(FakeMediaRecorder.instances[0]?.state).toBe("recording"));
    await tick(20_000);
    expect(screen.queryByTestId("countdown")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Start quick sums" }));
    expect(screen.getByText("3 + 1")).toBeInTheDocument();
    expect(screen.getByTestId("countdown")).toHaveTextContent("60");
    await tick(60_000);
    expect(tone).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    const send = await screen.findByRole("button", { name: "Send" });
    expect(send).toBeDisabled();
    const photo = new File(["jpg"], "strip.jpg", { type: "image/jpeg" });
    fireEvent.change(screen.getByTestId("strip-photo-input"), { target: { files: [photo] } });
    await waitFor(() => expect(screen.getByRole("button", { name: "Send" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(onSent).toHaveBeenCalled());
    const kinds = api.presignBlockUpload.mock.calls.map((c) => (c[1] as { kind: string }).kind).sort();
    expect(kinds).toEqual(["audio", "photo"]);
    expect(api.registerBlockMedia).toHaveBeenCalledWith("s1", expect.objectContaining({
      block: "maths", timing: expect.objectContaining({ timedStartMs: 20_000, timedEndMs: 80_000 }),
    }));
  });

  it("No strip photo sends the audio alone, marked declined, so maths is scored without it", async () => {
    renderBlock(mathsCard);
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    await waitFor(() => expect(FakeMediaRecorder.instances[0]?.state).toBe("recording"));
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    fireEvent.click(await screen.findByRole("button", { name: "No strip photo" }));
    await waitFor(() => expect(onSent).toHaveBeenCalled());
    expect(api.presignBlockUpload.mock.calls.map((c) => (c[1] as { kind: string }).kind)).toEqual(["audio"]);
    expect(api.registerBlockMedia).toHaveBeenCalledWith("s1", expect.objectContaining({ block: "maths", photoDeclined: true }));
  });

  it("the photo input opens the camera (capture) and takes images only", () => {
    renderBlock(mathsCard);
    const input = screen.getByTestId("strip-photo-input");
    expect(input).toHaveAttribute("accept", "image/*");
    expect(input).toHaveAttribute("capture", "environment");
  });
});
