import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

/**
 * "Quiz this lesson" on a Digital Coach report (the Home card's switch): drawn once the report is ready, for her own
 * lesson only (never on a coach's visit report), as the coaching kind. The button itself is LessonQuizButton's.
 *
 * (Setup copied from ReportPage.test.tsx.) The shared report page (v28 canvas CoachingLesson / ObservationReport): one layout for a
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
  getCoachingReportFile: vi.fn(),
}));
vi.mock("../../services/api", () => ({ default: { get: vi.fn(), post: vi.fn() }, portal }));
const nav = vi.hoisted(() => ({ goTo: vi.fn() }));
vi.mock("./navigate", () => nav);

vi.mock("../home/LessonQuizButton", () => ({ LessonQuizButton: ({ from, sessionId }: { from?: string; sessionId?: string }) => <i data-testid="quiz-this" data-from={from ?? "lp"} data-session={sessionId ?? ""} /> }));

import "../routes";
import api from "../../services/api";
import { resetShareAvailability } from "../share/api";
import { ReportPage } from "./ReportPage";
import { COACHING_REPORT } from "./paths";

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
  // a report the bot wrote its narrative for (every new one); one without shows the WhatsApp image instead.
  reportNarrative: { headline: "A lesson the whole class joined", identity: "", moments: [], strength: null, horizon: null, domainWhys: {}, language: "en", journeyNote: null },
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

describe("the report page — Quiz this lesson", () => {
  const visit = { observerName: "Head Testwala", observedAt: DETAIL.date, sentAt: null, reportImageUrl: "https://r2/visit.png", caption: null, companionText: null };

  it("a ready Digital Coach report: the button, as the coaching kind", async () => {
    portal.getCoachingProgress.mockResolvedValue({ id: ID, status: "completed", stage: "done", reflection: null, reportReady: true });
    portal.getCoachingSession.mockResolvedValue({ session: DETAIL });
    open();
    expect((await screen.findByTestId("quiz-this")).getAttribute("data-from")).toBe("coach");
  });

  it("the button carries this report's session, so the quiz home makes the quiz for THIS lesson (ICT IAB row 35)", async () => {
    portal.getCoachingProgress.mockResolvedValue({ id: ID, status: "completed", stage: "done", reflection: null, reportReady: true });
    portal.getCoachingSession.mockResolvedValue({ session: DETAIL });
    open();
    expect((await screen.findByTestId("quiz-this")).getAttribute("data-session")).toBe(ID);
  });

  it("a coach's visit report: no button", async () => {
    portal.getCoachingProgress.mockResolvedValue({ id: ID, status: "completed", stage: "done", reflection: null, reportReady: true });
    portal.getCoachingSession.mockResolvedValue({ session: { ...DETAIL, observation: visit } });
    open();
    await screen.findAllByRole("heading");
    await waitFor(() => expect(portal.getCoachingSession).toHaveBeenCalled());
    expect(screen.queryByTestId("quiz-this")).toBeNull();
  });

  it("still being worked on: no button", async () => {
    portal.getCoachingProgress.mockResolvedValue({ id: ID, status: "conducting_conversation", stage: "reflection", source: "portal",
      reflection: { questionNumber: 1, question: "Which children answered?" } });
    portal.getCoachingSession.mockResolvedValue({ session: DETAIL });
    open();
    await screen.findByRole("textbox");
    expect(screen.queryByTestId("quiz-this")).toBeNull();
  });
});
