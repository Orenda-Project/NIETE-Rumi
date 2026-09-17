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
vi.mock("../services/api", () => ({ leader: { getSchoolAnalytics: vi.fn() } }));
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

  it("shows the school's headline KPIs, not the principal's own", async () => {
    renderPage(PRINCIPAL);
    await waitFor(() => expect(screen.getByTestId("kpi-sessions")).toHaveTextContent("136"));
    expect(screen.getByTestId("kpi-avg-score")).toHaveTextContent("64.2");
    expect(screen.getByTestId("kpi-teachers")).toHaveTextContent("19");
    expect(screen.getByTestId("kpi-lesson-plans")).toHaveTextContent("269");
  });

  it("lists each domain with the number of sessions it was measured in", async () => {
    renderPage(PRINCIPAL);
    // Scoped to the domain cards: these names legitimately appear again in the
    // "where to focus" line below, so a bare getByText matches twice.
    await waitFor(() =>
      expect(screen.getByTestId("domain-student_engagement")).toHaveTextContent("Student Engagement"));
    expect(screen.getByTestId("domain-lesson_plan_fidelity")).toHaveTextContent("Lesson Plan Fidelity");
    // The session count is what stops a rarely-measured domain reading as a
    // school-wide weakness — two rubrics coexist in NIETE's live data.
    expect(screen.getByTestId("domain-lesson_plan_fidelity")).toHaveTextContent("120");
  });

  it("names the focus domain so she knows where to put attention", async () => {
    renderPage(PRINCIPAL);
    await waitFor(() => {
      expect(screen.getByTestId("focus-domain")).toHaveTextContent("Lesson Plan Fidelity");
    });
  });

  it("says plainly there is nothing yet rather than rendering 0%", async () => {
    renderPage(PRINCIPAL, {
      success: true,
      school: { name: "IMSG (VI-X) G-7/2", totalTeachers: 18, onRumi: 5, totalLessonPlans: 0 },
      analytics: {
        totalSessions: 0, averageScore: null, scoreTrend: [],
        domainBreakdown: [], strongestDomain: null, focusDomain: null,
      },
    });
    // 18 of the 40 sampled schools looked like this — a real, common state.
    await waitFor(() => expect(screen.getByTestId("empty-analytics")).toBeInTheDocument());
    expect(screen.queryByTestId("kpi-avg-score")).not.toBeInTheDocument();
  });

  it("tells a non-principal leader this view is not theirs, instead of showing a wrong school", async () => {
    (useAuth as any).mockReturnValue({ user: { firstName: "Noor", role: "coach" }, loading: false, logout: vi.fn() });
    (leader.getSchoolAnalytics as any).mockRejectedValue({ response: { status: 403 } });
    render(<MemoryRouter><SchoolAnalytics /></MemoryRouter>);
    await waitFor(() => expect(screen.getByTestId("not-for-you")).toBeInTheDocument());
  });
});
