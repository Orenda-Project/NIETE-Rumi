import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

/**
 * bd-bmc9a0.4 — ICT feedback (IAB Experience View, Quratulain), rows 34–36, on a ready Digital Coach report:
 *
 *   row 34   the audio summary's corner showed the time the report came ("15:47") where a length belongs, so a
 *            1–2 minute summary read as 15 minutes: no clock of the day on the report's voice note
 *   row 35   «فوری جانچ بنائیں» sat between the audio summary and the report: it comes after the report
 *   row 36   «دوسری ایپ میں کھولیں» reads as "open in another app": here it is «دوسرے ٹیب میں کھولیں»; and a Close
 *            that ends the session — «آپ کا ڈیجیٹل کوچنگ سیشن مکمل ہو گیا ہے۔» — and closes the link
 *
 * (Setup copied from ReportPage.quiz.test.tsx.)
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

vi.mock("../home/LessonQuizButton", () => ({ LessonQuizButton: ({ from }: { from?: string }) => <i data-testid="quiz-this" data-from={from ?? "lp"} /> }));

import "../routes";
import api from "../../services/api";
import { resetShareAvailability } from "../share/api";
import { ReportPage } from "./ReportPage";
import { COACHING_REPORT } from "./paths";
import { COACHING_V2_COPY as C, COACHING_V2_COPY_UR as U } from "./copy";

const http = api as unknown as { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> };
const ID = "0b4e8f9a-1c2d-4e5f-8a9b-0c1d2e3f4a5b";

const DETAIL = {
  // 10:47 UTC is 15:47 in Pakistan: the clock row 34's screenshot showed.
  id: ID, date: "2026-10-26T10:47:00Z", duration: 1680, overallScore: 30, maxScore: 52, percentage: 58,
  topic: "Provinces of Pakistan", subject: "Social Studies",
  lessonAudioUrl: "https://r2/lesson.webm", debriefAudioUrl: "https://r2/debrief.mp3", reportUrl: "https://r2/report.png",
  photoUrls: ["https://r2/p1.jpg"],
  breakdown: { framework: "fico", language: "en", overall: 58, marks: 30, max: 52, groups: [
    { key: "B", domainKey: "lp", name: "Lesson Plan Fidelity", score: 9, max: 14, pct: 64, indicators: [] },
  ] },
  reflection: [{ question: "Which children answered?", answer: "Only the front rows.", language: "en", asked_at: null, answered_at: null }],
  prioritizedAction: { action: "Ask the back rows first.", commitment: null },
  analysisData: { overall_score: { points: 30, max_points: 52, percentage: 58 } },
  observation: null,
  reportNarrative: { headline: "A lesson the whole class joined", identity: "", moments: [], strength: null, horizon: null, domainWhys: {}, language: "en", journeyNote: null },
};

const ready = (detail: Record<string, unknown> = DETAIL) => {
  portal.getCoachingProgress.mockResolvedValue({ id: ID, status: "completed", stage: "done", reflection: null, reportReady: true });
  portal.getCoachingSession.mockResolvedValue({ session: detail });
};

let close: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.clearAllMocks();
  resetShareAvailability();
  http.get.mockImplementation(async (url: string) => {
    if (url === `/teacher/coaching/${ID}/journey`) return { data: { success: true, points: [] } };
    throw new Error(`unexpected GET ${url}`);
  });
  close = vi.spyOn(window, "close").mockImplementation(() => undefined);
});
afterEach(() => close.mockRestore());

const open = () => render(
  <MemoryRouter initialEntries={[COACHING_REPORT.replace(":id", ID)]}>
    <Routes><Route path={COACHING_REPORT} element={<ReportPage />} /></Routes>
  </MemoryRouter>,
);

describe("row 34 — the audio summary shows no clock of the day", () => {
  it("the report's time (15:47 Pakistan) is nowhere on the voice note", async () => {
    ready();
    open();
    const summary = await screen.findByRole("group", { name: new RegExp(C.title) });
    expect(summary.textContent).not.toContain("15:47");
  });
});

describe("row 35 — Quick Quiz comes after the report", () => {
  it("below the comprehensive report, not between it and the audio summary", async () => {
    ready();
    open();
    const quiz = await screen.findByTestId("quiz-this");
    const report = screen.getByRole("heading", { name: C.fullReport });
    // the quiz follows the report's heading (and so the whole report under it) in the page
    expect(report.compareDocumentPosition(quiz) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const audio = screen.getByRole("heading", { name: C.voiceNote });
    expect(audio.compareDocumentPosition(report) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("row 36 — Open in another tab, and Close", () => {
  it("the words, in English and Urdu", () => {
    expect(C.openInTab).toBe("Open in another tab");
    expect(U.openInTab).toBe("دوسرے ٹیب میں کھولیں");
    expect(C.close).toBe("Close");
    expect(U.close).toBe("بند کریں");
    expect(C.sessionComplete).toBe("Your DC coaching session is now complete.");
    expect(U.sessionComplete).toBe("آپ کا ڈیجیٹل کوچنگ سیشن مکمل ہو گیا ہے۔");
  });

  it("the dock's Open says 'Open in another tab'", async () => {
    ready();
    open();
    const openBtn = await screen.findByTestId("share-open");
    expect(openBtn.textContent).toContain(C.openInTab);
  });

  it("Close ends the session: the complete line, and the link is closed", async () => {
    ready();
    open();
    fireEvent.click(await screen.findByRole("button", { name: C.close }));
    expect(await screen.findByText(C.sessionComplete)).toBeTruthy();
    expect(close).toHaveBeenCalled();
    // the report is gone: nothing more to do on this page
    expect(screen.queryByRole("heading", { name: C.fullReport })).toBeNull();
  });

  it("a coach's visit report has no Close (it is not her DC session)", async () => {
    const visit = { observerName: "Head Testwala", observedAt: DETAIL.date, sentAt: null, reportImageUrl: "https://r2/visit.png", caption: null, companionText: null };
    ready({ ...DETAIL, observation: visit });
    open();
    await screen.findByTestId("share-open");
    expect(screen.queryByRole("button", { name: C.close })).toBeNull();
  });
});
