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
}));
vi.mock("../../services/api", () => ({ default: { get: vi.fn(), post: vi.fn() }, portal }));

import "../routes";
import api from "../../services/api";
import { ReportPage } from "./ReportPage";
import { toReportData } from "./report";
import { COACHING_REPORT } from "./paths";
import { COACHING_V2_COPY as C } from "./copy";

const http = api as unknown as { get: ReturnType<typeof vi.fn> };
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

  it("ready: Done line, voice note, her recording, the report, Download; her answer folded", async () => {
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

    const fold = screen.getByRole("button", { name: new RegExp(C.yourAnswer) });
    expect(fold.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(fold);
    expect(screen.getByText("Only the front rows.")).toBeTruthy();
  });

  it("stopped: said so, no report", async () => {
    portal.getCoachingProgress.mockResolvedValue({ id: ID, status: "failed", stage: "stopped", reflection: null });
    open();
    expect(await screen.findByText(C.stopped)).toBeTruthy();
    expect(portal.getCoachingSession).not.toHaveBeenCalled();
  });
});
