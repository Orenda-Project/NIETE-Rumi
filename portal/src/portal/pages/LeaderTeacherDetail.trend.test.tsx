import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";

/**
 * A coach opening a teacher wants to know whether she is getting better, and the
 * detail page only ever showed a flat list of dated scores. The API already returns
 * the whole ordered series, so the trend was a rendering gap, not a data one.
 *
 * It is deliberately hidden below two scored observations: a "trend" drawn through one
 * point is a decoration that invites a conclusion it cannot support.
 */

vi.mock("../hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("../services/api", () => ({ leader: { getTeacher: vi.fn() } }));

import { useAuth } from "../hooks/useAuth";
import { leader } from "../services/api";
import LeaderTeacherDetail from "./LeaderTeacherDetail";

const detail = (sessions: any[]) => ({
  success: true,
  teacher: { rumiUserId: "u1", name: "Ayesha", phone: "923001234567", onRumi: true },
  stats: {
    coachingSessions: sessions.length, lessonPlans: 7, readingAssessments: 3,
    lastScore: sessions.length ? sessions[0].score : null,
  },
  sessions,
});

// Newest first, exactly as the service returns it.
const THREE = [
  { id: "s3", date: "2026-09-10T10:00:00Z", score: 66, points: 92, maxPoints: 140 },
  { id: "s2", date: "2026-08-28T10:00:00Z", score: 54, points: 76, maxPoints: 140 },
  { id: "s1", date: "2026-08-02T10:00:00Z", score: 48, points: 71, maxPoints: 148 },
];

function renderWith(resolved: any) {
  (useAuth as any).mockReturnValue({ user: { firstName: "Noor", role: "coach" }, loading: false, logout: vi.fn() });
  (leader.getTeacher as any).mockResolvedValue(resolved);
  const r = render(
    <MemoryRouter initialEntries={["/portal/leader/teacher/u1"]}>
      <Routes>
        <Route path="/portal/leader/teacher/:id" element={<LeaderTeacherDetail />} />
      </Routes>
    </MemoryRouter>,
  );
  return r;
}

describe("LeaderTeacherDetail — score trend", () => {
  beforeEach(() => vi.clearAllMocks());

  it("draws a line chart once there are two or more scored observations", async () => {
    const { container } = renderWith(detail(THREE));
    await waitFor(() => expect(screen.getByTestId("score-trend")).toBeInTheDocument());
    // The series is a monotone cubic, so the path's `d` is one C-command run rather
    // than one segment per point — the dots are what carry the point count, and what a
    // reader actually sees.
    expect(container.querySelector(".recharts-line-curve")).not.toBeNull();
    expect(container.querySelectorAll(".recharts-line-dot")).toHaveLength(3);
  });

  it("plots oldest-first, so the line reads left to right in time", async () => {
    renderWith(detail(THREE));
    await waitFor(() => expect(screen.getByTestId("score-trend")).toBeInTheDocument());
    const labels = screen.getAllByTestId("trend-x-label").map((n) => n.textContent);
    expect(labels).toEqual(["2 Aug", "28 Aug", "10 Sep"]);
  });

  it("hides itself for a single observation — one point is not a trend", async () => {
    renderWith(detail([THREE[0]]));
    await waitFor(() => expect(screen.getByRole("heading", { name: /Ayesha/ })).toBeInTheDocument());
    expect(screen.queryByTestId("score-trend")).not.toBeInTheDocument();
  });

  it("hides itself when nothing was scored, even with several observations", async () => {
    renderWith(detail(THREE.map((s) => ({ ...s, score: null }))));
    await waitFor(() => expect(screen.getByRole("heading", { name: /Ayesha/ })).toBeInTheDocument());
    expect(screen.queryByTestId("score-trend")).not.toBeInTheDocument();
  });

  it("skips an unscored observation rather than plotting it as zero", async () => {
    const withGap = [THREE[0], { ...THREE[1], score: null }, THREE[2]];
    const { container } = renderWith(detail(withGap));
    await waitFor(() => expect(screen.getByTestId("score-trend")).toBeInTheDocument());
    expect(container.querySelectorAll(".recharts-line-dot")).toHaveLength(2);
    expect(screen.getAllByTestId("trend-x-label").map((n) => n.textContent)).toEqual(["2 Aug", "10 Sep"]);
  });

  it("leaves the coaching history list in place", async () => {
    renderWith(detail(THREE));
    await waitFor(() => expect(screen.getByText("Coaching history")).toBeInTheDocument());
    expect(screen.getAllByText(/marks/).length).toBe(3);
  });
});
