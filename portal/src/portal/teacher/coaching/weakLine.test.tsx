import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import i18n from "i18next";

/**
 * bd-q261rec (queue #261) — her Digital Coaching recording goes up in pieces (portal_upload_pieces on for her). When the
 * line drops, the send waits and goes on by itself from the next piece; the Sending card says so — Weak internet, how
 * many pieces arrived, when it tries again — and Try now ends the wait at once. Before: "No internet" and Try again
 * from zero.
 */

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
const session = vi.hoisted(() => ({
  active: false, paused: false, stream: null, screenWentOff: false, recordingId: null, returnTo: null,
  elapsedMs: () => 0, start: vi.fn(async () => "recording"), pause: vi.fn(), resume: vi.fn(),
  finish: vi.fn(async () => null), askBeforeLogout: vi.fn(),
}));
vi.mock("../../lib/recordingSession", () => ({ useRecordingSession: () => session, useRecordingClock: () => 0 }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: () => ({ user: { firstName: "Ayesha", lastName: "Bibi" } }) }));
vi.mock("../../services/api", () => ({
  default: { get: vi.fn(), post: vi.fn() },
  portal: { getCoachingProgress: vi.fn(), getCoachingSession: vi.fn(), submitCoachingReflection: vi.fn() },
  language: { get: vi.fn(() => new Promise(() => {})), set: vi.fn() },
}));
const hooks = vi.hoisted(() => ({ onWait: null as null | ((w: unknown) => void), onProgress: null as null | ((p: number) => void) }));
const sendLesson = vi.hoisted(() => vi.fn((args: { onWait?: (w: unknown) => void }, _api: unknown, onProgress: (p: number) => void) => {
  hooks.onWait = args.onWait || null;
  hooks.onProgress = onProgress;
  return new Promise(() => {});
}));
vi.mock("../../lib/coachingSend", async (orig) => ({ ...(await orig<typeof import("../../lib/coachingSend")>()), sendLesson }));
vi.mock("../../lib/pieceUpload", async (orig) => ({ ...(await orig<typeof import("../../lib/pieceUpload")>()), wakePieces: vi.fn() }));
vi.mock("../../lib/recordingStore", () => ({
  latestUnsent: vi.fn(async () => null),
  deleteRecording: vi.fn().mockResolvedValue(undefined),
  createRecording: vi.fn(), appendChunk: vi.fn(), markFinished: vi.fn(),
}));
vi.mock("../../lib/coachingUpload", async (orig) => ({
  ...(await orig<typeof import("../../lib/coachingUpload")>()),
  readAudioDuration: vi.fn().mockResolvedValue(1800),
}));

import "../routes";
import api from "../../services/api";
import { wakePieces } from "../../lib/pieceUpload";
import { NewObservationPage } from "./NewObservation";
import { clearDraft, holdDraft } from "./draft";
import { COACHING_NEW } from "./paths";
import { COACHING_V2_COPY as E, COACHING_V2_COPY_UR as U } from "./copy";

const http = api as unknown as { get: ReturnType<typeof vi.fn> };

beforeEach(async () => {
  vi.clearAllMocks();
  clearDraft();
  if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} });
  await act(async () => { await i18n.changeLanguage("en"); });
  http.get.mockImplementation(async (url: string) => {
    if (url === "/me/grade-subjects") return { data: { success: true, combos: [{ grade: 4, gradeCode: "grade_4", subject: "General Science", subjectKey: "science", source: "class" }] } };
    if (url === "/lesson-plans/recent") return { data: { plans: [] } };
    throw new Error(`unexpected GET ${url}`);
  });
});

async function submitAndWait() {
  holdDraft({
    audio: { blob: new Blob(["a"]), filename: "lesson.m4a", durationMs: 1_800_000, recordingId: null, source: "file", size: 1, startedAt: null },
    plan: null, photos: [], cls: { grade: 4, subject: "General Science", subjectKey: "science" },
  });
  render(
    <MemoryRouter initialEntries={[{ pathname: COACHING_NEW }]}>
      <Routes><Route path={COACHING_NEW} element={<NewObservationPage />} /><Route path="*" element={<NewObservationPage />} /></Routes>
    </MemoryRouter>,
  );
  const submit = await screen.findByRole("button", { name: E.submit }, { timeout: 5000 });
  await act(async () => { fireEvent.click(submit); });
  act(() => { hooks.onProgress?.(40); });
}

describe("Digital Coaching: the line drops while it sends", () => {
  it("the send is told how to say it waits", async () => {
    await submitAndWait();
    expect(sendLesson).toHaveBeenCalledWith(expect.objectContaining({ onWait: expect.any(Function) }), expect.anything(), expect.any(Function));
  });

  it("Weak internet, pieces sent, the clock to the next try, and Try now ends the wait", async () => {
    await submitAndWait();
    act(() => { hooks.onWait?.({ ms: 20_000, attempt: 2, sent: 12, pieces: 30, sentBytes: 1, online: false }); });
    expect(screen.getByText(E.weakLine)).toBeTruthy();
    expect(screen.getByText(E.piecesSent(12, 30))).toBeTruthy();
    expect(screen.getByTestId("dc-retry-in").textContent).toMatch(/0:(19|20)/);
    fireEvent.click(screen.getByRole("button", { name: E.tryNow }));
    expect(wakePieces).toHaveBeenCalledTimes(1);
  });

  it("moving again: back to Sending and its percentage", async () => {
    await submitAndWait();
    act(() => { hooks.onWait?.({ ms: 20_000, attempt: 2, sent: 12, pieces: 30, sentBytes: 1, online: false }); });
    act(() => { hooks.onProgress?.(55); });
    expect(screen.queryByText(E.weakLine)).toBeNull();
    expect(screen.getByText("55%")).toBeTruthy();
  });

  it("the words are in Urdu too", () => {
    expect(U.weakLine).toBeTruthy();
    expect(U.tryNow).toBeTruthy();
    expect(U.piecesSent(12, 30)).toContain("12");
    expect(U.retryIn("0:20")).toContain("0:20");
  });
});
