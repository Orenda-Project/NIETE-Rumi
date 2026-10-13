import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

/**
 * bd-fmf24g.4 — the shared report page (v28 canvas CoachingLesson / ObservationReport): one layout for a
 * Digital Coach lesson and a coach's visit.
 *
 *   progress     ProgressSteps from the pipeline's stage while it works; a small "Done" line once ready
 *   reflection   the one question, inline, answered here (the existing portal answer endpoint); answered,
 *                it folds into "Your answer"
 *   ready        the voice note (DC, when the bot sent one), her recording, the report sections (ReportBody),
 *                and Download of the report she got on WhatsApp — never a transcript or a rubric
 */

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("../../lib/recordingSession", () => ({ useRecordingSession: () => null, useRecordingClock: () => 0 }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: () => ({ user: { firstName: "Ayesha", lastName: "Bibi" } }) }));
const portal = vi.hoisted(() => ({
  getCoachingProgress: vi.fn(),
  getCoachingSession: vi.fn(),
  submitCoachingReflection: vi.fn(),
  presignCoachingUpload: vi.fn(),
  uploadToR2: vi.fn(),
  submitCoachingVoiceReflection: vi.fn(),
}));
vi.mock("../../services/api", () => ({ default: { get: vi.fn(), post: vi.fn() }, portal }));

import "../routes";
import api from "../../services/api";
import { resetShareAvailability } from "../share/api";
import { ReportPage } from "./ReportPage";
import { toReportData } from "./report";
import { COACHING_REPORT } from "./paths";
import { COACHING_V2_COPY as C, COACHING_V2_COPY_UR as U } from "./copy";

const http = api as unknown as { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> };
const ID = "0b4e8f9a-1c2d-4e5f-8a9b-0c1d2e3f4a5b";

const DETAIL = {
  id: ID, date: "2026-10-02T06:00:00Z", duration: 1680, overallScore: 30, maxScore: 52, percentage: 58,
  topic: "Provinces of Pakistan", subject: "Social Studies",
  lessonAudioUrl: "https://r2/lesson.webm", debriefAudioUrl: "https://r2/debrief.mp3", reportUrl: "https://r2/report.png",
  photoUrls: ["https://r2/p1.jpg"],
  breakdown: { framework: "fico", language: "en", overall: 58, marks: 30, max: 52, groups: [
    { key: "B", domainKey: "lp", name: "Lesson Plan Fidelity", score: 9, max: 14, pct: 64, indicators: [] },
    { key: "C", domainKey: "hlp", name: "High-Leverage Practices", score: 6, max: 8, pct: 75, indicators: [] },
  ] },
  reflection: [{ question: "Which children answered?", answer: "Only the front rows.", language: "en", asked_at: null, answered_at: null }],
  prioritizedAction: { action: "Ask the back rows first.", commitment: null },
  analysisData: { overall_score: { points: 30, max_points: 52, percentage: 58 } },
  observation: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  resetShareAvailability();
  http.get.mockImplementation(async (url: string) => {
    if (url === `/teacher/coaching/${ID}/journey`) return { data: { success: true, points: [{ date: "2026-09-10", pct: 50 }, { date: "2026-10-02", pct: 58 }] } };
    throw new Error(`unexpected GET ${url}`);
  });
});

const open = () => render(
  <MemoryRouter initialEntries={[COACHING_REPORT.replace(":id", ID)]}>
    <Routes><Route path={COACHING_REPORT} element={<ReportPage />} /></Routes>
  </MemoryRouter>,
);

describe("toReportData", () => {
  it("the report's own numbers and sections, her commitment action, the journey; no invented headline", () => {
    const d = toReportData(DETAIL as never, { teacher: "Ayesha Bibi", journey: [{ date: "2026-09-10", pct: 50 }, { date: "2026-10-02", pct: 58 }] });
    expect(d).toMatchObject({
      headline: "", marks: 30, max: 52, teacher: "Ayesha Bibi", topic: "Provinces of Pakistan",
      sections: [
        { code: "B", label: "Lesson Plan Fidelity", score: 9, max: 14 },
        { code: "C", label: "High-Leverage Practices", score: 6, max: 8 },
      ],
      tryNext: "Ask the back rows first.",
      journey: { points: [50, 58] },
      debrief: null,
    });
    expect(d.photos).toEqual([{ src: "https://r2/p1.jpg", cap: "" }]);
  });

  it("bd-fmf24g.10 — the stored narrative fills the headline, identity, the first moment, strength, horizon and each section's why", () => {
    const d = toReportData({
      ...DETAIL,
      breakdown: { ...DETAIL.breakdown, groups: [
        { ...DETAIL.breakdown.groups[0], notAssessed: true, why: "No lesson plan was attached." },
        { ...DETAIL.breakdown.groups[1], domainKey: "hlp" },
      ] },
      reportNarrative: {
        headline: "You made fractions feel easy", identity: "A teacher who waits",
        moments: [{ title: "Pair talk", quote: "Tell your partner why", why: "Every child spoke" }, { title: "Two", quote: "q2", why: "w2" }],
        strength: { title: "Wait time", note: "You waited." }, horizon: { title: "Name one moment", note: "" },
        domainWhys: { lp: "model line that must not replace the code-written one", hlp: "You modelled each fold." }, language: "en",
      },
    } as never, { teacher: "Ayesha Bibi", journey: [] });
    expect(d).toMatchObject({
      headline: "You made fractions feel easy", identity: "A teacher who waits",
      moment: { quote: "Tell your partner why", why: "Every child spoke" },
      strength: { title: "Wait time", note: "You waited." },
      horizon: { title: "Name one moment" },
    });
    expect(d.horizon).not.toHaveProperty("note");
    expect(d.sections.map((x) => x.why)).toEqual(["No lesson plan was attached.", "You modelled each fold."]);
  });

  it("bd-fmf24g.10 — without a stored narrative those sections are left out: no headline, no moment, strength, horizon or why", () => {
    const d = toReportData(DETAIL as never, { teacher: "Ayesha Bibi", journey: [] });
    expect(d.headline).toBe("");
    expect(d.moment).toBeNull();
    expect(d.strength).toBeNull();
    expect(d.horizon).toBeNull();
    expect(d.sections.every((x) => x.why === undefined)).toBe(true);
  });

  it("a session with no marks yet carries none: not a stand-in 0/0", () => {
    const d = toReportData({ ...DETAIL, overallScore: undefined, maxScore: null, breakdown: null } as never, { teacher: "Ayesha Bibi", journey: [] });
    expect(d.marks).toBeNull();
    expect(d.max).toBeNull();
  });

  it("a coach's visit: her debrief from the coach as the last section", () => {
    const d = toReportData({ ...DETAIL, prioritizedAction: null, observation: {
      observerName: "Hataf Atif", observedAt: null, sentAt: null, reportImageUrl: "https://r2/hero.png", caption: null,
      companionText: "We talked about the paper strips.",
    } } as never, { teacher: "Ayesha Bibi", journey: [] });
    expect(d.debrief).toEqual({ heading: "From Hataf Atif", initials: "HA", note: "We talked about the paper strips." });
    expect(d.journey).toBeNull();
  });
});

describe("the report page — a Digital Coach lesson", () => {
  it("while it waits for her answer: the steps, the question inline, no report yet", async () => {
    portal.getCoachingProgress.mockResolvedValue({ id: ID, status: "conducting_conversation", stage: "reflection", source: "portal",
      reflection: { questionNumber: 1, question: "Which children answered?" } });
    portal.submitCoachingReflection.mockResolvedValue({ done: true, acknowledgement: "Thank you." });
    open();

    const steps = await screen.findByRole("region", { name: C.progress });
    expect(within(steps).getByText(C.stepReflection)).toBeTruthy();
    expect(within(steps).getByText(C.yourTurn)).toBeTruthy();
    expect(screen.getByText("Which children answered?")).toBeTruthy();
    expect(screen.queryByRole("region", { name: /scores/i })).toBeNull();
    expect(screen.queryByRole("link", { name: C.download })).toBeNull();

    fireEvent.change(screen.getByRole("textbox", { name: C.yourAnswer }), { target: { value: "Only the front rows." } });
    fireEvent.click(screen.getByRole("button", { name: C.send }));
    await waitFor(() => expect(portal.submitCoachingReflection).toHaveBeenCalledWith(ID, "Only the front rows."));
  });

  // bd-kn3m1a — ICT feedback (IAB Experience View, row 10): after her answer the page goes straight to the audio
  // summary, then "Your Comprehensive Lesson Report". Her lesson recording and the reflection question (with her
  // answer) no longer appear again in between.
  it("ready: Done line, the audio summary, then the comprehensive report, Download — no recording, no Q&A again", async () => {
    portal.getCoachingProgress.mockResolvedValue({ id: ID, status: "completed", stage: "done", reflection: null, reportReady: true });
    portal.getCoachingSession.mockResolvedValue({ session: DETAIL });
    open();

    expect(await screen.findByRole("region", { name: /scores/i })).toBeTruthy();
    expect(screen.getByText("Lesson Plan Fidelity")).toBeTruthy();
    expect(screen.getByRole("button", { name: new RegExp(C.done) })).toBeTruthy();
    expect(screen.getByRole("group", { name: /Digital Coach/ })).toBeTruthy();
    expect(screen.getByRole("link", { name: C.download }).getAttribute("href")).toBe("https://r2/report.png");
    expect(screen.queryByText(/transcript/i)).toBeNull();
    expect(screen.queryByText(/rubric/i)).toBeNull();

    expect(screen.queryByRole("heading", { name: C.yourRecording })).toBeNull();
    expect(screen.queryByRole("group", { name: C.yourRecording })).toBeNull();
    expect(screen.queryByRole("button", { name: new RegExp(C.yourAnswer) })).toBeNull();
    expect(screen.queryByText("Which children answered?")).toBeNull();

    const summary = screen.getByRole("heading", { name: C.voiceNote });
    const report = screen.getByRole("heading", { name: C.fullReport });
    const scores = screen.getByRole("region", { name: /scores/i });
    expect(summary.compareDocumentPosition(report) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(report.compareDocumentPosition(scores) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("bd-kn3m1a — while it is worked on, her recording is not shown again either", async () => {
    portal.getCoachingProgress.mockResolvedValue({ id: ID, status: "conducting_conversation", stage: "reflection", source: "portal",
      reflection: { questionNumber: 1, question: "Which children answered?" } });
    portal.getCoachingSession.mockResolvedValue({ session: DETAIL });
    open();
    await screen.findByRole("textbox", { name: C.yourAnswer });
    expect(screen.queryByRole("heading", { name: C.yourRecording })).toBeNull();
  });

  it("bd-kn3m1a — a coach's visit report is unchanged: it still has her recording and no DC report heading", async () => {
    portal.getCoachingProgress.mockResolvedValue({ id: ID, status: "completed", stage: "done", reflection: null, reportReady: true });
    portal.getCoachingSession.mockResolvedValue({ session: { ...DETAIL, observation: { observerName: "Hataf Atif", observedAt: DETAIL.date,
      sentAt: null, reportImageUrl: "https://r2/visit.png", caption: null, companionText: null } } });
    open();
    expect(await screen.findByRole("heading", { name: C.yourRecording })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: C.fullReport })).toBeNull();
  });

  it("bd-kn3m1a — 'Your Comprehensive Lesson Report' in English and Urdu", () => {
    expect(C.fullReport).toBe("Your Comprehensive Lesson Report");
    expect(U.fullReport).toBe("آپ کے سبق کی مکمل رپورٹ");
  });

  it("bd-fmf24g.30 — the dock: Send on WhatsApp is locked (no template configured), and Open is the report image", async () => {
    portal.getCoachingProgress.mockResolvedValue({ id: ID, status: "completed", stage: "done", reflection: null, reportReady: true });
    portal.getCoachingSession.mockResolvedValue({ session: DETAIL });
    open();
    const send = await screen.findByTestId("share-send");
    await waitFor(() => expect(send).toBeDisabled());
    expect(send.textContent).toContain("Not available yet");
    expect(screen.getByTestId("share-open")).toBeTruthy();
  });

  it("bd-fmf24g.30 — configured: a press posts {kind:'dc', id}; a coach's visit posts kind 'observation'", async () => {
    http.get.mockImplementation(async (url: string) => {
      if (url === "/share/availability") return { data: { kinds: { dc: true, observation: true } } };
      if (url === `/teacher/coaching/${ID}/journey`) return { data: { success: true, points: [] } };
      throw new Error(`unexpected GET ${url}`);
    });
    http.post.mockResolvedValue({ data: { status: "sent", at: "2026-10-10T10:42:00.000Z" } });
    portal.getCoachingProgress.mockResolvedValue({ id: ID, status: "completed", stage: "done", reflection: null, reportReady: true });
    portal.getCoachingSession.mockResolvedValue({ session: DETAIL });
    const first = open();
    await waitFor(() => expect(screen.getByTestId("share-send")).not.toBeDisabled());
    fireEvent.click(screen.getByTestId("share-send"));
    await waitFor(() => expect(http.post).toHaveBeenCalledWith("/share/whatsapp", { kind: "dc", id: ID }));
    first.unmount();

    resetShareAvailability();
    portal.getCoachingSession.mockResolvedValue({ session: { ...DETAIL, observation: { observerName: "Hataf Atif", observedAt: DETAIL.date, sentAt: null, reportImageUrl: "https://r2/visit.png", caption: null, companionText: null } } });
    open();
    await waitFor(() => expect(screen.getByTestId("share-send")).not.toBeDisabled());
    fireEvent.click(screen.getByTestId("share-send"));
    await waitFor(() => expect(http.post).toHaveBeenCalledWith("/share/whatsapp", { kind: "observation", id: ID }));
  });

  it("stopped: said so, no report", async () => {
    portal.getCoachingProgress.mockResolvedValue({ id: ID, status: "failed", stage: "stopped", reflection: null });
    open();
    expect(await screen.findByText(C.stopped)).toBeTruthy();
    expect(portal.getCoachingSession).not.toHaveBeenCalled();
  });
});

/**
 * bd-eygg2f — ICT feedback (IAB Experience View, row 5): teachers answer the reflection question by writing
 * OR by speaking, so the page offers both, and the step's line says so in both languages.
 */
describe("the reflection answer by voice (bd-eygg2f)", () => {
  class FakeRecorder {
    static isTypeSupported = (t: string) => t.startsWith("audio/webm");
    state = "inactive";
    ondataavailable: ((e: { data: Blob }) => void) | null = null;
    onstop: (() => void) | null = null;
    constructor(public stream: unknown, public options: unknown) {}
    start() { this.state = "recording"; }
    stop() { this.state = "inactive"; this.ondataavailable?.({ data: new Blob(["voice"], { type: "audio/webm" }) }); this.onstop?.(); }
  }
  const asking = () => {
    portal.getCoachingProgress.mockResolvedValue({ id: ID, status: "conducting_conversation", stage: "reflection", source: "portal",
      reflection: { questionNumber: 1, question: "Which children answered?" } });
  };
  beforeEach(() => {
    vi.stubGlobal("MediaRecorder", FakeRecorder);
    Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] }) }, configurable: true });
    URL.createObjectURL = vi.fn(() => "blob:answer");
    URL.revokeObjectURL = vi.fn();
  });

  it("the step's line is 'write or speak', in English and Urdu", () => {
    expect(C.subReflection).toBe("Write or speak");
    expect(U.subReflection).toBe("لکھ کر یا بول کر جواب دیں");
  });

  it("record, stop, send: the clip goes up as reflection_audio and the answer is the key", async () => {
    asking();
    portal.presignCoachingUpload.mockResolvedValue({ key: "reflection_audio/u/2026-10/portal_a.webm", uploadUrl: "https://r2/put", contentType: "audio/webm" });
    portal.uploadToR2.mockResolvedValue(undefined);
    portal.submitCoachingVoiceReflection.mockResolvedValue({ done: true, acknowledgement: "Thank you." });
    open();

    fireEvent.click(await screen.findByRole("button", { name: C.recordAnswer }));
    fireEvent.click(await screen.findByRole("button", { name: C.stop }));
    expect(await screen.findByRole("button", { name: C.removeRecording })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: C.send }));

    await waitFor(() => expect(portal.submitCoachingVoiceReflection).toHaveBeenCalledWith(ID, "reflection_audio/u/2026-10/portal_a.webm"));
    expect(portal.presignCoachingUpload).toHaveBeenCalledWith(expect.objectContaining({ kind: "reflection_audio", filename: "answer.webm" }));
    expect(portal.submitCoachingReflection).not.toHaveBeenCalled();
    expect(await screen.findByText("Thank you.")).toBeTruthy();
  });

  it("typing still sends text; the mic gives way to Send once she types", async () => {
    asking();
    portal.submitCoachingReflection.mockResolvedValue({ done: true, acknowledgement: "Thank you." });
    open();
    expect(await screen.findByRole("button", { name: C.recordAnswer })).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox", { name: C.yourAnswer }), { target: { value: "Only the front rows." } });
    expect(screen.queryByRole("button", { name: C.recordAnswer })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: C.send }));
    await waitFor(() => expect(portal.submitCoachingReflection).toHaveBeenCalledWith(ID, "Only the front rows."));
  });

  it("remove throws the clip away and brings the box back", async () => {
    asking();
    open();
    fireEvent.click(await screen.findByRole("button", { name: C.recordAnswer }));
    fireEvent.click(await screen.findByRole("button", { name: C.stop }));
    fireEvent.click(await screen.findByRole("button", { name: C.removeRecording }));
    expect(await screen.findByRole("textbox", { name: C.yourAnswer })).toBeTruthy();
    expect(portal.presignCoachingUpload).not.toHaveBeenCalled();
  });

  it("a refused mic says so and leaves typing open", async () => {
    asking();
    Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia: vi.fn().mockRejectedValue(new Error("denied")) }, configurable: true });
    open();
    fireEvent.click(await screen.findByRole("button", { name: C.recordAnswer }));
    expect(await screen.findByText(C.micBlocked)).toBeTruthy();
    expect(screen.getByRole("textbox", { name: C.yourAnswer })).toBeTruthy();
  });
});

/**
 * bd-czmyoh — ICT feedback (IAB Experience View, row 6): on WhatsApp the reflection question always comes as a
 * voice note, never as text. The portal now plays it the same way; the words show only when the bot could not
 * voice it (WhatsApp's own fallback). She answers by typing or speaking (bd-eygg2f).
 */
describe("the reflection question as a voice note (bd-czmyoh)", () => {
  it("plays the question as the Digital Coach's voice note and does not print it", async () => {
    portal.getCoachingProgress.mockResolvedValue({ id: ID, status: "conducting_conversation", stage: "reflection", source: "portal",
      reflection: { questionNumber: 1, question: "Which children answered?", audioUrl: "https://signed.example/q1.ogg" } });
    open();

    const section = await screen.findByRole("region", { name: C.stepReflection });
    const note = within(section).getByRole("group", { name: new RegExp(C.title) });
    expect(note.querySelector("audio")?.getAttribute("src")).toBe("https://signed.example/q1.ogg");
    expect(within(section).queryByText("Which children answered?")).toBeNull();
    expect(within(section).getByRole("textbox", { name: C.yourAnswer })).toBeTruthy();
  });

  it("with no voice (TTS failed) the question shows as text, as WhatsApp falls back", async () => {
    portal.getCoachingProgress.mockResolvedValue({ id: ID, status: "conducting_conversation", stage: "reflection", source: "portal",
      reflection: { questionNumber: 1, question: "Which children answered?" } });
    open();

    const section = await screen.findByRole("region", { name: C.stepReflection });
    expect(within(section).getByText("Which children answered?")).toBeTruthy();
    expect(within(section).queryByRole("group", { name: new RegExp(C.title) })).toBeNull();
  });
});

/**
 * bd-ncfml5 — ICT feedback (IAB Experience View, row 7): after she answers, the Digital Coach's follow-up on
 * WhatsApp is always a voice note, never text. The portal plays it the same way; the words show only when it
 * could not be voiced.
 */
describe("the follow-up after her answer as a voice note (bd-ncfml5)", () => {
  const asking = () => portal.getCoachingProgress.mockResolvedValue({ id: ID, status: "conducting_conversation", stage: "reflection",
    source: "portal", reflection: { questionNumber: 1, question: "Which children answered?" } });

  it("plays the follow-up as the Digital Coach's voice note and does not print it", async () => {
    asking();
    portal.submitCoachingReflection.mockResolvedValue({ done: true, acknowledgement: "That pause gave her room.",
      acknowledgementAudioUrl: "https://signed.example/closer.ogg" });
    open();
    fireEvent.change(await screen.findByRole("textbox", { name: C.yourAnswer }), { target: { value: "Only the front rows." } });
    fireEvent.click(screen.getByRole("button", { name: C.send }));

    const note = await screen.findByRole("group", { name: new RegExp(C.title) });
    expect(note.querySelector("audio")?.getAttribute("src")).toBe("https://signed.example/closer.ogg");
    expect(screen.queryByText("That pause gave her room.")).toBeNull();
  });

  it("with no voice the follow-up shows as words, as WhatsApp falls back", async () => {
    asking();
    portal.submitCoachingReflection.mockResolvedValue({ done: true, acknowledgement: "That pause gave her room." });
    open();
    fireEvent.change(await screen.findByRole("textbox", { name: C.yourAnswer }), { target: { value: "Only the front rows." } });
    fireEvent.click(screen.getByRole("button", { name: C.send }));

    expect(await screen.findByText("That pause gave her room.")).toBeTruthy();
  });
});

/**
 * bd-phk3v4 — ICT feedback (IAB Experience View, row 8): in Urdu the answer box's cursor starts on the LEFT and
 * what she types in Urdu still runs right to left — the box follows what is typed (dir="auto"), like WhatsApp's.
 */
describe("the answer box in Urdu (bd-phk3v4)", () => {
  it("follows what she types: dir=auto", async () => {
    portal.getCoachingProgress.mockResolvedValue({ id: ID, status: "conducting_conversation", stage: "reflection", source: "portal",
      reflection: { questionNumber: 1, question: "Which children answered?" } });
    open();
    const box = await screen.findByRole("textbox", { name: C.yourAnswer });
    expect(box.getAttribute("dir")).toBe("auto");
  });
});

/**
 * bd-9d1cmi — ICT feedback (IAB Experience View, row 9): the debrief's heading said "Voice note"; it now says what
 * it is — her lesson report's audio summary, not a random voice message — in English and Urdu.
 */
describe("the debrief's heading (bd-9d1cmi)", () => {
  it("is 'Audio Summary of Your Lesson Report' / 'آپ کے سبق کی رپورٹ کا آڈیو خلاصہ'", () => {
    expect(C.voiceNote).toBe("Audio Summary of Your Lesson Report");
    expect(U.voiceNote).toBe("آپ کے سبق کی رپورٹ کا آڈیو خلاصہ");
  });

  it("heads the Digital Coach's spoken debrief on the ready report", async () => {
    portal.getCoachingProgress.mockResolvedValue({ id: ID, status: "completed", stage: "done", reflection: null, reportReady: true });
    portal.getCoachingSession.mockResolvedValue({ session: DETAIL });
    open();
    expect(await screen.findByRole("heading", { name: "Audio Summary of Your Lesson Report" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Voice note" })).toBeNull();
  });
});
