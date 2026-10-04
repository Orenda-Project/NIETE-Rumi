import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

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
  render(
    <MemoryRouter initialEntries={["/portal/leader/observations"]}>
      <Routes>
        <Route path="/portal/leader/observations" element={<LeaderObservations />} />
        <Route path="/portal/leader/observe/new" element={<div>record page</div>} />
      </Routes>
    </MemoryRouter>,
  );
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
    expect(entry.textContent).toContain("Record your Teacher’s Lesson");
    // bd-5rz1v.9 — the same button as the teacher's: a white arrow at the end, no ripple
    expect(within(entry).getByTestId("send-lesson-arrow")).toBeInTheDocument();
    expect(entry.querySelector("[class*='animate-rec-wave']")).toBeNull();
    expect(await screen.findByText("Sadia Noor")).toBeInTheDocument();
    expect(screen.getByText("Check the draft")).toBeInTheDocument();
    expect(screen.queryByText("Kiran Javed")).toBeNull(); // finished ones are not "in progress"
    const send = await screen.findByRole("link", { name: "Record this lesson" });
    expect(send.getAttribute("href")).toBe("/portal/leader/observe/new?teacher=923120004471&school=niete%3A7");
    fireEvent.click(entry);
    expect(await screen.findByText("record page")).toBeInTheDocument();
  });

  it("outside the pilot: none of it", async () => {
    P.getConfig.mockResolvedValue({ features: { coachObservation: false } });
    renderPage();
    await waitFor(() => expect(screen.getByText("Ayesha Bibi")).toBeInTheDocument());
    expect(screen.queryByTestId("coach-observe-entry")).toBeNull();
    expect(screen.queryByRole("link", { name: "Record this lesson" })).toBeNull();
    expect(L.getActiveObservations).not.toHaveBeenCalled();
  });
});

// bd-5rz1v.6.6 — the intro told every coach "To schedule or debrief, send
// /observe to NIETE on WhatsApp". For a coach in the pilot that is no longer
// true: a lesson sent from here is checked, talked through and sent from here.
describe("LeaderObservations — what the page says it is for", () => {
  it("in the pilot: the portal does the whole observation; WhatsApp only for what was recorded there", async () => {
    P.getConfig.mockResolvedValue({ features: { coachObservation: true } });
    renderPage();
    await screen.findByTestId("coach-observe-entry");
    expect(screen.getByText(/check the draft, talk with the teacher and send the report — all here/i)).toBeInTheDocument();
    expect(screen.queryByText(/To schedule or debrief, send \/observe/)).toBeNull();
  });

  it("outside the pilot: the page reads as before", async () => {
    P.getConfig.mockResolvedValue({ features: { coachObservation: false } });
    renderPage();
    await waitFor(() => expect(screen.getByText("Ayesha Bibi")).toBeInTheDocument());
    expect(screen.getByText(/To schedule or debrief, send \/observe to NIETE on WhatsApp/)).toBeInTheDocument();
  });
});
