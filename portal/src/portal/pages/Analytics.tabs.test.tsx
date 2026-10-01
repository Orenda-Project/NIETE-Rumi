import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

/**
 * The Analytics page, round 3 (operator, 2026-09-30), on BOTH profiles:
 *   · tabs at the top — Observations · Attendance · Principal Remarks — one
 *     shown at a time
 *   · a From / To date window over the whole page (blank = all time)
 *   · Observations: ONE "Observation Feedback" section (rating over time +
 *     strong and weak areas), and "When Observations Happened" as a
 *     day-by-day strip like the attendance page
 *   · the teacher's page hides lesson plans and exams, for now
 */

const charts: Array<{ type: string }> = [];
vi.mock("react-apexcharts", () => ({
  default: (p: any) => { charts.push({ type: p.type }); return <div data-testid={`chart-${p.type}`} />; },
}));
vi.mock("../hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("../services/api", () => ({
  leader: {
    // The Attendance tab loads its detail too (2026-09-30).
    getAttendance: vi.fn().mockResolvedValue({ success: true, from: null, to: null, focusTeacher: null, teachers: [], schoolDays: [], students: { groups: [], byDay: [] }, staff: { groups: [], byDay: [] } }),
    getSchoolAnalytics: vi.fn(),
    getSteps: vi.fn().mockResolvedValue({ success: true, cycle: null, teachers: [], summary: {} }),
  },
  portal: { getMyAttendance: vi.fn().mockResolvedValue({ success: true, from: null, to: null, focusTeacher: null, teachers: [], schoolDays: [], students: { groups: [], byDay: [] }, staff: { groups: [], byDay: [] } }), getMyAnalytics: vi.fn() },
}));

import { useAuth } from "../hooks/useAuth";
import { leader, portal } from "../services/api";
import SchoolAnalytics from "./SchoolAnalytics";
import PortalCoachingAnalytics from "./PortalCoachingAnalytics";

const ANALYTICS = {
  totalSessions: 3, humanObservations: 2, digitalCoachObservations: 1, averageScore: 60,
  scoreTrend: [
    { date: "2026-09-08T05:00:00Z", percentage: 48, points: 48, maxPoints: 100, teacherName: "Ayesha" },
    { date: "2026-09-10T05:00:00Z", percentage: 70, points: 70, maxPoints: 100, teacherName: "Ayesha" },
  ],
  areas: [
    { key: "e", name: "Engagement", pct: 85, band: "excellent", observations: 2 },
    { key: "s", name: "Subject knowledge", pct: 30, band: "below_average", observations: 2 },
  ],
  byMonth: [{ month: "2026-09", human: 2, digitalCoach: 1 }],
  observations: [
    { date: "2026-09-10T05:00:00Z", kind: "human", percentage: 70, teacherName: "Ayesha" },
    { date: "2026-09-10T07:00:00Z", kind: "digital_coach", percentage: null, teacherName: "Ayesha" },
    { date: "2026-09-08T05:00:00Z", kind: "human", percentage: 48, teacherName: "Ayesha" },
  ],
  domainBreakdown: [], strongestDomain: null, focusDomain: null,
};
const PRESENCE = {
  teacher: { records: 5, present: 4, absent: 1, leave: 0, presentPct: 80 },
  student: { sessions: 2, totalMarked: 60, present: 50, presentPct: 83.3 },
};

function mountPrincipal() {
  (useAuth as any).mockReturnValue({ user: { firstName: "Atifa", role: "principal" }, loading: false, logout: vi.fn() });
  (leader.getSchoolAnalytics as any).mockResolvedValue({
    success: true, range: { from: "2026-09-01", to: "2026-09-12" },
    school: { name: "S", totalTeachers: 3, onRumi: 3, totalLessonPlans: 4, totalExams: 2 },
    focusTeacher: null, teachers: [], analytics: ANALYTICS, presence: PRESENCE,
    remarks: { submitted: 0, averagePct: null, indicatorBreakdown: [], focusIndicator: null },
  });
  render(<MemoryRouter initialEntries={["/portal/leader/school-analytics?from=2026-09-01&to=2026-09-12"]}><SchoolAnalytics /></MemoryRouter>);
}
function mountTeacher() {
  (useAuth as any).mockReturnValue({ user: { firstName: "Ayesha", role: "teacher" }, loading: false, logout: vi.fn() });
  (portal.getMyAnalytics as any).mockResolvedValue({
    success: true, range: { from: "2026-09-01", to: "2026-09-12" },
    totals: { lessonPlans: 5, examsGenerated: 3 }, analytics: ANALYTICS, presence: PRESENCE,
    remarksReceived: [{ cycleName: "Q3", submittedAt: "2026-09-11T05:00:00Z", comment: "Good", areas: [{ ordinal: 1, name: "Collaboration", score: 3 }] }],
  });
  render(<MemoryRouter initialEntries={["/portal/coaching/analytics?from=2026-09-01&to=2026-09-12"]}><PortalCoachingAnalytics /></MemoryRouter>);
}

beforeEach(() => { vi.clearAllMocks(); charts.length = 0; });

describe.each([["principal", mountPrincipal], ["teacher", mountTeacher]] as const)("Analytics — %s", (_who, mount) => {
  it("has three tabs, Observations first and open", async () => {
    mount();
    const tabs = await screen.findAllByRole("tab");
    expect(tabs.map((t) => t.textContent?.trim())).toEqual(["Observations", "Attendance", "Principal Remarks"]);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("observations")).toBeInTheDocument();
    expect(screen.queryByTestId("presence-help")).toBeNull();
    expect(screen.queryByTestId("remarks-help")).toBeNull();
  });

  it("each tab shows its own section and hides the others", async () => {
    mount();
    await userEvent.click(await screen.findByRole("tab", { name: "Attendance" }));
    expect(screen.getByTestId("presence-help")).toBeInTheDocument();
    expect(screen.queryByTestId("observations")).toBeNull();
    await userEvent.click(screen.getByRole("tab", { name: "Principal Remarks" }));
    expect(screen.getByTestId("remarks-help")).toBeInTheDocument();
    expect(screen.queryByTestId("presence-help")).toBeNull();
  });

  it("has a From / To date window, read from the address and sent to the server", async () => {
    mount();
    expect(await screen.findByTestId("analytics-from")).toHaveValue("2026-09-01");
    expect(screen.getByTestId("analytics-to")).toHaveValue("2026-09-12");
    const api = _who === "principal" ? leader.getSchoolAnalytics : portal.getMyAnalytics;
    await waitFor(() => expect(JSON.stringify((api as any).mock.calls.at(-1))).toContain("2026-09-01"));
    expect(JSON.stringify((api as any).mock.calls.at(-1))).toContain("2026-09-12");
  });

  it("Observation Feedback is ONE section: the rating over time and the areas together", async () => {
    mount();
    const fb = await screen.findByTestId("observation-feedback");
    expect(within(fb).getByRole("heading", { level: 3, name: "Observation Feedback" })).toBeInTheDocument();
    expect(within(fb).getByTestId("chart-line")).toBeInTheDocument();
    expect(within(fb).getByTestId("area-s")).toHaveTextContent(/work on this/i);
    const h3 = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent?.trim());
    expect(h3).not.toContain("Progress");
    expect(h3).not.toContain("Strong and Weak Areas");
  });

  it("When Observations Happened is a day-by-day strip, not a monthly chart", async () => {
    mount();
    await screen.findByTestId("observations");
    expect(charts.find((c) => c.type === "bar")).toBeUndefined();
    // Every school day in the window is a cell; a day with nothing is a dash.
    expect(screen.getByTestId("obs-day-2026-09-08")).toHaveTextContent("1");
    expect(screen.getByTestId("obs-day-2026-09-10")).toHaveTextContent("2");
    expect(screen.getByTestId("obs-day-2026-09-09")).toHaveTextContent("–");
    // Weekends are left out unless something happened on them.
    expect(screen.queryByTestId("obs-day-2026-09-06")).toBeNull();
  });

  it("picking a day lists that day's observations", async () => {
    mount();
    await userEvent.click(await screen.findByTestId("obs-day-2026-09-08"));
    const rows = screen.getAllByTestId(/^obs-row-/);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent(/Human Observation/);
    expect(rows[0]).toHaveTextContent(/Average/); // 48
  });
});

it("the teacher's page hides lesson plans and exams, for now", async () => {
  mountTeacher();
  await screen.findByTestId("observations");
  expect(screen.queryByTestId("kpi-lesson-plans")).toBeNull();
  expect(screen.queryByTestId("kpi-exams")).toBeNull();
});

it("a link to #remarks opens the Principal Remarks tab", async () => {
  (useAuth as any).mockReturnValue({ user: { firstName: "Atifa", role: "principal" }, loading: false, logout: vi.fn() });
  (leader.getSchoolAnalytics as any).mockResolvedValue({
    success: true, range: { from: null, to: null },
    school: { name: "S", totalTeachers: 3, onRumi: 3, totalLessonPlans: 4, totalExams: 2 },
    focusTeacher: null, teachers: [], analytics: ANALYTICS, presence: PRESENCE,
    remarks: { submitted: 0, averagePct: null, indicatorBreakdown: [], focusIndicator: null },
  });
  render(<MemoryRouter initialEntries={["/portal/leader/school-analytics#remarks"]}><SchoolAnalytics /></MemoryRouter>);
  expect(await screen.findByTestId("remarks-help")).toBeInTheDocument();
  expect(screen.getByRole("tab", { name: "Principal Remarks" })).toHaveAttribute("aria-selected", "true");
});
