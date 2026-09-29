import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";

/**
 * "Remove the Observation scores everywhere from Numbers and Percentages to
 * brackets" (operator, 2026-09-29).
 *
 * Every portal page that shows an OBSERVATION score, teacher-side and
 * principal-side, mounted against a realistic payload and read as the user
 * reads it: no percentage, no "points out of", and every chart axis, tooltip
 * and data label in band words.
 *
 * Deliberately NOT covered, because they are not observation scores: quiz and
 * exam marks, attendance presence, and the supervisor-remarks average.
 */

const charts: any[] = [];
vi.mock("react-apexcharts", () => ({
  default: (props: any) => {
    charts.push(props.options);
    return <div data-testid="chart" />;
  },
}));
vi.mock("../hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("../services/api", () => ({
  portal: {
    getCoachingSessions: vi.fn(),
    getCoachingAnalytics: vi.fn(),
    getDashboard: vi.fn(),
    getCoachingSession: vi.fn(),
  },
  leader: { getSchoolAnalytics: vi.fn() },
}));

import { useAuth } from "../hooks/useAuth";
import { portal, leader } from "../services/api";
import PortalCoaching from "./PortalCoaching";
import PortalCoachingAnalytics from "./PortalCoachingAnalytics";
import PortalDashboard from "./PortalDashboard";
import PortalCoachingDetail from "./PortalCoachingDetail";
import SchoolAnalytics from "./SchoolAnalytics";
import SchoolLessons from "./SchoolLessons";

const PERCENT = /\d+(?:\.\d+)?\s*%/;
const OUT_OF = /\b\d+\s*\/\s*\d+\b/;

/** What the user reads: the page, minus injected <style>, minus `except` sections. */
function pageText(except: string[] = []): string {
  const clone = document.body.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("style,script").forEach((n) => n.remove());
  for (const id of except) {
    const el = clone.querySelector(`[data-testid="${id}"]`);
    (el?.closest("section") || el)?.remove();
  }
  return clone.textContent || "";
}

/** Every formatter any chart exposes, run over the whole 0-100 range. */
function chartOutputs(): string[] {
  const out: string[] = [];
  const run = (f: any) => {
    if (typeof f !== "function") return;
    for (const v of [0, 12.5, 20, 33, 40, 55, 60, 64.2, 80, 91, 100]) out.push(String(f(v, { seriesIndex: 0, dataPointIndex: 0, w: {} })));
  };
  for (const o of charts) {
    const ys = Array.isArray(o?.yaxis) ? o.yaxis : [o?.yaxis];
    for (const y of ys) run(y?.labels?.formatter);
    run(o?.xaxis?.labels?.formatter);
    run(o?.tooltip?.y?.formatter);
    run(o?.dataLabels?.formatter);
    for (const y of ys) if (y?.title?.text) out.push(String(y.title.text));
  }
  return out;
}

function asTeacher() {
  (useAuth as any).mockReturnValue({ user: { firstName: "Ayesha", role: "teacher" }, loading: false, logout: vi.fn() });
}
function asPrincipal() {
  (useAuth as any).mockReturnValue({ user: { firstName: "Atifa", role: "principal" }, loading: false, logout: vi.fn() });
}

const SESSIONS = [
  { id: "s2", date: "2026-09-15T10:00:00Z", duration: 1800, overallScore: 95, maxScore: 148, percentage: 64.2, framework: "fico" },
  { id: "s1", date: "2026-08-10T10:00:00Z", duration: 1700, overallScore: 71, maxScore: 148, percentage: 48, framework: "fico" },
];

const ANALYTICS = {
  overallScoreTrend: [
    { date: "2026-08-10T10:00:00Z", score: 71, percentage: 48 },
    { date: "2026-09-15T10:00:00Z", score: 95, percentage: 64.2 },
  ],
  goalAreaBreakdown: [
    { name: "Student Engagement", score: 9, maxScore: 14, percentage: 64.3, sessions: 2 },
    { name: "Subject Knowledge", score: 4, maxScore: 16, percentage: 25, sessions: 2 },
  ],
  insights: { totalSessions: 2, averageScore: 56.1, improvement: 16.2, bestGoalArea: "Student Engagement", focusArea: "Subject Knowledge" },
};

beforeEach(() => {
  vi.clearAllMocks();
  charts.length = 0;
});

describe("the teacher's own pages", () => {
  it("Coaching — the session list and its averages", async () => {
    asTeacher();
    (portal.getCoachingSessions as any).mockResolvedValue({ sessions: SESSIONS });
    render(<MemoryRouter><PortalCoaching /></MemoryRouter>);
    await waitFor(() => expect(screen.getAllByTestId("score-band").length).toBeGreaterThan(0));
    const text = pageText();
    expect(text).not.toMatch(PERCENT);
    expect(text).not.toMatch(OUT_OF);
    expect(text).toMatch(/Good/);
  });

  it("Coaching analytics — insights, area cards and both charts", async () => {
    asTeacher();
    (portal.getCoachingAnalytics as any).mockResolvedValue({ analytics: ANALYTICS });
    render(<MemoryRouter><PortalCoachingAnalytics /></MemoryRouter>);
    await waitFor(() => expect(charts.length).toBeGreaterThan(0));
    const text = pageText();
    expect(text).not.toMatch(PERCENT);
    expect(text).not.toMatch(OUT_OF);
    expect(chartOutputs().join(" | ")).not.toMatch(/%/);
    expect(chartOutputs().join(" | ")).toMatch(/Good/);
  });

  it("Dashboard — the latest lesson and the trend", async () => {
    asTeacher();
    (portal.getDashboard as any).mockResolvedValue({
      stats: { totalLessonPlans: 3, totalCoachingSessions: 2 },
      recentLessonPlans: [],
      recentCoachingSession: SESSIONS[0],
    });
    (portal.getCoachingAnalytics as any).mockResolvedValue({ analytics: ANALYTICS });
    render(<MemoryRouter><PortalDashboard /></MemoryRouter>);
    await waitFor(() => screen.getByTestId("dashboard-greeting"));
    await waitFor(() => expect(screen.getAllByTestId("score-band").length).toBeGreaterThan(0));
    expect(pageText()).not.toMatch(PERCENT);
    expect(chartOutputs().join(" | ")).not.toMatch(/%/);
  });

  it("Session report — overall, sections, indicators and the coaching card", async () => {
    asTeacher();
    (portal.getCoachingSession as any).mockResolvedValue({
      session: {
        ...SESSIONS[0],
        transcript: "",
        reportUrl: null,
        reportFormat: null,
        lessonAudioUrl: null,
        debriefAudioUrl: null,
        reflection: [],
        // stored before this change — the old card text carries "x/y"
        prioritizedAction: { action: 'Focus on "Every student participates" — currently 1/2. Try one specific improvement in your next class.' },
        analysisData: {
          overall_score: { points: 95, max_points: 148, percentage: 64.2 },
          executive_summary: "A focused lesson.",
          strengths: ["Clear modelling"],
          growth_opportunities: ["Check understanding"],
          recommendations: ["Cold call"],
        },
        breakdown: {
          framework: "fico", language: "en", overall: 64, marks: 95, max: 148, scaleMax: 2,
          groups: [{
            key: "D", domainKey: "student_engagement", name: "Student Engagement", score: 9, max: 14, pct: 64,
            indicators: [{ id: "D1", name: "Every student participates", score: 1, evidence: "e", evidence_summary: null, applicable: true }],
          }],
        },
      },
    });
    render(
      <MemoryRouter initialEntries={["/portal/coaching/session/s2"]}>
        <Routes><Route path="/portal/coaching/session/:sessionId" element={<PortalCoachingDetail />} /></Routes>
      </MemoryRouter>,
    );
    await waitFor(() => screen.getByText(/Coaching Session Report/));
    const text = pageText();
    expect(text).not.toMatch(PERCENT);
    expect(text).not.toMatch(OUT_OF);
    expect(text).not.toMatch(/Points Earned|Maximum Points|Success Rate/);
    expect(text).toMatch(/Every student participates/); // the card still shows, minus its score
  });
});

const SCHOOL = {
  success: true,
  school: { name: "IMSG Mohra Nagial", totalTeachers: 19, onRumi: 17, totalLessonPlans: 42 },
  focusTeacher: null,
  teachers: [{ id: "t1", name: "Ayesha Bibi", isPrincipal: false }],
  analytics: {
    totalSessions: 2, averageScore: 56.1,
    scoreTrend: [
      { date: "2026-08-10T00:00:00Z", percentage: 48, points: 71, maxPoints: 148, teacherName: "Ayesha Bibi" },
      { date: "2026-09-15T00:00:00Z", percentage: 64.2, points: 95, maxPoints: 148, teacherName: "Ayesha Bibi" },
    ],
    domainBreakdown: [
      { key: "student_engagement", name: "Student Engagement", percentage: 64.3, sessions: 2 },
      { key: "teacher_subject_knowledge", name: "Subject Knowledge", percentage: 25, sessions: 2 },
    ],
    strongestDomain: "Student Engagement", focusDomain: "Subject Knowledge",
  },
  presence: {
    teacher: { records: 20, present: 18, absent: 2, leave: 0, presentPct: 90 },
    student: { sessions: 5, totalMarked: 200, present: 180, presentPct: 90 },
  },
  remarks: { submitted: 1, averagePct: 70, indicatorBreakdown: [], focusIndicator: null },
};

describe("the principal's pages", () => {
  it("Analytics — average, area cards, lesson preview and chart; presence and remarks untouched", async () => {
    asPrincipal();
    (leader.getSchoolAnalytics as any).mockResolvedValue(SCHOOL);
    render(<MemoryRouter><SchoolAnalytics /></MemoryRouter>);
    await waitFor(() => expect(charts.length).toBeGreaterThan(0));
    const text = pageText(["presence-help", "remarks-help"]);
    expect(text).not.toMatch(PERCENT);
    expect(text).not.toMatch(OUT_OF);
    expect(text).toMatch(/Good|Average/);
    const axis = chartOutputs().join(" | ");
    expect(axis).not.toMatch(/%/);
    expect(axis).toMatch(/Excellent/);
  });

  it("Lessons — every observed lesson in bands", async () => {
    asPrincipal();
    (leader.getSchoolAnalytics as any).mockResolvedValue(SCHOOL);
    render(<MemoryRouter><SchoolLessons /></MemoryRouter>);
    await waitFor(() => expect(screen.getAllByTestId("score-band").length).toBe(2));
    expect(pageText()).not.toMatch(PERCENT);
    expect(pageText()).not.toMatch(OUT_OF);
  });
});
