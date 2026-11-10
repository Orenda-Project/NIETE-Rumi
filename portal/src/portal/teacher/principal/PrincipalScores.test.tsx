import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

/**
 * bd-33wxxi.6 — the operator, 10 Nov ~11:50, on Q1: "Lets start with hiding the scores and then later figure out if we
 * wanna show them, on the report for Principals." A principal on the principal app sees no AI score and no coach score
 * on a finished observation — one she made of a teacher (the coach's observation page and its Send preview) or her own
 * lesson (Digital Coaching's report). Everything else on those pages stays: the recording, the steps, what she made, the
 * report the teacher received, the report's sections. A coach and a teacher see exactly what they saw before.
 */

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("../../lib/recordingSession", () => ({ useRecordingSession: () => null, useRecordingClock: () => 0 }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: vi.fn() }));
// The coach app's own gate and readiness, as the coach pages' own tests stub them (the coach is let in).
vi.mock("../../coach/CoachGate", () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("../../coach/training/appReady", async (orig) => ({ ...(await orig<Record<string, unknown>>()), coachFeatureReady: () => true }));
const api = vi.hoisted(() => ({
  portal: {
    getConfig: vi.fn(), getCoachingProgress: vi.fn(), getCoachingSession: vi.fn(), getCoachingSessions: vi.fn(),
    submitCoachingReflection: vi.fn(), presignCoachingUpload: vi.fn(), uploadToR2: vi.fn(),
    submitCoachingVoiceReflection: vi.fn(), getCoachingReportFile: vi.fn(),
  },
  coach: { getObservation: vi.fn(), getReports: vi.fn(), getVisit: vi.fn(), getPending: vi.fn() },
  leader: { getObservation: vi.fn(), previewReport: vi.fn(), getObserveRecentPlans: vi.fn() },
}));
vi.mock("../../services/api", () => ({ default: { get: vi.fn(), post: vi.fn() }, ...api }));

import "../routes";
import http from "../../services/api";
import { useAuth } from "../../hooks/useAuth";
import { forgetConfig } from "../../lib/useNewUi";
import i18n from "@/i18n/config";
import { TEACHER_ROUTES } from "../routes";
import { COACHING_REPORT } from "../coaching/paths";
import { resetShareAvailability } from "../share/api";
import CoachObservation from "../../coach/pages/CoachObservation";
import SendReport from "../../coach/reports/SendReport";
import { beforeAll as preloadFirst } from "vitest";
import { preloadAll } from "@/lib/lazyPage";

preloadFirst(() => preloadAll({ pages: true }), 120_000);

const H = http as unknown as { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> };
const PRINCIPAL = { firstName: "Saima", lastName: "Sample", role: "principal", phoneNumber: "test-principal-1", schoolName: "GGPS Sample" };
const TEACHER = { ...PRINCIPAL, firstName: "Ayesha", role: "teacher", phoneNumber: "test-teacher-1" };
const COACH = { firstName: "Hataf", role: "coach", phoneNumber: "test-coach-1" };
const T = { timeout: 8000 };

// One finished observation she made of a teacher: AI score 64, coach score 61, the lesson to play, the report sent.
const OBS_ID = "aaaaaaaa-0000-4000-8000-000000000009";
const OBS = {
  success: true, id: OBS_ID, date: "2026-11-09T06:30:00Z", step: "sent", portal: true, mine: true, score: 61, dcScore: 64,
  summary: null, teacher: { name: "Ayesha Sample", teacherExtId: "900001", schoolName: "GGPS Sample" },
  observer: { self: true, name: "Saima Sample" }, sentAt: "2026-11-09T09:00:00Z", caption: "Well done, Ayesha.",
  imageUrl: "https://r2/report.png", audioUrl: "https://r2/lesson.webm",
};
const FEEDBACK = { harmful: false, praise_line: "You listened well.", wins: [], try: null, reflection_question: null, concern: null };
const VIEW = (step: string) => ({
  id: OBS_ID, createdAt: "2026-11-09T06:30:00Z", sessionStatus: "x", step, problem: null, preparing: false,
  teacher: { name: "Ayesha Sample", phone: "900001" }, lesson: { topic: null, subject: null, hasLessonPlan: false }, draft: { edited: false },
  talk: { guide: { intro: "Start with a win.", steps: [] }, recordedAt: "2026-11-09T08:00:00Z", feedback: FEEDBACK },
  report: { status: null, teacherName: "Ayesha Sample", teacherPhone: "900001", caption: "Well done, Ayesha.", companionText: null,
    imageUrl: "https://r2/report.png", sentAt: step === "sent" ? "2026-11-09T09:00:00Z" : null, templateSentAt: null },
});

// Her own lesson, analysed by the Digital Coach: 30 of 52 marks (58%).
const DC_ID = "0b4e8f9a-1c2d-4e5f-8a9b-0c1d2e3f4a5b";
const DETAIL = {
  id: DC_ID, date: "2026-11-09T06:00:00Z", duration: 1680, overallScore: 30, maxScore: 52, percentage: 58,
  topic: "Provinces of Pakistan", subject: "Social Studies",
  lessonAudioUrl: "https://r2/lesson.webm", debriefAudioUrl: "https://r2/debrief.mp3", reportUrl: "https://r2/report.png",
  photoUrls: [],
  breakdown: { framework: "fico", language: "en", overall: 58, marks: 30, max: 52, groups: [
    { key: "B", domainKey: "lp", name: "Lesson Plan Fidelity", score: 9, max: 14, pct: 64, indicators: [] },
  ] },
  reflection: [], prioritizedAction: { action: "Ask the back rows first.", commitment: null },
  analysisData: { overall_score: { points: 30, max_points: 52, percentage: 58 } }, observation: null,
  reportNarrative: { headline: "A lesson the whole class joined", identity: "", moments: [], strength: null, horizon: null, domainWhys: {}, language: "en", journeyNote: null },
};

function serve(principalApp = true) {
  api.portal.getConfig.mockResolvedValue({ features: { teacherV2: true, principalApp } });
  api.coach.getObservation.mockResolvedValue(OBS);
  api.leader.getObservation.mockResolvedValue(VIEW("sent"));
  api.portal.getCoachingProgress.mockResolvedValue({ id: DC_ID, status: "completed", stage: "done", reflection: null, reportReady: true });
  api.portal.getCoachingSession.mockResolvedValue({ session: DETAIL });
  H.get.mockImplementation(async (url: string) => {
    if (url === `/teacher/coaching/${DC_ID}/journey`) return { data: { success: true, points: [] } };
    return { data: { success: true } };
  });
}

function as(user: object) {
  vi.mocked(useAuth).mockReturnValue({ user, loading: false } as unknown as ReturnType<typeof useAuth>);
}

/** The teacher app's own routes (the principal's observation pages and Digital Coaching's report live there). */
function openTeacherApp(path: string, user: object) {
  as(user);
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>{TEACHER_ROUTES.map((r) => <Route key={r.path} path={r.path} element={r.element} />)}</Routes>
    </MemoryRouter>,
  );
}

/** The coach app's page, as the coach app mounts it (the default observe routes). */
function openCoach(path: string, pattern: string, el: JSX.Element) {
  as(COACH);
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes><Route path={pattern} element={el} /></Routes>
    </MemoryRouter>,
  );
}

const noScoreText = () => {
  const text = document.body.textContent || "";
  expect(text).not.toMatch(/AI score/);
  expect(text).not.toMatch(/Coach score/);
  expect(text).not.toMatch(/61%|64%/);
  expect(screen.queryByRole("img", { name: /AI score/ })).toBeNull();
};

describe("a principal's finished-observation report hides the AI score and the coach score (#55, operator 10 Nov)", { timeout: 20_000 }, () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    forgetConfig();
    resetShareAvailability();
    await i18n.changeLanguage("en");
  });

  it("her observation of a teacher: no AI score, no coach score; the lesson still plays and the rest stays", async () => {
    serve();
    openTeacherApp(`/portal/teacher/principal/observation/${OBS_ID}`, PRINCIPAL);
    await screen.findByTestId("coach-observation", {}, T);
    await screen.findByTestId("observation-report", {}, T);
    noScoreText();
    // the recording is still there to play, with its own word; what she made and the report the teacher got stay
    expect(screen.getByText("Class recording")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Play/i })).toBeTruthy();
    expect(screen.getByTestId("what-you-made")).toBeTruthy();
    expect(screen.getByText("Well done, Ayesha.")).toBeTruthy();
  });

  it("in Urdu too: no AI اسکور, no کوچ اسکور", async () => {
    await i18n.changeLanguage("ur");
    serve();
    openTeacherApp(`/portal/teacher/principal/observation/${OBS_ID}`, PRINCIPAL);
    await screen.findByTestId("observation-report", {}, T);
    const text = document.body.textContent || "";
    expect(text).not.toMatch(/AI اسکور|کوچ اسکور/);
    expect(text).not.toMatch(/61|64/);
    expect(screen.getByText("کلاس کی ریکارڈنگ")).toBeTruthy();
  });

  it("her Send preview: no score header; the report the teacher will get is still shown", async () => {
    serve();
    api.leader.getObservation.mockResolvedValue(VIEW("report"));
    openTeacherApp(`/portal/teacher/principal/observation/${OBS_ID}/send`, PRINCIPAL);
    await screen.findByTestId("report-preview", {}, T);
    expect(screen.queryByTestId("send-score")).toBeNull();
    noScoreText();
  });

  it("her own lesson (Digital Coaching's report): no score; the report's sections stay", async () => {
    serve();
    openTeacherApp(COACHING_REPORT.replace(":id", DC_ID), PRINCIPAL);
    await screen.findByRole("region", { name: /scores/i }, T);
    expect(screen.getByText("Lesson Plan Fidelity")).toBeTruthy();
    expect(screen.queryByTestId("report-score")).toBeNull();
    expect(document.body.textContent || "").not.toMatch(/58%|30\/52/);
  });

  it("unchanged for a teacher: her own lesson's report still shows her score", async () => {
    serve(false);
    openTeacherApp(COACHING_REPORT.replace(":id", DC_ID), TEACHER);
    expect(await screen.findByTestId("report-score", {}, T)).toBeTruthy();
    expect(screen.getByTestId("report-score").textContent).toMatch(/58%/);
  });

  it("unchanged for a principal the switch does not name: her own lesson's report still shows her score", async () => {
    serve(false);
    openTeacherApp(COACHING_REPORT.replace(":id", DC_ID), PRINCIPAL);
    expect(await screen.findByTestId("report-score", {}, T)).toBeTruthy();
  });

  it("unchanged for a coach: the observation page shows the AI score ring and the coach score", async () => {
    serve();
    openCoach(`/portal/coach/observation/${OBS_ID}`, "/portal/coach/observation/:id", <CoachObservation />);
    expect(await screen.findByRole("img", { name: /AI score 61%/ }, T)).toBeTruthy();
    expect(screen.getByText("Coach score 61%")).toBeTruthy();
  });

  it("unchanged for a coach: the Send preview shows the score header", async () => {
    serve();
    api.leader.getObservation.mockResolvedValue(VIEW("report"));
    openCoach(`/portal/coach/observation/${OBS_ID}/send`, "/portal/coach/observation/:id/send", <SendReport />);
    expect(await screen.findByTestId("send-score", {}, T)).toBeTruthy();
  });
});
