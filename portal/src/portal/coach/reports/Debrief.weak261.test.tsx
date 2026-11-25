import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// bd-oe6r47 (queue #278): these tests cover the in-app recorder, so upload-only (default ON) is switched off here.
vi.mock("../observe/uploadOnly", () => ({ useUploadOnly: () => false, uploadOnlyOn: () => false }));
vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: any) => <div>{children}</div> }));
vi.mock("../CoachGate", () => ({ default: ({ children }: any) => <>{children}</> }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: () => ({ user: { firstName: "Hataf", role: "coach", phoneNumber: "923001234567" }, loading: false }) }));
vi.mock("../../services/api", () => ({
  coach: { getPending: vi.fn() },
  leader: { getObservation: vi.fn(), getTalkGuide: vi.fn(), retryTalk: vi.fn(), presignObserveUpload: vi.fn(), startTalk: vi.fn() },
  portal: { uploadToR2: vi.fn() },
}));
vi.mock("../../lib/recordingSupport", () => ({ canRecordHere: () => Promise.resolve(true) }));
vi.mock("../../lib/recordingStore", () => ({ deleteRecording: vi.fn().mockResolvedValue(undefined) }));
const recorderProps = vi.hoisted(() => ({ copy: null as any }));
vi.mock("../../components/coaching/coach/CoachRecorder", () => ({
  default: ({ label, onFinished, copy }: any) => (
    recorderProps.copy = copy,
    <div><span>{label}</span><button type="button" onClick={() => onFinished({ blob: new Blob(["x"], { type: "audio/webm" }), id: "rec-1", type: { ext: ".webm" } })}>finish recording</button></div>
  ),
}));
const talk = vi.hoisted(() => ({ choice: null as null | { onWait?: (w: unknown) => void }, onProgress: null as null | ((p: number) => void) }));
vi.mock("../../lib/coachObserve", async (orig) => ({
  ...(await orig<typeof import("../../lib/coachObserve")>()),
  sendTalk: vi.fn((_id: string, _a: unknown, _api: unknown, _up: unknown, onProgress: (p: number) => void, choice: { onWait?: (w: unknown) => void }) => {
    talk.choice = choice || null;
    talk.onProgress = onProgress;
    return new Promise(() => {});
  }),
}));
vi.mock("../../lib/pieceUpload", async (orig) => ({ ...(await orig<typeof import("../../lib/pieceUpload")>()), wakePieces: vi.fn() }));
import { leader } from "../../services/api";
import Debrief from "./Debrief";
import { wakePieces } from "../../lib/pieceUpload";
import { OBSERVE_COPY } from "../observe/copy";

/**
 * bd-q261rec (queue #261) — the debrief talk goes up in pieces too. When the line drops while it sends, the page says
 * Weak internet, how many pieces arrived and when it tries again, with Try now; the talk goes on by itself.
 */
const L = leader as any;
const GUIDE = {
  intro: "Open with what worked.",
  sections: {
    strengths: { title: "Strengths", body: "Students answered by name and felt safe to try.", say_this: "Your questions were open." },
    growth: { title: "Growth", body: "Group transitions took three minutes." },
    action: { title: "Action", body: "Try a 10-second countdown before group work." },
  },
  reflection_question: "What will you try in tomorrow's lesson?",
};
const VIEW = (step: string, extra: Record<string, unknown> = {}) => ({
  id: "cs-1", createdAt: "2026-10-06T06:30:00Z", sessionStatus: "x", step, problem: null, preparing: false, portal: true,
  teacher: { name: "Ayesha Bibi", phone: "923001110001" }, lesson: { topic: null, subject: null, hasLessonPlan: false }, draft: { edited: false },
  talk: { guide: null, recordedAt: null, feedback: null },
  report: { status: null, teacherName: "Ayesha Bibi", teacherPhone: null, caption: null, companionText: null, imageUrl: null, sentAt: null, templateSentAt: null },
  ...extra,
});

const renderPage = () => render(
  <MemoryRouter initialEntries={["/portal/coach/observation/cs-1/debrief"]}>
    <Routes>
      <Route path="/portal/coach/observation/:id/debrief" element={<Debrief />} />
      <Route path="/portal/coach/observation/:id" element={<div>observation page</div>} />
    </Routes>
  </MemoryRouter>,
);
const audio = (name = "talk.mp3") => new File(["audio"], name, { type: "audio/mpeg" });
const chooseFile = (file: File) => fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [file] } });

beforeEach(() => {
  vi.clearAllMocks();
  L.getObservation.mockResolvedValue(VIEW("talk"));
  L.getTalkGuide.mockResolvedValue({ guide: GUIDE });


});

describe("Debrief — the talk while the line is down", () => {
  it("is sent with a way to say it waits; Weak internet, pieces sent, Try now; moving again hides it", async () => {
    renderPage();
    await screen.findByTestId("talk-guide");
    chooseFile(audio());
    await waitFor(() => expect(talk.choice?.onWait).toBeTypeOf("function"));
    act(() => { talk.choice!.onWait!({ ms: 60_000, attempt: 3, sent: 4, pieces: 9, sentBytes: 1, online: false }); });
    expect(await screen.findByText(OBSERVE_COPY.weakLine)).toBeInTheDocument();
    expect(screen.getByText(OBSERVE_COPY.piecesSent(4, 9))).toBeInTheDocument();
    expect(screen.getByTestId("talk-retry-in").textContent).toMatch(/[01]:\d\d/);
    fireEvent.click(screen.getByRole("button", { name: OBSERVE_COPY.tryNow }));
    expect(wakePieces).toHaveBeenCalledTimes(1);
    act(() => { talk.onProgress!(70); });
    expect(screen.queryByText(OBSERVE_COPY.weakLine)).toBeNull();
  });
});
