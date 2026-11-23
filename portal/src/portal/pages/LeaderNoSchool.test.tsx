import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * bd-r2uzg1.21.4 — a principal whose account names no school (users.school_id empty) opens the leader pages.
 *
 * Her patch is her own school, so with none every page read zeros and blanks: My Patch "Teachers 0", "On NIETE 0/0",
 * "No completed visits yet"; Teachers "0 teachers in your patch" and "No teachers yet ... once your roster is set up";
 * Analytics "Teachers 0"; Observed lessons "No observations yet". Nothing said why or what to do.
 *
 * The server now says so (`noSchool: true` on /leader/overview, /leader/teachers, /leader/school-analytics), and each
 * page shows one plain notice instead of the zeros: no school is linked to her account yet, ask her coach to add her
 * to her school. A principal WITH a school sees exactly what she saw before.
 */

vi.mock("../hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("../services/api", () => ({
  leader: { getOverview: vi.fn(), getTeachers: vi.fn(), getSchoolAnalytics: vi.fn() },
}));
vi.mock("react-apexcharts", () => ({ default: () => <div data-testid="chart" /> }));

import i18n from "@/i18n/config";
import { useAuth } from "../hooks/useAuth";
import { leader } from "../services/api";
import LeaderHome from "./LeaderHome";
import LeaderTeachers from "./LeaderTeachers";
import SchoolAnalytics from "./SchoolAnalytics";
import SchoolLessons from "./SchoolLessons";

const TITLE = "No school linked yet";
const ASK = /Ask your coach to add you to your school/;

const EMPTY_OVERVIEW = {
  totalTeachers: 0, onRumi: 0, notOnRumi: 0, totalCoachingSessions: 0, totalLessonPlans: 0,
  totalAttendanceSessions: 0, totalTrainingModules: 0, teachersMarkingAttendance: 0, teachersInTraining: 0,
  scoredTeachers: 0, avgLastScore: null, focus: [],
};
const OVERVIEW = { ...EMPTY_OVERVIEW, totalTeachers: 14, onRumi: 12, totalCoachingSessions: 37, totalLessonPlans: 90 };

const analyticsPayload = (over: Record<string, unknown> = {}) => ({
  success: true,
  school: { name: "Sample School", totalTeachers: 14, onRumi: 12, totalLessonPlans: 90, totalExams: 3 },
  focusTeacher: null,
  teachers: [{ id: "t1", name: "Teacher One", isPrincipal: false }],
  analytics: { totalSessions: 0, averageScore: null, scoreTrend: [], domainBreakdown: [], strongestDomain: null, focusDomain: null },
  presence: { teacher: { records: 0, present: 0, absent: 0, leave: 0, presentPct: null },
              student: { sessions: 0, totalMarked: 0, present: 0, presentPct: null } },
  remarks: { submitted: 0, averagePct: null, indicatorBreakdown: [], focusIndicator: null },
  ...over,
});
const NO_SCHOOL_ANALYTICS = analyticsPayload({
  noSchool: true,
  school: { name: null, totalTeachers: 0, onRumi: 0, totalLessonPlans: 0, totalExams: 0 },
  teachers: [],
});

function signIn() {
  vi.mocked(useAuth).mockReturnValue({ user: { firstName: "Sample", role: "principal" }, loading: false, logout: vi.fn() });
}
const mount = (el: JSX.Element) => render(<MemoryRouter>{el}</MemoryRouter>);

describe("a principal with no school linked", () => {
  beforeEach(() => { vi.clearAllMocks(); signIn(); });
  afterEach(async () => { await i18n.changeLanguage("en"); });

  it("My Patch: the notice, not the zero tiles", async () => {
    vi.mocked(leader.getOverview).mockResolvedValue({ success: true, noSchool: true, overview: EMPTY_OVERVIEW });
    mount(<LeaderHome />);
    const notice = await screen.findByTestId("patch-no-school");
    expect(notice).toHaveTextContent(TITLE);
    expect(notice).toHaveTextContent(ASK);
    expect(screen.queryByText("0/0")).toBeNull();
    expect(screen.queryByText("Coaching sessions")).toBeNull();
    expect(screen.queryByText(/No completed visits yet/)).toBeNull();
  });

  it("Teachers: the notice, not '0 teachers in your patch' and 'No teachers yet'", async () => {
    vi.mocked(leader.getTeachers).mockResolvedValue({ success: true, noSchool: true, total: 0, onRumi: 0, teachers: [] });
    mount(<LeaderTeachers />);
    const notice = await screen.findByTestId("teachers-no-school");
    expect(notice).toHaveTextContent(TITLE);
    expect(notice).toHaveTextContent(ASK);
    expect(screen.queryByText(/teachers in your patch/)).toBeNull();
    expect(screen.queryByText("No teachers yet")).toBeNull();
  });

  it("Analytics: the notice, not 'Teachers 0' and the empty tabs", async () => {
    vi.mocked(leader.getSchoolAnalytics).mockResolvedValue(NO_SCHOOL_ANALYTICS);
    mount(<SchoolAnalytics />);
    const notice = await screen.findByTestId("analytics-no-school");
    expect(notice).toHaveTextContent(TITLE);
    expect(notice).toHaveTextContent(ASK);
    expect(screen.queryByTestId("kpi-teachers")).toBeNull();
    expect(screen.queryByTestId("kpi-lesson-plans")).toBeNull();
  });

  it("Observed lessons: the notice, not 'No observations yet'", async () => {
    vi.mocked(leader.getSchoolAnalytics).mockResolvedValue(NO_SCHOOL_ANALYTICS);
    mount(<SchoolLessons />);
    const notice = await screen.findByTestId("lessons-no-school");
    expect(notice).toHaveTextContent(TITLE);
    expect(screen.queryByTestId("lessons-empty")).toBeNull();
    expect(screen.queryByTestId("teacher-filter")).toBeNull();
  });

  it("in Urdu: the notice is the Urdu words", async () => {
    await i18n.changeLanguage("ur");
    vi.mocked(leader.getOverview).mockResolvedValue({ success: true, noSchool: true, overview: EMPTY_OVERVIEW });
    mount(<LeaderHome />);
    const notice = await screen.findByTestId("patch-no-school");
    expect(notice).toHaveTextContent("اسکول ابھی منسلک نہیں");
    expect(notice).toHaveTextContent(/اپنے کوچ سے کہیں/);
    expect(notice).not.toHaveTextContent(TITLE);
  });
});

describe("a principal WITH a school: unchanged", () => {
  beforeEach(() => { vi.clearAllMocks(); signIn(); });

  it("My Patch shows her tiles and no notice", async () => {
    vi.mocked(leader.getOverview).mockResolvedValue({ success: true, noSchool: false, overview: OVERVIEW });
    mount(<LeaderHome />);
    await waitFor(() => expect(screen.getByText("14")).toBeInTheDocument());
    expect(screen.getByText("37")).toBeInTheDocument();
    expect(screen.queryByTestId("patch-no-school")).toBeNull();
  });

  it("an answer with no noSchool field (an older server) is today's page", async () => {
    vi.mocked(leader.getOverview).mockResolvedValue({ success: true, overview: OVERVIEW });
    mount(<LeaderHome />);
    await waitFor(() => expect(screen.getByText("14")).toBeInTheDocument());
    expect(screen.queryByTestId("patch-no-school")).toBeNull();
  });

  it("a school with no teachers yet keeps 'No teachers yet' (her school IS linked)", async () => {
    vi.mocked(leader.getTeachers).mockResolvedValue({ success: true, noSchool: false, total: 0, onRumi: 0, teachers: [] });
    mount(<LeaderTeachers />);
    await waitFor(() => expect(screen.getByText("No teachers yet")).toBeInTheDocument());
    expect(screen.queryByTestId("teachers-no-school")).toBeNull();
  });

  it("Analytics shows her numbers and no notice", async () => {
    vi.mocked(leader.getSchoolAnalytics).mockResolvedValue(analyticsPayload({ noSchool: false }));
    mount(<SchoolAnalytics />);
    await waitFor(() => expect(screen.getByTestId("kpi-teachers")).toHaveTextContent("14"));
    expect(screen.queryByTestId("analytics-no-school")).toBeNull();
  });
});
