import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * bd-60119 — Coaching history on the Analytics page.
 *
 * Ported from the teacher-detail page, which principals no longer land on. The
 * trend chart shows the SHAPE; this shows the individual lessons behind it,
 * with the date and the marks — which is what a principal points at when she
 * talks to a teacher about a specific visit.
 */

vi.mock("../hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("../services/api", () => ({ leader: { getSchoolAnalytics: vi.fn() } }));
vi.mock("react-apexcharts", () => ({ default: () => <div data-testid="chart" /> }));

import { useAuth } from "../hooks/useAuth";
import { leader } from "../services/api";
import SchoolAnalytics from "./SchoolAnalytics";

const BASE = {
  success: true,
  school: { name: "IMSB (I-V), MAL", totalTeachers: 8, onRumi: 7, totalLessonPlans: 42 },
  focusTeacher: null,
  teachers: [{ id: "t1", name: "Ayesha Bibi", isPrincipal: false }],
  analytics: {
    totalSessions: 2, averageScore: 60.7,
    scoreTrend: [
      { date: "2026-08-01T00:00:00Z", percentage: 58, points: 58, maxPoints: 100, teacherName: "Ayesha Bibi" },
      { date: "2026-09-01T00:00:00Z", percentage: 64, points: 64, maxPoints: 100, teacherName: "Sana Riaz" },
    ],
    domainBreakdown: [{ key: "d1", name: "High Leverage Practices", percentage: 55.7, sessions: 2 }],
    strongestDomain: "High Leverage Practices", focusDomain: "High Leverage Practices",
  },
  presence: {
    teacher: { records: 6, present: 6, absent: 0, leave: 0, presentPct: 100 },
    student: { sessions: 7, totalMarked: 161, present: 143, presentPct: 88.8 },
  },
  remarks: { submitted: 0, averagePct: null, indicatorBreakdown: [], focusIndicator: null },
};

function mount(payload: any = BASE) {
  (useAuth as any).mockReturnValue({ user: { firstName: "Atifa", role: "principal" }, loading: false, logout: vi.fn() });
  (leader.getSchoolAnalytics as any).mockResolvedValue(payload);
  render(<MemoryRouter><SchoolAnalytics /></MemoryRouter>);
}

describe("SchoolAnalytics — coaching history", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lists each observed lesson, newest first", async () => {
    mount();
    await waitFor(() => expect(screen.getByTestId("coaching-history")).toBeInTheDocument());
    const rows = screen.getAllByTestId(/^history-row-/);
    expect(rows).toHaveLength(2);
    // Newest first: the list is read as "what happened recently".
    expect(rows[0].textContent).toMatch(/Sep/);
  });

  it("shows the marks behind each lesson, not only the percentage", async () => {
    mount();
    await waitFor(() => expect(screen.getByTestId("coaching-history")).toBeInTheDocument());
    expect(screen.getAllByTestId(/^history-row-/)[0].textContent).toMatch(/64 \/ 100/);
  });

  it("names the teacher on each row when showing the whole school", async () => {
    mount();
    await waitFor(() => expect(screen.getByTestId("coaching-history")).toBeInTheDocument());
    // Across a school the date alone does not say whose lesson it was.
    expect(screen.getAllByTestId(/^history-row-/)[0].textContent).toMatch(/Sana Riaz/);
  });

  it("drops the teacher name when already filtered to one teacher", async () => {
    mount({ ...BASE, focusTeacher: { id: "t1", name: "Ayesha Bibi" } });
    await waitFor(() => expect(screen.getByTestId("coaching-history")).toBeInTheDocument());
    const rows = screen.getAllByTestId(/^history-row-/);
    expect(rows[0].textContent).not.toMatch(/Sana Riaz/);
  });

  it("says so when there are no observed lessons yet", async () => {
    mount({ ...BASE, analytics: { ...BASE.analytics, totalSessions: 0, scoreTrend: [], domainBreakdown: [] } });
    await waitFor(() => expect(screen.getByTestId("empty-analytics")).toBeInTheDocument());
    expect(screen.queryByTestId("coaching-history")).not.toBeInTheDocument();
  });
});
