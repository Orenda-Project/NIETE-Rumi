import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * bd-60119 — a PRINCIPAL tapping a teacher lands on Analytics, filtered to her.
 *
 * The teacher-detail page and the Analytics page had grown into near-duplicates
 * (operator, 2026-09-17): both show a score trend and per-teacher numbers, and
 * Analytics now does strictly more — presence and evaluations as well. Two
 * pages answering one question means two places to keep right, and a principal
 * choosing between them for no reason.
 *
 * So for a principal the roster deep-links into the Analytics filter. A COACH
 * keeps the detail page: her patch spans many schools, so the school-scoped
 * Analytics tab is not hers (the endpoint 403s her), and taking her detail page
 * away would leave her with nothing.
 */

vi.mock("../hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("../services/api", () => ({ leader: { getTeachers: vi.fn() } }));

import { useAuth } from "../hooks/useAuth";
import { leader } from "../services/api";
import LeaderTeachers from "./LeaderTeachers";

const TEACHERS = {
  success: true, total: 2, onRumi: 2,
  teachers: [
    { name: "Ayesha", rumiUserId: "u1", onRumi: true, coachingSessions: 4, lessonPlans: 9, lastScore: 71, lastSessionAt: "2026-07-20", phone: "923001", teacherExtId: "T1" },
    { name: "Zainab", rumiUserId: "u2", onRumi: true, coachingSessions: 2, lessonPlans: 3, lastScore: 48, lastSessionAt: "2026-07-22", phone: "923002", teacherExtId: "T2" },
  ],
};

function renderAs(role: string) {
  (useAuth as any).mockReturnValue({ user: { firstName: "X", role }, loading: false, logout: vi.fn() });
  (leader.getTeachers as any).mockResolvedValue(TEACHERS);
  render(<MemoryRouter><LeaderTeachers /></MemoryRouter>);
}

describe("LeaderTeachers — where a teacher row leads", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sends a principal to Analytics, pre-filtered to that teacher", async () => {
    renderAs("principal");
    await waitFor(() => expect(screen.getByText("Ayesha")).toBeInTheDocument());
    const link = screen.getByText("Ayesha").closest("a");
    expect(link).toHaveAttribute("href", "/portal/leader/school-analytics?teacherId=u1");
  });

  it("keeps a coach on the teacher detail page — Analytics is not hers", async () => {
    renderAs("coach");
    await waitFor(() => expect(screen.getByText("Ayesha")).toBeInTheDocument());
    const link = screen.getByText("Ayesha").closest("a");
    expect(link).toHaveAttribute("href", "/portal/leader/teacher/u1");
  });
});
