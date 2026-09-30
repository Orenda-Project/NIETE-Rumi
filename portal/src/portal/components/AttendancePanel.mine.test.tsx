import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

/**
 * The Attendance page, opened to a teacher (operator, 2026-09-30). The same
 * page and the same bars as her principal's, scoped to her: her classes'
 * registers and her own days. No teacher picker, no principal's next step.
 */

vi.mock("../hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("../services/api", () => ({ leader: { getAttendance: vi.fn() }, portal: { getMyAttendance: vi.fn() } }));

import { useAuth } from "../hooks/useAuth";
import { leader, portal } from "../services/api";
import AttendancePanel from "./AttendancePanel";

const PAYLOAD = {
  success: true, from: "2026-09-01", to: "2026-09-30", focusTeacher: null, teachers: [],
  schoolDays: ["2026-09-08", "2026-09-09"],
  students: {
    groups: [{ name: "Grade 4", people: 30, days: 2, chances: 60, present: 52, absent: 8, neverMarked: 0, markedDays: 2 }],
    byDay: [{ name: "Grade 4", days: [
      { date: "2026-09-08", marked: true, total: 30, present: 27, absent: 3 },
      { date: "2026-09-09", marked: true, total: 30, present: 25, absent: 5 },
    ] }],
  },
  staff: {
    groups: [{ name: "Ayesha (test) One", people: 1, days: 2, chances: 2, present: 1, absent: 1, neverMarked: 0, markedDays: 2 }],
    byDay: [{ name: "Ayesha (test) One", days: [
      { date: "2026-09-08", marked: true, total: 1, present: 1, absent: 0 },
      { date: "2026-09-09", marked: true, total: 1, present: 0, absent: 1 },
    ] }],
  },
};

function mount(payload: any = PAYLOAD) {
  (useAuth as any).mockReturnValue({ user: { firstName: "Ayesha", role: "teacher" }, loading: false, logout: vi.fn() });
  (portal.getMyAttendance as any).mockResolvedValue(payload);
  render(<MemoryRouter><AttendancePanel audience="teacher" from={null} to={null} /></MemoryRouter>);
}

describe("Attendance, for a teacher", () => {
  beforeEach(() => vi.clearAllMocks());

  it("loads HER attendance, never the principal's", async () => {
    mount();
    await screen.findByTestId("group-Grade 4");
    expect(portal.getMyAttendance).toHaveBeenCalled();
    expect(leader.getAttendance).not.toHaveBeenCalled();
  });

  it("says it is her classes and her own days", async () => {
    mount();
    await screen.findByTestId("group-Grade 4");
    const h3 = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent?.trim());
    expect(h3).toContain("Your students, by class");
    expect(h3).toContain("You");
  });

  it("has no teacher picker and no principal's next step", async () => {
    mount();
    await screen.findByTestId("group-Grade 4");
    expect(screen.queryByTestId("teacher-filter")).toBeNull();
    expect(screen.queryByText(/Give your remark/)).toBeNull();
  });

  it("keeps the day-by-day view (the date window is the Analytics page's)", async () => {
    mount();
    await screen.findByTestId("group-Grade 4");
    await userEvent.click(screen.getByTestId("view-byday"));
    expect(screen.getByTestId("byday-row-Ayesha (test) One")).toBeInTheDocument();
  });

  it("an empty window tells HER to mark from WhatsApp", async () => {
    mount({ ...PAYLOAD, schoolDays: [], students: { groups: [], byDay: [] }, staff: { groups: [], byDay: [] } });
    await waitFor(() => expect(screen.getByTestId("attendance-empty")).toBeInTheDocument());
    expect(screen.getByTestId("attendance-empty")).toHaveTextContent(/mark attendance from WhatsApp/i);
    expect(screen.getByTestId("attendance-empty")).not.toHaveTextContent(/ask your teachers/i);
  });
});
