import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import i18n from "i18next";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: any) => <div>{children}</div> }));
vi.mock("../CoachGate", () => ({ default: ({ children }: any) => <>{children}</> }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: () => ({ user: { firstName: "Hataf", role: "coach", phoneNumber: "923001234567" }, loading: false }) }));
vi.mock("../../services/api", () => ({
  coach: { getVisit: vi.fn(), getPending: vi.fn() },
  leader: {
    cancelSchedule: vi.fn(), getObserveRecentPlans: vi.fn(), getObserveLessonQuestion: vi.fn(),
    getObservation: vi.fn(), getTalkGuide: vi.fn(), retryTalk: vi.fn(), presignObserveUpload: vi.fn(), startTalk: vi.fn(),
  },
  portal: { uploadToR2: vi.fn() },
}));
vi.mock("../../lib/recordingSupport", () => ({
  canRecordHere: () => Promise.resolve(true),
  pickRecordingType: () => ({ mimeType: "audio/webm;codecs=opus", ext: ".webm" }),
}));
vi.mock("../../lib/keepAwake", () => ({ keepScreenOn: async () => async () => {} }));
vi.mock("fix-webm-duration", () => ({ default: vi.fn(async (blob: Blob) => blob) }));
// No network from the heartbeat in a test.
vi.mock("../../lib/recordingBeat", () => ({
  RecordingHeart: class { sample() { return {}; } saved() {} event() {} flush() { return Promise.resolve(); } dispose() { return Promise.resolve(); } },
  cutOf: () => null,
}));
// The phone's kept recordings (IndexedDB): latestUnsent honours its `accept` filter like the real store.
const kept = vi.hoisted(() => ({ list: [] as any[] }));
vi.mock("../../lib/recordingStore", () => ({
  deleteRecording: vi.fn(async () => {}),
  markFinished: vi.fn(async () => {}),
  createRecording: vi.fn(async () => {}),
  appendChunk: vi.fn(async () => {}),
  latestUnsent: vi.fn(async (accept?: (m: any) => boolean) => kept.list.find((r) => !accept || accept(r.meta)) ?? null),
}));
vi.mock("./uploadOnly", async (orig) => ({ ...(await orig<typeof import("./uploadOnly")>()), useUploadOnly: () => false }));
vi.mock("../flow/useCoachFlowV2", async (orig) => ({ ...(await orig<typeof import("../flow/useCoachFlowV2")>()), useFlowV6: () => false }));

import { coach, leader } from "../../services/api";
import { markFinished } from "../../lib/recordingStore";
import CoachRecord from "../pages/CoachRecord";
import CoachVisit from "../pages/CoachVisit";
import Debrief from "../reports/Debrief";
import { clearDraft, getDraft } from "../observeDraft";
import { rememberRecording } from "../../lib/coachObserve";

/**
 * bd-ma9jiy (queue #262) — the operator 25 Nov ~19:45, after his own WhatsApp test (swiping WhatsApp away stopped the
 * recording; its saved copy came back via "Send saved recording"): "when they open that observation again, you show them
 * the same UI that you show somebody when they pause their observation ... simulate as in the observation got paused in
 * the middle ... they can press resume and it would continue right then and there."
 *
 * So a recording this phone kept for THIS teacher opens on Record observation as the PAUSED recorder: the clock at its
 * saved length, "Paused", Resume and Stop — no microphone until Resume, and Resume continues the SAME recording (same id).
 * Stop without Resume hands the kept file to Check and send. The visit page's way back says Continue recording. A debrief
 * talk kept for this observation opens Debrief's recorder paused the same way (and is never offered as the class).
 * The real recording engine (useCoachRecording + LessonRecorder) runs here; only the phone's store and mic are fakes.
 */
const C = coach as any;
const L = leader as any;
const VISIT_ID = "0d8a6d1c-1111-4c1c-9a1a-000000000262";
const AYESHA = "923001110001";
const VISIT = {
  success: true,
  visit: { id: VISIT_ID, teacherName: "Ayesha Bibi", teacherExtId: AYESHA, schoolName: "IMSG I-10/1", schoolExtId: "niete:110", scheduledFor: "2026-11-25", scheduledSlot: "11:30", status: "upcoming", overdue: false },
  teacher: null,
  lastVisit: null,
};

const keep = (id: string, who: Parameters<typeof rememberRecording>[1], elapsedMs = 1_234_000) => {
  rememberRecording(id, who);
  // bd-ma9jiy.3: cut a minute ago (#292's rule: only a recording cut within the hour reopens paused; keptNeedsYou.test
  // has the stopped and the old ones).
  const last = Date.now() - 60_000;
  kept.list.push({ meta: { id, mimeType: "audio/webm;codecs=opus", startedAt: new Date(last - elapsedMs).toISOString(), elapsedMs, ext: ".webm", finished: false }, blob: new Blob(["kept"], { type: "audio/webm" }), nextSeq: 1234, parts: 1, beats: [{ t: last, st: "r" }] });
};

class FakeMR {
  static last: FakeMR | null = null;
  static isTypeSupported = () => true;
  state = "inactive";
  ondataavailable: any = null;
  onstop: any = null;
  constructor() { FakeMR.last = this; }
  start() { this.state = "recording"; }
  pause() { this.state = "paused"; }
  resume() { this.state = "recording"; }
  stop() { this.state = "inactive"; this.onstop?.(); }
}
const gum = vi.fn(async () => ({ getTracks: () => [{ stop: vi.fn() }] }));

const renderAt = (path: string) => render(
  <MemoryRouter initialEntries={[path]}>
    <Routes>
      <Route path="/portal/coach/visit/:id" element={<CoachVisit />} />
      <Route path="/portal/coach/visit/:id/record" element={<CoachRecord />} />
      <Route path="/portal/coach/visit/:id/check" element={<div>check and send</div>} />
      <Route path="/portal/coach/observation/:id/debrief" element={<Debrief />} />
      <Route path="*" element={<div>elsewhere</div>} />
    </Routes>
  </MemoryRouter>,
);

beforeEach(async () => {
  vi.clearAllMocks();
  kept.list = [];
  FakeMR.last = null;
  window.localStorage.clear();
  (globalThis as any).MediaRecorder = FakeMR;
  Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia: gum }, configurable: true });
  if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} });
  await act(async () => { await i18n.changeLanguage("en"); });
  clearDraft(VISIT_ID);
  C.getVisit.mockResolvedValue(VISIT);
  L.getObserveLessonQuestion.mockResolvedValue({ ask: false });
});
afterEach(() => cleanup());

describe("a kept observation recording reopens as a PAUSED recording", () => {
  it("Record observation: Paused, the clock at the saved length, Resume and Stop; no microphone yet; no Send saved recording", async () => {
    keep("rec-ayesha", { teacherExtId: AYESHA, schoolExtId: null, teacherName: "Ayesha Bibi", kind: "obs", visitId: VISIT_ID });
    renderAt(`/portal/coach/visit/${VISIT_ID}/record`);
    const timer = await screen.findByRole("timer");
    expect(timer.textContent).toContain("20:34"); // 1,234 s
    expect(screen.getByText("Paused")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resume" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Stop" })).toBeEnabled();
    expect(screen.queryByRole("link", { name: "Send saved recording" })).toBeNull();
    expect(gum).not.toHaveBeenCalled();
  });

  it("Resume opens the microphone and carries on in the SAME recording", async () => {
    keep("rec-ayesha", { teacherExtId: AYESHA, schoolExtId: null, teacherName: "Ayesha Bibi", kind: "obs", visitId: VISIT_ID });
    renderAt(`/portal/coach/visit/${VISIT_ID}/record`);
    fireEvent.click(await screen.findByRole("button", { name: "Resume" }));
    await waitFor(() => expect(gum).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("Recording")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
    expect(FakeMR.last!.state).toBe("recording");
  });

  it("Stop without Resume: the kept file goes to Check and send, as this recording", async () => {
    keep("rec-ayesha", { teacherExtId: AYESHA, schoolExtId: null, teacherName: "Ayesha Bibi", kind: "obs", visitId: VISIT_ID });
    renderAt(`/portal/coach/visit/${VISIT_ID}/record`);
    fireEvent.click(await screen.findByRole("button", { name: "Stop" }));
    fireEvent.click(await screen.findByRole("button", { name: /Yes, stop/i }));
    expect(await screen.findByText("check and send")).toBeInTheDocument();
    expect(getDraft(VISIT_ID)).toMatchObject({ recordingId: "rec-ayesha", durationMs: 1_234_000 });
    expect(markFinished).toHaveBeenCalledWith("rec-ayesha", 1_234_000);
    expect(gum).not.toHaveBeenCalled();
  });

  it("the visit page's way back to it: Continue recording, to the record step", async () => {
    keep("rec-ayesha", { teacherExtId: AYESHA, schoolExtId: null, teacherName: "Ayesha Bibi", kind: "obs", visitId: VISIT_ID });
    renderAt(`/portal/coach/visit/${VISIT_ID}`);
    expect(await screen.findByRole("link", { name: "Continue recording" })).toHaveAttribute("href", `/portal/coach/visit/${VISIT_ID}/record`);
  });

  it("a debrief talk kept for this teacher is NOT offered as the class recording", async () => {
    keep("talk-1", { teacherExtId: AYESHA, schoolExtId: null, teacherName: "Ayesha Bibi", kind: "dbrf", observationId: "cs-1" });
    renderAt(`/portal/coach/visit/${VISIT_ID}/record`);
    await waitFor(() => expect(gum).toHaveBeenCalled()); // nothing kept for the class: a new recording starts
    expect(screen.queryByText("Paused")).toBeNull();
  });
});

describe("a kept debrief talk reopens Debrief's recorder PAUSED", () => {
  const VIEW = {
    id: "cs-1", createdAt: "2026-11-25T06:30:00Z", sessionStatus: "x", step: "talk", problem: null, preparing: false, portal: true,
    teacher: { name: "Ayesha Bibi", phone: AYESHA }, lesson: { topic: null, subject: null, hasLessonPlan: false }, draft: { edited: false },
    talk: { guide: null, recordedAt: null, feedback: null },
    report: { status: null, teacherName: "Ayesha Bibi", teacherPhone: null, caption: null, companionText: null, imageUrl: null, sentAt: null, templateSentAt: null },
  };
  it("Paused, its clock at the saved length, Continue; no microphone until Continue", async () => {
    L.getObservation.mockResolvedValue(VIEW);
    L.getTalkGuide.mockResolvedValue({ guide: { intro: "Open with what worked.", steps: [], reflection_question: "What will you try?" } });
    keep("talk-1", { teacherExtId: "", schoolExtId: null, teacherName: "Ayesha Bibi", kind: "dbrf", observationId: "cs-1" }, 245_000);
    renderAt("/portal/coach/observation/cs-1/debrief");
    // bd-ma9jiy.3: first the line and Continue recording; the press opens the recorder paused.
    fireEvent.click(await screen.findByRole("button", { name: "Continue recording" }));
    expect(await screen.findByText("Paused")).toBeInTheDocument();
    expect(screen.getByText("04:05")).toBeInTheDocument();
    expect(gum).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(gum).toHaveBeenCalledTimes(1));
  });
});
