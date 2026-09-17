import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

/**
 * bd-60118 — the remaining STEPS components on the principal's Analytics tab,
 * plus the per-teacher filter.
 *
 * The tab is NOT branded STEPS (operator, 2026-09-17) — a principal reads her
 * school, not a framework name. But the five components are all present:
 * S/T/E already came from the coaching domains; P (presence) and S (supervisor
 * remarks) are added here.
 *
 * Numbers ARE shown. Momina's "no numerical marks to principals"
 * (#steps-coordination, 2026-09-07) governs what AEOs and the wider leader
 * family see; this view is principal-only and 403s everyone else, and the
 * operator confirmed numbers are right for her own school (2026-09-17).
 */

vi.mock("../hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("../services/api", () => ({ leader: { getSchoolAnalytics: vi.fn() } }));
vi.mock("react-apexcharts", () => ({ default: () => <div data-testid="chart" /> }));

import { useAuth } from "../hooks/useAuth";
import { leader } from "../services/api";
import SchoolAnalytics from "./SchoolAnalytics";

const PAYLOAD = {
  success: true,
  school: { name: "IMSB (I-V), MAL", totalTeachers: 8, onRumi: 7, totalLessonPlans: 42 },
  focusTeacher: null,
  teachers: [
    { id: "t1", name: "Ayesha Bibi", isPrincipal: false },
    { id: "t2", name: "Sana Riaz", isPrincipal: false },
    { id: "p1", name: "Atifa Ahsan", isPrincipal: true },
  ],
  analytics: {
    totalSessions: 18, averageScore: 60.7,
    scoreTrend: [{ date: "2026-08-01T00:00:00Z", percentage: 58 }],
    domainBreakdown: [
      { key: "teacher_subject_knowledge", name: "Teacher Subject Knowledge", percentage: 68.5, sessions: 18 },
      { key: "high_leverage_practices", name: "High Leverage Practices", percentage: 55.7, sessions: 18 },
    ],
    strongestDomain: "Teacher Subject Knowledge",
    focusDomain: "High Leverage Practices",
  },
  presence: {
    teacher: { records: 6, present: 6, absent: 0, leave: 0, presentPct: 100 },
    student: { sessions: 7, totalMarked: 161, present: 143, presentPct: 88.8 },
  },
  remarks: {
    submitted: 1, averagePct: 70,
    indicatorBreakdown: [
      { key: "score_growth", ordinal: 1, name: "Professional Growth & Feedback Uptake", average: 3, percentage: 75, teachers: 1 },
      { key: "score_student_support", ordinal: 4, name: "Student-Centered Support", average: 2, percentage: 50, teachers: 1 },
    ],
    focusIndicator: "Student-Centered Support",
  },
};

function renderPage(payload: any = PAYLOAD) {
  (useAuth as any).mockReturnValue({ user: { firstName: "Atifa", role: "principal" }, loading: false, logout: vi.fn() });
  (leader.getSchoolAnalytics as any).mockResolvedValue(payload);
  render(<MemoryRouter><SchoolAnalytics /></MemoryRouter>);
}

describe("SchoolAnalytics — presence + remarks + filter", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows teacher and student presence as two SEPARATE figures", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId("presence-teacher")).toHaveTextContent("100"));
    expect(screen.getByTestId("presence-student")).toHaveTextContent("88.8");
    // No blended P score — the 60:40 weighting was never locked.
    expect(screen.queryByTestId("presence-combined")).not.toBeInTheDocument();
  });

  it("shows the supervisor remarks with their indicator breakdown", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId("remarks-average")).toHaveTextContent("70"));
    expect(screen.getByTestId("remark-score_student_support")).toHaveTextContent("Student-Centered Support");
    expect(screen.getByTestId("remarks-focus")).toHaveTextContent("Student-Centered Support");
  });

  it("does not brand the page STEPS", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId("presence-teacher")).toBeInTheDocument());
    expect(document.body.textContent).not.toMatch(/STEPS/);
  });

  it("offers every teacher in the school in the filter", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId("teacher-filter")).toBeInTheDocument());
    const opts = screen.getAllByRole("option").map((o) => o.textContent);
    expect(opts).toContain("Ayesha Bibi");
    expect(opts).toContain("Sana Riaz");
    // Whole school is the default view.
    expect(opts[0]).toMatch(/whole school|all teachers/i);
  });

  it("refetches scoped to one teacher when the filter changes", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId("teacher-filter")).toBeInTheDocument());
    await userEvent.selectOptions(screen.getByTestId("teacher-filter"), "t1");
    await waitFor(() => expect(leader.getSchoolAnalytics).toHaveBeenLastCalledWith("t1"));
  });

  it("says whose numbers are on screen when one teacher is selected", async () => {
    renderPage({ ...PAYLOAD, focusTeacher: { id: "t1", name: "Ayesha Bibi" } });
    await waitFor(() => expect(screen.getByTestId("scope-label")).toHaveTextContent("Ayesha Bibi"));
  });

  it("handles a school with presence but no remarks yet", async () => {
    renderPage({
      ...PAYLOAD,
      remarks: { submitted: 0, averagePct: null, indicatorBreakdown: [], focusIndicator: null },
    });
    await waitFor(() => expect(screen.getByTestId("presence-teacher")).toBeInTheDocument());
    expect(screen.getByTestId("remarks-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("remarks-average")).not.toBeInTheDocument();
  });

  it("says nothing is marked rather than showing 0% presence", async () => {
    renderPage({
      ...PAYLOAD,
      presence: {
        teacher: { records: 0, present: 0, absent: 0, leave: 0, presentPct: null },
        student: { sessions: 0, totalMarked: 0, present: 0, presentPct: null },
      },
    });
    await waitFor(() => expect(screen.getByTestId("presence-empty")).toBeInTheDocument());
    expect(screen.queryByTestId("presence-teacher")).not.toBeInTheDocument();
  });
});
