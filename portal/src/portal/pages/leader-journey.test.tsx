import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";

/**
 * Items 1, 4 and 5 across the leader pages beyond the home.
 *
 *  1 · Where the numeric score was removed last round, the BAND now shows —
 *      "remove the Observation scores … from Numbers and Percentages to
 *      brackets" (operator, 2026-09-29) replaces hiding with banding.
 *  4 · The teacher page carries HER STEPS row, and each letter drills into her
 *      own filtered view: lessons for S·T·E, attendance for P, and for the
 *      remark either her submitted one or the WhatsApp /remark to write it.
 *  5 · The journey: the principal's nav runs in STEPS order, and every page on
 *      it ends with a Next-step link to the one after.
 */

vi.mock("../hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("react-apexcharts", () => ({ default: () => <div data-testid="chart" /> }));
vi.mock("../services/api", () => ({
  leader: {
    getTeacher: vi.fn(), getSteps: vi.fn(), getTeachers: vi.fn(), getObservations: vi.fn(),
    createSchedule: vi.fn(), cancelSchedule: vi.fn(), getSchoolAnalytics: vi.fn(), getAttendance: vi.fn(),
  },
}));

import { useAuth } from "../hooks/useAuth";
import { leader } from "../services/api";
import LeaderTeacherDetail from "./LeaderTeacherDetail";
import LeaderTeachers from "./LeaderTeachers";
import LeaderObservations from "./LeaderObservations";
import SchoolLessons from "./SchoolLessons";
import SchoolAttendance from "./SchoolAttendance";
import SchoolAnalytics from "./SchoolAnalytics";
import PortalNavigation from "../components/PortalNavigation";
import { WHATSAPP_URL } from "@/lib/whatsapp";

const as = (role: string) =>
  (useAuth as any).mockReturnValue({ user: { firstName: "Atifa", role }, loading: false, logout: vi.fn() });
const hrefOf = (el: HTMLElement) => (el.closest("a") || el).getAttribute("href");
const PERCENT = /\d+(?:\.\d+)?\s*%/;

const DETAIL = {
  success: true,
  teacher: { rumiUserId: "u1", name: "Ayesha Bibi", phone: "923001234567", onRumi: true },
  stats: { coachingSessions: 2, lessonPlans: 7, readingAssessments: 3, lastScore: 64.2, lastSummary: "A focused lesson." },
  sessions: [
    { id: "s2", date: "2026-09-15T10:00:00Z", score: 64.2, points: 95, maxPoints: 148, summary: "A focused lesson." },
    { id: "s1", date: "2026-08-10T10:00:00Z", score: 48, points: 71, maxPoints: 148, summary: null },
  ],
};

const STEPS_ROW = (remark: string) => ({
  id: "u1", name: "Ayesha Bibi", lastObservedAt: "2026-09-15",
  s: { pct: 18.8, band: "needs_support" }, t: { pct: 63.6, band: "good" }, e: { pct: 92.9, band: "excellent" },
  presence: { present: 18, absent: 2, leave: 1, markedDays: 20 },
  remark,
});
const stepsWith = (remark: string) => ({
  success: true, cycle: { name: "Third Quarter 2026", endsAt: "2026-10-01T00:00:00Z" },
  teachers: [STEPS_ROW(remark)], summary: {},
});

function mountDetail(role = "principal", remark = "todo") {
  as(role);
  (leader.getTeacher as any).mockResolvedValue(DETAIL);
  (leader.getSteps as any).mockResolvedValue(stepsWith(remark));
  render(
    <MemoryRouter initialEntries={["/portal/leader/teacher/u1"]}>
      <Routes><Route path="/portal/leader/teacher/:id" element={<LeaderTeacherDetail />} /></Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => vi.clearAllMocks());

describe("1 · the band is back where the number was removed", () => {
  it("teacher page: her latest lesson and each visit carry a band, never a number", async () => {
    mountDetail();
    await screen.findByTestId("session-s2");
    expect(within(screen.getByTestId("session-s2")).getByTestId("score-band")).toHaveTextContent("Good");
    expect(within(screen.getByTestId("session-s1")).getByTestId("score-band")).toHaveTextContent("Average");
    expect(screen.getByTestId("latest-band")).toHaveTextContent("Good");
    expect(document.querySelector("main")?.textContent || document.body.textContent).not.toMatch(PERCENT);
  });

  it("teachers list: each row shows her latest band", async () => {
    as("principal");
    (leader.getTeachers as any).mockResolvedValue({
      success: true, total: 1, onRumi: 1,
      teachers: [{ teacherExtId: "x", name: "Ayesha Bibi", hasName: true, phone: "92300", onRumi: true, rumiUserId: "u1",
        coachingSessions: 2, observations: 1, lessonPlans: 7, attendanceSessions: 0, trainingModules: 0,
        lastSessionAt: null, lastScore: 64.2, focusArea: null, schoolName: "S", emis: "1", isPrincipal: false }],
    });
    render(<MemoryRouter><LeaderTeachers /></MemoryRouter>);
    expect(await screen.findByTestId("score-band")).toHaveTextContent("Good");
  });

  it("observations: pending and completed carry bands", async () => {
    as("coach");
    (leader.getObservations as any).mockResolvedValue({
      success: true,
      observations: {
        upcoming: [],
        pendingDebriefs: [{ id: "c1", createdAt: "2026-07-31T09:00:00Z", teacherName: "Sadia", teacherUserId: "t1", status: "observer_review_complete", debriefStatus: "pending", score: 62.2, reportPdfUrl: null }],
        completed: [{ id: "c2", createdAt: "2026-07-27T09:00:00Z", teacherName: "Nadia", teacherUserId: "t2", status: "observer_review_complete", debriefStatus: "done", score: 38.7, reportPdfUrl: null }],
      },
    });
    (leader.getTeachers as any).mockResolvedValue({ success: true, total: 0, onRumi: 0, teachers: [] });
    render(<MemoryRouter><LeaderObservations /></MemoryRouter>);
    await waitFor(() => expect(screen.getAllByTestId("score-band")).toHaveLength(2));
    expect(screen.getAllByTestId("score-band").map((b) => b.textContent)).toEqual(["Good", "Below average"]);
  });
});

const FOCUS_ANALYTICS = {
  success: true,
  school: { name: "S", totalTeachers: 1, onRumi: 1, totalLessonPlans: 1 },
  focusTeacher: { id: "u1", name: "Ayesha Bibi" },
  teachers: [{ id: "u1", name: "Ayesha Bibi", isPrincipal: false }],
  analytics: { totalSessions: 0, averageScore: null, scoreTrend: [], domainBreakdown: [], strongestDomain: null, focusDomain: null },
  presence: { teacher: { records: 0, present: 0, absent: 0, leave: 0, presentPct: null }, student: { sessions: 0, totalMarked: 0, present: 0, presentPct: null } },
  remarks: { submitted: 0, averagePct: null, indicatorBreakdown: [], focusIndicator: null },
};

function mountHerAnalytics(remark = "todo") {
  as("principal");
  (leader.getSchoolAnalytics as any).mockResolvedValue(FOCUS_ANALYTICS);
  (leader.getSteps as any).mockResolvedValue(stepsWith(remark));
  render(
    <MemoryRouter initialEntries={["/portal/leader/school-analytics?teacherId=u1"]}>
      <Routes><Route path="/portal/leader/school-analytics" element={<SchoolAnalytics />} /></Routes>
    </MemoryRouter>,
  );
}

describe("4 · her own STEPS row drills into her own views", () => {
  // bd-60119: a principal's teacher IS Analytics filtered to her, so that is
  // where her STEPS row lives.
  it("S, T and E open her observed lessons; P opens her attendance", async () => {
    mountHerAnalytics();
    const row = await screen.findByTestId("teacher-steps");
    for (const k of ["s", "t", "e"]) {
      expect(hrefOf(within(row).getByTestId(`teacher-steps-${k}`))).toBe("/portal/leader/lessons?teacherId=u1");
    }
    expect(hrefOf(within(row).getByTestId("teacher-steps-p"))).toBe("/portal/leader/attendance?teacherId=u1");
    expect(within(row).getByTestId("teacher-steps-p")).toHaveTextContent("18 of 20 days");
    expect(row.textContent).not.toMatch(PERCENT);
  });

  it("a remark still to write opens WhatsApp with /remark ready to send", async () => {
    mountHerAnalytics("todo");
    const cell = await screen.findByTestId("teacher-steps-r");
    expect(cell).toHaveTextContent("To do");
    expect(hrefOf(cell)).toBe(`${WHATSAPP_URL}?text=%2Fremark`);
  });

  it("a submitted remark scrolls to it on this page", async () => {
    mountHerAnalytics("done");
    const cell = await screen.findByTestId("teacher-steps-r");
    expect(cell).toHaveTextContent("Done");
    expect(hrefOf(cell)).toBe("/portal/leader/school-analytics?teacherId=u1#remarks");
  });

  it("the whole-school Analytics view carries no single-teacher row", async () => {
    as("principal");
    (leader.getSchoolAnalytics as any).mockResolvedValue({ ...FOCUS_ANALYTICS, focusTeacher: null });
    render(<MemoryRouter><SchoolAnalytics /></MemoryRouter>);
    await waitFor(() => expect(leader.getSchoolAnalytics).toHaveBeenCalled());
    await screen.findByRole("heading", { level: 1, name: "School Analytics" });
    expect(screen.queryByTestId("teacher-steps")).toBeNull();
  });

  it("a coach's teacher page shows bands but no one-school STEPS row", async () => {
    mountDetail("coach");
    await screen.findByTestId("session-s2");
    expect(leader.getSteps).not.toHaveBeenCalled();
    expect(screen.queryByTestId("teacher-steps")).toBeNull();
  });
});

describe("5 · the journey, page by page", () => {
  it("the principal's nav runs in STEPS order", () => {
    as("principal");
    render(<MemoryRouter><PortalNavigation /></MemoryRouter>);
    const desktop = screen.getAllByRole("navigation")[0];
    const titles = within(desktop).getAllByRole("link").map((l) => l.textContent?.trim() || "");
    const idx = (t: string) => titles.findIndex((x) => x === t);
    const order = ["My Patch", "Teachers", "Lessons", "Attendance", "Analytics"].map(idx);
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("her Analytics → her lessons", async () => {
    mountHerAnalytics();
    expect(hrefOf(await screen.findByTestId("next-step"))).toBe("/portal/leader/lessons?teacherId=u1");
  });

  it("teachers list → lessons", async () => {
    as("principal");
    (leader.getTeachers as any).mockResolvedValue({ success: true, total: 0, onRumi: 0, teachers: [] });
    render(<MemoryRouter><LeaderTeachers /></MemoryRouter>);
    expect(hrefOf(await screen.findByTestId("next-step"))).toBe("/portal/leader/lessons");
  });

  it("lessons → attendance", async () => {
    as("principal");
    (leader.getSchoolAnalytics as any).mockResolvedValue({
      success: true, school: { name: "S" }, focusTeacher: null, teachers: [],
      analytics: { totalSessions: 0, averageScore: null, scoreTrend: [], domainBreakdown: [], strongestDomain: null, focusDomain: null },
    });
    render(<MemoryRouter><SchoolLessons /></MemoryRouter>);
    expect(hrefOf(await screen.findByTestId("next-step"))).toBe("/portal/leader/attendance");
  });

  it("attendance → remarks", async () => {
    as("principal");
    (leader.getAttendance as any).mockResolvedValue({
      success: true, from: "2026-09-01", to: "2026-09-20", focusTeacher: null, teachers: [], schoolDays: [],
      students: { groups: [], byDay: [] }, staff: { groups: [], byDay: [] },
    });
    render(<MemoryRouter><SchoolAttendance /></MemoryRouter>);
    expect(hrefOf(await screen.findByTestId("next-step"))).toBe("/portal/leader/school-analytics#remarks");
  });

  it("a coach's pages carry no principal journey", async () => {
    as("coach");
    (leader.getTeachers as any).mockResolvedValue({ success: true, total: 0, onRumi: 0, teachers: [] });
    render(<MemoryRouter><LeaderTeachers /></MemoryRouter>);
    await waitFor(() => expect(leader.getTeachers).toHaveBeenCalled());
    expect(screen.queryByTestId("next-step")).toBeNull();
  });
});
