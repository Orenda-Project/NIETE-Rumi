import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";

/**
 * Operator, 2026-09-30: "Analytics is there for exactly this kind of data. So
 * yes, revert My Patch. I don't even need to see this STEPS number on the
 * Analytics page. Remove it all." — and the separate Attendance page is
 * absorbed into the Analytics Attendance tab, with its menu item gone.
 */

vi.mock("../hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("react-apexcharts", () => ({ default: () => <div data-testid="chart" /> }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("../services/api", () => ({
  leader: {
    getOverview: vi.fn(), getSteps: vi.fn(), getTeacher: vi.fn(), getTeachers: vi.fn(),
    getSchoolAnalytics: vi.fn(), getAttendance: vi.fn(),
  },
  portal: { getMyAnalytics: vi.fn(), getMyAttendance: vi.fn() },
}));

import { useAuth } from "../hooks/useAuth";
import { leader, portal } from "../services/api";
import LeaderHome from "./LeaderHome";
import LeaderTeachers from "./LeaderTeachers";
import LeaderTeacherDetail from "./LeaderTeacherDetail";
import SchoolLessons from "./SchoolLessons";
import SchoolAnalytics from "./SchoolAnalytics";
import PortalCoachingAnalytics from "./PortalCoachingAnalytics";
import PortalNavigation from "../components/PortalNavigation";
import LegacyAttendanceRedirect from "../components/LegacyAttendanceRedirect";

const as = (role: string) =>
  (useAuth as any).mockReturnValue({ user: { firstName: "Atifa", role }, loading: false, logout: vi.fn() });

const PRESENCE = {
  teacher: { records: 20, present: 18, absent: 2, leave: 0, presentPct: 90 },
  student: { sessions: 2, totalMarked: 60, present: 55, presentPct: 91.7 },
};
const ANALYTICS = {
  success: true, range: { from: null, to: null },
  school: { name: "S", totalTeachers: 3, onRumi: 3, totalLessonPlans: 4, totalExams: 2 },
  focusTeacher: { id: "u1", name: "Ayesha Bibi" },
  teachers: [{ id: "u1", name: "Ayesha Bibi", isPrincipal: false }],
  analytics: { totalSessions: 0, averageScore: null, scoreTrend: [], domainBreakdown: [], strongestDomain: null, focusDomain: null, observations: [], areas: [] },
  presence: PRESENCE,
  remarks: { submitted: 0, averagePct: null, indicatorBreakdown: [], focusIndicator: null },
};
const ATTENDANCE = {
  success: true, from: null, to: null, focusTeacher: null, teachers: [],
  schoolDays: ["2026-09-08", "2026-09-09"],
  students: {
    groups: [{ name: "Grade 4", people: 30, days: 2, chances: 60, present: 55, absent: 5, neverMarked: 0, markedDays: 2 }],
    byDay: [{ name: "Grade 4", days: [
      { date: "2026-09-08", marked: true, total: 30, present: 28, absent: 2 },
      { date: "2026-09-09", marked: true, total: 30, present: 27, absent: 3 },
    ] }],
  },
  staff: {
    groups: [{ name: "Ayesha Bibi", people: 1, days: 2, chances: 2, present: 2, absent: 0, neverMarked: 0, markedDays: 2 }],
    byDay: [{ name: "Ayesha Bibi", days: [
      { date: "2026-09-08", marked: true, total: 1, present: 1, absent: 0 },
      { date: "2026-09-09", marked: true, total: 1, present: 1, absent: 0 },
    ] }],
  },
};

beforeEach(() => vi.clearAllMocks());

describe("My Patch is back to what it was before STEPS", () => {
  it("a principal's My Patch is the patch overview — KPIs, feature reach, Needs attention — and no STEPS grid", async () => {
    as("principal");
    (leader.getOverview as any).mockResolvedValue({ success: true, overview: {
      totalTeachers: 3, onRumi: 3, notOnRumi: 0, totalCoachingSessions: 5, totalLessonPlans: 4,
      totalAttendanceSessions: 2, totalTrainingModules: 1, teachersMarkingAttendance: 2, teachersInTraining: 1,
      scoredTeachers: 1, avgLastScore: 60, focus: [{ rumiUserId: "u1", name: "Ayesha Bibi", coachingSessions: 2, focusArea: "Subject knowledge" }],
    } });
    render(<MemoryRouter><LeaderHome /></MemoryRouter>);
    expect(await screen.findByTestId("feature-reach")).toBeInTheDocument();
    expect(screen.getByText("Needs attention")).toBeInTheDocument();
    expect((leader as any).getSteps).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toMatch(/STEPS/);
  });
});

describe("no STEPS row or step journey anywhere", () => {
  it("Analytics for one teacher has no STEPS row and no next step", async () => {
    as("principal");
    (leader.getSchoolAnalytics as any).mockResolvedValue(ANALYTICS);
    render(<MemoryRouter initialEntries={["/portal/leader/school-analytics?teacherId=u1"]}><SchoolAnalytics /></MemoryRouter>);
    await screen.findByTestId("observations");
    expect(screen.queryByTestId("teacher-steps")).toBeNull();
    expect(screen.queryByTestId("next-step")).toBeNull();
    expect((leader as any).getSteps).not.toHaveBeenCalled();
  });

  it("a teacher's page has no STEPS row", async () => {
    as("principal");
    (leader.getTeacher as any).mockResolvedValue({
      success: true, teacher: { rumiUserId: "u1", name: "Ayesha Bibi", phone: "923001234567", onRumi: true },
      stats: { coachingSessions: 0, lessonPlans: 0, readingAssessments: 0, lastScore: null, lastSummary: null }, sessions: [],
    });
    render(
      <MemoryRouter initialEntries={["/portal/leader/teacher/u1"]}>
        <Routes><Route path="/portal/leader/teacher/:id" element={<LeaderTeacherDetail />} /></Routes>
      </MemoryRouter>,
    );
    await screen.findByText("Ayesha Bibi");
    expect(screen.queryByTestId("teacher-steps")).toBeNull();
    expect((leader as any).getSteps).not.toHaveBeenCalled();
  });

  it("Teachers and Lessons end with no step link", async () => {
    as("principal");
    (leader.getTeachers as any).mockResolvedValue({ success: true, total: 0, onRumi: 0, teachers: [] });
    const { unmount } = render(<MemoryRouter><LeaderTeachers /></MemoryRouter>);
    await screen.findByRole("heading", { level: 1 });
    expect(screen.queryByTestId("next-step")).toBeNull();
    unmount();
    (leader.getSchoolAnalytics as any).mockResolvedValue(ANALYTICS);
    render(<MemoryRouter><SchoolLessons /></MemoryRouter>);
    await screen.findByRole("heading", { level: 1 });
    expect(screen.queryByTestId("next-step")).toBeNull();
  });
});

describe("the Attendance page lives in the Analytics Attendance tab", () => {
  it("principal: the tab holds the full detail — grades, teachers, day by day — scoped to the page's filters", async () => {
    as("principal");
    (leader.getSchoolAnalytics as any).mockResolvedValue(ANALYTICS);
    (leader.getAttendance as any).mockResolvedValue(ATTENDANCE);
    render(<MemoryRouter initialEntries={["/portal/leader/school-analytics?teacherId=u1&from=2026-09-01#attendance"]}><SchoolAnalytics /></MemoryRouter>);
    expect(await screen.findByTestId("group-Grade 4")).toBeInTheDocument();
    expect(screen.getByTestId("presence-help")).toBeInTheDocument();
    expect(screen.queryByTestId("attendance-detail-link")).toBeNull();
    expect((leader.getAttendance as any).mock.lastCall[0]).toEqual({ from: "2026-09-01", to: null, teacherId: "u1" });
    await userEvent.click(screen.getByTestId("view-byday"));
    expect(screen.getByTestId("cell-Grade 4-2026-09-08")).toHaveTextContent("28/30");
  });

  it("teacher: the tab holds HER detail, and no link out", async () => {
    as("teacher");
    (portal.getMyAnalytics as any).mockResolvedValue({
      success: true, range: { from: null, to: null }, totals: { lessonPlans: 0, examsGenerated: 0 },
      analytics: ANALYTICS.analytics, presence: PRESENCE, remarksReceived: [],
    });
    (portal.getMyAttendance as any).mockResolvedValue(ATTENDANCE);
    render(<MemoryRouter initialEntries={["/portal/coaching/analytics#attendance"]}><PortalCoachingAnalytics /></MemoryRouter>);
    expect(await screen.findByTestId("group-Grade 4")).toBeInTheDocument();
    expect(portal.getMyAttendance).toHaveBeenCalled();
    expect(leader.getAttendance).not.toHaveBeenCalled();
    expect(screen.queryByTestId("my-attendance-link")).toBeNull();
    const h3 = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent?.trim());
    expect(h3).toContain("Your students, by class");
  });

  it.each(["principal", "teacher"])("the %s menu has no separate Attendance item", (role) => {
    as(role);
    render(<MemoryRouter><PortalNavigation /></MemoryRouter>);
    expect(screen.queryAllByRole("link", { name: /^Attendance$/ })).toHaveLength(0);
  });

  it.each([
    ["/portal/leader/attendance?teacherId=u1", "/portal/leader/school-analytics", "?teacherId=u1", "#attendance"],
    ["/portal/attendance", "/portal/coaching/analytics", "", "#attendance"],
  ])("an old link %s lands on Analytics → Attendance", async (from, path, search, hash) => {
    const Where = () => { const l = useLocation(); return <div data-testid="where">{l.pathname + l.search + l.hash}</div>; };
    render(
      <MemoryRouter initialEntries={[from]}>
        <Routes>
          <Route path="/portal/leader/attendance" element={<LegacyAttendanceRedirect to="/portal/leader/school-analytics" />} />
          <Route path="/portal/attendance" element={<LegacyAttendanceRedirect to="/portal/coaching/analytics" />} />
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByTestId("where")).toHaveTextContent(`${path}${search}${hash}`);
  });
});
