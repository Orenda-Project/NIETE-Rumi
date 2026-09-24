import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * bd-60174 (STEPS v1.1, principal-dashboard feedback items 6 and 7).
 *
 * The numbers on this page were right; nothing said what they were. Two labels
 * were reported as unreadable, verbatim: "Student attendance is showing Unknown
 * users / 220/20, these labels are not understood" and "In teacher attendance
 * 1x19, this label is not understood".
 *
 * Both are real defects of labelling, not of arithmetic:
 *
 *   "220 / 20"  was present / absent. A slashed pair reads as part-over-whole
 *               everywhere else in the world, so this parses as "220 of 20" —
 *               impossible, therefore read as a bug. The two numbers need
 *               naming, not reformatting.
 *
 *   "1 x 19"    was people x school-days = chances to show up. The derivation
 *               is worth showing (it IS the denominator), but three bare
 *               numbers and two operators say nothing about teachers or days.
 *
 * The page's own rule stands and these tests enforce it: the unit is a
 * person-day and NO percentage is rendered, because the panel this replaced
 * divided 58 by 61 and printed 94.7% off 46% of the data. Naming the numbers
 * must not reintroduce a rate.
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
  teachers: [{ id: "t1", name: "Ayesha Bibi", isPrincipal: false }],
  schoolDays: ["2026-09-01", "2026-09-02", "2026-09-03"],
  students: {
    // Deliberately the reported shape: present 220, absent 20 — the pair that
    // reads as "220 of 20" when it is printed as a bare fraction.
    groups: [
      { name: "Grade 2 - A", people: 80, days: 3, chances: 240, present: 220, absent: 20, neverMarked: 0, markedDays: 3 },
    ],
    byDay: [],
  },
  staff: {
    // The reported "1x19": one teacher across 19 school days.
    groups: [
      { name: "Hina Shah", people: 1, days: 19, chances: 19, present: 15, absent: 4, neverMarked: 0, markedDays: 19 },
    ],
    byDay: [],
  },
};

function mount(payload: any = PAYLOAD) {
  (useAuth as any).mockReturnValue({ user: { firstName: "Atifa", role: "principal" }, loading: false, logout: vi.fn() });
  (leader.getAttendance as any).mockResolvedValue(payload);
  render(<MemoryRouter><SchoolAttendance /></MemoryRouter>);
}

describe("SchoolAttendance — every number says what it is (bd-60174)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("names present and absent instead of printing a bare 220 / 20", async () => {
    mount();
    await waitFor(() => expect(screen.getByTestId("group-Grade 2 - A")).toBeInTheDocument());
    const row = screen.getByTestId("group-Grade 2 - A");

    // Both counts still shown — the fix is naming them, not hiding them.
    expect(row).toHaveTextContent("220");
    expect(row).toHaveTextContent("20");

    // ...and each is named, so the pair can never be read as a fraction.
    expect(row).toHaveTextContent(/present/i);
    expect(row).toHaveTextContent(/absent/i);

    // The bare slashed pair itself must be gone: "220 / 20" is exactly the
    // string that was reported as unreadable.
    expect(row.textContent?.replace(/\s+/g, " ")).not.toMatch(/220 \/ 20/);
  });

  it("spells out people x days rather than leaving 1 x 19 bare", async () => {
    mount();
    await waitFor(() => expect(screen.getByTestId("group-Hina Shah")).toBeInTheDocument());
    const row = screen.getByTestId("group-Hina Shah");

    // The derivation stays visible — it is the denominator.
    expect(row).toHaveTextContent("19");

    // But the factors are named, so "1 x 19 = 19" is legible without a key.
    expect(row).toHaveTextContent(/day/i);
    expect(row.textContent).toMatch(/teacher|person|people|staff/i);
  });

  it("still renders no percentage anywhere — the person-day rule holds", async () => {
    mount();
    await waitFor(() => expect(screen.getByTestId("group-Grade 2 - A")).toBeInTheDocument());
    expect(screen.getByTestId("group-Grade 2 - A").textContent).not.toMatch(/%/);
    expect(screen.getByTestId("group-Hina Shah").textContent).not.toMatch(/%/);
  });
});
