import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

/**
 * bd-v0toag.31 — group D (live moves): before Record she picks the lesson she is teaching from her
 * recent plans, or skips. Only when GET /live-moves/eligible says yes within 1.5 s; otherwise, and
 * for everyone else, Record starts recording as today. The plan she picked is kept through Check
 * and send. Copied mocks from RecordPage.test.tsx (566 lines — new behaviour gets its own file).
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
    liveEligible: vi.fn(),
    liveCard: vi.fn(),
    liveKey: vi.fn(),
    liveDetect: vi.fn(),
    liveEnd: vi.fn(),
    liveTaps: vi.fn(),
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
import { latestUnsent } from "../../lib/recordingStore";
import { takeHandedOffRecording } from "../../lib/lessonHandoff";
import { RecordingSessionProvider, useRecordingSession } from "../../lib/recordingSession";
import { resetNewUiMemory } from "../../lib/useNewUi";
import { forgetLiveHold } from "./useLiveMoves";
import PortalCoachingRecord from "../../pages/PortalCoachingRecord";

const api = portal as unknown as Record<string, ReturnType<typeof vi.fn>>;
const TEACHER = { id: "t-1", firstName: "Ayesha", role: "teacher", phoneNumber: "920000000001" };


function renderPage(state: unknown = null, { entries }: { entries?: Array<string | { pathname: string; state: unknown }> } = {}) {
  vi.mocked(useAuth).mockReturnValue({ user: TEACHER, loading: false, logout: vi.fn() } as unknown as ReturnType<typeof useAuth>);
  const all = entries ?? [{ pathname: "/portal/coaching/new", state }];
  return render(
    <MemoryRouter initialEntries={all} initialIndex={all.length - 1}>
      <RecordingSessionProvider>
        <Routes>
          <Route path="/portal/coaching/new" element={<PortalCoachingRecord />} />
        </Routes>
      </RecordingSessionProvider>
    </MemoryRouter>,
  );
}

const getUserMedia = vi.fn();

const RECENT = [
  { planKey: "k5:g4-sci-ch2-seg3", kind: "k5", lessonId: "g4-sci-ch2-seg3", found: true, title: "Leaves make food", grade: 4, subject: "Science", chapterNumber: 2, chapterTitle: "Plants", dayLabel: "Day 3", pagesLabel: null, lastUsedAt: "2026-10-02T05:00:00Z", lastOpenedAt: null, lastReceivedAt: null, open: { lane: "k5", lessonId: "g4-sci-ch2-seg3" } },
  { planKey: "g612:g7-sci.c02.p010", kind: "g612", segmentId: "g7-sci.c02.p010", lang: "ur", found: true, title: "Photosynthesis", grade: 7, subject: "Science", chapterNumber: 2, chapterTitle: null, dayLabel: null, pagesLabel: null, lastUsedAt: "2026-10-01T05:00:00Z", lastOpenedAt: null, lastReceivedAt: null, open: { lane: "g612", segmentId: "g7-sci.c02.p010", lang: "ur" } },
  { planKey: "k5:gone", kind: "k5", lessonId: "gone", found: false, title: null, grade: null, subject: null, chapterNumber: null, chapterTitle: null, dayLabel: null, pagesLabel: null, lastUsedAt: "2026-09-01T05:00:00Z", lastOpenedAt: null, lastReceivedAt: null, open: { lane: "k5", lessonId: "gone" } },
];

beforeEach(() => {
  vi.clearAllMocks();
  resetNewUiMemory();
  forgetLiveHold();
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
  api.liveEligible.mockResolvedValue({ on: true });
  api.liveCard.mockResolvedValue({ on: false });
  api.liveKey.mockResolvedValue({ ok: false, reason: "off" });
  api.liveDetect.mockResolvedValue({ ticked: [] });
  api.liveEnd.mockResolvedValue({ ok: true });
});

const CARD = {
  lessonId: "g4-sci-ch2-seg3", stamp: "s1",
  sections: [{ sec: "open", minutes: 5, moves: [{ idx: 0, covers: ["m1"], chip: "HOOK", do: "Show a leaf", say: "What is this?" }] }],
};

async function finishAndCheck() {
  fireEvent.click(screen.getByRole("button", { name: "Finish" }));
  const sheet = await screen.findByRole("dialog", { name: "Finish recording" });
  fireEvent.click(within(sheet).getByRole("button", { name: "Yes, finish" }));
  return screen.findByRole("button", { name: "Send to Digital Coach" });
}

describe("group D: pick the lesson before Record", () => {
  it("eligible teacher lands on pick, not recording", async () => {
    renderPage({ start: "record" });
    const pick = await screen.findByTestId("record-pick");
    expect(await within(pick).findByText("Leaves make food")).toBeTruthy();
    expect(within(pick).getByRole("button", { name: "Skip" })).toBeTruthy();
    expect(screen.queryByTestId("record-clock")).toBeNull();
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it("ineligible or slow eligible check → recording as today", async () => {
    api.liveEligible.mockResolvedValue({ on: false });
    const first = renderPage({ start: "record" });
    await screen.findByTestId("record-clock");
    expect(screen.queryByTestId("record-pick")).toBeNull();
    first.unmount();

    api.liveEligible.mockReturnValue(new Promise(() => {}));
    renderPage({ start: "record" });
    await screen.findByTestId("record-clock", {}, { timeout: 3000 });
    expect(screen.queryByTestId("record-pick")).toBeNull();
  });

  it("a failed eligible check → recording as today", async () => {
    api.liveEligible.mockRejectedValue(new Error("502"));
    renderPage({ start: "record" });
    await screen.findByTestId("record-clock");
  });

  it("Skip starts recording with no plan", async () => {
    renderPage({ start: "record" });
    fireEvent.click(await screen.findByRole("button", { name: "Skip" }));
    await screen.findByTestId("record-clock");
    expect(api.liveCard).not.toHaveBeenCalled();
    fireEvent.click(await finishAndCheck());
    await waitFor(() => expect(api.startCoachingUpload).toHaveBeenCalled());
    expect(api.startCoachingUpload.mock.calls[0][0].lessonPlan).toBeUndefined();
    expect(api.startCoachingUpload.mock.calls[0][0].liveMoves).toBeUndefined();
  });

  it("pick then Record keeps the plan through check (no re-ask)", async () => {
    renderPage({ start: "record" });
    const pick = await screen.findByTestId("record-pick");
    fireEvent.click(await within(pick).findByText("Leaves make food"));
    await screen.findByTestId("record-clock");
    expect(api.liveCard).toHaveBeenCalledWith("g4-sci-ch2-seg3");
    await finishAndCheck();
    expect(within(screen.getByTestId("check-plan")).getByText("Leaves make food")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Send to Digital Coach" }));
    await waitFor(() => expect(api.startCoachingUpload).toHaveBeenCalled());
    expect(api.startCoachingUpload.mock.calls[0][0]).toMatchObject({ lessonPlan: { lessonId: "g4-sci-ch2-seg3" } });
  });

  it("no card → recording stage has no moves list and no key request", async () => {
    renderPage({ start: "record" });
    fireEvent.click(await within(await screen.findByTestId("record-pick")).findByText("Leaves make food"));
    await screen.findByTestId("record-clock");
    await waitFor(() => expect(api.liveCard).toHaveBeenCalled());
    expect(screen.queryByTestId("live-moves")).toBeNull();
    expect(api.liveKey).not.toHaveBeenCalled();
  });

  it("a card → the live record goes with the lesson when she sends it", async () => {
    api.liveCard.mockResolvedValue({ on: true, card: CARD });
    renderPage({ start: "record" });
    fireEvent.click(await within(await screen.findByTestId("record-pick")).findByText("Leaves make food"));
    await screen.findByTestId("record-clock");
    await waitFor(() => expect(api.liveKey).toHaveBeenCalled());
    fireEvent.click(await finishAndCheck());
    await waitFor(() => expect(api.startCoachingUpload).toHaveBeenCalled());
    expect(api.startCoachingUpload.mock.calls[0][0].liveMoves).toMatchObject({
      lessonId: "g4-sci-ch2-seg3", liveId: "rec-1", moves: [{ idx: 0, covers: ["m1"], tickedAtMs: null }],
    });
  });

  it("a card → the moves list replaces the Lesson plans row, stays on check, and her tap goes with the lesson", async () => {
    api.liveCard.mockResolvedValue({ on: true, card: CARD });
    renderPage({ start: "record" });
    fireEvent.click(await within(await screen.findByTestId("record-pick")).findByText("Leaves make food"));
    await screen.findByTestId("live-moves");
    expect(screen.queryByTestId("record-lesson-plans")).toBeNull();
    fireEvent.click(screen.getByTestId("live-move-0"));
    fireEvent.click(screen.getByRole("button", { name: "I did this" }));
    const send = await finishAndCheck();
    expect(screen.getByTestId("live-moves")).toBeTruthy();
    fireEvent.click(send);
    await waitFor(() => expect(api.startCoachingUpload).toHaveBeenCalled());
    expect(api.startCoachingUpload.mock.calls[0][0].liveMoves.taps).toEqual([
      expect.objectContaining({ idx: 0, choice: "did", live_state: "unticked" }),
    ]);
  });
});
