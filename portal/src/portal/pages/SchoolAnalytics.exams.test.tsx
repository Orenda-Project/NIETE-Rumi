import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/** Exams generated sits beside Lesson plans on School Analytics (operator, 2026-09-30). */

vi.mock("react-apexcharts", () => ({ default: () => <div data-testid="chart" /> }));
vi.mock("../hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("../services/api", () => ({
  leader: { getSchoolAnalytics: vi.fn(), getSteps: vi.fn().mockResolvedValue({ success: true, cycle: null, teachers: [], summary: {} }) },
}));

import { useAuth } from "../hooks/useAuth";
import { leader } from "../services/api";
import SchoolAnalytics from "./SchoolAnalytics";

it("shows the school's exams generated next to its lesson plans", async () => {
  (useAuth as any).mockReturnValue({ user: { firstName: "Atifa", role: "principal" }, loading: false, logout: vi.fn() });
  (leader.getSchoolAnalytics as any).mockResolvedValue({
    success: true, school: { name: "S", totalTeachers: 9, onRumi: 9, totalLessonPlans: 42, totalExams: 27 },
    focusTeacher: null, teachers: [],
    analytics: { totalSessions: 0, averageScore: null, scoreTrend: [], domainBreakdown: [], strongestDomain: null, focusDomain: null },
  });
  render(<MemoryRouter><SchoolAnalytics /></MemoryRouter>);
  expect(await screen.findByTestId("kpi-exams")).toHaveTextContent("27");
  expect(screen.getByTestId("kpi-exams")).toHaveTextContent("Exams generated");
});
