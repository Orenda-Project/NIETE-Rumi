import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * bd-2676 — schedule a visit from the portal.
 *
 * Riffat R33: visits could only be booked in WhatsApp, so a coach who cleared
 * her chats to free storage lost the record. Operator decision: create +
 * cancel, no edit.
 */

vi.mock("../hooks/useAuth", () => ({ useAuth: vi.fn() }));
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

const OBS = {
  success: true,
  observations: {
    upcoming: [
      { id: "s1", teacherName: "Tahira Manzoor", schoolName: "IMSG Mohra Nagial", schoolExtId: "niete:509", teacherExtId: "p1", scheduledFor: "2026-08-20", scheduledSlot: "09:00", overdue: false },
    ],
    pendingDebriefs: [],
    completed: [],
  },
};

const TEACHERS = {
  success: true, total: 2, onRumi: 2,
  teachers: [
    { teacherExtId: "p1", name: "Tahira Manzoor", phone: "923001111111", onRumi: true, rumiUserId: "u1", coachingSessions: 0, observations: 1, lessonPlans: 0, lastSessionAt: null, lastScore: null, focusArea: null, schoolName: "IMSG Mohra Nagial", emis: "509" },
    { teacherExtId: "p2", name: "Touseef Ahmed", phone: "923002222222", onRumi: true, rumiUserId: "u2", coachingSessions: 0, observations: 0, lessonPlans: 0, lastSessionAt: null, lastScore: null, focusArea: null, schoolName: "IMCB Mughal", emis: "541" },
  ],
};

function renderPage() {
  (useAuth as any).mockReturnValue({ user: { firstName: "Riffat", role: "coach" }, loading: false, logout: vi.fn() });
  (leader.getObservations as any).mockResolvedValue(OBS);
  (leader.getTeachers as any).mockResolvedValue(TEACHERS);
  (leader.createSchedule as any).mockResolvedValue({ success: true, id: "new-1" });
  (leader.cancelSchedule as any).mockResolvedValue({ success: true, cancelled: true });
  render(
    <MemoryRouter>
      <LeaderObservations />
    </MemoryRouter>,
  );
}

describe("LeaderObservations — scheduling (bd-2676)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("offers a way to schedule a visit", async () => {
    renderPage();
    expect(await screen.findByText(/Schedule a visit/i)).toBeInTheDocument();
  });

  it("lists the coach's own teachers to pick from", async () => {
    renderPage();
    await waitFor(() => expect(leader.getTeachers).toHaveBeenCalled());
    expect(await screen.findByRole("option", { name: /Tahira Manzoor/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Touseef Ahmed/ })).toBeInTheDocument();
  });

  it("books the visit with the teacher and date the coach chose", async () => {
    renderPage();
    await waitFor(() => expect(leader.getTeachers).toHaveBeenCalled());
    fireEvent.change(await screen.findByLabelText(/Teacher/i), { target: { value: "p2" } });
    fireEvent.change(screen.getByLabelText(/Date/i), { target: { value: "2026-08-25" } });
    fireEvent.click(screen.getByRole("button", { name: /Schedule visit/i }));
    await waitFor(() => expect(leader.createSchedule).toHaveBeenCalledWith(
      expect.objectContaining({ teacherExtId: "p2", date: "2026-08-25" }),
    ));
  });

  it("lets the coach cancel an upcoming visit", async () => {
    renderPage();
    const cancel = await screen.findByRole("button", { name: /Cancel/i });
    fireEvent.click(cancel);
    await waitFor(() => expect(leader.cancelSchedule).toHaveBeenCalledWith("s1"));
  });

  it("shows the server's reason when a booking is refused", async () => {
    renderPage();
    (leader.createSchedule as any).mockRejectedValue({ response: { data: { error: "That date is in the past" } } });
    await waitFor(() => expect(leader.getTeachers).toHaveBeenCalled());
    fireEvent.change(await screen.findByLabelText(/Teacher/i), { target: { value: "p1" } });
    fireEvent.change(screen.getByLabelText(/Date/i), { target: { value: "2026-01-01" } });
    fireEvent.click(screen.getByRole("button", { name: /Schedule visit/i }));
    expect(await screen.findByText(/That date is in the past/)).toBeInTheDocument();
  });
});
