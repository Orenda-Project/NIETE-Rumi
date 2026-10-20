import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

/**
 * bd-v0toag.31.3 — live moves on the teacher app's own recording page. Amena recorded on staging as group D with a
 * library plan chosen and saw no moves: this page never asked for the card. Here, with a library plan held, the moves
 * list shows while she records; at Stop her ticks and taps go into the draft, and Submit sends them with the lesson.
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
vi.mock("../../services/api", () => ({ default: { get: vi.fn(), post: vi.fn() }, portal: live }));
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
import { SendPage } from "./SendPage";
import { clearDraft, holdDraft, peekDraft } from "./draft";
import { forgetLiveHold } from "../../newui/coaching/useLiveMoves";
import { COACHING_NEW, COACHING_SEND } from "./paths";
import { COACHING_V2_COPY as C } from "./copy";

const PLAN = { kind: "library" as const, pick: { lessonId: "grade_1_english_ch5_seg2" }, title: "Ch 5 Day 2", chips: [] };
const CARD = {
  lessonId: "grade_1_english_ch5_seg2", stamp: "s1",
  sections: [{ sec: "open", minutes: 5, moves: [{ idx: 0, covers: ["m1"], chip: "HOOK", do: "Show a picture", say: "What is this?" }] }],
};

function Where() {
  return <div data-testid="where">{useLocation().pathname}</div>;
}
function at(state?: unknown) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: COACHING_SEND, state }]}>
      <Routes>
        <Route path={COACHING_SEND} element={<><SendPage /><Where /></>} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  clearDraft();
  forgetLiveHold();
  session.active = true;
  session.recordingId = "rec-1";
  session.finish.mockResolvedValue({ blob: new Blob(["rec"], { type: "audio/webm" }), durationMs: 60_000, type: { mimeType: "audio/webm", ext: ".webm" }, id: "rec-1" });
  live.liveCard.mockResolvedValue({ on: true, card: CARD });
  live.liveKey.mockResolvedValue({ ok: false, reason: "off" });
  live.liveDetect.mockResolvedValue({ ticked: [] });
  live.liveEnd.mockResolvedValue({ ok: true });
});

async function stop() {
  fireEvent.click(screen.getByRole("button", { name: C.stop }));
  const sheet = await screen.findByRole("dialog", { name: C.finishTitle });
  fireEvent.click(within(sheet).getByRole("button", { name: C.yesFinish }));
  await waitFor(() => expect(screen.getByTestId("where").textContent).toBe(COACHING_NEW));
}

describe("teacher app recording page: live moves", () => {
  it("a library plan and a card → the moves list shows while she records", async () => {
    holdDraft({ audio: null, plan: PLAN, photos: [] });
    at();
    expect(await screen.findByTestId("live-moves")).toBeTruthy();
    expect(live.liveCard).toHaveBeenCalledWith("grade_1_english_ch5_seg2");
  });

  it("no card → no moves list, the page as today", async () => {
    live.liveCard.mockResolvedValue({ on: false });
    holdDraft({ audio: null, plan: PLAN, photos: [] });
    at();
    await waitFor(() => expect(live.liveCard).toHaveBeenCalled());
    expect(screen.queryByTestId("live-moves")).toBeNull();
    expect(screen.getByRole("button", { name: C.stop })).toBeTruthy();
  });

  it("no plan → no card asked for", async () => {
    at();
    await screen.findByRole("button", { name: C.stop });
    expect(live.liveCard).not.toHaveBeenCalled();
  });

  it("her tap goes into the draft at Stop, and Submit sends it with the lesson", async () => {
    holdDraft({ audio: null, plan: PLAN, photos: [] });
    const first = at();
    fireEvent.click(await screen.findByTestId("live-move-0"));
    fireEvent.click(screen.getByRole("button", { name: "I did this" }));
    await stop();
    expect(peekDraft()?.live).toMatchObject({ lessonId: "grade_1_english_ch5_seg2", liveId: "rec-1" });
    first.unmount();

    session.active = false;
    session.recordingId = null;
    at({ start: "submit" });
    await waitFor(() => expect(sendLesson).toHaveBeenCalled());
    const [payload] = sendLesson.mock.calls[0] as unknown as [{ liveMoves: { taps: unknown[] } | null }];
    expect(payload.liveMoves?.taps).toEqual([expect.objectContaining({ idx: 0, choice: "did" })]);
  });

  it("nothing live held → Submit sends no live record", async () => {
    holdDraft({ audio: { blob: new Blob(["a"]), filename: "l.webm", durationMs: 60_000, recordingId: null, source: "recorded", size: 1, startedAt: null }, plan: PLAN, photos: [] });
    session.active = false;
    at({ start: "submit" });
    await waitFor(() => expect(sendLesson).toHaveBeenCalled());
    expect((sendLesson.mock.calls[0] as unknown as [{ liveMoves: unknown }])[0].liveMoves).toBeNull();
  });
});
