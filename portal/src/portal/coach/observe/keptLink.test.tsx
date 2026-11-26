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
    cancelSchedule: vi.fn(), createSchedule: vi.fn(), getObserveRecentPlans: vi.fn(), getObserveLessonQuestion: vi.fn(),
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
  beatLink: (beat: Record<string, unknown>) => ({ ...beat }),
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
  readKept: vi.fn(async (id: string) => kept.list.find((r) => r.meta.id === id) ?? null),
  setLink: vi.fn(async (id: string, link: any) => { const r = kept.list.find((x) => x.meta.id === id); if (r) r.meta.link = link; }),
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
 * bd-ma9jiy (queue #262; the operator 26 Nov ~15:10, after #292: 62 teachers recorded a new lesson onto an old kept file):
 * "on the user's device we should note which observation is the one that's being recorded. So they can also store 2 at
 * a time as well." A coach's kept recording belongs to ITS visit (its own link, or the phone's teacher list for one kept
 * before this): Continue reopens it only on that visit; another visit of the same teacher starts a fresh file; two live
 * side by side, each under its own visit. One with no visit (kept before 25 Nov) is unlinked: never reopened, never sent as
 * a visit's; Needs you offers it for Save to phone only.
 */
const C = coach as any;
const L = leader as any;
const AYESHA = "923001110001";
const V1 = "0d8a6d1c-1111-4c1c-9a1a-000000000001";
const V2 = "0d8a6d1c-2222-4c1c-9a1a-000000000002";
const V3 = "0d8a6d1c-3333-4c1c-9a1a-000000000003";
const visitAnswer = (id: string) => ({
  success: true,
  visit: { id, teacherName: "Ayesha Bibi", teacherExtId: AYESHA, schoolName: "IMSG I-10/1", schoolExtId: "niete:110", scheduledFor: karachiDay(), scheduledSlot: "11:30", status: "upcoming", overdue: false },
  teacher: null, lastVisit: null,
});
const MIN = 60_000;
const keepFor = (id: string, link: Record<string, unknown> | null, legacy: Parameters<typeof rememberRecording>[1] | null, elapsedMs: number) => {
  if (legacy) rememberRecording(id, legacy);
  const last = Date.now() - 2 * MIN;
  kept.list.push({
    meta: { id, mimeType: "audio/webm;codecs=opus", startedAt: new Date(last - elapsedMs).toISOString(), elapsedMs, ext: ".webm", finished: false, ...(link ? { link } : {}) },
    blob: new Blob(["kept"], { type: "audio/webm" }), nextSeq: 10, parts: 1, beats: [{ t: last, s: 9, st: "r" }],
  });
};
const obsLink = (visitId: string) => ({ kind: "obs", visitId, teacherExtId: AYESHA, teacherName: "Ayesha Bibi" });

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
      <Route path="/portal/coach/observe" element={<CoachObserveToday />} />
      <Route path="/portal/coach/visit/:id" element={<CoachVisit />} />
      <Route path="/portal/coach/visit/:id/record" element={<CoachRecord />} />
      <Route path="/portal/coach/visit/:id/check" element={<div>check and send</div>} />
      <Route path="*" element={<div>elsewhere</div>} />
    </Routes>
  </MemoryRouter>,
);

beforeEach(async () => {
  vi.clearAllMocks();
  (URL as any).createObjectURL = () => "blob:portal/kept"; // jsdom has none
  (URL as any).revokeObjectURL = () => {};
  kept.list = [];
  window.localStorage.clear();
  (globalThis as any).MediaRecorder = FakeMR;
  Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia: gum }, configurable: true });
  if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} });
  await act(async () => { await i18n.changeLanguage("en"); });
  [V1, V2, V3].forEach((v) => clearDraft(v));
  C.getVisit.mockImplementation(async (id: string) => visitAnswer(id));
  C.getPending.mockResolvedValue({ waiting: 0, ids: [] });
  C.getSchedule.mockResolvedValue({ success: true, from: karachiDay(), to: addDays(karachiDay(), 90), overdue: [], visits: [] });
  C.getReports.mockResolvedValue({ success: true, waiting: [], inProgress: [], all: { total: 0 } });
  L.getObserveLessonQuestion.mockResolvedValue({ ask: false });
});
afterEach(() => cleanup());

describe("two kept recordings for two visits of the same teacher: each only on its own visit", () => {
  beforeEach(() => {
    keepFor("rec-v1", obsLink(V1), null, 10 * MIN);           // 10:00
    keepFor("rec-v2", null, { teacherExtId: AYESHA, schoolExtId: null, teacherName: "Ayesha Bibi", kind: "obs", visitId: V2 }, 20 * MIN); // 20:00, kept before the link
  });

  it("visit 1 offers Continue; its record step reopens visit 1's file (10:00), not visit 2's", async () => {
    renderAt(`/portal/coach/visit/${V1}`);
    expect(await screen.findByRole("link", { name: "Continue recording" })).toHaveAttribute("href", `/portal/coach/visit/${V1}/record`);
    cleanup();
    renderAt(`/portal/coach/visit/${V1}/record`);
    expect((await screen.findByRole("timer")).textContent).toContain("10:00");
    expect(gum).not.toHaveBeenCalled();
  });

  it("visit 2 reopens visit 2's file (20:00)", async () => {
    renderAt(`/portal/coach/visit/${V2}/record`);
    expect((await screen.findByRole("timer")).textContent).toContain("20:00");
  });

  it("visit 3 of the same teacher: no Continue, Start recording; its record step starts a FRESH file", async () => {
    renderAt(`/portal/coach/visit/${V3}`);
    expect(await screen.findByRole("link", { name: "Start recording" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Continue recording" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Send saved recording" })).toBeNull();
    cleanup();
    renderAt(`/portal/coach/visit/${V3}/record`);
    await waitFor(() => expect(gum).toHaveBeenCalled()); // a new recording, not either kept one
    expect(screen.queryByText("Paused")).toBeNull();
  });

  it("Needs you: two rows, each opening its own visit's recorder", async () => {
    renderAt("/portal/coach/observe");
    const needs = await screen.findByTestId("needs-you");
    await waitFor(() => expect(within(needs).getAllByRole("link").length).toBe(2));
    const hrefs = within(needs).getAllByRole("link").map((a) => a.getAttribute("href")).sort();
    expect(hrefs).toEqual([`/portal/coach/visit/${V1}/record`, `/portal/coach/visit/${V2}/record`].sort());
  });
});

describe("a coach copy kept with no visit (before 25 Nov): unlinked, never reopened", () => {
  beforeEach(() => {
    keepFor("rec-legacy", null, { teacherExtId: AYESHA, schoolExtId: null, teacherName: "Ayesha Bibi" }, 15 * MIN);
  });

  it("the visit page and the record step treat it as nothing kept: a fresh recording", async () => {
    renderAt(`/portal/coach/visit/${V1}`);
    expect(await screen.findByRole("link", { name: "Start recording" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Continue recording" })).toBeNull();
    cleanup();
    renderAt(`/portal/coach/visit/${V1}/record`);
    await waitFor(() => expect(gum).toHaveBeenCalled());
  });

  it("Needs you: 'Unlinked', opening its player with Save to phone only", async () => {
    renderAt("/portal/coach/observe");
    const needs = await screen.findByTestId("needs-you");
    const row = await within(needs).findByRole("button", { name: /Ayesha Bibi/ });
    expect(row).toHaveTextContent("Unlinked");
    fireEvent.click(row);
    const tray = await screen.findByRole("dialog");
    expect(within(tray).getByText(/Unlinked recording from/)).toBeInTheDocument();
    expect(await within(tray).findByTestId("unlinked-player")).toBeInTheDocument();
  });
});

/**
 * The operator 26 Nov (via Godfather): copies kept by the OLD recorder (before 25 Nov 22:52) must be found and shown too —
 * e.g. a coach's lesson of 25 Nov 09:38-10:08 recorded in WhatsApp's browser: no visit, no heartbeats — with Send and Save
 * to phone. Send makes it its OWN observation (a visit booked for now for that teacher), never another visit's.
 */
describe("copies kept by the old recorder (before 25 Nov 22:52)", () => {
  const oldCopy = (id: string, who: Parameters<typeof rememberRecording>[1] | null) => {
    if (who) rememberRecording(id, who);
    kept.list.push({
      meta: { id, mimeType: "audio/webm;codecs=opus", startedAt: "2026-11-25T04:38:00Z", elapsedMs: 30 * MIN, ext: ".webm", finished: false },
      blob: new Blob(["old"], { type: "audio/webm" }), nextSeq: 360, parts: 1, beats: [],
    });
  };

  it("found and listed: 'Unlinked recording from 09:38', Save to phone and Send as the teacher's observation", async () => {
    oldCopy("rec-aqila", { teacherExtId: AYESHA, schoolExtId: "niete:110", teacherName: "Aqila" });
    L.createSchedule.mockResolvedValue({ success: true, id: V3 });
    renderAt("/portal/coach/observe");
    const row = await within(await screen.findByTestId("needs-you")).findByRole("button", { name: /Aqila/ });
    expect(row).toHaveTextContent("Unlinked");
    expect(row).toHaveTextContent("30 min");
    fireEvent.click(row);
    const tray = await screen.findByRole("dialog");
    expect(within(tray).getByText("Unlinked recording from 09:38")).toBeInTheDocument();
    expect(await within(tray).findByRole("button", { name: "Save to phone" })).toBeInTheDocument();
    fireEvent.click(within(tray).getByRole("button", { name: "Send as Aqila’s observation" }));
    expect(await screen.findByText("check and send")).toBeInTheDocument();
    expect(L.createSchedule).toHaveBeenCalledWith(expect.objectContaining({ teacherExtId: AYESHA, now: true }));
    expect(kept.list[0].meta.link).toMatchObject({ kind: "obs", visitId: V3, teacherExtId: AYESHA });
  });

  it("one with no teacher on the phone at all is still found: Save to phone (no visit to send it with)", async () => {
    oldCopy("rec-nobody", null);
    renderAt("/portal/coach/observe");
    const row = await within(await screen.findByTestId("needs-you")).findByRole("button", { name: /Unlinked/ });
    fireEvent.click(row);
    const tray = await screen.findByRole("dialog");
    expect(await within(tray).findByRole("button", { name: "Save to phone" })).toBeInTheDocument();
    expect(within(tray).queryByRole("button", { name: /^Send as/ })).toBeNull();
  });
});
