import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// bd-2455: the coach's /observe world on the portal — upcoming scheduled
// observations (overdue-flagged), pending debriefs, completed observations.

vi.mock("../hooks/useAuth", () => ({ useAuth: vi.fn() }));
// bd-2676: the page now also loads the coach's teachers for the scheduling
// form, so the mock must provide it — an undefined mock throws on render.
vi.mock("../services/api", () => ({
  leader: {
    getObservations: vi.fn(),
    getTeachers: vi.fn(),
    createSchedule: vi.fn(),
    cancelSchedule: vi.fn(),
  },
}));

import { useAuth } from "../hooks/useAuth";
import { leader } from "../services/api";
import LeaderObservations from "./LeaderObservations";

const OBSERVATIONS = {
  success: true,
  observations: {
    upcoming: [
      { id: "s1", teacherName: "Sadia Tabassum", schoolName: "GPS Alpha", schoolExtId: "niete:1", teacherExtId: "p1", scheduledFor: "2026-07-30", scheduledSlot: "09:30", overdue: true },
      { id: "s2", teacherName: "Nadia Perveen", schoolName: "GPS Beta", schoolExtId: "niete:2", teacherExtId: "p2", scheduledFor: "2026-08-04", scheduledSlot: "11:30", overdue: false },
    ],
    pendingDebriefs: [
      { id: "c1", createdAt: "2026-07-31T09:00:00Z", teacherName: "Sadia", teacherUserId: "t1", status: "observer_review_complete", debriefStatus: "pending", score: 62.2, reportPdfUrl: null },
    ],
    completed: [
      { id: "c2", createdAt: "2026-07-27T09:00:00Z", teacherName: "Nadia", teacherUserId: "t2", status: "observer_review_complete", debriefStatus: "done", score: 58.7, reportPdfUrl: "https://r2/report.pdf" },
      { id: "c6", createdAt: "2026-07-18T09:00:00Z", teacherName: null, teacherUserId: null, status: "completed", debriefStatus: "done", score: null, reportPdfUrl: null },
    ],
  },
};

function renderPage(payload = OBSERVATIONS) {
  (useAuth as any).mockReturnValue({ user: { firstName: "Noor", role: "coach" }, loading: false, logout: vi.fn() });
  (leader.getObservations as any).mockResolvedValue(payload);
  (leader.getTeachers as any).mockResolvedValue({ success: true, total: 0, onRumi: 0, teachers: [] });
  render(
    <MemoryRouter>
      <LeaderObservations />
    </MemoryRouter>,
  );
}

describe("LeaderObservations", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders the three sections with their rows", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("Sadia Tabassum")).toBeInTheDocument());
    // upcoming
    expect(screen.getByText("GPS Alpha")).toBeInTheDocument();
    expect(screen.getByText(/overdue/i)).toBeInTheDocument();
    // pending debriefs
    expect(screen.getByText("Debriefs waiting")).toBeInTheDocument();
    expect(screen.getByText("Sadia")).toBeInTheDocument();
    // completed
    expect(screen.getByText("Nadia")).toBeInTheDocument();
  });

  it("an unbound legacy observation renders a neutral label, never the coach's name", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("Sadia Tabassum")).toBeInTheDocument());
    expect(screen.getByText(/unassigned observation/i)).toBeInTheDocument();
    // The coach ("Noor") must never be shown as an observed teacher — scope to
    // the observation rows (the layout header legitimately shows her name).
    for (const li of screen.getAllByRole("listitem")) {
      expect(li.textContent).not.toContain("Noor");
    }
  });

  it("shows friendly empty states when there is nothing scheduled or pending", async () => {
    renderPage({ success: true, observations: { upcoming: [], pendingDebriefs: [], completed: [] } });
    await waitFor(() => expect(screen.getByText(/nothing scheduled/i)).toBeInTheDocument());
    expect(screen.getByText(/no debriefs waiting/i)).toBeInTheDocument();
    expect(screen.getByText(/no completed observations/i)).toBeInTheDocument();
  });
});
