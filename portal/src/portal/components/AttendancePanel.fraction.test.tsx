import { it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

/** A class's day cell reads present OUT OF the register, e.g. 28/30 (operator, 2026-09-30). */

vi.mock("../hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("../services/api", () => ({ leader: { getAttendance: vi.fn() } }));
import { useAuth } from "../hooks/useAuth";
import { leader } from "../services/api";
import AttendancePanel from "./AttendancePanel";

it("a class's day cell shows present / on the register; a teacher's stays P or A", async () => {
  (useAuth as any).mockReturnValue({ user: { firstName: "A", role: "principal" }, loading: false, logout: vi.fn() });
  (leader.getAttendance as any).mockResolvedValue({
    success: true, from: "2026-09-01", to: "2026-09-30", focusTeacher: null, teachers: [],
    schoolDays: ["2026-09-08", "2026-09-09", "2026-09-10"],
    students: {
      groups: [{ name: "Grade 4", people: 30, days: 3, chances: 90, present: 58, absent: 2, neverMarked: 30, markedDays: 2 }],
      byDay: [{ name: "Grade 4", days: [
        { date: "2026-09-08", marked: true, total: 30, present: 28, absent: 2 },
        { date: "2026-09-09", marked: true, total: 30, present: 30, absent: 0 },
        { date: "2026-09-10", marked: false, total: null, present: null, absent: null },
      ] }],
    },
    staff: {
      groups: [{ name: "Hina", people: 1, days: 3, chances: 3, present: 1, absent: 1, neverMarked: 1, markedDays: 2 }],
      byDay: [{ name: "Hina", days: [
        { date: "2026-09-08", marked: true, total: 1, present: 1, absent: 0 },
        { date: "2026-09-09", marked: true, total: 1, present: 0, absent: 1 },
        { date: "2026-09-10", marked: false, total: null, present: null, absent: null },
      ] }],
    },
  });
  render(<MemoryRouter><AttendancePanel from={null} to={null} /></MemoryRouter>);
  await userEvent.click(await screen.findByTestId("view-byday"));
  expect(screen.getByTestId("cell-Grade 4-2026-09-08")).toHaveTextContent("28/30");
  expect(screen.getByTestId("cell-Grade 4-2026-09-09")).toHaveTextContent("30/30");
  expect(screen.getByTestId("cell-Grade 4-2026-09-10")).toHaveTextContent("–");
  expect(screen.getByTestId("cell-Hina-2026-09-08")).toHaveTextContent("P");
  expect(screen.getByTestId("cell-Hina-2026-09-09")).toHaveTextContent("A");
});
