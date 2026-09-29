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
vi.mock("../services/api", () => ({ leader: { getSchoolAnalytics: vi.fn(), getSteps: vi.fn().mockResolvedValue({ success: true, cycle: null, teachers: [], summary: {} }) } }));
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
    humanObservations: 2, digitalCoachObservations: 0,
    byMonth: [{ month: "2026-09", human: 1, digitalCoach: 0 }],
    observations: [
      { date: "2026-09-01T09:00:00Z", kind: "human", percentage: 64, teacherName: "Sana Riaz" },
    ],
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

// Rewritten 2026-09-29: the "Recent observed lessons" preview became the
// month list under "When Observations Happened" (operator). Same questions —
// newest first, band not marks, whose lesson — asked of the new list.
describe("SchoolAnalytics — when observations happened", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lists the newest month's observations, newest first", async () => {
    mount({ ...BASE, analytics: { ...BASE.analytics,
      byMonth: [{ month: "2026-09", human: 2, digitalCoach: 0 }],
      observations: [
        { date: "2026-09-20T09:00:00Z", kind: "human", percentage: 64, teacherName: "Sana Riaz" },
        { date: "2026-09-02T09:00:00Z", kind: "human", percentage: 58, teacherName: "Ayesha Bibi" },
      ] } });
    await waitFor(() => expect(screen.getAllByTestId(/^obs-row-/)).toHaveLength(2));
    expect(screen.getAllByTestId(/^obs-row-/)[0].textContent).toMatch(/20 Sept?/);
  });

  it("shows a Human Observation's band, never its marks or percentage", async () => {
    mount();
    await waitFor(() => expect(screen.getAllByTestId(/^obs-row-/)).toHaveLength(1));
    const row = screen.getAllByTestId(/^obs-row-/)[0];
    expect(row.textContent).toMatch(/Good/);
    expect(row.textContent).not.toMatch(/\d+\s*\/\s*\d+|\d+\s*%/);
  });

  it("names the teacher on each row when showing the whole school", async () => {
    mount();
    await waitFor(() => expect(screen.getAllByTestId(/^obs-row-/)).toHaveLength(1));
    expect(screen.getAllByTestId(/^obs-row-/)[0].textContent).toMatch(/Sana Riaz/);
  });

  it("drops the teacher name when already filtered to one teacher", async () => {
    mount({ ...BASE, focusTeacher: { id: "t1", name: "Ayesha Bibi" } });
    await waitFor(() => expect(screen.getAllByTestId(/^obs-row-/)).toHaveLength(1));
    expect(screen.getAllByTestId(/^obs-row-/)[0].textContent).not.toMatch(/Sana Riaz/);
  });

  it("says so when there are no observations yet", async () => {
    mount({ ...BASE, analytics: { ...BASE.analytics, totalSessions: 0, scoreTrend: [], humanObservations: 0,
      byMonth: [], observations: [], areas: [] } });
    await waitFor(() => expect(screen.getByText("No observations yet.")).toBeInTheDocument());
    expect(screen.queryAllByTestId(/^obs-row-/)).toHaveLength(0);
  });
});
