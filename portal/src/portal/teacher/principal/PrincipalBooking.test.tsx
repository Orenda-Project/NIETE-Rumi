import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

/**
 * bd-31ziu8 — a principal books a visit exactly as a coach does (operator 18 Nov ~16:40: "the principal does not do
 * scheduling? If that is the case, drop it. It has to be the same as coach."):
 *   New visit   the picked teacher → the coach's day and time step → POST /leader/schedules (the coach's booking) →
 *               "Visit scheduled", whose links stay in her app (New visit → Pick the teacher, My schedule → hers)
 *   My schedule the coach's screen over her own bookings, each visit opening the picked teacher's visit screen
 */

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("../../coach/CoachGate", () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
const api = vi.hoisted(() => ({
  coach: { getSchedule: vi.fn(), editSchedule: vi.fn() },
  leader: { createSchedule: vi.fn() },
}));
vi.mock("../../services/api", () => ({ default: { get: vi.fn(), post: vi.fn() }, ...api }));
const visitOf = vi.hoisted(() => vi.fn());
vi.mock("./observe", async (orig) => ({ ...(await orig<typeof import("./observe")>()), principalVisit: visitOf }));

import { PrincipalNewVisit } from "./NewVisit";
import { PrincipalSchedule } from "./Schedule";

vi.setConfig({ testTimeout: 40_000 });
const TODAY = new Date().toISOString().slice(0, 10);

beforeEach(() => {
  vi.clearAllMocks();
  visitOf.mockResolvedValue({
    visit: { id: "900001", teacherExtId: "900001", teacherName: "Ayesha Sample", schoolName: "GGPS Sample", schoolExtId: "niete:1126", scheduledFor: TODAY, scheduledSlot: null, status: "upcoming" },
  });
  api.coach.getSchedule.mockResolvedValue({
    success: true, from: TODAY, to: TODAY, overdue: [],
    visits: [{ id: "sched-1", teacherExtId: "900001", teacherName: "Ayesha Sample", schoolName: "GGPS Sample", schoolExtId: "niete:1126", scheduledFor: TODAY, scheduledSlot: "09:00", status: "upcoming" }],
  });
  api.leader.createSchedule.mockResolvedValue({ success: true, id: "sched-1" });
});

describe("a principal books a visit as a coach does", () => {
  it("New visit: the coach's day and time step for the picked teacher, the coach's booking, links in her app", async () => {
    render(
      <MemoryRouter initialEntries={["/portal/teacher/principal/new-visit?teacher=900001"]}>
        <Routes><Route path="/portal/teacher/principal/new-visit" element={<PrincipalNewVisit />} /></Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByTestId("time-picker")).toBeTruthy());
    expect(visitOf).toHaveBeenCalledWith("900001");
    const schedule = screen.getAllByRole("button").find((b) => /schedule/i.test(b.textContent || ""));
    expect(schedule).toBeTruthy();
    fireEvent.click(schedule!);
    await waitFor(() => expect(api.leader.createSchedule).toHaveBeenCalledWith(expect.objectContaining({ teacherExtId: "900001", slot: "09:00" })));
    await waitFor(() => expect(document.querySelector('a[href="/portal/teacher/principal/schedule"]')).toBeTruthy());
    expect(document.querySelector('a[href="/portal/teacher/principal/pick"]')).toBeTruthy();
  });

  it("My schedule: her bookings, each opening the picked teacher's visit screen in her app", async () => {
    render(
      <MemoryRouter initialEntries={["/portal/teacher/principal/schedule"]}>
        <Routes><Route path="/portal/teacher/principal/schedule" element={<PrincipalSchedule />} /></Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(document.querySelector('a[href="/portal/teacher/principal/visit/900001"]')).toBeTruthy());
    expect(document.querySelector('a[href="/portal/coach/visit/sched-1"]')).toBeNull();
    expect(document.querySelector('a[href="/portal/teacher/principal/pick"]')).toBeTruthy();
  });
});
