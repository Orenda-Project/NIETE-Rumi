import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// bd-5rz1v — "Record your class": the page a teacher reaches from the big
// button on Coaching. It is built for a teacher who is not confident with
// phones: one big choice at a time, few words.
//
//   choose      Record now (where the microphone can work) | Choose a recording
//   recording   a big clock, Pause, Finish — Finish asks first
//   check       listen, redo, add a lesson plan (library or a photo), board photos
//   send        → "Sent!" → Open this lesson
//
// The recording and the network are mocked; the file rules (types, caps, photo
// count) are the real ones from lib/coachingUpload.

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("../components/PortalLayout", () => ({ default: ({ children }: any) => <div>{children}</div> }));
vi.mock("../services/api", () => ({
  portal: {
    getConfig: vi.fn(),
    presignCoachingUpload: vi.fn(),
    uploadToR2: vi.fn(),
    startCoachingUpload: vi.fn(),
    getRecentLessonPlans: vi.fn(),
    getLibraryGrades: vi.fn(),
    getLibrarySubjects: vi.fn(),
    getLibraryChapters: vi.fn(),
    getLibraryLessons: vi.fn(),
    requestLibraryLesson: vi.fn(),
    getLibraryLessonStatus: vi.fn(),
  },
}));
vi.mock("../lib/recordingSupport", async (orig) => ({
  ...(await orig<any>()),
  canRecordHere: vi.fn(),
  // jsdom has no MediaRecorder; this is what Chrome and the app's WebView pick.
  pickRecordingType: vi.fn(() => ({ mimeType: "audio/webm;codecs=opus", ext: ".webm" })),
}));
vi.mock("../lib/keepAwake", () => ({ keepScreenOn: vi.fn().mockResolvedValue(async () => {}) }));
vi.mock("../lib/recordingStore", () => ({
  latestUnsent: vi.fn(),
  deleteRecording: vi.fn().mockResolvedValue(undefined),
  createRecording: vi.fn(), appendChunk: vi.fn(), markFinished: vi.fn(),
}));
vi.mock("../lib/coachingUpload", async (orig) => ({
  ...(await orig<any>()),
  readAudioDuration: vi.fn().mockResolvedValue(1800),
}));

const recorder = {
  start: vi.fn().mockResolvedValue(undefined),
  pause: vi.fn(), resume: vi.fn(),
  isPaused: vi.fn().mockReturnValue(false),
  elapsedMs: vi.fn().mockReturnValue(38 * 60_000 + 24_000),
  stop: vi.fn(),
  discard: vi.fn().mockResolvedValue(undefined),
};
// A function, not an arrow: the page constructs it with `new`.
vi.mock("../lib/lessonRecorder", () => ({ LessonRecorder: vi.fn(function LessonRecorder() { return recorder; }) }));

import { portal } from "../services/api";
import { canRecordHere } from "../lib/recordingSupport";
import { latestUnsent, deleteRecording } from "../lib/recordingStore";
import { readAudioDuration } from "../lib/coachingUpload";
import { keepScreenOn } from "../lib/keepAwake";
import PortalCoachingRecord from "./PortalCoachingRecord";

const api = portal as any;

function file(name: string, size = 1000) {
  const f = new File(["x"], name);
  Object.defineProperty(f, "size", { value: size });
  return f;
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/portal/coaching/new"]}>
      <Routes>
        <Route path="/portal/coaching/new" element={<PortalCoachingRecord />} />
      </Routes>
    </MemoryRouter>,
  );
}

async function ready() {
  renderPage();
  await screen.findByRole("button", { name: /choose a recording/i });
}

function choose(testId: string, files: File[]) {
  fireEvent.change(screen.getByTestId(testId), { target: { files } });
}

async function toCheckWithFile(name = "Period 3.m4a") {
  await ready();
  choose("audio-input", [file(name, 24_000_000)]);
  await screen.findByRole("button", { name: /send to digital coach/i });
}

const getUserMedia = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  api.getConfig.mockResolvedValue({ features: { selfObservation: true } });
  vi.mocked(canRecordHere).mockResolvedValue(true);
  vi.mocked(latestUnsent).mockResolvedValue(null);
  vi.mocked(readAudioDuration).mockResolvedValue(1800);
  recorder.isPaused.mockReturnValue(false);
  recorder.elapsedMs.mockReturnValue(38 * 60_000 + 24_000);
  recorder.stop.mockResolvedValue({
    blob: new Blob(["rec"], { type: "audio/webm" }), durationMs: 38 * 60_000 + 24_000,
    type: { mimeType: "audio/webm;codecs=opus", ext: ".webm" }, id: "rec-1",
  });
  getUserMedia.mockResolvedValue({ getTracks: () => [] });
  Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia }, configurable: true });
  let n = 0;
  api.presignCoachingUpload.mockImplementation(async ({ kind, filename }: any) => {
    n += 1;
    return { key: `${kind}/${n}-${filename}`, uploadUrl: `https://r2/${n}`, contentType: "x" };
  });
  api.uploadToR2.mockResolvedValue(undefined);
  api.startCoachingUpload.mockResolvedValue({ coachingSessionId: "cs-9" });
  api.getRecentLessonPlans.mockResolvedValue({ plans: [] });
  api.getLibraryGrades.mockResolvedValue([{ grade: 4, lane: "k5" }, { grade: 7, lane: "g612" }]);
  api.getLibrarySubjects.mockResolvedValue([{ key: "sst", label: "Social Studies" }]);
  api.getLibraryChapters.mockResolvedValue([{ key: "3", label: "Chapter 3: Our provinces" }]);
  api.getLibraryLessons.mockResolvedValue([]);
});

describe("Record your class — dark until the feature is on", () => {
  it("explains, instead of offering a recorder, when it is off for her", async () => {
    api.getConfig.mockResolvedValue({ features: { selfObservation: false } });
    renderPage();
    expect(await screen.findByText(/isn.t available on your account yet/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /record now/i })).not.toBeInTheDocument();
  });
});

describe("Record your class — the first choice", () => {
  it("offers Record now and Choose a recording", async () => {
    await ready();
    expect(screen.getByRole("button", { name: /record now/i })).toBeInTheDocument();
  });

  it("hides Record now where the microphone cannot work (an older app), keeping Choose a recording", async () => {
    vi.mocked(canRecordHere).mockResolvedValue(false);
    await ready();
    expect(screen.queryByRole("button", { name: /record now/i })).not.toBeInTheDocument();
  });

  it("refuses a file that is not a recording before anything is uploaded", async () => {
    await ready();
    choose("audio-input", [file("notes.pdf")]);
    expect(await screen.findByText(/not a recording/i)).toBeInTheDocument();
    expect(api.presignCoachingUpload).not.toHaveBeenCalled();
  });
});

describe("Record your class — recording", () => {
  it("asks for the microphone, keeps the screen on, and shows the clock with Finish and Pause", async () => {
    await ready();
    fireEvent.click(screen.getByRole("button", { name: /record now/i }));

    expect(await screen.findByText("Recording")).toBeInTheDocument();
    expect(getUserMedia).toHaveBeenCalledWith({ audio: expect.anything() });
    expect(recorder.start).toHaveBeenCalled();
    expect(keepScreenOn).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /^finish$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^pause$/i })).toBeInTheDocument();
    expect(screen.getByText(/keep this screen open/i)).toBeInTheDocument();
  });

  it("Pause stops the recording and offers Continue", async () => {
    await ready();
    fireEvent.click(screen.getByRole("button", { name: /record now/i }));
    fireEvent.click(await screen.findByRole("button", { name: /^pause$/i }));
    expect(recorder.pause).toHaveBeenCalled();
    expect(await screen.findByText("Paused")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^continue$/i }));
    expect(recorder.resume).toHaveBeenCalled();
  });

  it("Finish asks first, so one stray tap cannot end the lesson", async () => {
    await ready();
    fireEvent.click(screen.getByRole("button", { name: /record now/i }));
    fireEvent.click(await screen.findByRole("button", { name: /^finish$/i }));

    const sheet = await screen.findByRole("dialog", { name: /finish recording/i });
    expect(within(sheet).getByText(/38 minutes/)).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole("button", { name: /keep recording/i }));
    expect(recorder.stop).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^finish$/i }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: /yes, finish/i }));
    expect(await screen.findByRole("button", { name: /send to digital coach/i })).toBeInTheDocument();
    expect(recorder.stop).toHaveBeenCalled();
    expect(screen.getByText(/your recording/i)).toBeInTheDocument();
  });

  it("warns, in the finish sheet, about a recording under 10 minutes", async () => {
    recorder.elapsedMs.mockReturnValue(6 * 60_000);
    await ready();
    fireEvent.click(screen.getByRole("button", { name: /record now/i }));
    fireEvent.click(await screen.findByRole("button", { name: /^finish$/i }));
    expect(within(await screen.findByRole("dialog")).getByText(/that is short/i)).toBeInTheDocument();
  });

  it("when the microphone is refused, says how to allow it and offers a file instead", async () => {
    getUserMedia.mockRejectedValue(Object.assign(new Error("denied"), { name: "NotAllowedError" }));
    await ready();
    fireEvent.click(screen.getByRole("button", { name: /record now/i }));
    expect(await screen.findByText(/we can.t use the microphone/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /choose a recording instead/i })).toBeInTheDocument();
  });
});

describe("Record your class — check and send", () => {
  it("names the chosen file and offers to choose a different one", async () => {
    await toCheckWithFile("Period 3.m4a");
    expect(screen.getByText("Period 3.m4a")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /choose a different file/i })).toBeInTheDocument();
  });

  it("warns about a recording under 10 minutes, but still lets her send it", async () => {
    vi.mocked(readAudioDuration).mockResolvedValue(300);
    await toCheckWithFile();
    expect(await screen.findByText(/under 10 minutes/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /send to digital coach/i })).toBeEnabled();
  });

  it("sends, then says so and links to the lesson", async () => {
    await toCheckWithFile("Period 3.m4a");
    fireEvent.click(screen.getByRole("button", { name: /send to digital coach/i }));

    expect(await screen.findByText(/^sent!$/i)).toBeInTheDocument();
    expect(api.startCoachingUpload).toHaveBeenCalledWith({ key: "audio/1-Period 3.m4a", photoKeys: [] });
    expect(screen.getByRole("link", { name: /open this lesson/i })).toHaveAttribute("href", "/portal/coaching/session/cs-9");
    expect(screen.getByText(/also tell you on whatsapp/i)).toBeInTheDocument();
  });

  it("a recording made here is sent as a .webm and deleted from the phone once it has arrived", async () => {
    await ready();
    fireEvent.click(screen.getByRole("button", { name: /record now/i }));
    fireEvent.click(await screen.findByRole("button", { name: /^finish$/i }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: /yes, finish/i }));
    fireEvent.click(await screen.findByRole("button", { name: /send to digital coach/i }));

    await screen.findByText(/^sent!$/i);
    const audio = api.presignCoachingUpload.mock.calls[0][0];
    expect(audio.kind).toBe("audio");
    expect(audio.filename).toMatch(/\.webm$/);
    expect(deleteRecording).toHaveBeenCalledWith("rec-1");
  });

  it("when the internet drops, keeps everything and offers Try again", async () => {
    api.uploadToR2.mockRejectedValueOnce(new Error("upload failed (network)"));
    await toCheckWithFile();
    fireEvent.click(screen.getByRole("button", { name: /send to digital coach/i }));

    expect(await screen.findByText(/the internet stopped/i)).toBeInTheDocument();
    expect(api.startCoachingUpload).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(await screen.findByText(/^sent!$/i)).toBeInTheDocument();
  });

  it("when another lesson is still being analysed, says so and links to it", async () => {
    api.startCoachingUpload.mockRejectedValue({ response: { status: 409, data: { status: "in_progress", coachingSessionId: "cs-1" } } });
    await toCheckWithFile();
    fireEvent.click(screen.getByRole("button", { name: /send to digital coach/i }));
    expect(await screen.findByText(/already being analysed/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /open that lesson/i })).toHaveAttribute("href", "/portal/coaching/session/cs-1");
  });

  it("takes up to 3 board photos and refuses a fourth", async () => {
    await toCheckWithFile();
    choose("photos-input", [file("a.jpg"), file("b.jpg"), file("c.jpg"), file("d.jpg")]);
    expect(await screen.findByText(/up to 3 photos/i)).toBeInTheDocument();
    choose("photos-input", [file("a.jpg"), file("b.jpg")]);
    fireEvent.click(screen.getByRole("button", { name: /send to digital coach/i }));
    await screen.findByText(/^sent!$/i);
    expect(api.startCoachingUpload.mock.calls[0][0].photoKeys).toHaveLength(2);
  });
});

describe("Record your class — the lesson plan", () => {
  async function openSheet() {
    await toCheckWithFile();
    fireEvent.click(screen.getByRole("button", { name: /add a lesson plan/i }));
    return screen.findByRole("dialog", { name: /add your lesson plan/i });
  }

  it("offers the library or a photo of her own plan", async () => {
    const sheet = await openSheet();
    expect(within(sheet).getByRole("button", { name: /from our library/i })).toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: /take a photo/i })).toBeInTheDocument();
  });

  it("Take a photo opens the back camera", async () => {
    await openSheet();
    const input = screen.getByTestId("plan-photo-input");
    expect(input).toHaveAttribute("capture", "environment");
    expect(input).toHaveAttribute("accept", expect.stringContaining("image/"));
  });

  it("a photo of her plan is sent as her lesson plan", async () => {
    await openSheet();
    choose("plan-photo-input", [file("IMG_0042.jpg")]);
    expect(await screen.findByText(/photo of your plan/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /send to digital coach/i }));
    await screen.findByText(/^sent!$/i);
    expect(api.startCoachingUpload.mock.calls[0][0]).toMatchObject({ lessonPlanKey: "lesson_plan/2-IMG_0042.jpg" });
  });

  it("her recent plans come first, and one tap picks one", async () => {
    api.getRecentLessonPlans.mockResolvedValue({ plans: [{
      assetId: "asset-1", lessonId: "g4-sst-ch3-seg2", topic: "Provinces of Pakistan", grade: "4",
      subject: "Social Studies", chapterNumber: 3, dayLabel: "Day 2", pagesLabel: null, downloadedAt: null,
    }] });
    const sheet = await openSheet();
    fireEvent.click(within(sheet).getByRole("button", { name: /from our library/i }));

    expect(await screen.findByText(/your recent plans/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /provinces of pakistan/i }));

    expect(await screen.findByRole("button", { name: /send to digital coach/i })).toBeInTheDocument();
    expect(screen.getByText(/from the library/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /send to digital coach/i }));
    await screen.findByText(/^sent!$/i);
    expect(api.startCoachingUpload.mock.calls[0][0]).toMatchObject({ lessonPlan: { assetId: "asset-1" } });
  });

  it("finds a lesson one question at a time: grade, subject, chapter, lesson", async () => {
    api.getLibraryLessons.mockResolvedValue([
      { id: "g4-sst-ch3-seg1", label: "Pakistan on the map", sub: "Day 1", ready: true, used: false },
      { id: "g4-sst-ch3-seg2", label: "Provinces of Pakistan", sub: "Day 2", ready: true, used: true },
    ]);
    const sheet = await openSheet();
    fireEvent.click(within(sheet).getByRole("button", { name: /from our library/i }));

    expect(await screen.findByText(/which grade\?/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "4" }));
    expect(await screen.findByText(/which subject\?/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /social studies/i }));
    expect(await screen.findByText(/which chapter\?/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /chapter 3/i }));
    expect(await screen.findByText(/which lesson\?/i)).toBeInTheDocument();
    expect(screen.getByText(/you used this plan/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /provinces of pakistan/i }));
    fireEvent.click(await screen.findByRole("button", { name: /send to digital coach/i }));
    await screen.findByText(/^sent!$/i);
    expect(api.getLibrarySubjects).toHaveBeenCalledWith(4, "k5");
    expect(api.startCoachingUpload.mock.calls[0][0]).toMatchObject({ lessonPlan: { lessonId: "g4-sst-ch3-seg2" } });
  });

  it("a grade 6-12 lesson that is not written yet can be got ready, then picked", async () => {
    api.getLibraryLessons.mockResolvedValue([
      { id: "g7-sci-ch2-s3", label: "Photosynthesis", sub: "Pages 22-24", ready: false, used: false },
    ]);
    api.requestLibraryLesson.mockResolvedValue({ state: "ready", renderId: "r1" });
    const sheet = await openSheet();
    fireEvent.click(within(sheet).getByRole("button", { name: /from our library/i }));
    fireEvent.click(await screen.findByRole("button", { name: "7" }));
    fireEvent.click(await screen.findByRole("button", { name: /social studies/i }));
    fireEvent.click(await screen.findByRole("button", { name: /chapter 3/i }));

    fireEvent.click(await screen.findByRole("button", { name: /photosynthesis/i }));
    expect(api.requestLibraryLesson).toHaveBeenCalledWith("g7-sci-ch2-s3");
    fireEvent.click(await screen.findByRole("button", { name: /send to digital coach/i }));
    await screen.findByText(/^sent!$/i);
    expect(api.startCoachingUpload.mock.calls[0][0]).toMatchObject({ lessonPlan: { segmentId: "g7-sci-ch2-s3", lang: "en" } });
  });
});

describe("Record your class — a recording that was never sent", () => {
  it("is offered on the first screen, and Send it goes straight to check", async () => {
    vi.mocked(latestUnsent).mockResolvedValue({
      meta: { id: "rec-old", mimeType: "audio/webm", ext: ".webm", startedAt: "2026-10-02T08:00:00Z", elapsedMs: 12 * 60_000, finished: false },
      blob: new Blob(["old"], { type: "audio/webm" }),
    } as any);
    await ready();
    expect(screen.getByText(/a recording that was not sent/i)).toBeInTheDocument();
    expect(screen.getByText(/12 minutes/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /send it/i }));
    fireEvent.click(await screen.findByRole("button", { name: /send to digital coach/i }));
    await screen.findByText(/^sent!$/i);
    expect(deleteRecording).toHaveBeenCalledWith("rec-old");
  });

  it("Delete removes it from the phone", async () => {
    vi.mocked(latestUnsent).mockResolvedValue({
      meta: { id: "rec-old", mimeType: "audio/webm", ext: ".webm", startedAt: "2026-10-02T08:00:00Z", elapsedMs: 60_000, finished: true },
      blob: new Blob(["old"]),
    } as any);
    await ready();
    fireEvent.click(screen.getByRole("button", { name: /^delete$/i }));
    await waitFor(() => expect(deleteRecording).toHaveBeenCalledWith("rec-old"));
    expect(screen.queryByText(/a recording that was not sent/i)).not.toBeInTheDocument();
  });
});
