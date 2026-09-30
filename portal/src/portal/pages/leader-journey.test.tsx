import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";

/**
 * Item 1 across the leader pages beyond the home. (Items 4 and 5 — her STEPS
 * row and the Next-step journey — were removed with STEPS on 2026-09-30,
 * operator: "Analytics is there for exactly this kind of data".)
 *
 *  1 · Where the numeric score was removed last round, the BAND now shows —
 *      "remove the Observation scores … from Numbers and Percentages to
 *      brackets" (operator, 2026-09-29) replaces hiding with banding.
 */

vi.mock("../hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("react-apexcharts", () => ({ default: () => <div data-testid="chart" /> }));
vi.mock("../services/api", () => ({
  leader: {
    getTeacher: vi.fn(), getTeachers: vi.fn(), getObservations: vi.fn(),
    createSchedule: vi.fn(), cancelSchedule: vi.fn(), getSchoolAnalytics: vi.fn(), getAttendance: vi.fn(),
  },
}));

import { useAuth } from "../hooks/useAuth";
import { leader } from "../services/api";
import LeaderTeacherDetail from "./LeaderTeacherDetail";
import LeaderTeachers from "./LeaderTeachers";
import LeaderObservations from "./LeaderObservations";

const as = (role: string) =>
  (useAuth as any).mockReturnValue({ user: { firstName: "Atifa", role }, loading: false, logout: vi.fn() });
const PERCENT = /\d+(?:\.\d+)?\s*%/;

const DETAIL = {
  success: true,
  teacher: { rumiUserId: "u1", name: "Ayesha Bibi", phone: "923001234567", onRumi: true },
  stats: { coachingSessions: 2, lessonPlans: 7, readingAssessments: 3, lastScore: 64.2, lastSummary: "A focused lesson." },
  sessions: [
    { id: "s2", date: "2026-09-15T10:00:00Z", score: 64.2, points: 95, maxPoints: 148, summary: "A focused lesson." },
    { id: "s1", date: "2026-08-10T10:00:00Z", score: 48, points: 71, maxPoints: 148, summary: null },
  ],
};

function mountDetail(role = "principal") {
  as(role);
  (leader.getTeacher as any).mockResolvedValue(DETAIL);
  render(
    <MemoryRouter initialEntries={["/portal/leader/teacher/u1"]}>
      <Routes><Route path="/portal/leader/teacher/:id" element={<LeaderTeacherDetail />} /></Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => vi.clearAllMocks());

describe("1 · the band is back where the number was removed", () => {
  it("teacher page: her latest lesson and each visit carry a band, never a number", async () => {
    mountDetail();
    await screen.findByTestId("session-s2");
    expect(within(screen.getByTestId("session-s2")).getByTestId("score-band")).toHaveTextContent("Good");
    expect(within(screen.getByTestId("session-s1")).getByTestId("score-band")).toHaveTextContent("Average");
    expect(screen.getByTestId("latest-band")).toHaveTextContent("Good");
    expect(document.querySelector("main")?.textContent || document.body.textContent).not.toMatch(PERCENT);
  });

  it("teachers list: each row shows her latest band", async () => {
    as("principal");
    (leader.getTeachers as any).mockResolvedValue({
      success: true, total: 1, onRumi: 1,
      teachers: [{ teacherExtId: "x", name: "Ayesha Bibi", hasName: true, phone: "92300", onRumi: true, rumiUserId: "u1",
        coachingSessions: 2, observations: 1, lessonPlans: 7, attendanceSessions: 0, trainingModules: 0,
        lastSessionAt: null, lastScore: 64.2, focusArea: null, schoolName: "S", emis: "1", isPrincipal: false }],
    });
    render(<MemoryRouter><LeaderTeachers /></MemoryRouter>);
    expect(await screen.findByTestId("score-band")).toHaveTextContent("Good");
  });

  it("observations: pending and completed carry bands", async () => {
    as("coach");
    (leader.getObservations as any).mockResolvedValue({
      success: true,
      observations: {
        upcoming: [],
        pendingDebriefs: [{ id: "c1", createdAt: "2026-07-31T09:00:00Z", teacherName: "Sadia", teacherUserId: "t1", status: "observer_review_complete", debriefStatus: "pending", score: 62.2, reportPdfUrl: null }],
        completed: [{ id: "c2", createdAt: "2026-07-27T09:00:00Z", teacherName: "Nadia", teacherUserId: "t2", status: "observer_review_complete", debriefStatus: "done", score: 38.7, reportPdfUrl: null }],
      },
    });
    (leader.getTeachers as any).mockResolvedValue({ success: true, total: 0, onRumi: 0, teachers: [] });
    render(<MemoryRouter><LeaderObservations /></MemoryRouter>);
    await waitFor(() => expect(screen.getAllByTestId("score-band")).toHaveLength(2));
    expect(screen.getAllByTestId("score-band").map((b) => b.textContent)).toEqual(["Good", "Below average"]);
  });
});
