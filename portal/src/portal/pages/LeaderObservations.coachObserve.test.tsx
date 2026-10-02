import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// bd-5rz1v.6 — Observations gains ONE goal button (Option B, B3, deep green)
// and the lessons she sent, only for a coach in the portal_coach_observation
// pilot. Everyone else's page is unchanged.

vi.mock("../hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("../services/api", () => ({
  portal: { getConfig: vi.fn() },
  leader: {
    getObservations: vi.fn(),
    getTeachers: vi.fn(),
    createSchedule: vi.fn(),
    cancelSchedule: vi.fn(),
    getActiveObservations: vi.fn(),
  },
}));

import { useAuth } from "../hooks/useAuth";
import { leader, portal } from "../services/api";
import LeaderObservations from "./LeaderObservations";

const L = leader as any;
const P = portal as any;

function renderPage() {
  (useAuth as any).mockReturnValue({ user: { firstName: "Sana", role: "coach" }, loading: false, logout: vi.fn() });
  render(<MemoryRouter><LeaderObservations /></MemoryRouter>);
}

beforeEach(() => {
  vi.clearAllMocks();
  L.getObservations.mockResolvedValue({ success: true, observations: { upcoming: [
    { id: "s1", teacherName: "Ayesha Bibi", schoolName: "IMSG", schoolExtId: "niete:7", teacherExtId: "923120004471", scheduledFor: "2026-10-02", scheduledSlot: "09:30", overdue: false },
  ], pendingDebriefs: [], completed: [] } });
  L.getTeachers.mockResolvedValue({ teachers: [] });
  L.getActiveObservations.mockResolvedValue({ observations: [
    { id: "cs-1", createdAt: "2026-10-02T04:30:00Z", teacherName: "Sadia Noor", step: "draft", problem: null },
    { id: "cs-2", createdAt: "2026-09-30T04:30:00Z", teacherName: "Kiran Javed", step: "done", problem: null },
  ] });
});

describe("LeaderObservations — send a lesson", () => {
  it("in the pilot: the B3 goal button, the lessons she sent, and 'Send her lesson' on a visit", async () => {
    P.getConfig.mockResolvedValue({ features: { coachObservation: true } });
    renderPage();
    const entry = await screen.findByTestId("coach-observe-entry");
    expect(entry.textContent).toContain("Send a lesson to your Digital Coach");
    expect(entry.getAttribute("href")).toBe("/portal/leader/observe/new");
    expect(await screen.findByText("Sadia Noor")).toBeInTheDocument();
    expect(screen.getByText("Check the draft")).toBeInTheDocument();
    expect(screen.queryByText("Kiran Javed")).toBeNull(); // finished ones are not "in progress"
    const send = await screen.findByRole("link", { name: "Send her lesson" });
    expect(send.getAttribute("href")).toBe("/portal/leader/observe/new?teacher=923120004471&school=niete%3A7");
  });

  it("outside the pilot: none of it", async () => {
    P.getConfig.mockResolvedValue({ features: { coachObservation: false } });
    renderPage();
    await waitFor(() => expect(screen.getByText("Ayesha Bibi")).toBeInTheDocument());
    expect(screen.queryByTestId("coach-observe-entry")).toBeNull();
    expect(screen.queryByRole("link", { name: "Send her lesson" })).toBeNull();
    expect(L.getActiveObservations).not.toHaveBeenCalled();
  });
});
