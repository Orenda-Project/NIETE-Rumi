import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";

/**
 * bd-60174 — this file used to assert the score TREND CHART on the leader's
 * teacher-detail page: that it drew above two scored observations, plotted
 * oldest-first, skipped unscored visits, and hid itself below two points.
 *
 * That chart is gone. It plotted the very number the principal-dashboard
 * feedback asked us to stop showing, so keeping it would have handed the score
 * back as a picture. The score itself is untouched — still computed, still
 * stored, still on the payload, and still shown on the teacher's OWN analytics,
 * where it was never in question.
 *
 * The old assertions are not merely deleted. Four of them would now pass
 * VACUOUSLY — "hides itself when nothing was scored" is trivially true once
 * nothing ever draws — and a vacuous test is worse than no test, because it
 * reports coverage it does not have. What replaces them is the claim that
 * actually matters now, stated so it fails if the chart ever comes back.
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
    lastSummary: null,
  },
  sessions,
});

/** Newest first, exactly as the service returns it — three SCORED visits. */
const THREE = [
  { id: "s3", date: "2026-09-10T10:00:00Z", score: 66, points: 92, maxPoints: 140, summary: null },
  { id: "s2", date: "2026-08-28T10:00:00Z", score: 54, points: 76, maxPoints: 140, summary: null },
  { id: "s1", date: "2026-08-02T10:00:00Z", score: 48, points: 71, maxPoints: 148, summary: null },
];

function renderWith(resolved: any, role = "coach") {
  (useAuth as any).mockReturnValue({ user: { firstName: "Noor", role }, loading: false, logout: vi.fn() });
  (leader.getTeacher as any).mockResolvedValue(resolved);
  return render(
    <MemoryRouter initialEntries={["/portal/leader/teacher/u1"]}>
      <Routes>
        <Route path="/portal/leader/teacher/:id" element={<LeaderTeacherDetail />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** The page's own text, without the layout's injected <style> rules. */
function pageText(): string {
  const main = document.querySelector("main") || document.body;
  const clone = main.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("style,script").forEach((n) => n.remove());
  return clone.textContent || "";
}

describe("LeaderTeacherDetail — the score trend is gone, and stays gone", () => {
  beforeEach(() => vi.clearAllMocks());

  it("draws no trend chart, even with three scored observations", async () => {
    renderWith(detail(THREE));
    await waitFor(() => expect(screen.getByTestId("session-s3")).toBeInTheDocument());
    expect(screen.queryByTestId("score-trend")).toBeNull();
    // The axis ticks were the chart's only findable text; neither may return.
    expect(screen.queryAllByTestId("trend-x-label")).toHaveLength(0);
  });

  it("shows no percentage anywhere, however many scores the payload carries", async () => {
    renderWith(detail(THREE));
    await waitFor(() => expect(screen.getByTestId("session-s3")).toBeInTheDocument());
    expect(pageText()).not.toMatch(/\d+\s*%/);
  });

  it("still lists every visit — the history was never the problem", async () => {
    renderWith(detail(THREE));
    await waitFor(() => expect(screen.getByTestId("session-s3")).toBeInTheDocument());
    expect(screen.getAllByTestId(/^session-/)).toHaveLength(3);
  });

  it("hides the score from a coach too, not only a principal", async () => {
    renderWith(detail(THREE), "principal");
    await waitFor(() => expect(screen.getByTestId("session-s3")).toBeInTheDocument());
    expect(pageText()).not.toMatch(/\d+\s*%/);
  });
});
