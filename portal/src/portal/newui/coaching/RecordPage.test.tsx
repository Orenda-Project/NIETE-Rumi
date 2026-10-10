import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, within, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { tapProblems } from "../checks/rules";

/**
 * bd-5rz1v.26 — /portal/coaching/new in the new UI (portal_new_ui + self-observation, a
 * teacher): record, then check and send. Same flow as today's PortalCoachingRecord, rebuilt from
 * the kit:
 *
 *   recording  InnerBar (crumb Coaching) "Record live lecture"; the Recording chip (red dot) or
 *              Paused (amber); a big clock; sound bars; a Lesson plans row with "Recording
 *              continues"; Finish (green, asks first) and Pause / Continue (outline)
 *   refused    Microphone blocked: where to allow it, Try again, Upload recording
 *   check      "Check and send": her recording (listen, record again / change file), a lesson
 *              plan (Recent lesson plans from GET /lesson-plans/recent, the library, a photo, a
 *              file), up to 3 board photos, Send to Digital Coach
 *   sending    a ring and the percentage, no menu
 *   after      Sent → Open lesson; No internet → Try again; plan refused → Change lesson plan;
 *              another lesson analysing → Open that lesson
 *
 * Route state from Coaching ({ start: record | file | resume }) is taken once, as before. The
 * recording lives in the app-level session (bd-5rz1v.10): Back while recording leaves it running.
 */

vi.mock("../../hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("../../components/PortalLayout", () => ({
  default: ({ children, ownHeading, bare }: { children: React.ReactNode; ownHeading?: boolean; bare?: boolean }) => (
    <div data-testid="layout" data-own-heading={String(Boolean(ownHeading))} data-bare={bare ? "yes" : "no"}>{children}</div>
  ),
}));
const http = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("../../services/api", () => ({
  default: http,
  portal: {
    getConfig: vi.fn(),
    getDashboard: vi.fn(),
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
vi.mock("../../lib/recordingSupport", async (orig) => ({
  ...(await orig<typeof import("../../lib/recordingSupport")>()),
  canRecordHere: vi.fn(async () => true),
  pickRecordingType: vi.fn(() => ({ mimeType: "audio/webm;codecs=opus", ext: ".webm" })),
}));
vi.mock("../../lib/keepAwake", () => ({ keepScreenOn: vi.fn().mockResolvedValue(async () => {}) }));
vi.mock("../../lib/recordingStore", () => ({
  latestUnsent: vi.fn(),
  deleteRecording: vi.fn().mockResolvedValue(undefined),
  createRecording: vi.fn(), appendChunk: vi.fn(), markFinished: vi.fn(),
}));
vi.mock("../../lib/coachingUpload", async (orig) => ({
  ...(await orig<typeof import("../../lib/coachingUpload")>()),
  readAudioDuration: vi.fn().mockResolvedValue(1800),
}));
const recorder = vi.hoisted(() => ({
  id: "rec-1",
  start: vi.fn(), pause: vi.fn(), resume: vi.fn(), isPaused: vi.fn(), elapsedMs: vi.fn(), stop: vi.fn(), discard: vi.fn(),
}));
vi.mock("../../lib/lessonRecorder", () => ({ LessonRecorder: vi.fn(function LessonRecorder() { return recorder; }) }));

import { useAuth } from "../../hooks/useAuth";
import { portal } from "../../services/api";
import { latestUnsent, deleteRecording } from "../../lib/recordingStore";
import { keepScreenOn } from "../../lib/keepAwake";
import { handOffRecording, takeHandedOffRecording } from "../../lib/lessonHandoff";
import { RecordingSessionProvider, useRecordingSession } from "../../lib/recordingSession";
import { resetNewUiMemory } from "../../lib/useNewUi";
import PortalCoachingRecord from "../../pages/PortalCoachingRecord";

const api = portal as unknown as Record<string, ReturnType<typeof vi.fn>>;
const TEACHER = { id: "t-1", firstName: "Ayesha", role: "teacher", phoneNumber: "920000000001" };

function file(name: string, size = 1000) {
  const f = new File(["x"], name);
  Object.defineProperty(f, "size", { value: size });
  return f;
}

/** Coaching and the lesson page, standing in: where she went, and with what. */
function Where() {
  const { pathname, state } = useLocation();
  return <output data-testid="where" data-state={JSON.stringify(state ?? null)}>{pathname}</output>;
}
const HistoryState = () => <div data-testid="history-state">{JSON.stringify(useLocation().state)}</div>;
/** Is the app-level recording still on? */
const SessionOn = () => <div data-testid="session-on">{String(!!useRecordingSession()?.active)}</div>;

function renderPage(state: unknown = null, { entries }: { entries?: Array<string | { pathname: string; state: unknown }> } = {}) {
  vi.mocked(useAuth).mockReturnValue({ user: TEACHER, loading: false, logout: vi.fn() } as unknown as ReturnType<typeof useAuth>);
  const all = entries ?? [{ pathname: "/portal/coaching/new", state }];
  return render(
    <MemoryRouter initialEntries={all} initialIndex={all.length - 1}>
      <RecordingSessionProvider>
        <HistoryState />
        <SessionOn />
        <Routes>
          <Route path="/portal/coaching/new" element={<PortalCoachingRecord />} />
          <Route path="*" element={<Where />} />
        </Routes>
      </RecordingSessionProvider>
    </MemoryRouter>,
  );
}

const bar = () => screen.getByTestId("newui-inner-bar");
const chipText = (el: HTMLElement) => [...el.querySelectorAll("[data-chip]")].map((c) => c.textContent);
const getUserMedia = vi.fn();

async function recording() {
  renderPage({ start: "record" });
  await screen.findByTestId("record-clock");
}

async function toCheck() {
  await recording();
  fireEvent.click(screen.getByRole("button", { name: "Finish" }));
  const sheet = await screen.findByRole("dialog", { name: "Finish recording" });
  fireEvent.click(within(sheet).getByRole("button", { name: "Yes, finish" }));
  await screen.findByRole("button", { name: "Send to Digital Coach" });
}

async function withFile(name = "Period 3.m4a") {
  handOffRecording(file(name, 24_000_000));
  renderPage({ start: "file" });
  await screen.findByRole("button", { name: "Send to Digital Coach" });
}

async function openPlanSheet() {
  fireEvent.click(screen.getByTestId("check-plan"));
  return screen.findByRole("dialog", { name: "Lesson plan" });
}

const RECENT = [
  { planKey: "k5:g4-sci-ch2-seg3", kind: "k5", lessonId: "g4-sci-ch2-seg3", found: true, title: "Leaves make food", grade: 4, subject: "Science", chapterNumber: 2, chapterTitle: "Plants", dayLabel: "Day 3", pagesLabel: null, lastUsedAt: "2026-10-02T05:00:00Z", lastOpenedAt: null, lastReceivedAt: null, open: { lane: "k5", lessonId: "g4-sci-ch2-seg3" } },
  { planKey: "g612:g7-sci.c02.p010", kind: "g612", segmentId: "g7-sci.c02.p010", lang: "ur", found: true, title: "Photosynthesis", grade: 7, subject: "Science", chapterNumber: 2, chapterTitle: null, dayLabel: null, pagesLabel: null, lastUsedAt: "2026-10-01T05:00:00Z", lastOpenedAt: null, lastReceivedAt: null, open: { lane: "g612", segmentId: "g7-sci.c02.p010", lang: "ur" } },
  { planKey: "k5:gone", kind: "k5", lessonId: "gone", found: false, title: null, grade: null, subject: null, chapterNumber: null, chapterTitle: null, dayLabel: null, pagesLabel: null, lastUsedAt: "2026-09-01T05:00:00Z", lastOpenedAt: null, lastReceivedAt: null, open: { lane: "k5", lessonId: "gone" } },
];

beforeEach(() => {
  vi.clearAllMocks();
  resetNewUiMemory();
  takeHandedOffRecording();
  api.getConfig.mockResolvedValue({ success: true, features: { assessmentGenerator: false, assessmentGeneratorMessage: null, selfObservation: true, newUi: true } });
  vi.mocked(latestUnsent).mockResolvedValue(null);
  recorder.start.mockResolvedValue(undefined);
  recorder.isPaused.mockReturnValue(false);
  recorder.elapsedMs.mockReturnValue(38 * 60_000 + 24_000);
  recorder.stop.mockResolvedValue({
    blob: new Blob(["rec"], { type: "audio/webm" }), durationMs: 38 * 60_000 + 24_000,
    type: { mimeType: "audio/webm;codecs=opus", ext: ".webm" }, id: "rec-1",
  });
  getUserMedia.mockResolvedValue({ getTracks: () => [] });
  Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia }, configurable: true });
  let n = 0;
  api.presignCoachingUpload.mockImplementation(async ({ kind, filename }: { kind: string; filename: string }) => {
    n += 1;
    return { key: `${kind}/${n}-${filename}`, uploadUrl: `https://r2/${n}`, contentType: "x" };
  });
  api.uploadToR2.mockResolvedValue(undefined);
  api.startCoachingUpload.mockResolvedValue({ coachingSessionId: "cs-9" });
  http.get.mockImplementation(async (url: string) => (url === "/lesson-plans/recent" ? { data: { success: true, plans: RECENT } } : { data: {} }));
  api.getLibraryGrades.mockResolvedValue([{ grade: 4, lane: "k5" }, { grade: 7, lane: "g612" }]);
  api.getLibrarySubjects.mockResolvedValue([{ key: "sst", label: "Social Studies" }]);
  api.getLibraryChapters.mockResolvedValue([{ key: "3", label: "Chapter 3: Our provinces" }]);
  api.getLibraryLessons.mockResolvedValue([]);
});

describe("which record page she gets", () => {
  it("the new UI: an inner page under Coaching, drawing its own heading", async () => {
    await recording();
    expect(within(bar()).getByTestId("newui-crumb")).toHaveTextContent("Coaching");
    expect(within(bar()).getByRole("heading", { level: 1 })).toHaveTextContent("Record live lecture");
    expect(screen.getByTestId("layout")).toHaveAttribute("data-own-heading", "true");
  });

  it("without the new UI: today's page", async () => {
    api.getConfig.mockResolvedValue({ success: true, features: { selfObservation: true, newUi: false } });
    renderPage({ start: "record" });
    expect(await screen.findByText("We can hear your class.")).toBeInTheDocument();
    expect(screen.queryByTestId("newui-inner-bar")).toBeNull();
  });
});

describe("the route state from Coaching", () => {
  it("opened with no choice: back to Coaching with the Send a lesson sheet open", async () => {
    renderPage();
    expect(await screen.findByTestId("where")).toHaveAttribute("data-state", JSON.stringify({ sendSheet: true }));
  });

  it("an upload whose file did not survive a reload: back to Coaching to choose again", async () => {
    renderPage({ start: "file" });
    expect(await screen.findByTestId("where")).toHaveAttribute("data-state", JSON.stringify({ sendSheet: true }));
  });

  it("the choice is taken once: Back to this page later finds nothing that would start a recording", async () => {
    await recording();
    expect(screen.getByTestId("history-state")).toHaveTextContent("null");
  });
});

describe("recording", () => {
  it("asks for the microphone, keeps the screen on, and shows the live chip, the clock and the bars", async () => {
    await recording();
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(keepScreenOn).toHaveBeenCalled();
    const live = screen.getByText("Recording").closest("[data-chip]")!;
    expect(live.className).toMatch(/bg-nu-record-bg/);
    expect(live.querySelector("[data-dot]")).not.toBeNull();
    expect(screen.getByTestId("record-clock")).toHaveTextContent("38:24");
    expect(screen.getByTestId("record-level-bars")).toBeInTheDocument();
  });

  it("a Lesson plans row says the recording continues, and opens the lesson plans", async () => {
    await recording();
    const row = screen.getByTestId("record-lesson-plans");
    expect(row).toHaveAttribute("href", "/portal/curriculum");
    expect(chipText(row)).toEqual(["Recording continues"]);
    expect(within(row).getByText("Recording continues").closest("[data-chip]")!.className).toMatch(/bg-nu-record-bg/);
  });

  it("Finish is the green button and Pause the outline under it", async () => {
    await recording();
    const actions = screen.getByTestId("newui-bottom-actions");
    const [finish, pause] = within(actions).getAllByRole("button");
    expect(finish).toHaveTextContent("Finish");
    expect(finish.className).toMatch(/(^|\s)bg-nu-button(\s|$)/);
    expect(pause).toHaveTextContent("Pause");
    expect(pause.className).toMatch(/bg-nu-button-secondary/);
  });

  it("Pause: the amber Paused chip, and Continue resumes", async () => {
    await recording();
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    expect(recorder.pause).toHaveBeenCalled();
    expect(screen.getByText("Paused").closest("[data-chip]")!.className).toMatch(/bg-nu-chip-warning-bg/);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(recorder.resume).toHaveBeenCalled();
    expect(await screen.findByText("Recording")).toBeInTheDocument();
  });

  it("Finish asks first; Keep recording keeps it going", async () => {
    await recording();
    fireEvent.click(screen.getByRole("button", { name: "Finish" }));
    const sheet = await screen.findByRole("dialog", { name: "Finish recording" });
    expect(chipText(sheet)).toEqual(["38 min"]);
    // bd-fmf24g.41: the kit's ConfirmTray — Yes, finish over Keep recording, both full width and 56px, stacked with a gap.
    const box = within(sheet).getByTestId("confirm-tray-actions");
    expect(box.className.split(/\s+/)).toEqual(expect.arrayContaining(["flex", "flex-col", "gap-3"]));
    const actions = within(box).getAllByRole("button");
    expect(actions.map((b) => b.textContent)).toEqual(["Yes, finish", "Keep recording"]);
    for (const b of actions) {
      expect(b.className.split(/\s+/)).toEqual(expect.arrayContaining(["w-full", "min-h-[56px]"]));
      expect(b.className.split(/\s+/)).not.toContain("flex-1");
    }
    fireEvent.click(within(sheet).getByRole("button", { name: "Keep recording" }));
    expect(recorder.stop).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("a recording under 10 minutes says Short lesson in the finish sheet", async () => {
    recorder.elapsedMs.mockReturnValue(5 * 60_000);
    await recording();
    fireEvent.click(screen.getByRole("button", { name: "Finish" }));
    const sheet = await screen.findByRole("dialog", { name: "Finish recording" });
    // The kit's waiting tone (amber), as every recording's finish sheet draws it (bd-fmf24g.41).
    expect(chipText(sheet)).toEqual(["5 min", "Short lesson"]);
    expect(within(sheet).getByText("Short lesson").closest("[data-chip]")!.className).toMatch(/bg-\[#fef3c7\]/);
  });

  it("the screen going off while recording is said, in amber", async () => {
    await recording();
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    expect((await screen.findByText("Screen went off")).closest("[data-chip]")!.className).toMatch(/bg-nu-chip-warning-bg/);
  });

  it("Back leaves the page and the lesson keeps recording (bd-5rz1v.10)", async () => {
    renderPage(null, { entries: ["/portal/curriculum", { pathname: "/portal/coaching/new", state: { start: "record" } }] });
    await screen.findByTestId("record-clock");
    fireEvent.click(within(bar()).getByRole("button", { name: "Back" }));
    expect(await screen.findByTestId("where")).toHaveTextContent("/portal/curriculum");
    expect(recorder.stop).not.toHaveBeenCalled();
    expect(screen.getByTestId("session-on")).toHaveTextContent("true");
  });

  it("the microphone refused: where to allow it, Try again, and Upload recording", async () => {
    getUserMedia.mockRejectedValue(Object.assign(new Error("denied"), { name: "NotAllowedError" }));
    renderPage({ start: "record" });
    expect(await screen.findByText("Microphone blocked")).toBeInTheDocument();
    expect(screen.getByText("Lock › Microphone › Allow")).toBeInTheDocument();
    getUserMedia.mockResolvedValue({ getTracks: () => [] });
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByTestId("record-clock")).toBeInTheDocument();
  });

  it("the microphone refused: Upload recording takes a file instead", async () => {
    getUserMedia.mockRejectedValue(new Error("denied"));
    renderPage({ start: "record" });
    await screen.findByText("Microphone blocked");
    fireEvent.change(screen.getByTestId("audio-input"), { target: { files: [file("lesson.mp3")] } });
    expect(await screen.findByRole("button", { name: "Send to Digital Coach" })).toBeInTheDocument();
    expect(screen.getByText("lesson.mp3")).toBeInTheDocument();
  });
});

describe("check and send — her recording", () => {
  it("a recording made here: Your recording, its minutes, Just now", async () => {
    await toCheck();
    expect(within(bar()).getByRole("heading", { level: 1 })).toHaveTextContent("Check and send");
    const row = screen.getByTestId("check-recording");
    expect(row).toHaveTextContent("Your recording");
    expect(chipText(row)).toEqual(["38 min", "Just now"]);
  });

  it("a file: its name, minutes and size; Change file keeps it unless she picks a recording", async () => {
    await withFile();
    const row = screen.getByTestId("check-recording");
    expect(row).toHaveTextContent("Period 3.m4a");
    expect(chipText(row)).toEqual(["30 min", "22.9 MB"]);
    fireEvent.click(screen.getByRole("button", { name: "Change file" }));
    fireEvent.change(screen.getByTestId("audio-input"), { target: { files: [file("notes.pdf")] } });
    expect(await screen.findByText("Not a recording")).toBeInTheDocument();
    expect(screen.getByTestId("check-recording")).toHaveTextContent("Period 3.m4a");
  });

  it("a short recording says so, and can still be sent", async () => {
    vi.mocked(latestUnsent).mockResolvedValue(null);
    recorder.stop.mockResolvedValue({ blob: new Blob(["r"]), durationMs: 4 * 60_000, type: { mimeType: "audio/webm", ext: ".webm" }, id: "rec-1" });
    await toCheck();
    expect(chipText(screen.getByTestId("check-recording"))).toContain("Short lesson");
    expect(screen.getByRole("button", { name: "Send to Digital Coach" })).not.toBeDisabled();
  });

  it("Record again deletes the recording and goes back to Coaching's sheet", async () => {
    await toCheck();
    fireEvent.click(screen.getByRole("button", { name: "Record again" }));
    expect(await screen.findByTestId("where")).toHaveAttribute("data-state", JSON.stringify({ sendSheet: true }));
    expect(deleteRecording).toHaveBeenCalledWith("rec-1");
  });

  it("Continue (resume): the recording left on the phone, deleted from it once sent", async () => {
    vi.mocked(latestUnsent).mockResolvedValue({
      meta: { id: "rec-old", mimeType: "audio/webm", ext: ".webm", startedAt: "2026-10-02T03:00:00Z", elapsedMs: 31 * 60_000, finished: false },
      blob: new Blob(["old"], { type: "audio/webm" }),
    });
    renderPage({ start: "resume" });
    await screen.findByRole("button", { name: "Send to Digital Coach" });
    expect(chipText(screen.getByTestId("check-recording"))).toEqual(["31 min", "2 Oct"]);
    fireEvent.click(screen.getByRole("button", { name: "Send to Digital Coach" }));
    await screen.findByText("Sent");
    expect(deleteRecording).toHaveBeenCalledWith("rec-old");
  });

  it("Continue with nothing left on the phone goes back to Coaching", async () => {
    renderPage({ start: "resume" });
    expect(await screen.findByTestId("where")).toHaveAttribute("data-state", JSON.stringify({ sendSheet: true }));
  });
});

describe("check and send — the lesson plan", () => {
  it("Recent lesson plans first (GET /lesson-plans/recent), then the library, a photo, a file", async () => {
    await toCheck();
    const sheet = await openPlanSheet();
    expect(http.get).toHaveBeenCalledWith("/lesson-plans/recent", { params: { limit: 3 } });
    const recent = await within(sheet).findByRole("list", { name: "Recent lesson plans" });
    expect(within(recent).getAllByRole("button").map((b) => b.textContent)).toEqual([
      expect.stringContaining("Leaves make food"), expect.stringContaining("Photosynthesis"),
    ]);
    expect(within(sheet).getByRole("button", { name: "From the library" })).toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: "Take a photo" })).toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: "Choose a file" })).toBeInTheDocument();
  });

  it("one tap picks a recent plan, and it is sent as the plan she taught (grades 1-5)", async () => {
    await toCheck();
    const sheet = await openPlanSheet();
    fireEvent.click(await within(sheet).findByRole("button", { name: /Leaves make food/ }));
    const row = screen.getByTestId("check-plan");
    expect(row).toHaveTextContent("Leaves make food");
    expect(chipText(row)).toEqual(["Grade 4", "Science", "Day 3"]);
    fireEvent.click(screen.getByRole("button", { name: "Send to Digital Coach" }));
    await screen.findByText("Sent");
    expect(api.startCoachingUpload.mock.calls[0][0]).toMatchObject({ lessonPlan: { lessonId: "g4-sci-ch2-seg3" } });
  });

  it("a grades 6-12 recent plan goes in its own language", async () => {
    await toCheck();
    const sheet = await openPlanSheet();
    fireEvent.click(await within(sheet).findByRole("button", { name: /Photosynthesis/ }));
    fireEvent.click(screen.getByRole("button", { name: "Send to Digital Coach" }));
    await screen.findByText("Sent");
    expect(api.startCoachingUpload.mock.calls[0][0]).toMatchObject({ lessonPlan: { segmentId: "g7-sci.c02.p010", lang: "ur" } });
  });

  it("no recent plans (or the list fails): the sheet still offers the library, a photo and a file", async () => {
    http.get.mockRejectedValue(new Error("down"));
    await toCheck();
    const sheet = await openPlanSheet();
    expect(within(sheet).getByRole("button", { name: "From the library" })).toBeInTheDocument();
    expect(within(sheet).queryByRole("list", { name: "Recent lesson plans" })).toBeNull();
  });

  it("the library, one step at a time: grade, subject, chapter, lesson; Back steps up", async () => {
    api.getLibraryLessons.mockResolvedValue([
      { id: "g4-sst-ch3-seg1", label: "Pakistan on the map", sub: "Day 1", ready: true, used: false },
      { id: "g4-sst-ch3-seg2", label: "Provinces of Pakistan", sub: "Day 2", ready: true, used: true },
    ]);
    await toCheck();
    const sheet = await openPlanSheet();
    fireEvent.click(within(sheet).getByRole("button", { name: "From the library" }));
    expect(within(bar()).getByRole("heading", { level: 1 })).toHaveTextContent("Grade");
    await screen.findByRole("radio", { name: "4" });
    // One heading says the step: the bar's (a label over the grid repeated it, seen on sandbox).
    expect(screen.getAllByRole("heading", { name: /^grade$/i })).toHaveLength(1);
    fireEvent.click(await screen.findByRole("radio", { name: "4" }));
    fireEvent.click(await screen.findByRole("button", { name: "Social Studies" }));
    expect(within(bar()).getByRole("heading", { level: 1 })).toHaveTextContent("Chapter");
    expect(within(bar()).getByTestId("newui-crumb")).toHaveTextContent("Coaching · Grade 4 · Social Studies");
    // Back steps up, not out
    fireEvent.click(within(bar()).getByRole("button", { name: "Back" }));
    expect(within(bar()).getByRole("heading", { level: 1 })).toHaveTextContent("Subject");
    fireEvent.click(await screen.findByRole("button", { name: "Social Studies" }));
    fireEvent.click(await screen.findByRole("button", { name: "Chapter 3: Our provinces" }));
    const lesson = await screen.findByRole("button", { name: /Provinces of Pakistan/ });
    expect(chipText(lesson)).toEqual(["Day 2", "Used"]);
    fireEvent.click(lesson);
    expect(await screen.findByTestId("check-plan")).toHaveTextContent("Provinces of Pakistan");
    fireEvent.click(screen.getByRole("button", { name: "Send to Digital Coach" }));
    await screen.findByText("Sent");
    expect(api.getLibrarySubjects).toHaveBeenCalledWith(4, "k5");
    expect(api.startCoachingUpload.mock.calls[0][0]).toMatchObject({ lessonPlan: { lessonId: "g4-sst-ch3-seg2" } });
  });

  it("a grades 6-12 lesson not written yet is got ready, then picked", async () => {
    api.getLibraryLessons.mockResolvedValue([{ id: "g7-sci-ch2-s3", label: "Photosynthesis", sub: null, ready: false, used: false }]);
    api.requestLibraryLesson.mockResolvedValue({ state: "ready", renderId: "r1" });
    await toCheck();
    fireEvent.click(within(await openPlanSheet()).getByRole("button", { name: "From the library" }));
    fireEvent.click(await screen.findByRole("radio", { name: "7" }));
    fireEvent.click(await screen.findByRole("button", { name: "Social Studies" }));
    fireEvent.click(await screen.findByRole("button", { name: "Chapter 3: Our provinces" }));
    const lesson = await screen.findByRole("button", { name: /Photosynthesis/ });
    expect(chipText(lesson)).toEqual(["Not written"]);
    fireEvent.click(lesson);
    expect(api.requestLibraryLesson).toHaveBeenCalledWith("g7-sci-ch2-s3");
    fireEvent.click(await screen.findByRole("button", { name: "Send to Digital Coach" }));
    await screen.findByText("Sent");
    expect(api.startCoachingUpload.mock.calls[0][0]).toMatchObject({ lessonPlan: { segmentId: "g7-sci-ch2-s3", lang: "en" } });
  });

  it("a photo of her plan: the back camera (accept exactly image/*), sent as her lesson plan", async () => {
    await toCheck();
    const sheet = await openPlanSheet();
    const photo = within(sheet).getByTestId("plan-photo-input");
    expect(photo).toHaveAttribute("accept", "image/*");
    expect(photo).toHaveAttribute("capture", "environment");
    fireEvent.change(photo, { target: { files: [file("plan.jpg")] } });
    const row = await screen.findByTestId("check-plan");
    expect(chipText(row)).toEqual(["Photo"]);
    fireEvent.click(screen.getByRole("button", { name: "Send to Digital Coach" }));
    await screen.findByText("Sent");
    expect(api.presignCoachingUpload.mock.calls.map((c) => c[0].kind)).toEqual(["audio", "lesson_plan"]);
  });

  it("a file that is not a lesson plan is refused, in words not a sentence", async () => {
    await toCheck();
    const sheet = await openPlanSheet();
    fireEvent.change(within(sheet).getByTestId("plan-file-input"), { target: { files: [file("song.mp3")] } });
    expect(await within(sheet).findByText("Not a lesson plan")).toBeInTheDocument();
  });
});

describe("check and send — board photos", () => {
  it("takes up to 3, each removable, and refuses a fourth", async () => {
    await toCheck();
    const input = screen.getByTestId("photos-input");
    fireEvent.change(input, { target: { files: [file("a.jpg"), file("b.png")] } });
    expect(await screen.findByRole("button", { name: "Remove a.jpg" })).toBeInTheDocument();
    expect(screen.getByTestId("check-photos")).toHaveTextContent("2/3");
    fireEvent.click(screen.getByRole("button", { name: "Remove a.jpg" }));
    expect(screen.queryByRole("button", { name: "Remove a.jpg" })).toBeNull();
    fireEvent.change(input, { target: { files: [file("c.jpg"), file("d.jpg"), file("e.jpg")] } });
    expect(await screen.findByText("Up to 3")).toBeInTheDocument();
    fireEvent.change(input, { target: { files: [file("notes.pdf")] } });
    expect(await screen.findByText("Not a photo")).toBeInTheDocument();
  });
});

describe("sending, and after", () => {
  it("sends with no menu and a ring; then Sent, and Open lesson replaces this page", async () => {
    let finishUpload: () => void = () => {};
    api.uploadToR2.mockImplementation((_u: string, _b: Blob, _t: string, onProgress?: (n: number) => void) => new Promise<void>((resolve) => {
      onProgress?.(1);
      finishUpload = resolve;
    }));
    await toCheck();
    fireEvent.click(screen.getByRole("button", { name: "Send to Digital Coach" }));
    expect(await screen.findByText("Sending")).toBeInTheDocument();
    expect(screen.getByTestId("layout")).toHaveAttribute("data-bare", "yes");
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    await act(async () => { finishUpload(); });
    expect(await screen.findByText("Sent")).toBeInTheDocument();
    expect(screen.getByTestId("layout")).toHaveAttribute("data-bare", "no");
    expect(deleteRecording).toHaveBeenCalledWith("rec-1");
    fireEvent.click(screen.getByRole("button", { name: "Open lesson" }));
    expect(await screen.findByTestId("where")).toHaveTextContent("/portal/coaching/session/cs-9");
  });

  it("the internet stopped: Saved on phone, and Try again sends again", async () => {
    api.uploadToR2.mockRejectedValueOnce(new Error("network"));
    await toCheck();
    fireEvent.click(screen.getByRole("button", { name: "Send to Digital Coach" }));
    expect(await screen.findByText("No internet")).toBeInTheDocument();
    expect(screen.getByText("Saved on phone")).toBeInTheDocument();
    expect(deleteRecording).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Sent")).toBeInTheDocument();
  });

  it("the plan could not be used: Change lesson plan, back at Check and send with the plan sheet open", async () => {
    api.startCoachingUpload.mockRejectedValueOnce({ response: { status: 400, data: { reason: "plan_not_ready" } } });
    await toCheck();
    fireEvent.click(await openPlanSheet().then((s) => within(s).findByRole("button", { name: /Leaves make food/ })));
    fireEvent.click(screen.getByRole("button", { name: "Send to Digital Coach" }));
    expect(await screen.findByText("Lesson plan not used")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Change lesson plan" }));
    expect(await screen.findByRole("dialog", { name: "Lesson plan" })).toBeInTheDocument();
    expect(screen.getByTestId("check-plan")).not.toHaveTextContent("Leaves make food");
  });

  it("another lesson still being analysed: says so and opens it", async () => {
    api.startCoachingUpload.mockRejectedValue({ response: { status: 409, data: { status: "in_progress", coachingSessionId: "cs-1" } } });
    await toCheck();
    fireEvent.click(screen.getByRole("button", { name: "Send to Digital Coach" }));
    expect(await screen.findByText("Another lesson analysing")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open that lesson" })).toHaveAttribute("href", "/portal/coaching/session/cs-1");
  });
});

describe("the rules", () => {
  it("every target is 56px: recording, the finish sheet, check and send, the plan sheet", async () => {
    await recording();
    expect(tapProblems(document.body)).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Finish" }));
    const sheet = await screen.findByRole("dialog", { name: "Finish recording" });
    expect(tapProblems(document.body)).toEqual([]);
    fireEvent.click(within(sheet).getByRole("button", { name: "Yes, finish" }));
    await screen.findByRole("button", { name: "Send to Digital Coach" });
    expect(tapProblems(document.body)).toEqual([]);
    await openPlanSheet();
    await waitFor(() => expect(screen.getAllByRole("button", { name: /Leaves make food/ }).length).toBeGreaterThan(0));
    expect(tapProblems(document.body)).toEqual([]);
  });
});
