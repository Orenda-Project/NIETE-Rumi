import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import i18n from "i18next";
import { MemoryRouter, Route, Routes } from "react-router-dom";

/**
 * bd-q261rec (queue #261) — the line dropped while her observation went up IN PIECES. Before: "Couldn't send" and Try
 * again started from zero. Now the send waits and goes on by itself from the next piece; the Sending page says so —
 * "Weak internet", how many pieces arrived, when it tries again — with Try now, which ends the wait at once.
 */

vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: any) => <div>{children}</div> }));
vi.mock("../CoachGate", () => ({ default: ({ children }: any) => <>{children}</> }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: () => ({ user: { firstName: "Rifat", role: "coach", phoneNumber: "923001234567" }, loading: false }) }));
vi.mock("../../services/api", () => ({ coach: { getHome: vi.fn() }, leader: {}, portal: {} }));
vi.mock("../../lib/coachObserve", async (orig) => ({ ...(await orig<typeof import("../../lib/coachObserve")>()), sendObservation: vi.fn() }));
vi.mock("../../lib/recordingStore", () => ({ deleteRecording: vi.fn(async () => {}), latestUnsent: vi.fn(async () => null) }));
vi.mock("../../lib/pieceUpload", async (orig) => ({ ...(await orig<typeof import("../../lib/pieceUpload")>()), wakePieces: vi.fn() }));

import { sendObservation } from "../../lib/coachObserve";
import { wakePieces } from "../../lib/pieceUpload";
import { getJob, resetSender, startSend } from "./sender";
import { OBSERVE_COPY, OBSERVE_COPY_UR } from "./copy";
import CoachSending from "../pages/CoachSending";

const VISIT = "0d8a6d1c-1111-4c1c-9a1a-000000000009";
const args = {
  visitId: VISIT, teacherExtId: "923001110001", schoolExtId: "niete:1", teacherName: "Ayesha Bibi", visitDay: "2026-11-26",
  durationMs: 38 * 60_000, recordingId: null, audio: { blob: new Blob(["x"], { type: "audio/mp4" }), filename: "obs.m4a" },
  plan: null, photos: [] as File[],
};

let finish: (v: { coachingSessionId: string }) => void;
let hooks: { onWait?: (w: unknown) => void } = {};

beforeEach(async () => {
  vi.clearAllMocks();
  resetSender();
  if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} });
  await act(async () => { await i18n.changeLanguage("en"); });
  (sendObservation as any).mockImplementation((a: any, _api: unknown, _up: unknown, onProgress: (p: number) => void) => {
    hooks = a;
    onProgress(40);
    return new Promise((r) => { finish = r; });
  });
});

const page = () => render(
  <MemoryRouter initialEntries={[`/portal/coach/visit/${VISIT}/sending`]}>
    <Routes><Route path="/portal/coach/visit/:id/sending" element={<CoachSending />} /></Routes>
  </MemoryRouter>,
);

describe("the sender keeps the wait on the job", () => {
  it("a wait is on the job (pieces sent, when it tries again); the next progress clears it", async () => {
    startSend(args);
    await act(async () => { await Promise.resolve(); });
    expect(hooks.onWait).toBeTypeOf("function");
    act(() => { hooks.onWait!({ ms: 20_000, attempt: 2, sent: 12, pieces: 30, sentBytes: 1, online: false }); });
    const job = getJob(VISIT)!;
    expect(job.state).toBe("sending");
    expect(job.wait).toMatchObject({ sent: 12, pieces: 30 });
    expect(job.wait!.until).toBeGreaterThan(Date.now() + 15_000);
    act(() => { finish({ coachingSessionId: "cs-1" }); });
    await act(async () => { await Promise.resolve(); });
    expect(getJob(VISIT)!.wait ?? null).toBeNull();
  });
});

describe("the Sending page while it waits", () => {
  it("says Weak internet, how many pieces arrived, and Try now ends the wait", async () => {
    startSend(args);
    await act(async () => { await Promise.resolve(); });
    act(() => { hooks.onWait!({ ms: 20_000, attempt: 2, sent: 12, pieces: 30, sentBytes: 1, online: true }); });
    page();
    expect(screen.getByTestId("send-state")).toHaveTextContent(OBSERVE_COPY.weakLine);
    expect(screen.getByText(OBSERVE_COPY.piecesSent(12, 30))).toBeInTheDocument();
    expect(screen.getByTestId("send-retry-in").textContent).toMatch(/0:(19|20)/);
    fireEvent.click(screen.getByRole("button", { name: OBSERVE_COPY.tryNow }));
    expect(wakePieces).toHaveBeenCalledTimes(1);
  });

  it("not waiting: Sending, no Try now", async () => {
    startSend(args);
    await act(async () => { await Promise.resolve(); });
    page();
    expect(screen.getByTestId("send-state")).toHaveTextContent(OBSERVE_COPY.sending);
    expect(screen.queryByRole("button", { name: OBSERVE_COPY.tryNow })).toBeNull();
  });

  it("the words are in Urdu too", () => {
    expect(OBSERVE_COPY_UR.weakLine).toBeTruthy();
    expect(OBSERVE_COPY_UR.tryNow).toBeTruthy();
    expect(OBSERVE_COPY_UR.piecesSent(12, 30)).toContain("12");
    expect(OBSERVE_COPY_UR.retryIn("0:20")).toContain("0:20");
  });
});
