import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";

// bd-2434 (NIETE port of bd-2393): one teacher's detail — identity, stats,
// coaching sessions with scores.

vi.mock("../hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("../services/api", () => ({ leader: { getTeacher: vi.fn() } }));

import { useAuth } from "../hooks/useAuth";
import { leader } from "../services/api";
import LeaderTeacherDetail from "./LeaderTeacherDetail";

const DETAIL = {
  success: true,
  teacher: { rumiUserId: "u1", name: "Ayesha", phone: "923001234567", onRumi: true },
  stats: { coachingSessions: 2, lessonPlans: 7, readingAssessments: 3, lastScore: 48, lastSummary: null },
  sessions: [
    { id: "s2", date: "2026-07-22T10:00:00Z", score: 48, points: 71, maxPoints: 148, summary: null },
    { id: "s1", date: "2026-07-10T10:00:00Z", score: 71, points: 105, maxPoints: 148, summary: null },
  ],
};

function renderDetail(resolved: any = DETAIL) {
  (useAuth as any).mockReturnValue({ user: { firstName: "Noor", role: "coach" }, loading: false, logout: vi.fn() });
  (leader.getTeacher as any).mockResolvedValue(resolved);
  render(
    <MemoryRouter initialEntries={["/portal/leader/teacher/u1"]}>
      <Routes>
        <Route path="/portal/leader/teacher/:id" element={<LeaderTeacherDetail />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("LeaderTeacherDetail", () => {
  beforeEach(() => vi.clearAllMocks());

  it("fetches the teacher by the route id", async () => {
    renderDetail();
    await waitFor(() => expect(leader.getTeacher).toHaveBeenCalledWith("u1"));
  });

  it("renders the teacher name + stats", async () => {
    renderDetail();
    await waitFor(() => expect(screen.getByRole("heading", { name: /Ayesha/ })).toBeInTheDocument());
    expect(screen.getByText("7")).toBeInTheDocument();   // lesson plans
    expect(screen.getByText("3")).toBeInTheDocument();   // reading assessments
  });

  it("lists the coaching sessions", async () => {
    renderDetail();
    // bd-60174: this asserted on a "%" because the row used to carry a score.
    // The leader view no longer shows one — the operator's decision is to hide
    // the number, not to stop computing it — so the claim is now made against
    // the session rows themselves, which is what this test was always about.
    await waitFor(() => expect(screen.getAllByTestId(/^session-/).length).toBe(2));
  });
});
