import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

/**
 * bd-v0toag.31.4 — live moves on the teacher app's real record screen. Teacher v2 records on the one screen
 * (NewObservation); bd-v0toag.31.3 wired only the send page, which nothing opens, so Amena recorded on staging as group D
 * with a library plan and saw no moves. Here, with a library plan chosen, the moves list shows while she records, and
 * Submit sends her ticks and taps with the lesson.
 */

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
const session = vi.hoisted(() => ({
  active: true, paused: false, stream: null, screenWentOff: false, recordingId: "rec-1" as string | null, returnTo: null,
  elapsedMs: () => 0, start: vi.fn(async () => "recording"), pause: vi.fn(), resume: vi.fn(),
  finish: vi.fn(), askBeforeLogout: vi.fn(), setChunkListener: vi.fn(),
}));
vi.mock("../../lib/recordingSession", () => ({ useRecordingSession: () => session, useRecordingClock: () => 0 }));
const live = vi.hoisted(() => ({ liveCard: vi.fn(), liveKey: vi.fn(), liveDetect: vi.fn(), liveEnd: vi.fn() }));
vi.mock("../../services/api", () => ({ default: { get: vi.fn(async () => ({ data: {} })), post: vi.fn() }, portal: live }));
vi.mock("../../lib/live/sonioxTee", () => ({
  createSonioxTee: () => ({ push: vi.fn(), windowText: () => "", status: () => "live", stats: () => ({ drops: 0, bytesSent: 0 }), close: vi.fn() }),
}));
const sendLesson = vi.hoisted(() => vi.fn(async (..._a: unknown[]) => ({ coachingSessionId: "sess-1" })));
vi.mock("../../lib/coachingSend", async (orig) => ({ ...(await orig<typeof import("../../lib/coachingSend")>()), sendLesson }));
vi.mock("../../lib/recordingStore", () => ({
  latestUnsent: vi.fn(async () => null),
  deleteRecording: vi.fn().mockResolvedValue(undefined),
  createRecording: vi.fn(), appendChunk: vi.fn(), markFinished: vi.fn(),
}));

import "../routes";
import { NewObservationPage } from "./NewObservation";
import { clearDraft, holdDraft } from "./draft";
import { forgetLiveHold } from "../../newui/coaching/useLiveMoves";
import { COACHING_NEW } from "./paths";
import { COACHING_V2_COPY as C } from "./copy";

const CLS = { grade: 1, subject: "English", subjectKey: null };
const PLAN = { kind: "library" as const, pick: { lessonId: "grade_1_english_ch5_seg2" }, title: "Ch 5 Day 2", chips: [] };
const CARD = {
  lessonId: "grade_1_english_ch5_seg2", stamp: "s1",
  sections: [{ sec: "open", minutes: 5, moves: [{ idx: 0, covers: ["m1"], chip: "HOOK", do: "Show a picture", say: "What is this?" }] }],
};

/** She is recording on the one screen (the recording bar's Return), with her class and this plan chosen. */
function recording(plan: typeof PLAN | null = PLAN) {
  holdDraft({ audio: null, plan, photos: [], cls: CLS });
  return render(
    <MemoryRouter initialEntries={[{ pathname: COACHING_NEW, state: { keep: true } }]}>
      <Routes><Route path={COACHING_NEW} element={<NewObservationPage />} /></Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  clearDraft();
  forgetLiveHold();
  session.active = true;
  session.recordingId = "rec-1";
  session.finish.mockImplementation(async () => {
    session.active = false;
    session.recordingId = null;
    return { blob: new Blob(["rec"], { type: "audio/webm" }), durationMs: 1_800_000, type: { mimeType: "audio/webm", ext: ".webm" }, id: "rec-1" };
  });
  live.liveCard.mockResolvedValue({ on: true, card: CARD });
  live.liveKey.mockResolvedValue({ ok: false, reason: "off" });
  live.liveDetect.mockResolvedValue({ ticked: [] });
  live.liveEnd.mockResolvedValue({ ok: true });
});

describe("the one screen: live moves while she records", () => {
  it("a library plan and a card → the moves list shows while she records", async () => {
    recording();
    expect(await screen.findByTestId("live-moves")).toBeTruthy();
    expect(live.liveCard).toHaveBeenCalledWith("grade_1_english_ch5_seg2");
    expect(session.setChunkListener).toHaveBeenCalledWith(expect.any(Function));
  });

  it("no card (not group D, or switched off) → no moves list, recording as today", async () => {
    live.liveCard.mockResolvedValue({ on: false });
    recording();
    await waitFor(() => expect(live.liveCard).toHaveBeenCalled());
    expect(screen.queryByTestId("live-moves")).toBeNull();
    expect(screen.getByRole("button", { name: C.stop })).toBeTruthy();
  });

  it("no plan → no card asked for", async () => {
    recording(null);
    await screen.findByRole("button", { name: C.stop });
    expect(live.liveCard).not.toHaveBeenCalled();
  });

  it("her tap goes with Submit", async () => {
    recording();
    fireEvent.click(await screen.findByTestId("live-move-0"));
    fireEvent.click(screen.getByRole("button", { name: "I did this" }));
    fireEvent.click(screen.getByRole("button", { name: C.stop }));
    const sheet = await screen.findByRole("dialog", { name: C.finishTitle });
    fireEvent.click(within(sheet).getByRole("button", { name: C.yesFinish }));
    await waitFor(() => expect(live.liveEnd).toHaveBeenCalled());
    fireEvent.click(await screen.findByRole("button", { name: C.submit }));
    await waitFor(() => expect(sendLesson).toHaveBeenCalled());
    const [payload] = sendLesson.mock.calls[0] as unknown as [{ liveMoves: { lessonId: string; liveId: string; taps: unknown[] } | null }];
    expect(payload.liveMoves).toMatchObject({ lessonId: "grade_1_english_ch5_seg2", liveId: "rec-1" });
    expect(payload.liveMoves?.taps).toEqual([expect.objectContaining({ idx: 0, choice: "did" })]);
  });

  it("a file she uploads (no recording here) → Submit sends no live record", async () => {
    session.active = false;
    session.recordingId = null;
    holdDraft({
      audio: { blob: new Blob(["a"]), filename: "l.m4a", durationMs: 1_800_000, recordingId: null, source: "file", size: 1, startedAt: null },
      plan: PLAN, photos: [], cls: CLS,
    });
    render(
      <MemoryRouter initialEntries={[{ pathname: COACHING_NEW, state: { keep: true } }]}>
        <Routes><Route path={COACHING_NEW} element={<NewObservationPage />} /></Routes>
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole("button", { name: C.submit }));
    await waitFor(() => expect(sendLesson).toHaveBeenCalled());
    expect((sendLesson.mock.calls[0] as unknown as [{ liveMoves: unknown }])[0].liveMoves ?? null).toBeNull();
    expect(live.liveCard).not.toHaveBeenCalled();
  });
});
