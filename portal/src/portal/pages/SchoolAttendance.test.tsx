import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

/**
 * bd-60123 — the attendance page, in the shapes settled on the design canvas.
 *
 * Default is G3: every grade merged across its children AND its days, one bar
 * each on one scale. A button swaps to the day-wise detail. Date and teacher
 * filters apply to both.
 *
 * The invariant under all of it: the denominator is people x school days, so
 * an unmarked day is a visible block and never silently drops out of a rate.
 */

vi.mock("../hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("../services/api", () => ({ leader: { getAttendance: vi.fn() } }));

import { useAuth } from "../hooks/useAuth";
import { leader } from "../services/api";
import SchoolAttendance from "./SchoolAttendance";

const PAYLOAD = {
  success: true,
  from: "2026-08-19", to: "2026-09-17",
  focusTeacher: null,
  teachers: [
    { id: "t1", name: "Ayesha Bibi", isPrincipal: false },
    { id: "t2", name: "Sana Riaz", isPrincipal: false },
  ],
  schoolDays: ["2026-09-01", "2026-09-02", "2026-09-03"],
  students: {
    groups: [
      { name: "Grade 3 - C", people: 40, days: 3, chances: 120, present: 35, absent: 5, neverMarked: 80, markedDays: 1 },
      { name: "Grade 2 - A", people: 38, days: 3, chances: 114, present: 99, absent: 8, neverMarked: 7, markedDays: 3 },
    ],
    byDay: [
      { name: "Grade 2 - A", days: [
        { date: "2026-09-01", marked: true, total: 38, present: 36, absent: 2 },
        { date: "2026-09-02", marked: false, total: null, present: null, absent: null },
        { date: "2026-09-03", marked: true, total: 38, present: 35, absent: 3 },
      ] },
    ],
  },
  staff: {
    groups: [
      { name: "Hina Shah", people: 1, days: 3, chances: 3, present: 2, absent: 1, neverMarked: 0, markedDays: 3 },
    ],
    byDay: [
      { name: "Hina Shah", days: [
        { date: "2026-09-01", marked: true, total: 1, present: 1, absent: 0 },
        { date: "2026-09-02", marked: true, total: 1, present: 0, absent: 1 },
        { date: "2026-09-03", marked: false, total: null, present: null, absent: null },
      ] },
    ],
  },
};

function mount(payload: any = PAYLOAD) {
  (useAuth as any).mockReturnValue({ user: { firstName: "Atifa", role: "principal" }, loading: false, logout: vi.fn() });
  (leader.getAttendance as any).mockResolvedValue(payload);
  render(<MemoryRouter><SchoolAttendance /></MemoryRouter>);
}

describe("SchoolAttendance — G3 by default", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows one merged row per grade, least-known first", async () => {
    mount();
    await waitFor(() => expect(screen.getByTestId("group-Grade 3 - C")).toBeInTheDocument());
    const rows = screen.getAllByTestId(/^group-/);
    expect(rows[0]).toHaveTextContent("Grade 3 - C");
  });

  it("states the denominator as people x days, not as a percentage", async () => {
    mount();
    await waitFor(() => expect(screen.getByTestId("group-Grade 2 - A")).toBeInTheDocument());
    const row = screen.getByTestId("group-Grade 2 - A");
    expect(row).toHaveTextContent("38");
    expect(row).toHaveTextContent("114");
    expect(row.textContent).not.toMatch(/%/);
  });

  it("shows how much is simply unknown on every row", async () => {
    mount();
    await waitFor(() => expect(screen.getByTestId("group-Grade 3 - C")).toBeInTheDocument());
    expect(screen.getByTestId("group-Grade 3 - C")).toHaveTextContent("80");
  });

  it("covers staff with the same shape", async () => {
    mount();
    await waitFor(() => expect(screen.getByTestId("group-Hina Shah")).toBeInTheDocument());
  });
});

describe("SchoolAttendance — day-wise detail", () => {
  beforeEach(() => vi.clearAllMocks());

  it("is not shown until she asks for it", async () => {
    mount();
    await waitFor(() => expect(screen.getByTestId("group-Grade 2 - A")).toBeInTheDocument());
    expect(screen.queryByTestId("byday-students")).not.toBeInTheDocument();
  });

  it("swaps to the day-wise table on the button", async () => {
    mount();
    await waitFor(() => expect(screen.getByTestId("view-byday")).toBeInTheDocument());
    await userEvent.click(screen.getByTestId("view-byday"));
    await waitFor(() => expect(screen.getByTestId("byday-staff")).toBeInTheDocument());
    // P/A letters per day, and the unmarked day is its own state.
    const row = screen.getByTestId("byday-row-Hina Shah");
    expect(within(row).getByTestId("cell-Hina Shah-2026-09-02")).toHaveTextContent("A");
    expect(within(row).getByTestId("cell-Hina Shah-2026-09-03")).toHaveTextContent("–");
  });

  it("goes back to the merged view", async () => {
    mount();
    await waitFor(() => expect(screen.getByTestId("view-byday")).toBeInTheDocument());
    await userEvent.click(screen.getByTestId("view-byday"));
    await waitFor(() => expect(screen.getByTestId("byday-staff")).toBeInTheDocument());
    await userEvent.click(screen.getByTestId("view-summary"));
    await waitFor(() => expect(screen.getByTestId("group-Grade 2 - A")).toBeInTheDocument());
  });
});

describe("SchoolAttendance — filters", () => {
  beforeEach(() => vi.clearAllMocks());

  it("refetches on a date change", async () => {
    mount();
    await waitFor(() => expect(screen.getByTestId("from-date")).toBeInTheDocument());
    // fireEvent.change, not userEvent.type: a native date input commits one
    // value at a time from the picker, whereas typing fires a partial date per
    // keystroke ("2026-09-0") and the assertion races the last one.
    const from = screen.getByTestId("from-date") as HTMLInputElement;
    fireEvent.change(from, { target: { value: "2026-09-01" } });
    await waitFor(() =>
      expect(leader.getAttendance).toHaveBeenLastCalledWith(
        expect.objectContaining({ from: "2026-09-01" }),
      ));
  });

  it("refetches scoped to one teacher", async () => {
    mount();
    await waitFor(() => expect(screen.getByTestId("teacher-filter")).toBeInTheDocument());
    await userEvent.selectOptions(screen.getByTestId("teacher-filter"), "t1");
    await waitFor(() =>
      expect(leader.getAttendance).toHaveBeenLastCalledWith(
        expect.objectContaining({ teacherId: "t1" }),
      ));
  });

  it("says so when the window holds no attendance at all", async () => {
    mount({ ...PAYLOAD, schoolDays: [],
      students: { groups: [], byDay: [] }, staff: { groups: [], byDay: [] } });
    await waitFor(() => expect(screen.getByTestId("attendance-empty")).toBeInTheDocument());
  });
});
