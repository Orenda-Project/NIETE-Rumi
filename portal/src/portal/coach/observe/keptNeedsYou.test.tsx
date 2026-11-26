import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import i18n from "i18next";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: any) => <div>{children}</div> }));
vi.mock("../CoachGate", () => ({ default: ({ children }: any) => <>{children}</> }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: () => ({ user: { firstName: "Hataf", role: "coach", phoneNumber: "923001234567" }, loading: false }) }));
vi.mock("../../services/api", () => ({
  coach: { getVisit: vi.fn(), getPending: vi.fn(), getSchedule: vi.fn(), getReports: vi.fn(), getHome: vi.fn() },
  leader: {
    cancelSchedule: vi.fn(), getObserveRecentPlans: vi.fn(), getObserveLessonQuestion: vi.fn(),
    getObservation: vi.fn(), getTalkGuide: vi.fn(), retryTalk: vi.fn(), presignObserveUpload: vi.fn(), startTalk: vi.fn(),
  },
  portal: { uploadToR2: vi.fn() },
}));
vi.mock("../../lib/useChildTest", () => ({ useChildTest: vi.fn(() => false) }));
vi.mock("../../lib/useChildTestSa", () => ({ useChildTestSa: vi.fn(() => false) }));
vi.mock("../../lib/recordingSupport", () => ({
  canRecordHere: () => Promise.resolve(true),
  pickRecordingType: () => ({ mimeType: "audio/webm;codecs=opus", ext: ".webm" }),
}));
vi.mock("../../lib/keepAwake", () => ({ keepScreenOn: async () => async () => {} }));
vi.mock("fix-webm-duration", () => ({ default: vi.fn(async (blob: Blob) => blob) }));
vi.mock("../../lib/recordingBeat", () => ({
  RecordingHeart: class { sample() { return {}; } saved() {} event() {} flush() { return Promise.resolve(); } dispose() { return Promise.resolve(); } },
  cutOf: () => null,
}));
// The phone's kept recordings (IndexedDB). latestUnsent honours `accept`; listKept is every one, newest first.
const kept = vi.hoisted(() => ({ list: [] as any[] }));
vi.mock("../../lib/recordingStore", () => ({
  deleteRecording: vi.fn(async () => {}),
  markFinished: vi.fn(async () => {}),
  createRecording: vi.fn(async () => {}),
  appendChunk: vi.fn(async () => {}),
  latestUnsent: vi.fn(async (accept?: (m: any) => boolean) => kept.list.find((r) => !accept || accept(r.meta)) ?? null),
  listKept: vi.fn(async () => kept.list.map((r) => ({ meta: r.meta, beats: r.beats.slice(-1) }))),
}));
vi.mock("./uploadOnly", async (orig) => ({ ...(await orig<typeof import("./uploadOnly")>()), useUploadOnly: () => false }));
vi.mock("../flow/useCoachFlowV2", async (orig) => ({ ...(await orig<typeof import("../flow/useCoachFlowV2")>()), useFlowV6: () => false, useFlowV2: () => false }));
vi.mock("../flow/track", () => ({ trackFlow: vi.fn() }));

import { coach, leader } from "../../services/api";
import CoachRecord from "../pages/CoachRecord";
import CoachVisit from "../pages/CoachVisit";
import CoachObserveToday from "../pages/CoachObserveToday";
import CoachHome from "../pages/CoachHome";
import Debrief from "../reports/Debrief";
import { clearDraft } from "../observeDraft";
import { rememberRecording } from "../../lib/coachObserve";
import { karachiDay } from "../time";
import { addDays } from "../../teacher/ui";

/**
 * bd-ma9jiy.3 (queue #262, UI round) — the operator 26 Nov ~11:10, his own design after crashing the app and going back:
 *
 *   (1) "incomplete recordings aka recordings that were done but not yet submitted should also be on the Needs You
 *       section" — every recording this phone keeps and has not sent is a row in Needs you (Observe, and Home): the
 *       teacher, how long, when; a PAUSED one (cut by a kill, last saved within the hour) opens the recorder paused, a
 *       NOT SENT one (stopped, or older) opens its visit (Send saved recording); a debrief talk opens its Debrief.
 *   (2) "Since there is already a pending recording, the 'start recording' and 'upload recording' should not be there.
 *       Instead, there should be the Continue recording button that looks similar to the Start recording button but with
 *       a paused icon. With a text on top: Your recording was paused abruptly." — Visit and Debrief, for a PAUSED one.
 *
 * Paused vs not sent is #292's rule (lib/keptOffer): resumed only if cut by a kill and last saved within the hour, so an
 * old or stopped copy is never joined onto today's lesson and never hides Start recording.
 */
const C = coach as any;
const L = leader as any;
const VISIT_ID = "0d8a6d1c-1111-4c1c-9a1a-000000000262";
const AYESHA = "923001110001";
const VISIT = {
  success: true,
  visit: { id: VISIT_ID, teacherName: "Ayesha Bibi", teacherExtId: AYESHA, schoolName: "IMSG I-10/1", schoolExtId: "niete:110", scheduledFor: karachiDay(), scheduledSlot: "11:30", status: "upcoming", overdue: false },
  teacher: null,
  lastVisit: null,
};
const MIN = 60_000;

/** A kept recording: `cut` = killed mid-recording, saved `agoMin` minutes ago; `stopped` = she pressed Stop, never sent. */
const keep = (id: string, who: Parameters<typeof rememberRecording>[1] | null, how: "cut" | "stopped", agoMin = 2, elapsedMs = 1_234_000) => {
  if (who) rememberRecording(id, who);
  const last = Date.now() - agoMin * MIN;
  kept.list.push({
    meta: { id, mimeType: "audio/webm;codecs=opus", startedAt: new Date(last - elapsedMs).toISOString(), elapsedMs, ext: ".webm", finished: how === "stopped" },
    blob: new Blob(["kept"], { type: "audio/webm" }), nextSeq: 1234, parts: 1,
    beats: [{ t: last, s: 1233, st: how === "cut" ? "r" : "i" }],
  });
};
const ayesha = { teacherExtId: AYESHA, schoolExtId: "niete:110", teacherName: "Ayesha Bibi", kind: "obs" as const, visitId: VISIT_ID };

const gum = vi.fn(async () => ({ getTracks: () => [{ stop: vi.fn() }] }));
class FakeMR {
  static isTypeSupported = () => true;
  state = "inactive";
  ondataavailable: any = null;
  onstop: any = null;
  start() { this.state = "recording"; }
  pause() { this.state = "paused"; }
  resume() { this.state = "recording"; }
  stop() { this.state = "inactive"; this.onstop?.(); }
}

const renderAt = (path: string) => render(
  <MemoryRouter initialEntries={[path]}>
    <Routes>
      <Route path="/portal/coach" element={<CoachHome />} />
      <Route path="/portal/coach/observe" element={<CoachObserveToday />} />
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
  window.localStorage.clear();
  (globalThis as any).MediaRecorder = FakeMR;
  Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia: gum }, configurable: true });
  if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} });
  await act(async () => { await i18n.changeLanguage("en"); });
  clearDraft(VISIT_ID);
  C.getVisit.mockResolvedValue(VISIT);
  C.getPending.mockResolvedValue({ waiting: 0, ids: [] });
  C.getSchedule.mockResolvedValue({ success: true, from: karachiDay(), to: addDays(karachiDay(), 90), overdue: [], visits: [] });
  C.getReports.mockResolvedValue({ success: true, waiting: [], inProgress: [], all: { total: 0 } });
  C.getHome.mockResolvedValue({ success: true, home: { today: [], counts: { week: 0, overdue: 0, waiting: 0, inProgress: 0, teachers: 3, schools: 1 } } });
  L.getObserveLessonQuestion.mockResolvedValue({ ask: false });
});
afterEach(() => cleanup());

describe("(2) the visit page with a PAUSED recording: one Continue recording, nothing else to start with", () => {
  it("the line on top, ONE Continue recording (to the paused recorder); no Start recording, no Upload recording", async () => {
    keep("rec-ayesha", ayesha, "cut");
    renderAt(`/portal/coach/visit/${VISIT_ID}`);
    expect(await screen.findByText("Your recording was paused abruptly.")).toBeInTheDocument();
    const go = screen.getByRole("link", { name: "Continue recording" });
    expect(go).toHaveAttribute("href", `/portal/coach/visit/${VISIT_ID}/record`);
    expect(go.querySelector("svg")).not.toBeNull(); // the pause icon
    expect(screen.queryByRole("link", { name: "Start recording" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Upload recording" })).toBeNull();
    // the visit's own actions stay
    expect(screen.getByRole("link", { name: "Reschedule" })).toBeInTheDocument();
  });

  it("a recording she STOPPED and never sent: Send saved recording, and Start / Upload stay (it is not paused)", async () => {
    keep("rec-ayesha", ayesha, "stopped", 30);
    renderAt(`/portal/coach/visit/${VISIT_ID}`);
    expect(await screen.findByRole("link", { name: "Send saved recording" })).toHaveAttribute("href", `/portal/coach/visit/${VISIT_ID}/check`);
    expect(screen.getByText("Your recording was not sent.")).toBeInTheDocument();
    expect(screen.queryByText("Your recording was paused abruptly.")).toBeNull();
    expect(screen.queryByRole("link", { name: "Continue recording" })).toBeNull();
    expect(screen.getByRole("link", { name: "Start recording" })).toBeInTheDocument();
  });

  it("one cut yesterday is not resumed: not sent, never joined onto today's lesson", async () => {
    keep("rec-ayesha", ayesha, "cut", 26 * 60);
    renderAt(`/portal/coach/visit/${VISIT_ID}`);
    expect(await screen.findByRole("link", { name: "Send saved recording" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Continue recording" })).toBeNull();
  });

  it("Record observation with a stopped one: no paused recorder, Send saved recording instead", async () => {
    keep("rec-ayesha", ayesha, "stopped", 30);
    renderAt(`/portal/coach/visit/${VISIT_ID}/record`);
    expect(await screen.findByRole("link", { name: "Send saved recording" })).toBeInTheDocument();
    expect(screen.queryByText("Paused")).toBeNull();
    expect(gum).not.toHaveBeenCalled();
  });
});

describe("(2) Debrief with a PAUSED talk", () => {
  const VIEW = {
    id: "cs-1", createdAt: "2026-11-25T06:30:00Z", sessionStatus: "x", step: "talk", problem: null, preparing: false, portal: true,
    teacher: { name: "Ayesha Bibi", phone: AYESHA }, lesson: { topic: null, subject: null, hasLessonPlan: false }, draft: { edited: false },
    talk: { guide: null, recordedAt: null, feedback: null },
    report: { status: null, teacherName: "Ayesha Bibi", teacherPhone: null, caption: null, companionText: null, imageUrl: null, sentAt: null, templateSentAt: null },
  };
  it("the line on top and ONE Continue recording; no Record / Upload; the paused recorder only after the press", async () => {
    L.getObservation.mockResolvedValue(VIEW);
    L.getTalkGuide.mockResolvedValue({ guide: { intro: "Open with what worked.", steps: [], reflection_question: "What will you try?" } });
    keep("talk-1", { teacherExtId: "", schoolExtId: null, teacherName: "Ayesha Bibi", kind: "dbrf", observationId: "cs-1" }, "cut", 2, 245_000);
    renderAt("/portal/coach/observation/cs-1/debrief");
    expect(await screen.findByText("Your recording was paused abruptly.")).toBeInTheDocument();
    await screen.findByText("Open with what worked."); // the guide is there, under it
    expect(screen.queryByRole("button", { name: "Start recording" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Upload recording" })).toBeNull();
    expect(screen.queryByText("Paused")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Continue recording" }));
    expect(await screen.findByText("Paused")).toBeInTheDocument();
    expect(screen.getByText("04:05")).toBeInTheDocument();
    expect(gum).not.toHaveBeenCalled();
  });
});

describe("(1) Needs you lists every recording kept on this phone and not sent", () => {
  it("Observe: a paused row opens the recorder; a debrief talk not sent opens its Debrief; a teacher's own DC take is not hers", async () => {
    keep("rec-ayesha", ayesha, "cut", 3);
    keep("talk-9", { teacherExtId: "923001110009", schoolExtId: null, teacherName: "Rabia Saleem", kind: "dbrf", observationId: "cs-9" }, "stopped", 90, 300_000);
    keep("dc-own", null, "cut", 1); // no coach owner: a teacher's Digital Coaching recording on a shared phone
    renderAt("/portal/coach/observe");
    const needs = await screen.findByTestId("needs-you");
    const paused = await within(needs).findByRole("link", { name: /Ayesha Bibi/ });
    expect(paused).toHaveAttribute("href", `/portal/coach/visit/${VISIT_ID}/record`);
    expect(paused).toHaveTextContent("Paused");
    expect(paused).toHaveTextContent("21 min");
    const talk = within(needs).getByRole("link", { name: /Rabia Saleem/ });
    expect(talk).toHaveAttribute("href", "/portal/coach/observation/cs-9/debrief");
    expect(talk).toHaveTextContent("Not sent");
    expect(talk).toHaveTextContent("Debrief");
    expect(within(needs).queryByText("Nothing waiting")).toBeNull();
    expect(within(needs).getAllByRole("link")).toHaveLength(2);
  });

  it("Observe: a stopped observation not sent opens its visit (Send saved recording there)", async () => {
    keep("rec-ayesha", ayesha, "stopped", 40);
    renderAt("/portal/coach/observe");
    const row = await within(await screen.findByTestId("needs-you")).findByRole("link", { name: /Ayesha Bibi/ });
    expect(row).toHaveAttribute("href", `/portal/coach/visit/${VISIT_ID}`);
    expect(row).toHaveTextContent("Not sent");
  });

  it("Home: a Needs you section with the same rows; none when nothing is kept", async () => {
    keep("rec-ayesha", ayesha, "cut", 3);
    const first = renderAt("/portal/coach");
    const needs = await screen.findByTestId("home-kept");
    expect(within(needs).getByText("Needs you")).toBeInTheDocument();
    expect(within(needs).getByRole("link", { name: /Ayesha Bibi/ })).toHaveAttribute("href", `/portal/coach/visit/${VISIT_ID}/record`);
    first.unmount();
    kept.list = [];
    renderAt("/portal/coach");
    await screen.findByTestId("home-greeting");
    await waitFor(() => expect(C.getHome).toHaveBeenCalled());
    expect(screen.queryByTestId("home-kept")).toBeNull();
  });

  it("Urdu: the line and the button in Urdu", async () => {
    await act(async () => { await i18n.changeLanguage("ur"); });
    keep("rec-ayesha", ayesha, "cut");
    renderAt(`/portal/coach/visit/${VISIT_ID}`);
    expect(await screen.findByText("آپ کی ریکارڈنگ اچانک رک گئی تھی۔")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "ریکارڈنگ جاری رکھیں" })).toBeInTheDocument();
  });
});
