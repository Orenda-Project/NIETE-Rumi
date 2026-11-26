import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
// The in-app web recorder: counted, so a test can say whether it started.
const engine = vi.hoisted(() => ({ started: 0, kept: null as string | null }));
vi.mock("../../lib/useCoachRecording", () => ({
  useCoachRecording: (opts?: { kept?: { meta: { id: string } } | null }) => {
    engine.started += 1;
    // bd-ma9jiy: which kept recording the recorder opens (paused) — resumeKept.test.tsx runs the real engine.
    if (opts?.kept) engine.kept = opts.kept.meta.id;
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
// The phone's kept recordings (IndexedDB), newest first; latestUnsent honours its `accept` filter like the real store.
const kept = vi.hoisted(() => ({ list: [] as any[] }));
vi.mock("../../lib/recordingStore", () => ({
  deleteRecording: vi.fn(async () => {}),
  latestUnsent: vi.fn(async (accept?: (m: any) => boolean) => kept.list.find((r) => !accept || accept(r.meta)) ?? null),
}));
const sw = vi.hoisted(() => ({ on: false as boolean | null }));
vi.mock("./uploadOnly", async (orig) => ({ ...(await orig<typeof import("./uploadOnly")>()), useUploadOnly: () => sw.on }));

import { coach, leader, portal } from "../../services/api";
import CoachRecord from "../pages/CoachRecord";
import CoachVisit from "../pages/CoachVisit";
import Debrief from "../reports/Debrief";
import { uploadOnlyOn } from "./uploadOnly";
import { clearDraft, getDraft } from "../observeDraft";
import { rememberRecording } from "../../lib/coachObserve";

/**
 * bd-ih6cej (queue #278) — the operator 25 Nov ~17:20: "Actually on second thought, give both the options again. But
 * advise whoever is using to use their own recorders if their internet is not very good. Suggest them." and ~17:25:
 * "we need it to be on the IAB browser" (WhatsApp's in-app browser, where coaches open the portal from the bot).
 *
 * portal_observe_upload_only is OFF for all again (no row): the in-app recorder is back, with Upload recording and one
 * line beside them: "Weak internet? Record in your phone's Recorder app, then upload it here." A recording this phone
 * keeps for THIS teacher (a cut or unsent in-app recording, IndexedDB) is offered as Send saved recording before a new
 * one starts, even when a newer kept recording belongs to someone else. "Record on phone" is gone: in WhatsApp's browser
 * and the app it opened the same attach chooser as Upload recording (the operator's test, 25 Nov ~17:15). A person the
 * switch still names gets ONE button, Upload recording, with its line.
 */
const C = coach as any;
const L = leader as any;
const P = portal as any;
const VISIT_ID = "0d8a6d1c-1111-4c1c-9a1a-000000000279";
const AYESHA = "923001110001";
const VISIT = {
  success: true,
  visit: { id: VISIT_ID, teacherName: "Ayesha Bibi", teacherExtId: AYESHA, schoolName: "IMSG I-10/1", schoolExtId: "niete:110", scheduledFor: "2026-11-25", scheduledSlot: "11:30", status: "upcoming", overdue: false },
  teacher: null,
  lastVisit: null,
};
const WEAK = "Weak internet? Record in your phone's Recorder app, then upload it here.";
const UPLOAD_ONLY = "Record in your phone's Recorder app, then upload it here.";

const keep = (id: string, teacherExtId: string, startedAt: string) => {
  // bd-ma9jiy (26 Nov ~15:10): a copy belongs to its visit — Ayesha's to this visit, anyone else's to their own.
  rememberRecording(id, { teacherExtId, schoolExtId: null, teacherName: "x", kind: "obs", visitId: teacherExtId === AYESHA ? VISIT_ID : `visit-of-${teacherExtId}` });
  // bd-ma9jiy.3: last saved a minute ago (#292's rule: only a recording cut within the hour reopens paused).
  kept.list.push({ meta: { id, startedAt, elapsedMs: 1_800_000, ext: ".webm", finished: false }, blob: new Blob(["x"]), beats: [{ t: Date.now() - 60_000, st: "r" }] });
};

const renderAt = (path: string) => render(
  <MemoryRouter initialEntries={[path]}>
    <Routes>
      <Route path="/portal/coach/visit/:id" element={<CoachVisit />} />
      <Route path="/portal/coach/visit/:id/record" element={<CoachRecord />} />
      <Route path="/portal/coach/visit/:id/check" element={<div>check and send</div>} />
      <Route path="/portal/coach/visit/:id/attach" element={<div>upload screen</div>} />
      <Route path="/portal/coach/observation/:id/debrief" element={<Debrief />} />
      <Route path="/portal/coach/observation/:id" element={<div>observation page</div>} />
      <Route path="*" element={<div>elsewhere</div>} />
    </Routes>
  </MemoryRouter>,
);
const record = () => renderAt(`/portal/coach/visit/${VISIT_ID}/record`);
const m4a = (name = "Voice 001.m4a") => new File(["0000ftypM4A "], name, { type: "audio/mp4" });

beforeEach(async () => {
  vi.clearAllMocks();
  engine.started = 0;
  engine.kept = null;
  kept.list = [];
  sw.on = false;
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

describe("the switch's rule (client): fail-closed again — only a literal true is upload-only", () => {
  it("no config, no features, a missing key or a stray value: OFF (the in-app recorder)", () => {
    for (const cfg of [null, undefined, {}, { features: {} }, { features: { observeUploadOnly: "true" } }, { features: { observeUploadOnly: false } }]) {
      expect(uploadOnlyOn(cfg)).toBe(false);
    }
  });
  it("true: ON", () => {
    expect(uploadOnlyOn({ features: { observeUploadOnly: true } })).toBe(true);
  });
});

describe("Record observation — the in-app recorder is back", () => {
  it("nothing kept for this teacher: the recorder starts, as before", async () => {
    record();
    expect(await screen.findByRole("timer")).toBeInTheDocument();
    expect(engine.started).toBeGreaterThan(0);
    expect(screen.queryByRole("link", { name: "Send saved recording" })).toBeNull();
  });

  // bd-ma9jiy (queue #262) — the operator 25 Nov ~19:45: a kept recording reopens as the PAUSED recording (Resume / Stop),
  // not as a Send saved recording card. The real engine's paused state, Resume and Stop: resumeKept.test.tsx.
  it("a recording kept for THIS teacher: the recorder opens WITH it (paused there); no Send saved recording card", async () => {
    keep("rec-ayesha", AYESHA, "2026-11-25T04:38:00Z");
    record();
    expect(await screen.findByRole("timer")).toBeInTheDocument();
    expect(engine.kept).toBe("rec-ayesha");
    expect(screen.queryByRole("link", { name: "Send saved recording" })).toBeNull();
  });

  it("her copy is the one reopened when a NEWER kept recording belongs to another teacher", async () => {
    keep("rec-huma", "923009990009", "2026-11-25T06:30:00Z");
    keep("rec-ayesha", AYESHA, "2026-11-25T04:38:00Z");
    record();
    expect(await screen.findByRole("timer")).toBeInTheDocument();
    expect(engine.kept).toBe("rec-ayesha");
  });

  it("a kept recording of ANOTHER teacher only: no card here, the recorder starts", async () => {
    keep("rec-huma", "923009990009", "2026-11-25T06:30:00Z");
    record();
    expect(await screen.findByRole("timer")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Send saved recording" })).toBeNull();
  });

  // bd-ma9jiy: a kept recording now opens the paused recorder, so the line is checked where it always sits: the visit page.
  it("in Urdu: the weak-internet line is Urdu", async () => {
    await act(async () => { await i18n.changeLanguage("ur"); });
    renderAt(`/portal/coach/visit/${VISIT_ID}`);
    expect(await screen.findByText("انٹرنیٹ کمزور ہے؟ فون کی ریکارڈر ایپ میں ریکارڈ کریں، پھر یہاں اپ لوڈ کریں۔")).toBeInTheDocument();
  });
});

describe("Record observation — upload-only (a person the switch names): ONE button", () => {
  beforeEach(() => { sw.on = true; });

  it("Upload recording is the only action; no Record on phone, no capture input, no recorder", async () => {
    record();
    const upload = await screen.findByRole("button", { name: "Upload recording" });
    expect(screen.getByText(UPLOAD_ONLY)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Record on phone" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Start recording" })).toBeNull();
    expect(document.querySelector("input[capture]")).toBeNull();
    expect(engine.started).toBe(0);

    const pick = screen.getByTestId("phone-upload-input") as HTMLInputElement;
    const clicked = vi.spyOn(pick, "click");
    fireEvent.click(upload);
    expect(clicked).toHaveBeenCalled();
    await act(async () => { fireEvent.change(pick, { target: { files: [m4a()] } }); });
    expect(await screen.findByText("check and send")).toBeInTheDocument();
    expect(getDraft(VISIT_ID)?.filename).toBe("Voice 001.m4a");
  });

  it("a kept copy for this teacher is still offered", async () => {
    keep("rec-ayesha", AYESHA, "2026-11-25T04:38:00Z");
    record();
    expect(await screen.findByRole("link", { name: "Send saved recording" })).toBeInTheDocument();
  });
});

describe("the visit page — the line above Start recording / Upload recording, and the kept copy", () => {
  it("the weak-internet line sits with the pair", async () => {
    renderAt(`/portal/coach/visit/${VISIT_ID}`);
    const line = await screen.findByText(WEAK);
    const group = line.closest('[role="group"]') as HTMLElement;
    expect(within(group).getByRole("link", { name: "Start recording" })).toBeInTheDocument();
    expect(within(group).getByRole("link", { name: "Upload recording" })).toBeInTheDocument();
  });

  // bd-ma9jiy (queue #262) — with the in-app recorder, the visit page's way back is Continue recording (the record step
  // opens it paused); upload-only keeps Send saved recording.
  it("a recording kept for this teacher: Continue recording on the visit page, to the record step", async () => {
    keep("rec-ayesha", AYESHA, "2026-11-25T04:38:00Z");
    renderAt(`/portal/coach/visit/${VISIT_ID}`);
    expect(await screen.findByRole("link", { name: "Continue recording" })).toHaveAttribute("href", `/portal/coach/visit/${VISIT_ID}/record`);
  });
});

/* ── Debrief ─────────────────────────────────────────────────────────────── */

const VIEW = (step: string) => ({
  id: "cs-1", createdAt: "2026-11-25T06:30:00Z", sessionStatus: "x", step, problem: null, preparing: false, portal: true,
  teacher: { name: "Ayesha Bibi", phone: AYESHA }, lesson: { topic: null, subject: null, hasLessonPlan: false }, draft: { edited: false },
  talk: { guide: null, recordedAt: null, feedback: null },
  report: { status: null, teacherName: "Ayesha Bibi", teacherPhone: null, caption: null, companionText: null, imageUrl: null, sentAt: null, templateSentAt: null },
});
const GUIDE = { intro: "Open with what worked.", steps: [{ title: "Start", body: "Say what went well." }], reflection_question: "What will you try?" };

describe("Debrief", () => {
  beforeEach(() => {
    L.getObservation.mockResolvedValue(VIEW("talk"));
    L.getTalkGuide.mockResolvedValue({ guide: GUIDE });
    L.presignObserveUpload.mockResolvedValue({ uploadUrl: "https://r2/put", contentType: "audio/mp4", key: "k/talk.m4a" });
    P.uploadToR2.mockResolvedValue(undefined);
    L.startTalk.mockResolvedValue({ success: true });
  });

  it("switch off: Start recording opens the in-app recorder; Upload recording beside it; the weak-internet line with them", async () => {
    renderAt("/portal/coach/observation/cs-1/debrief");
    const start = await screen.findByRole("button", { name: "Start recording" });
    expect(screen.getByRole("button", { name: "Upload recording" })).toBeInTheDocument();
    expect(screen.getByText(WEAK)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Record on phone" })).toBeNull();
    fireEvent.click(start);
    expect(await screen.findByText("web recorder")).toBeInTheDocument();
  });

  it("upload-only: ONE button, Upload recording, with its line; no recorder", async () => {
    sw.on = true;
    renderAt("/portal/coach/observation/cs-1/debrief");
    const upload = await screen.findByRole("button", { name: "Upload recording" });
    expect(screen.getByText(UPLOAD_ONLY)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start recording" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Record on phone" })).toBeNull();
    expect(document.querySelector("input[capture]")).toBeNull();
    const pick = screen.getByTestId("talk-input") as HTMLInputElement;
    const clicked = vi.spyOn(pick, "click");
    fireEvent.click(upload);
    expect(clicked).toHaveBeenCalled();
    await act(async () => { fireEvent.change(pick, { target: { files: [m4a("Debrief.m4a")] } }); });
    await waitFor(() => expect(L.startTalk).toHaveBeenCalled());
    expect(engine.started).toBe(0);
  });
});
