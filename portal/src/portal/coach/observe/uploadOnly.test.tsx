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
// The in-app web recorder: it must never start while upload-only is on.
const engine = vi.hoisted(() => ({ started: 0 }));
vi.mock("../../lib/useCoachRecording", () => ({
  useCoachRecording: () => {
    engine.started += 1;
    return { recording: true, paused: false, elapsed: 0, level: 0, screenWentOff: false, micBlocked: false,
      togglePause: vi.fn(), finish: vi.fn(), elapsedNow: () => 0 };
  },
  useMicLevel: () => null,
}));
vi.mock("../../components/coaching/coach/CoachRecorder", () => ({
  default: () => { engine.started += 1; return <div>web recorder</div>; },
  clockText: () => "00:00",
}));
vi.mock("../../lib/recordingSupport", () => ({ canRecordHere: () => Promise.resolve(true) }));
const unsent = vi.hoisted(() => ({ value: null as any }));
vi.mock("../../lib/recordingStore", () => ({
  deleteRecording: vi.fn(async () => {}),
  latestUnsent: vi.fn(async () => unsent.value),
}));
const sw = vi.hoisted(() => ({ on: true as boolean | null }));
vi.mock("./uploadOnly", async (orig) => ({ ...(await orig<typeof import("./uploadOnly")>()), useUploadOnly: () => sw.on }));

import { coach, leader, portal } from "../../services/api";
import CoachRecord from "../pages/CoachRecord";
import Debrief from "../reports/Debrief";
import { uploadOnlyOn } from "./uploadOnly";
import { clearDraft, getDraft } from "../observeDraft";
import { rememberRecording } from "../../lib/coachObserve";

/**
 * bd-oe6r47 (queue #278) — upload-only recording. The operator, 25 Nov: "until we are completely sure ... the recordings
 * don't go away if you have bad internet ... right now disable the option of recording directly on the thingy ... we only
 * give the upload recording button, or somehow if you click the button you automatically get routed to your phone's own
 * microphone recording software".
 *
 * With the switch on (portal_observe_upload_only, DEFAULT ON): the observe recording step and the debrief recording step
 * never start the in-app web recorder. The main button is a file input that asks for the phone's recorder
 * (accept="audio/*" capture), the second is "Upload recording" (any recording file), and one line says what to do. A
 * file from either goes the same way an uploaded file always went. A recording already kept on this phone (IndexedDB)
 * for this teacher can still be sent.
 */
const C = coach as any;
const L = leader as any;
const P = portal as any;
const VISIT_ID = "0d8a6d1c-1111-4c1c-9a1a-000000000278";
const VISIT = {
  success: true,
  visit: { id: VISIT_ID, teacherName: "Ayesha Bibi", teacherExtId: "923001110001", schoolName: "IMSG I-10/1", schoolExtId: "niete:110", scheduledFor: "2026-11-25", scheduledSlot: "11:30", status: "upcoming", overdue: false },
  teacher: null,
  lastVisit: null,
};

const renderRecord = () => render(
  <MemoryRouter initialEntries={[`/portal/coach/visit/${VISIT_ID}/record`]}>
    <Routes>
      <Route path="/portal/coach/visit/:id/record" element={<CoachRecord />} />
      <Route path="/portal/coach/visit/:id/check" element={<div>check and send</div>} />
      <Route path="*" element={<div>elsewhere</div>} />
    </Routes>
  </MemoryRouter>,
);

const m4a = (name = "Voice 001.m4a") => new File(["0000ftypM4A "], name, { type: "audio/mp4" });

beforeEach(async () => {
  vi.clearAllMocks();
  engine.started = 0;
  unsent.value = null;
  sw.on = true;
  if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} });
  await act(async () => { await i18n.changeLanguage("en"); });
  clearDraft(VISIT_ID);
  C.getVisit.mockResolvedValue(VISIT);
  L.getObserveLessonQuestion.mockResolvedValue({ ask: false });
});

afterEach(async () => {
  cleanup();
  await act(async () => { await i18n.changeLanguage("en"); });
});

describe("the switch's rule (client): only a literal false turns upload-only off", () => {
  it("no config, no features, a missing key, true or a stray value: ON", () => {
    for (const cfg of [null, undefined, {}, { features: {} }, { features: { observeUploadOnly: true } }, { features: { observeUploadOnly: "false" } }]) {
      expect(uploadOnlyOn(cfg)).toBe(true);
    }
  });
  it("false: OFF", () => {
    expect(uploadOnlyOn({ features: { observeUploadOnly: false } })).toBe(false);
  });
});

describe("Record observation — upload-only on", () => {
  it("never starts the web recorder: the phone's recorder, Upload recording and the one-line hint instead", async () => {
    renderRecord();
    const record = await screen.findByRole("button", { name: "Record on phone" });
    expect(screen.getByRole("button", { name: "Upload recording" })).toBeInTheDocument();
    expect(screen.getByText("Record with your phone's recorder, then upload it here.")).toBeInTheDocument();
    expect(engine.started).toBe(0);
    expect(screen.queryByRole("timer")).toBeNull();

    // The main button asks for the phone's own recorder: audio only, with capture.
    const capture = screen.getByTestId("phone-record-input") as HTMLInputElement;
    expect(capture.type).toBe("file");
    expect(capture.getAttribute("accept")).toBe("audio/*");
    expect(capture.hasAttribute("capture")).toBe(true);
    const clicked = vi.spyOn(capture, "click");
    fireEvent.click(record);
    expect(clicked).toHaveBeenCalled();

    // Upload recording takes any recording file (the same list as every recording picker), without capture.
    const pick = screen.getByTestId("phone-upload-input") as HTMLInputElement;
    expect(pick.hasAttribute("capture")).toBe(false);
    for (const t of [".m4a", ".amr", ".3gp", ".ogg", ".webm", "audio/*"]) expect(pick.getAttribute("accept")!.split(",")).toContain(t);
  });

  it("a file from the phone's recorder goes to Check and send, as an uploaded file always did", async () => {
    renderRecord();
    await screen.findByRole("button", { name: "Record on phone" });
    await act(async () => { fireEvent.change(screen.getByTestId("phone-record-input"), { target: { files: [m4a()] } }); });
    expect(await screen.findByText("check and send")).toBeInTheDocument();
    const draft = getDraft(VISIT_ID);
    expect(draft?.filename).toBe("Voice 001.m4a");
    expect(draft?.recordingId).toBeNull();
    expect(engine.started).toBe(0);
  });

  it("a picked file goes the same way; a file that is not a recording is refused on the spot", async () => {
    renderRecord();
    await screen.findByRole("button", { name: "Upload recording" });
    await act(async () => { fireEvent.change(screen.getByTestId("phone-upload-input"), { target: { files: [new File(["%PDF-1.4"], "notes.pdf", { type: "application/pdf" })] } }); });
    expect(await screen.findByRole("alert")).toHaveTextContent(/Not a recording/);
    await act(async () => { fireEvent.change(screen.getByTestId("phone-upload-input"), { target: { files: [m4a("lesson.amr")] } }); });
    expect(await screen.findByText("check and send")).toBeInTheDocument();
    expect(getDraft(VISIT_ID)?.filename).toBe("lesson.amr");
  });

  it("a recording already kept on this phone for this teacher can still be sent", async () => {
    rememberRecording("rec-kept", { teacherExtId: "923001110001", schoolExtId: "niete:110", teacherName: "Ayesha Bibi" });
    unsent.value = { meta: { id: "rec-kept", startedAt: Date.now() - 3600_000, elapsedMs: 2_400_000, ext: ".webm", finished: false }, blob: new Blob(["x"]) };
    renderRecord();
    const link = await screen.findByRole("link", { name: /Send saved recording/ });
    expect(link).toHaveAttribute("href", `/portal/coach/visit/${VISIT_ID}/check`);
    expect(engine.started).toBe(0);
  });

  it("a kept recording for ANOTHER teacher is not offered here", async () => {
    rememberRecording("rec-other", { teacherExtId: "923009990009", schoolExtId: null, teacherName: "Other" });
    unsent.value = { meta: { id: "rec-other", startedAt: Date.now(), elapsedMs: 60_000, ext: ".webm", finished: true }, blob: new Blob(["x"]) };
    renderRecord();
    await screen.findByRole("button", { name: "Record on phone" });
    await waitFor(() => expect(screen.queryByRole("link", { name: /Send saved recording/ })).toBeNull());
  });

  it("while the switch is read, nothing records and nothing is offered yet", async () => {
    sw.on = null;
    renderRecord();
    await waitFor(() => expect(C.getVisit).toHaveBeenCalled());
    expect(engine.started).toBe(0);
    expect(screen.queryByRole("button", { name: "Record on phone" })).toBeNull();
  });

  it("in Urdu: the button and the hint are Urdu", async () => {
    await act(async () => { await i18n.changeLanguage("ur"); });
    renderRecord();
    expect(await screen.findByRole("button", { name: "فون پر ریکارڈ کریں" })).toBeInTheDocument();
    expect(screen.getByText("فون کے ریکارڈر سے ریکارڈ کریں، پھر یہاں اپ لوڈ کریں۔")).toBeInTheDocument();
  });
});

describe("Record observation — upload-only off: today's web recorder", () => {
  it("starts the in-app recorder as before", async () => {
    sw.on = false;
    renderRecord();
    expect(await screen.findByRole("timer")).toBeInTheDocument();
    expect(engine.started).toBeGreaterThan(0);
    expect(screen.queryByTestId("phone-record-input")).toBeNull();
  });
});

/* ── Debrief ─────────────────────────────────────────────────────────────── */

const VIEW = (step: string) => ({
  id: "cs-1", createdAt: "2026-11-25T06:30:00Z", sessionStatus: "x", step, problem: null, preparing: false, portal: true,
  teacher: { name: "Ayesha Bibi", phone: "923001110001" }, lesson: { topic: null, subject: null, hasLessonPlan: false }, draft: { edited: false },
  talk: { guide: null, recordedAt: null, feedback: null },
  report: { status: null, teacherName: "Ayesha Bibi", teacherPhone: null, caption: null, companionText: null, imageUrl: null, sentAt: null, templateSentAt: null },
});
const GUIDE = { intro: "Open with what worked.", steps: [{ title: "Start", body: "Say what went well." }], reflection_question: "What will you try?" };

const renderDebrief = () => render(
  <MemoryRouter initialEntries={["/portal/coach/observation/cs-1/debrief"]}>
    <Routes>
      <Route path="/portal/coach/observation/:id/debrief" element={<Debrief />} />
      <Route path="/portal/coach/observation/:id" element={<div>observation page</div>} />
    </Routes>
  </MemoryRouter>,
);

describe("Debrief — upload-only on", () => {
  beforeEach(() => {
    L.getObservation.mockResolvedValue(VIEW("talk"));
    L.getTalkGuide.mockResolvedValue({ guide: GUIDE });
    L.presignObserveUpload.mockResolvedValue({ uploadUrl: "https://r2/put", contentType: "audio/mp4", key: "k/talk.m4a" });
    P.uploadToR2.mockResolvedValue(undefined);
    L.startTalk.mockResolvedValue({ success: true });
  });

  it("Record on phone opens the phone's recorder, never the web recorder; its file is sent as the talk", async () => {
    renderDebrief();
    const record = await screen.findByRole("button", { name: "Record on phone" });
    expect(screen.getByRole("button", { name: "Upload recording" })).toBeInTheDocument();
    expect(screen.getByText("Record with your phone's recorder, then upload it here.")).toBeInTheDocument();
    const capture = screen.getByTestId("talk-record-input") as HTMLInputElement;
    expect(capture.getAttribute("accept")).toBe("audio/*");
    expect(capture.hasAttribute("capture")).toBe(true);
    const clicked = vi.spyOn(capture, "click");
    fireEvent.click(record);
    expect(clicked).toHaveBeenCalled();
    expect(screen.queryByText("web recorder")).toBeNull();
    expect(engine.started).toBe(0);

    await act(async () => { fireEvent.change(capture, { target: { files: [m4a("Debrief.m4a")] } }); });
    await waitFor(() => expect(L.startTalk).toHaveBeenCalled());
    expect(P.uploadToR2).toHaveBeenCalled();
    expect(engine.started).toBe(0);
  });

  it("Upload recording still picks a file (no capture)", async () => {
    renderDebrief();
    await screen.findByRole("button", { name: "Upload recording" });
    const pick = screen.getByTestId("talk-input") as HTMLInputElement;
    expect(pick.hasAttribute("capture")).toBe(false);
    const clicked = vi.spyOn(pick, "click");
    fireEvent.click(screen.getByRole("button", { name: "Upload recording" }));
    expect(clicked).toHaveBeenCalled();
  });

  it("off: Start recording opens today's web recorder", async () => {
    sw.on = false;
    renderDebrief();
    fireEvent.click(await screen.findByRole("button", { name: "Start recording" }));
    expect(await screen.findByText("web recorder")).toBeInTheDocument();
  });
});
