import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * bd-60122 — the KPI row must mean ONE thing at a time.
 *
 * Filtered to a teacher, the row mixed two scopes and said so nowhere:
 * `totalTeachers` / `onRumi` came from the whole school while
 * `totalLessonPlans` was already scoped to the selection (portal.routes.js).
 * So three cards described Ayesha and one described the school, which is worse
 * than redundant — a row of four cards reads as sharing a scope.
 *
 * Filtered, the Teachers card is replaced by one about HER.
 */

vi.mock("../hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("../services/api", () => ({ leader: { getSchoolAnalytics: vi.fn() } }));
vi.mock("react-apexcharts", () => ({ default: () => <div data-testid="chart" /> }));

import { useAuth } from "../hooks/useAuth";
import { leader } from "../services/api";
import SchoolAnalytics from "./SchoolAnalytics";

const BASE = {
  success: true,
  school: { name: "IMSB (I-V), MAL", totalTeachers: 19, onRumi: 17, totalLessonPlans: 9 },
  focusTeacher: null,
  teachers: [{ id: "t1", name: "Ayesha Bibi", isPrincipal: false }],
  analytics: {
    totalSessions: 3, averageScore: 61.6,
    scoreTrend: [{ date: "2026-09-01T00:00:00Z", percentage: 61.6, points: 61, maxPoints: 100, teacherName: "Ayesha Bibi" }],
    domainBreakdown: [{ key: "d1", name: "High Leverage Practices", percentage: 55.7, sessions: 3 }],
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

describe("SchoolAnalytics — the KPI row states one scope", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows the school's teacher count on the whole-school view", async () => {
    mount();
    await waitFor(() => expect(screen.getByTestId("kpi-teachers")).toHaveTextContent("19"));
  });

  it("drops the school teacher count once one teacher is selected", async () => {
    mount({ ...BASE, focusTeacher: { id: "t1", name: "Ayesha Bibi" } });
    await waitFor(() => expect(screen.getByTestId("kpi-sessions")).toBeInTheDocument());
    // "19 teachers · 17 on NIETE" says nothing about Ayesha.
    expect(screen.queryByTestId("kpi-teachers")).not.toBeInTheDocument();
  });

  it("replaces it with a card about HER", async () => {
    mount({ ...BASE, focusTeacher: { id: "t1", name: "Ayesha Bibi" } });
    await waitFor(() => expect(screen.getByTestId("kpi-observed")).toBeInTheDocument());
    expect(screen.getByTestId("kpi-observed")).toHaveTextContent("3");
  });

  it("labels the row with whose numbers these are", async () => {
    mount({ ...BASE, focusTeacher: { id: "t1", name: "Ayesha Bibi" } });
    await waitFor(() => expect(screen.getByTestId("kpi-scope")).toBeInTheDocument());
    expect(screen.getByTestId("kpi-scope")).toHaveTextContent("Ayesha Bibi");
  });

  it("says the row is the whole school when nothing is filtered", async () => {
    mount();
    await waitFor(() => expect(screen.getByTestId("kpi-scope")).toBeInTheDocument());
    expect(screen.getByTestId("kpi-scope").textContent).toMatch(/whole school/i);
  });
});
