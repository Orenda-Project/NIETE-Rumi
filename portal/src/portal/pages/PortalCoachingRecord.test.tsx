import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

// bd-5rz1v — the record page a teacher reaches from Coaching's "Send a lesson"
// sheet (bd-5rz1v.7). It is built for a teacher who is not confident with
// phones: one big choice at a time, few words. There is no first screen of
// choices any more: Coaching says what she chose, in the route state —
//
//   { start: "record" }   Record Live Lecture → recording at once
//   { start: "file" }     Upload Recording → the file Coaching handed over
//   { start: "resume" }   Continue → the recording that was never sent
//
//   recording   a big clock, Pause, Finish — Finish asks first
//   check       listen, redo, add a lesson plan (library or a photo), board photos
//   send        → "Sent!" → Open this lesson
//
// The recording and the network are mocked; the file rules (types, caps, photo
// count) are the real ones from lib/coachingUpload.

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
// `bare` hides the app's navigation: a stray tap on it must not end a lesson mid-recording.
vi.mock("../components/PortalLayout", () => ({ default: ({ children, bare }: any) => <div data-testid="layout" data-bare={bare ? "yes" : "no"}>{children}</div> }));
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
import { handOffRecording, takeHandedOffRecording } from "../lib/lessonHandoff";
import PortalCoachingRecord from "./PortalCoachingRecord";

const api = portal as any;

function file(name: string, size = 1000) {
  const f = new File(["x"], name);
  Object.defineProperty(f, "size", { value: size });
  return f;
}

/** Stands in for Coaching: shows what the record page asked it to do. */
const CoachingPage = () => {
  const loc = useLocation();
  return <div data-testid="coaching-page">{JSON.stringify(loc.state)}</div>;
};

/** What this history entry holds now, as Back would find it. */
const HistoryState = () => <div data-testid="history-state">{JSON.stringify(useLocation().state)}</div>;

function renderPage(state: unknown = null) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: "/portal/coaching/new", state }]}>
      <HistoryState />
      <Routes>
        <Route path="/portal/coaching/new" element={<PortalCoachingRecord />} />
        <Route path="/portal/coaching" element={<CoachingPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** Record Live Lecture, from Coaching's sheet. */
async function recording() {
  renderPage({ start: "record" });
  await screen.findByText("Recording");
}

async function finished() {
  await recording();
  fireEvent.click(screen.getByRole("button", { name: /^finish$/i }));
  fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: /yes, finish/i }));
  await screen.findByRole("button", { name: /send to digital coach/i });
}

function choose(testId: string, files: File[]) {
  fireEvent.change(screen.getByTestId(testId), { target: { files } });
}

/** Upload Recording, from Coaching's sheet: Coaching hands the file over. */
async function toCheckWithFile(name = "Period 3.m4a") {
  handOffRecording(file(name, 24_000_000));
  renderPage({ start: "file" });
  await screen.findByRole("button", { name: /send to digital coach/i });
}

const getUserMedia = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  takeHandedOffRecording();
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
  it("explains, and starts nothing, when it is off for her", async () => {
    api.getConfig.mockResolvedValue({ features: { selfObservation: false } });
    renderPage({ start: "record" });
    expect(await screen.findByText(/isn.t available on your account yet/i)).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 20));
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(recorder.start).not.toHaveBeenCalled();
  });
});

describe("Record your class — no screen of choices (bd-5rz1v.7)", () => {
  it("opened without a choice, sends her to Coaching with the Send a lesson sheet open", async () => {
    renderPage();
    expect(await screen.findByTestId("coaching-page")).toHaveTextContent('{"sendSheet":true}');
  });

  it("an upload whose file did not survive a reload goes back to Coaching to choose again", async () => {
    renderPage({ start: "file" });
    expect(await screen.findByTestId("coaching-page")).toHaveTextContent('{"sendSheet":true}');
  });

  it("takes the choice once: Back to this page later finds nothing that would start a recording", async () => {
    await recording();
    expect(screen.getByTestId("history-state")).toHaveTextContent("null");
  });

  it("Record Live Lecture is recording on arrival — there is no second Record button", async () => {
    await recording();
    expect(screen.queryByRole("button", { name: /record now/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /record live lecture/i })).not.toBeInTheDocument();
  });
});

describe("Record your class — recording", () => {
  it("asks for the microphone, keeps the screen on, and shows the clock with Finish and Pause", async () => {
    renderPage({ start: "record" });

    expect(await screen.findByText("Recording")).toBeInTheDocument();
    expect(getUserMedia).toHaveBeenCalledWith({ audio: expect.anything() });
    expect(recorder.start).toHaveBeenCalled();
    expect(keepScreenOn).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /^finish$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^pause$/i })).toBeInTheDocument();
    expect(screen.getByText(/keep this screen open/i)).toBeInTheDocument();
    // No navigation to tap away from the lesson by mistake.
    expect(screen.getByTestId("layout")).toHaveAttribute("data-bare", "yes");
  });

  it("brings the navigation back once the recording is finished", async () => {
    await recording();
    expect(screen.getByTestId("layout")).toHaveAttribute("data-bare", "yes");
    fireEvent.click(screen.getByRole("button", { name: /^finish$/i }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: /yes, finish/i }));
    await screen.findByRole("button", { name: /send to digital coach/i });
    expect(screen.getByTestId("layout")).toHaveAttribute("data-bare", "no");
  });

  it("says 'less than a minute' rather than rounding seconds up to a minute", async () => {
    recorder.elapsedMs.mockReturnValue(20_000);
    await recording();
    fireEvent.click(await screen.findByRole("button", { name: /^finish$/i }));
    expect(within(await screen.findByRole("dialog")).getByText(/you recorded less than a minute/i)).toBeInTheDocument();
  });

  it("Pause stops the recording and offers Continue", async () => {
    await recording();
    fireEvent.click(await screen.findByRole("button", { name: /^pause$/i }));
    expect(recorder.pause).toHaveBeenCalled();
    expect(await screen.findByText("Paused")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^continue$/i }));
    expect(recorder.resume).toHaveBeenCalled();
  });

  it("Back (the browser's, or the app's key) asks 'Finish recording?' instead of leaving and stopping the lesson", async () => {
    await recording();
    await waitFor(() => expect(window.history.state && window.history.state.recordingGuard).toBe(true));
    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(await screen.findByRole("dialog", { name: /finish recording/i })).toBeInTheDocument();
    expect(recorder.stop).not.toHaveBeenCalled();
    expect(screen.getByText("Recording")).toBeInTheDocument();
  });

  it("once the recording is finished, the Back guard is taken off", async () => {
    await recording();
    await waitFor(() => expect(window.history.state && window.history.state.recordingGuard).toBe(true));
    const back = vi.spyOn(window.history, "back").mockImplementation(() => {});
    fireEvent.click(screen.getByRole("button", { name: /^finish$/i }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: /yes, finish/i }));
    await screen.findByRole("button", { name: /send to digital coach/i });
    expect(back).toHaveBeenCalled();
    back.mockRestore();
  });

  it("Finish asks first, so one stray tap cannot end the lesson", async () => {
    await recording();
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
    await recording();
    fireEvent.click(await screen.findByRole("button", { name: /^finish$/i }));
    expect(within(await screen.findByRole("dialog")).getByText(/that is short/i)).toBeInTheDocument();
  });

  it("when the microphone is refused, says how to allow it and offers a file instead", async () => {
    getUserMedia.mockRejectedValue(Object.assign(new Error("denied"), { name: "NotAllowedError" }));
    renderPage({ start: "record" });
    expect(await screen.findByText(/we can.t use the microphone/i)).toBeInTheDocument();
    const pick = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
    fireEvent.click(screen.getByRole("button", { name: /choose a recording instead/i }));
    expect(pick).toHaveBeenCalled();
    pick.mockRestore();
    choose("audio-input", [file("Period 3.m4a", 24_000_000)]);
    expect(await screen.findByRole("button", { name: /send to digital coach/i })).toBeInTheDocument();
  });
});

describe("Record your class — check and send", () => {
  it("names the chosen file and offers to choose a different one", async () => {
    await toCheckWithFile("Period 3.m4a");
    expect(screen.getByText("Period 3.m4a")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /choose a different file/i })).toBeInTheDocument();
  });

  it("Choose a different file opens the picker and keeps the current file until she picks another", async () => {
    await toCheckWithFile("Period 3.m4a");
    const pick = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
    fireEvent.click(screen.getByRole("button", { name: /choose a different file/i }));
    expect(pick).toHaveBeenCalled();
    pick.mockRestore();
    expect(screen.getByText("Period 3.m4a")).toBeInTheDocument();
    choose("audio-input", [file("notes.pdf")]);
    expect(await screen.findByText(/not a recording/i)).toBeInTheDocument();
    expect(screen.getByText("Period 3.m4a")).toBeInTheDocument();
    choose("audio-input", [file("Period 4.m4a", 24_000_000)]);
    expect(await screen.findByText("Period 4.m4a")).toBeInTheDocument();
    expect(screen.queryByText(/not a recording/i)).not.toBeInTheDocument();
  });

  it("Delete and record again deletes the recording and goes back to Coaching with the sheet open", async () => {
    await finished();
    fireEvent.click(screen.getByRole("button", { name: /delete and record again/i }));
    expect(await screen.findByTestId("coaching-page")).toHaveTextContent('{"sendSheet":true}');
    expect(deleteRecording).toHaveBeenCalledWith("rec-1");
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
    await finished();
    fireEvent.click(screen.getByRole("button", { name: /send to digital coach/i }));

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

  it("Take a photo opens the back camera — in the app too, which needs accept to be exactly image/*", async () => {
    await openSheet();
    const input = screen.getByTestId("plan-photo-input");
    expect(input).toHaveAttribute("capture", "environment");
    // Capacitor's BridgeWebChromeClient takes the camera path only when the
    // accept list contains "image/*"; "image/jpeg,image/png" gets the file picker.
    expect(input).toHaveAttribute("accept", "image/*");
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

// Offering it (Continue / Delete) is Coaching's job now: PortalCoaching.sendLesson.test.
describe("Record your class — a recording that was never sent", () => {
  it("Continue opens it in Check and send, and it is deleted from the phone once sent", async () => {
    vi.mocked(latestUnsent).mockResolvedValue({
      meta: { id: "rec-old", mimeType: "audio/webm", ext: ".webm", startedAt: "2026-10-02T08:00:00Z", elapsedMs: 12 * 60_000, finished: false },
      blob: new Blob(["old"], { type: "audio/webm" }),
    } as any);
    renderPage({ start: "resume" });
    const sendBtn = await screen.findByRole("button", { name: /send to digital coach/i });
    expect(screen.getByText(/12 minutes/i)).toBeInTheDocument();
    fireEvent.click(sendBtn);
    await screen.findByText(/^sent!$/i);
    expect(deleteRecording).toHaveBeenCalledWith("rec-old");
  });

  it("Continue with nothing left on the phone goes back to Coaching", async () => {
    renderPage({ start: "resume" });
    expect(await screen.findByTestId("coaching-page")).toHaveTextContent('{"sendSheet":true}');
  });
});
