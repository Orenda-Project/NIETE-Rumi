import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import i18n from "i18next";

/**
 * bd-kcv8s5 — the "Make a quiz" block at the foot of a ready Digital Coach report. The screen asks the server once
 * (portal.getReportQuizBlock) what to draw:
 *
 *   null (off, an error, anything unknown)   today's "Quiz this lesson" button (LessonQuizButton), nothing else
 *   inline                                   the quiz maker in a frame on this screen; the frame tells the screen its
 *                                            height (postMessage 'rq-height'), accepted only from that frame, this origin
 *   page                                     one button that opens the quiz maker as its own page
 *
 * A coach's visit report, or one still being worked on, asks nothing and draws nothing (the gate is the page's own).
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
  getReportQuizBlock: vi.fn(),
}));
vi.mock("../../services/api", () => ({
  default: { get: vi.fn(), post: vi.fn() },
  portal,
  language: { get: vi.fn(() => new Promise(() => {})), set: vi.fn() },
}));
const nav = vi.hoisted(() => ({ goTo: vi.fn() }));
vi.mock("./navigate", () => nav);

vi.mock("../home/LessonQuizButton", () => ({ LessonQuizButton: ({ from, sessionId }: { from?: string; sessionId?: string }) => <i data-testid="quiz-this" data-from={from ?? "lp"} data-session={sessionId ?? ""} /> }));

import "../routes";
import api from "../../services/api";
import { resetShareAvailability } from "../share/api";
import { ReportPage } from "./ReportPage";
import { COACHING_REPORT } from "./paths";
import { COACHING_V2_COPY as EN, COACHING_V2_COPY_UR as UR } from "./copy";

const http = api as unknown as { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> };
const ID = "0b4e8f9a-1c2d-4e5f-8a9b-0c1d2e3f4a5b";
const INLINE_URL = "/cq/tok123?embed=portal";
const PAGE_URL = "/cq/tok123?from=portal";

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
  reportNarrative: { headline: "A lesson the whole class joined", identity: "", moments: [], strength: null, horizon: null, domainWhys: {}, language: "en", journeyNote: null },
};
const VISIT = { observerName: "Head Testwala", observedAt: DETAIL.date, sentAt: null, reportImageUrl: "https://r2/visit.png", caption: null, companionText: null };

const ready = (detail: Record<string, unknown> = DETAIL) => {
  portal.getCoachingProgress.mockResolvedValue({ id: ID, status: "completed", stage: "done", reflection: null, reportReady: true });
  portal.getCoachingSession.mockResolvedValue({ session: detail });
};

beforeEach(async () => {
  vi.clearAllMocks();
  resetShareAvailability();
  if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} });
  await act(async () => { await i18n.changeLanguage("en"); });
  http.get.mockImplementation(async (url: string) => {
    if (url === `/teacher/coaching/${ID}/journey`) return { data: { success: true, points: [{ date: "2026-09-10", pct: 50 }, { date: "2026-10-02", pct: 58 }] } };
    throw new Error(`unexpected GET ${url}`);
  });
});
afterEach(async () => {
  await act(async () => { await i18n.changeLanguage("en"); });
});

const open = () => render(
  <MemoryRouter initialEntries={[COACHING_REPORT.replace(":id", ID)]}>
    <Routes><Route path={COACHING_REPORT} element={<ReportPage />} /></Routes>
  </MemoryRouter>,
);

const frame = () => document.querySelector("iframe[data-report-quiz-frame]") as HTMLIFrameElement | null;
const post = (data: unknown, origin: string, source: MessageEventSource | null) => {
  act(() => { window.dispatchEvent(new MessageEvent("message", { data, origin, source })); });
};

describe("the report page — the Make a quiz block", () => {
  it("switch off (null): today's Quiz this lesson button, no frame", async () => {
    ready();
    portal.getReportQuizBlock.mockResolvedValue(null);
    open();
    expect((await screen.findByTestId("quiz-this")).getAttribute("data-from")).toBe("coach");
    expect(portal.getReportQuizBlock).toHaveBeenCalledTimes(1);
    expect(portal.getReportQuizBlock).toHaveBeenCalledWith(ID);
    expect(frame()).toBeNull();
  });

  it("the call throws: the same, fail closed", async () => {
    ready();
    portal.getReportQuizBlock.mockRejectedValue(new Error("network"));
    open();
    expect(await screen.findByTestId("quiz-this")).toBeTruthy();
    expect(frame()).toBeNull();
  });

  it("a coach's visit report: never asked, no frame, no button", async () => {
    ready({ ...DETAIL, observation: VISIT });
    portal.getReportQuizBlock.mockResolvedValue({ mode: "inline", url: INLINE_URL });
    open();
    await waitFor(() => expect(portal.getCoachingSession).toHaveBeenCalled());
    await screen.findAllByRole("heading");
    expect(portal.getReportQuizBlock).not.toHaveBeenCalled();
    expect(frame()).toBeNull();
    expect(screen.queryByTestId("quiz-this")).toBeNull();
  });

  it("not ready yet: never asked", async () => {
    portal.getCoachingProgress.mockResolvedValue({ id: ID, status: "conducting_conversation", stage: "reflection", source: "portal",
      reflection: { questionNumber: 1, question: "Which children answered?" } });
    portal.getCoachingSession.mockResolvedValue({ session: DETAIL });
    portal.getReportQuizBlock.mockResolvedValue({ mode: "inline", url: INLINE_URL });
    open();
    await screen.findByRole("textbox");
    expect(portal.getReportQuizBlock).not.toHaveBeenCalled();
    expect(frame()).toBeNull();
  });

  it("inline: the quiz maker in a frame on this screen, and not the old button", async () => {
    ready();
    portal.getReportQuizBlock.mockResolvedValue({ mode: "inline", url: INLINE_URL });
    open();
    await waitFor(() => expect(frame()).not.toBeNull());
    const f = frame()!;
    expect(f.getAttribute("src")).toBe(INLINE_URL);
    expect(f.getAttribute("allow") ?? "").toContain("clipboard-write");
    expect(f.getAttribute("title")).toBe(EN.quizFrameTitle);
    expect(screen.queryByTestId("quiz-this")).toBeNull();
    expect(portal.getReportQuizBlock).toHaveBeenCalledTimes(1);
  });

  it("the frame sets its own height; nothing else does", async () => {
    ready();
    portal.getReportQuizBlock.mockResolvedValue({ mode: "inline", url: INLINE_URL });
    open();
    await waitFor(() => expect(frame()).not.toBeNull());
    const f = frame()!;
    const me = window.location.origin;
    const src = f.contentWindow;
    const height = () => f.style.height;

    post({ type: "rq-height", h: 640 }, me, src);
    expect(height()).toBe("640px");

    post({ type: "rq-height", h: 700 }, "https://evil.example", src);
    expect(height()).toBe("640px");
    post({ type: "rq-height", h: 700 }, me, window);
    expect(height()).toBe("640px");
    post({ type: "rq-height", h: "700" }, me, src);
    expect(height()).toBe("640px");
    post({ type: "rq-height", h: 0 }, me, src);
    expect(height()).toBe("640px");
    post({ type: "rq-height", h: 10001 }, me, src);
    expect(height()).toBe("640px");
    post({ type: "rq-height", h: 12.5 }, me, src);
    expect(height()).toBe("640px");
    post({ type: "other", h: 700 }, me, src);
    expect(height()).toBe("640px");
  });

  it("page: one link to the quiz maker, no frame", async () => {
    ready();
    portal.getReportQuizBlock.mockResolvedValue({ mode: "page", url: PAGE_URL });
    open();
    const link = await screen.findByRole("link", { name: EN.quizMake });
    expect(link.getAttribute("href")).toBe(PAGE_URL);
    expect(frame()).toBeNull();
    expect(screen.queryByTestId("quiz-this")).toBeNull();
  });

  it("Urdu: the label and the frame's title come from the Urdu words", async () => {
    await act(async () => { await i18n.changeLanguage("ur"); });
    ready();
    portal.getReportQuizBlock.mockResolvedValue({ mode: "page", url: PAGE_URL });
    const first = open();
    const link = await screen.findByRole("link", { name: UR.quizMake });
    expect(link.getAttribute("href")).toBe(PAGE_URL);
    first.unmount();

    portal.getReportQuizBlock.mockResolvedValue({ mode: "inline", url: INLINE_URL });
    open();
    await waitFor(() => expect(frame()).not.toBeNull());
    expect(frame()!.getAttribute("title")).toBe(UR.quizFrameTitle);
  });
});
