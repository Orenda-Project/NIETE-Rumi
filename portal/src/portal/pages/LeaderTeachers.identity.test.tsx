import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * bd-2671 / bd-2672 — Riffat (2026-08-13): the teacher list needs the SCHOOL
 * (teachers share names), and when a score is low it must say WHICH area needs
 * work rather than the bare words "Focus Area". Observations must also be
 * visible — bd-2671 found they were counted as zero everywhere.
 */

vi.mock("../hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("../services/api", () => ({ leader: { getTeachers: vi.fn() } }));

import { useAuth } from "../hooks/useAuth";
import { leader } from "../services/api";
import LeaderTeachers from "./LeaderTeachers";

const PAYLOAD = {
  success: true,
  teachers: [
    {
      teacherExtId: "p1", name: "Tahira Manzoor", phone: "923001234567",
      onRumi: true, rumiUserId: "u1",
      coachingSessions: 0, observations: 3, lessonPlans: 2,
      lastSessionAt: "2026-08-12T09:00:00Z", lastScore: 41.5,
      focusArea: "Checking for understanding",
      schoolName: "IMSG Mohra Nagial", emis: "509",
    },
    {
      teacherExtId: "p2", name: "Nadia Perveen", phone: "923009876543",
      onRumi: false, rumiUserId: null,
      coachingSessions: 0, observations: 0, lessonPlans: 0,
      lastSessionAt: null, lastScore: null,
      focusArea: null, schoolName: "IMSG Beta", emis: "512",
    },
  ],
};

function renderPage(payload: any = PAYLOAD) {
  (useAuth as any).mockReturnValue({ user: { firstName: "Riffat", role: "coach" }, loading: false, logout: vi.fn() });
  (leader.getTeachers as any).mockResolvedValue(payload);
  render(
    <MemoryRouter>
      <LeaderTeachers />
    </MemoryRouter>,
  );
}

describe("LeaderTeachers — school, EMIS, observations, named focus (bd-2672)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows the school and EMIS so same-named teachers are distinguishable", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText(/IMSG Mohra Nagial/)).toBeInTheDocument());
    expect(screen.getByText(/509/)).toBeInTheDocument();
  });

  it("counts observations, not only self-recorded sessions", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText(/3 observations/)).toBeInTheDocument());
  });

  it("names the focus area for a struggling teacher", async () => {
    renderPage();
    expect(await screen.findByText(/Checking for understanding/)).toBeInTheDocument();
  });

  it("shows the school even for a teacher not yet on Rumi", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText(/IMSG Beta/)).toBeInTheDocument());
    expect(screen.getByText(/Not yet on Rumi/)).toBeInTheDocument();
  });
});
