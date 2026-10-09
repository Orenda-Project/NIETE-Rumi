import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";

/**
 * bd-fmf24g.27 — the principal's Analytics: "My school | Me", My school first; the school is the server's (no school
 * parameter is ever sent); a teacher row opens that teacher; a number the server does not give is left out.
 */

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("../../lib/recordingSession", () => ({ useRecordingSession: () => null }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("../../services/api", () => ({
  default: { get: vi.fn(), post: vi.fn() },
  portal: { getMyAnalytics: vi.fn() },
  leader: { getSchoolAnalytics: vi.fn(), getTeachers: vi.fn() },
}));

import "../routes";
import api, { portal, leader } from "../../services/api";
import { useAuth } from "../../hooks/useAuth";
import analyticsRoutes from "./routes";
import { ANALYTICS_HOME } from "./paths";
import { ANALYTICS_V2_COPY as C } from "./copy";
import { oneTeacherPath } from "./school";

const http = api as unknown as { get: ReturnType<typeof vi.fn> };
const mine = portal.getMyAnalytics as unknown as ReturnType<typeof vi.fn>;
const schoolApi = leader.getSchoolAnalytics as unknown as ReturnType<typeof vi.fn>;
const rosterApi = leader.getTeachers as unknown as ReturnType<typeof vi.fn>;

const SCHOOL = (lp: number, obs: number) => ({
  success: true,
  school: { name: "Model School", totalTeachers: 3, onRumi: 3, totalLessonPlans: lp, totalExams: 17 },
  focusTeacher: null,
  teachers: [],
  analytics: {
    totalSessions: 7, averageScore: 66, domainBreakdown: [], strongestDomain: null, focusDomain: null,
    humanObservations: obs, digitalCoachObservations: 38,
    scoreTrend: [{ date: "2026-09-28", percentage: 66, points: null, maxPoints: null, teacherName: null }],
    areas: [{ key: "t", name: "Teaching skills", pct: 72, band: "good", observations: 3 }],
  },
  presence: { teacher: { records: 20, present: 18, absent: 2, leave: 0, presentPct: 93 }, student: { sessions: 3, totalMarked: 90, present: 79, presentPct: 88 } },
  remarks: {},
});
const ROSTER = {
  success: true, total: 3, onRumi: 3,
  teachers: [
    { rumiUserId: "u-b", name: "Bina", onRumi: true, observations: 1, coachingSessions: 4, isPrincipal: false },
    { rumiUserId: "u-a", name: "Ayesha", onRumi: true, observations: 2, coachingSessions: 6, isPrincipal: false },
    { rumiUserId: "u-p", name: "The Principal", onRumi: true, observations: 0, coachingSessions: 0, isPrincipal: true },
    { rumiUserId: null, name: "Not on app", onRumi: false, observations: 0, coachingSessions: 0 },
  ],
};

const asUser = (role: string) => vi.mocked(useAuth).mockReturnValue({ user: { id: "u-p", role, phoneNumber: "923001110009" }, loading: false } as never);
const open = (path = ANALYTICS_HOME) => render(
  <MemoryRouter initialEntries={[path]}>
    <Routes>{analyticsRoutes.map((r) => <Route key={r.path} path={r.path} element={r.element} />)}</Routes>
  </MemoryRouter>,
);

beforeEach(() => {
  vi.clearAllMocks();
  http.get.mockResolvedValue({ data: { lessonPlans: { used: 14 }, training: { completed: 6 }, assessments: { made: 4 }, attendance: { days: 18 }, coaching: { digitalCoach: 9, observations: 3 } } });
  mine.mockResolvedValue({ success: true, totals: {}, analytics: { scoreTrend: [], areas: [] }, presence: {}, remarksReceived: [] });
  schoolApi.mockImplementation(async (_id: string | null, range: { from?: string }) => SCHOOL(range?.from ? 61 : 61, 7));
  rosterApi.mockResolvedValue(ROSTER);
});

describe("principal Analytics", () => {
  it("tabs My school | Me, My school first, with her school's name", async () => {
    asUser("principal");
    open();
    const tabs = await screen.findByRole("tablist");
    const [first, second] = within(tabs).getAllByRole("tab");
    expect(first).toHaveTextContent(C.mySchool);
    expect(first).toHaveAttribute("aria-selected", "true");
    expect(second).toHaveTextContent(C.me);
    expect(await screen.findByText(/Model School/)).toBeTruthy();
  });

  it("never sends a school: only a date window, and no teacher id on the school view", async () => {
    asUser("principal");
    open();
    await screen.findByText(/Model School/);
    expect(schoolApi).toHaveBeenCalled();
    for (const [id, range] of schoolApi.mock.calls) {
      expect(id).toBeNull();
      expect(Object.keys(range).sort()).toEqual(["from", "to"]);
    }
  });

  it("tiles: the four locked names with the server's numbers; the change comes from the period before", async () => {
    asUser("principal");
    schoolApi.mockImplementation(async (_id: string | null, range: { from?: string; to?: string }) => SCHOOL(61, range.to && range.to < "2026-10" ? 5 : 7));
    const { container } = open();
    await screen.findByText(/Model School/);
    await waitFor(() => expect(container.querySelectorAll("[data-feature-tile]").length).toBe(4));
    expect(Array.from(container.querySelectorAll("[data-feature-tile]")).map((t) => t.getAttribute("data-feature-tile"))).toEqual(["lessons", "assessment", "observations", "coaching"]);
    for (const n of ["Lesson Plans", "Assessments", "Coach Observations", "Digital Coaching"]) expect(screen.getByText(n)).toBeTruthy();
    expect(screen.queryByText(C.modulesDone)).toBeNull();
    expect(screen.queryByText(C.attendanceDays)).toBeNull();
  });

  it("a tile the server cannot give is left out, not shown as a dash", async () => {
    asUser("principal");
    schoolApi.mockResolvedValue({ ...SCHOOL(61, 7), analytics: { ...SCHOOL(61, 7).analytics, humanObservations: undefined } });
    const { container } = open();
    await screen.findByText(/Model School/);
    await waitFor(() => expect(container.querySelectorAll("[data-feature-tile]").length).toBe(3));
    expect(screen.queryByText("—")).toBeNull();
  });

  it("her teachers are rows (not herself, not another principal, not those off the app), each opening that teacher", async () => {
    asUser("principal");
    open();
    const row = await screen.findByRole("link", { name: /Ayesha/ });
    expect(row).toHaveAttribute("href", oneTeacherPath("u-a"));
    expect(screen.getByRole("link", { name: /Bina/ })).toHaveAttribute("href", oneTeacherPath("u-b"));
    expect(screen.queryByText("The Principal")).toBeNull();
    expect(screen.queryByText("Not on app")).toBeNull();
    expect(row).toHaveTextContent("2 Observations · 6 DC");
  });

  it("Me shows her own page, the teacher one", async () => {
    asUser("principal");
    const user = userEvent.setup();
    open();
    await user.click(await screen.findByRole("tab", { name: C.me }));
    await waitFor(() => expect(mine).toHaveBeenCalled());
    expect(await screen.findByText(C.lessonPlansUsed)).toBeTruthy();
  });

  it("a teacher gets no tabs and never asks for school data", async () => {
    asUser("teacher");
    open();
    await waitFor(() => expect(mine).toHaveBeenCalled());
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(schoolApi).not.toHaveBeenCalled();
    expect(rosterApi).not.toHaveBeenCalled();
  });

  it("one teacher: asks for that id, shows her name; a 404 is a plain Not found", async () => {
    asUser("principal");
    schoolApi.mockResolvedValue({ ...SCHOOL(3, 1), focusTeacher: { id: "u-a", name: "Ayesha" } });
    open(oneTeacherPath("u-a"));
    expect(await screen.findByRole("heading", { name: "Ayesha" })).toBeTruthy();
    expect(schoolApi.mock.calls[0][0]).toBe("u-a");
    expect(screen.queryByText(C.modulesDone)).toBeNull();
  });

  it("one teacher outside her school: Not found, nothing else", async () => {
    asUser("principal");
    schoolApi.mockRejectedValue(new Error("404"));
    open(oneTeacherPath("u-other"));
    expect(await screen.findByText(C.notFound)).toBeTruthy();
    expect(document.querySelector("[data-feature-tile]")).toBeNull();
  });
});
