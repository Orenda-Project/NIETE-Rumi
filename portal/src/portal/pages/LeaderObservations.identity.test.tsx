import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * bd-2670 — Riffat (2026-08-13): the Debrief List shows "Unassigned" and the
 * Completed list shows no teacher, so a coach cannot tell whose debrief is
 * waiting. She asked for teacher name + observation date + school + EMIS,
 * because teachers with the same name exist in different schools.
 */

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

const PAYLOAD = {
  success: true,
  observations: {
    upcoming: [],
    pendingDebriefs: [
      {
        id: "c1", createdAt: "2026-08-12T09:00:00Z",
        teacherName: "Tahira Manzoor", teacherUserId: null,
        schoolName: "IMSG Mohra Nagial", emis: "509",
        status: "observer_review_complete", debriefStatus: "pending",
        score: 41.5, reportPdfUrl: null,
      },
    ],
    completed: [
      {
        id: "c2", createdAt: "2026-08-11T09:00:00Z",
        teacherName: "mr. kamran afzal", teacherUserId: null,
        schoolName: "IMSB (I-V) Humak", emis: "555",
        status: "observer_review_complete", debriefStatus: "done",
        score: 58.7, reportPdfUrl: null,
      },
    ],
  },
};

function renderPage(payload: any = PAYLOAD) {
  (useAuth as any).mockReturnValue({ user: { firstName: "Riffat", role: "coach" }, loading: false, logout: vi.fn() });
  (leader.getObservations as any).mockResolvedValue(payload);
  (leader.getTeachers as any).mockResolvedValue({ success: true, total: 0, onRumi: 0, teachers: [] });
  render(
    <MemoryRouter>
      <LeaderObservations />
    </MemoryRouter>,
  );
}

describe("LeaderObservations — the teacher is identifiable (bd-2670)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("names the teacher on a waiting debrief instead of 'Unassigned'", async () => {
    renderPage();
    expect(await screen.findByText("Tahira Manzoor")).toBeInTheDocument();
    expect(screen.queryByText(/Unassigned/i)).not.toBeInTheDocument();
  });

  it("shows the school and EMIS on a waiting debrief", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText(/IMSG Mohra Nagial/)).toBeInTheDocument());
    expect(screen.getByText(/509/)).toBeInTheDocument();
  });

  it("shows teacher, school and EMIS on a completed observation", async () => {
    renderPage();
    expect(await screen.findByText("mr. kamran afzal")).toBeInTheDocument();
    expect(screen.getByText(/IMSB \(I-V\) Humak/)).toBeInTheDocument();
    expect(screen.getByText(/555/)).toBeInTheDocument();
  });

  it("still renders cleanly when school and EMIS are unknown", async () => {
    renderPage({
      success: true,
      observations: {
        upcoming: [],
        pendingDebriefs: [{
          id: "c9", createdAt: "2026-08-10T09:00:00Z",
          teacherName: null, teacherUserId: null, schoolName: null, emis: null,
          status: "observer_review_complete", debriefStatus: "pending",
          score: null, reportPdfUrl: null,
        }],
        completed: [],
      },
    });
    // no crash, no literal "null" leaking into the UI
    await waitFor(() => expect(screen.getByText(/Debriefs waiting/i)).toBeInTheDocument());
    expect(screen.queryByText(/null/)).not.toBeInTheDocument();
  });
});
