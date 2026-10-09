import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: any) => <div>{children}</div> }));
vi.mock("../CoachGate", () => ({ default: ({ children }: any) => <>{children}</> }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: () => ({ user: { firstName: "Hataf", role: "coach", phoneNumber: "923001234567" }, loading: false }) }));
vi.mock("../../services/api", () => ({
  coach: { getSchedule: vi.fn(), getVisit: vi.fn(), getPeople: vi.fn(), editSchedule: vi.fn() },
  leader: { createSchedule: vi.fn(), cancelSchedule: vi.fn() },
}));
import { coach, leader } from "../../services/api";
import { hoursUntil } from "../time";
import CoachObservePick from "./CoachObservePick";
import CoachSchedule from "./CoachSchedule";
import CoachVisit from "./CoachVisit";
import CoachNewVisit from "./CoachNewVisit";

/**
 * bd-o15qnr.23 — "today" for a visit is the day in Pakistan, whatever the
 * phone's own time zone. The clock is 02:00 PKT on Thursday 8 Oct 2026 (21:00
 * UTC on the 7th): a phone set to UTC still thinks it is the 7th.
 *
 * Run this file under TZ=Asia/Karachi AND TZ=UTC (separate processes); the
 * phone's zone must not change a single answer.
 */
const C = coach as any;
const L = leader as any;

const visit = (id: string, name: string, day: string, slot: string, overdue = false) => ({
  id, teacherName: name, teacherExtId: `92300111000${id}`, schoolName: "IMSG I-10/1", schoolExtId: "niete:110",
  scheduledFor: day, scheduledSlot: slot, status: "upcoming", overdue,
});

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/portal/coach/observe/pick" element={<CoachObservePick />} />
        <Route path="/portal/coach/schedule" element={<CoachSchedule />} />
        <Route path="/portal/coach/visit/:id" element={<CoachVisit />} />
        <Route path="/portal/coach/new-visit" element={<CoachNewVisit />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-07T21:00:00Z"));
  C.getPeople.mockResolvedValue({
    success: true,
    schools: [{ schoolExtId: "niete:110", emis: "110", name: "IMSG I-10/1", teachers: 1, visits: 0, daysSinceVisit: null, avgHitl: null }],
    teachers: [{ teacherExtId: "923001110001", name: "Ayesha Bibi", phone: "923001110001", schoolExtId: "niete:110", emis: "110", schoolName: "IMSG I-10/1", hitl: 0, dc: 0, avgHitl: null, daysSinceVisit: null, daysSinceTraining: null }],
  });
  L.createSchedule.mockResolvedValue({ success: true, id: "new-1" });
});
afterEach(() => { vi.useRealTimers(); });

describe("02:00 PKT, 8 Oct", () => {
  it("a 9:00 AM visit today is 7 hours away (Pakistan's clock, not the phone's)", () => {
    expect(hoursUntil("09:00")).toBe(7);
  });

  it("Pick the teacher: yesterday's visit is overdue and today's is next", async () => {
    C.getSchedule.mockResolvedValue({ success: true, from: "x", to: "y", overdue: [visit("1", "Saima Khalid", "2026-10-07", "09:00", true)], visits: [visit("2", "Ayesha Bibi", "2026-10-08", "09:00")] });
    renderAt("/portal/coach/observe/pick");
    await screen.findByText("Ayesha Bibi");
    expect(C.getSchedule).toHaveBeenCalledWith({ from: "2026-09-08", to: "2027-01-06" });
    const earlier = screen.getByRole("button", { name: /earlier/i });
    expect(earlier).toHaveTextContent("1 overdue");
    expect(screen.getByText("Ayesha Bibi").closest("a")).toHaveTextContent("Next");
  });

  it("My schedule: yesterday's visit is 1 day late", async () => {
    C.getSchedule.mockResolvedValue({ success: true, from: "2026-10-05", to: "2026-10-11", overdue: [visit("1", "Saima Khalid", "2026-10-07", "09:00", true)], visits: [] });
    renderAt("/portal/coach/schedule");
    const overdue = await screen.findByTestId("overdue");
    expect(within(overdue).getByText("1 days late")).toBeInTheDocument();
  });

  it("the visit page: a visit on the 8th is today, in 7 h", async () => {
    C.getVisit.mockResolvedValue({ success: true, visit: visit("2", "Ayesha Bibi", "2026-10-08", "09:00"), teacher: { teacherExtId: "923001110002", name: "Ayesha Bibi", phone: "923001110002" }, lastVisit: null });
    renderAt("/portal/coach/visit/2");
    expect(await screen.findByRole("img", { name: "9:00 AM" })).toBeInTheDocument();
    expect(screen.getByText(/· Today/)).toBeInTheDocument();
    expect(screen.getByText("In 7 h")).toBeInTheDocument();
  });

  it("New visit: the day it opens on is the 8th", async () => {
    renderAt("/portal/coach/new-visit?school=niete%3A110&teacher=923001110001");
    await screen.findByText("Step 3 of 3");
    fireEvent.click(screen.getByRole("button", { name: /^Schedule$/ }));
    await waitFor(() => expect(L.createSchedule).toHaveBeenCalledWith(expect.objectContaining({ date: "2026-10-08" })));
  });
});
