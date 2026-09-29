import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * bd-60117 — the Analytics tab a PRINCIPAL sees: her school, not herself.
 *
 * Measured on NIETE prod 2026-09-17: all 460 principals together have 46 own
 * completed sessions (0.10 each), so a principal's own coaching data is an
 * empty page. Her school's is not — of 40 sampled, 34 had scored sessions.
 *
 * Charts are stubbed: this asserts what the principal READS, which is the part
 * that can be wrong in a way she would act on.
 */

vi.mock("../hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("../services/api", () => ({ leader: { getSchoolAnalytics: vi.fn(), getSteps: vi.fn().mockResolvedValue({ success: true, cycle: null, teachers: [], summary: {} }) } }));
vi.mock("react-apexcharts", () => ({ default: () => <div data-testid="chart" /> }));

import { useAuth } from "../hooks/useAuth";
import { leader } from "../services/api";
import SchoolAnalytics from "./SchoolAnalytics";

const PAYLOAD = {
  success: true,
  school: { name: "IMSG (I-V), BHARA KAU", totalTeachers: 19, onRumi: 17, totalLessonPlans: 269 },
  analytics: {
    totalSessions: 136,
    averageScore: 64.2,
    scoreTrend: [
      { date: "2026-07-01T00:00:00Z", percentage: 58 },
      { date: "2026-08-01T00:00:00Z", percentage: 64 },
    ],
    domainBreakdown: [
      { key: "student_engagement", name: "Student Engagement", percentage: 78.5, sessions: 136 },
      { key: "lesson_plan_fidelity", name: "Lesson Plan Fidelity", percentage: 41.2, sessions: 120 },
    ],
    strongestDomain: "Student Engagement",
    focusDomain: "Lesson Plan Fidelity",
  },
};

function renderPage(user: any, payload: any = PAYLOAD) {
  (useAuth as any).mockReturnValue({ user, loading: false, logout: vi.fn() });
  (leader.getSchoolAnalytics as any).mockResolvedValue(payload);
  render(
    <MemoryRouter>
      <SchoolAnalytics />
    </MemoryRouter>,
  );
}

const PRINCIPAL = { firstName: "Nosheen", role: "principal" };

describe("SchoolAnalytics", () => {
  beforeEach(() => vi.clearAllMocks());

  it("names the school, so she can see whose numbers these are", async () => {
    renderPage(PRINCIPAL);
    await waitFor(() => {
      expect(screen.getByText(/IMSG \(I-V\), BHARA KAU/)).toBeInTheDocument();
    });
  });

  // Rewritten 2026-09-29 for the Observations section (operator): the old
  // "Coaching sessions" / "Average rating" cards pooled Human and Digital Coach
  // Observations, and the four rubric-part cards became the three STEPS areas.
  // Each test keeps the question it asked, pointed at what now answers it.
  it("shows the school's headline numbers, not the principal's own", async () => {
    renderPage(PRINCIPAL, { ...PAYLOAD, analytics: { ...PAYLOAD.analytics, humanObservations: 12, digitalCoachObservations: 124 } });
    await waitFor(() => expect(screen.getByTestId("kpi-teachers")).toHaveTextContent("19"));
    expect(screen.getByTestId("kpi-lesson-plans")).toHaveTextContent("269");
    expect(screen.getByTestId("count-human")).toHaveTextContent("12");
    expect(screen.getByTestId("count-digital")).toHaveTextContent("124");
    expect(screen.queryByTestId("kpi-sessions")).toBeNull();
  });

  const AREAS = [
    { key: "e", name: "Engagement", pct: 78.5, band: "good", observations: 12 },
    { key: "t", name: "Teaching skills", pct: 55, band: "average", observations: 12 },
    { key: "s", name: "Subject knowledge", pct: 41.2, band: "average", observations: 12 },
  ];

  it("lists each STEPS area with its rating, strongest first", async () => {
    renderPage(PRINCIPAL, { ...PAYLOAD, analytics: { ...PAYLOAD.analytics, areas: AREAS } });
    await waitFor(() => expect(screen.getByTestId("area-e")).toHaveTextContent("Engagement"));
    expect(screen.getByTestId("area-e")).toHaveTextContent("Good");
    expect(screen.getAllByTestId(/^area-/).map((el) => el.getAttribute("data-testid"))).toEqual(["area-e", "area-t", "area-s"]);
  });

  it("marks the weakest area so she knows where to put attention", async () => {
    renderPage(PRINCIPAL, { ...PAYLOAD, analytics: { ...PAYLOAD.analytics, areas: AREAS } });
    await waitFor(() => expect(screen.getByTestId("area-s")).toHaveTextContent(/work on this/i));
    expect(screen.getByTestId("area-e")).not.toHaveTextContent(/work on this/i);
  });

  it("says plainly there are no Human Observations yet rather than rendering a rating", async () => {
    renderPage(PRINCIPAL, {
      success: true,
      school: { name: "IMSG (VI-X) G-7/2", totalTeachers: 18, onRumi: 5, totalLessonPlans: 0 },
      analytics: {
        totalSessions: 0, averageScore: null, scoreTrend: [], humanObservations: 0, digitalCoachObservations: 0,
        areas: [], byMonth: [], observations: [],
        domainBreakdown: [], strongestDomain: null, focusDomain: null,
      },
    });
    // 18 of the 40 sampled schools looked like this — a real, common state.
    await waitFor(() => expect(screen.getAllByText(/No Human Observations yet/).length).toBeGreaterThan(0));
    expect(screen.queryAllByTestId("score-band")).toHaveLength(0);
  });

  it("tells a non-principal leader this view is not theirs, instead of showing a wrong school", async () => {
    (useAuth as any).mockReturnValue({ user: { firstName: "Noor", role: "coach" }, loading: false, logout: vi.fn() });
    (leader.getSchoolAnalytics as any).mockRejectedValue({ response: { status: 403 } });
    render(<MemoryRouter><SchoolAnalytics /></MemoryRouter>);
    await waitFor(() => expect(screen.getByTestId("not-for-you")).toBeInTheDocument());
  });
});
