import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: any) => <div>{children}</div> }));
vi.mock("../CoachGate", () => ({ default: ({ children }: any) => <>{children}</> }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: () => ({ user: { firstName: "Hataf", role: "coach", phoneNumber: "923001234567" }, loading: false }) }));
vi.mock("../../services/api", () => ({
  coach: { getPeople: vi.fn(), getSchedule: vi.fn(), editSchedule: vi.fn() },
  leader: { createSchedule: vi.fn() },
}));
import { coach, leader } from "../../services/api";
import CoachNewVisit from "./CoachNewVisit";

/**
 * bd-o15qnr — New visit in three steps (school → teacher → day and time), then
 * a confirmation. The time is three toggles (hour, :00/:30, AM/PM) starting at
 * 9:00 AM; tapping hours 12–6 turns PM on. Reschedule opens step 3 for a visit.
 */
const C = coach as any;
const L = leader as any;

const PEOPLE = {
  success: true,
  schools: [
    { schoolExtId: "niete:110", emis: "110", name: "IMSG I-10/1", teachers: 6, visits: 9, daysSinceVisit: 0, avgHitl: 66 },
    { schoolExtId: "niete:494", emis: "494", name: "IMCB G-9/4", teachers: 8, visits: 1, daysSinceVisit: 41, avgHitl: 58 },
    { schoolExtId: "niete:620", emis: "620", name: "IMSG G-6/2", teachers: 6, visits: 0, daysSinceVisit: null, avgHitl: null },
  ],
  teachers: [
    { teacherExtId: "923001110005", name: "Sadia Noor", phone: "923001110005", schoolExtId: "niete:494", emis: "494", schoolName: "IMCB G-9/4", hitl: 1, dc: 0, avgHitl: 49, daysSinceVisit: 41, daysSinceTraining: 64 },
    { teacherExtId: "923001110006", name: "Hina Tariq", phone: "923001110006", schoolExtId: "niete:494", emis: "494", schoolName: "IMCB G-9/4", hitl: 2, dc: 4, avgHitl: 66, daysSinceVisit: 20, daysSinceTraining: 15 },
    { teacherExtId: "923001110001", name: "Ayesha Bibi", phone: "923001110001", schoolExtId: "niete:110", emis: "110", schoolName: "IMSG I-10/1", hitl: 3, dc: 7, avgHitl: 61, daysSinceVisit: 22, daysSinceTraining: 12 },
  ],
};

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/portal/coach/new-visit" element={<CoachNewVisit />} />
        <Route path="/portal/coach/teacher/:ext" element={<div>teacher profile</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  C.getPeople.mockResolvedValue(PEOPLE);
  C.getSchedule.mockResolvedValue({ success: true, from: "x", to: "y", overdue: [], visits: [] });
  L.createSchedule.mockResolvedValue({ success: true, id: "new-1" });
  C.editSchedule.mockResolvedValue({ success: true, id: "v9" });
});

describe("step 1 — pick a school", () => {
  it("never-visited first, then longest since a visit; numbers only", async () => {
    renderAt("/portal/coach/new-visit");
    expect(await screen.findByText("Step 1 of 3")).toBeInTheDocument();
    const names = screen.getAllByTestId("school-option").map((el) => within(el).getByTestId("name").textContent);
    expect(names).toEqual(["IMSG G-6/2", "IMCB G-9/4", "IMSG I-10/1"]);
    expect(screen.queryByText(/due/i)).toBeNull();
  });

  it("a school opens step 2 for it", async () => {
    renderAt("/portal/coach/new-visit");
    fireEvent.click(await screen.findByText("IMCB G-9/4"));
    expect(await screen.findByText("Step 2 of 3")).toBeInTheDocument();
  });
});

describe("step 2 — pick a teacher", () => {
  it("only that school's teachers, with their numbers and a Profile link", async () => {
    renderAt("/portal/coach/new-visit?school=niete%3A494");
    expect(await screen.findByText("Sadia Noor")).toBeInTheDocument();
    expect(screen.queryByText("Ayesha Bibi")).toBeNull();
    const card = screen.getByTestId("teacher-923001110005");
    expect(card).toHaveTextContent("Last visit 41 days");
    expect(card).toHaveTextContent("49%");
    expect(within(card).getByRole("link", { name: /Profile/ })).toHaveAttribute("href", "/portal/coach/teacher/923001110005");
  });

  it("search by name or phone", async () => {
    renderAt("/portal/coach/new-visit?school=niete%3A494");
    await screen.findByText("Sadia Noor");
    fireEvent.change(screen.getByPlaceholderText("Name or phone"), { target: { value: "0300 1110006" } });
    expect(screen.queryByText("Sadia Noor")).toBeNull();
    expect(screen.getByText("Hina Tariq")).toBeInTheDocument();
  });
});

describe("step 3 — day and time", () => {
  it("starts at 9:00 AM and books 24-hour time", async () => {
    renderAt("/portal/coach/new-visit?school=niete%3A494&teacher=923001110005");
    expect(await screen.findByText("Step 3 of 3")).toBeInTheDocument();
    expect(screen.getByTestId("time-readout")).toHaveTextContent("9:00 AM");
    fireEvent.click(screen.getByRole("button", { name: /Schedule/ }));
    await waitFor(() => expect(L.createSchedule).toHaveBeenCalledWith(expect.objectContaining({ teacherExtId: "923001110005", slot: "09:00" })));
    expect(await screen.findByText("Visit scheduled")).toBeInTheDocument();
  });

  it("stepping the hour to 2 turns PM on; :30 makes it 2:30 PM → 14:30", async () => {
    renderAt("/portal/coach/new-visit?school=niete%3A494&teacher=923001110005");
    await screen.findByText("Step 3 of 3");
    const later = screen.getByRole("button", { name: "Later hour" });
    for (let i = 0; i < 5; i += 1) fireEvent.click(later); // 9 → 10 → 11 → 12 → 1 → 2
    fireEvent.click(screen.getByRole("radio", { name: ":30" }));
    expect(screen.getByTestId("time-readout")).toHaveTextContent("2:30 PM");
    expect(screen.getByRole("radio", { name: "PM" })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("button", { name: /Schedule/ }));
    await waitFor(() => expect(L.createSchedule).toHaveBeenCalledWith(expect.objectContaining({ slot: "14:30" })));
  });

  it("she can still flip AM/PM by hand", async () => {
    renderAt("/portal/coach/new-visit?school=niete%3A494&teacher=923001110005");
    await screen.findByText("Step 3 of 3");
    fireEvent.click(screen.getByRole("radio", { name: "PM" }));
    expect(screen.getByTestId("time-readout")).toHaveTextContent("9:00 PM");
  });

  it("Reschedule edits the visit instead of booking a new one", async () => {
    renderAt("/portal/coach/new-visit?school=niete%3A110&teacher=923001110001&visit=0d8a6d1c-1111-4c1c-9a1a-000000000009&slot=11%3A30");
    await screen.findByText("Step 3 of 3");
    expect(screen.getByTestId("time-readout")).toHaveTextContent("11:30 AM");
    fireEvent.click(screen.getByRole("button", { name: /Schedule/ }));
    await waitFor(() => expect(C.editSchedule).toHaveBeenCalledWith("0d8a6d1c-1111-4c1c-9a1a-000000000009", expect.objectContaining({ slot: "11:30" })));
    expect(L.createSchedule).not.toHaveBeenCalled();
  });

  it("a refusal from the server is shown, and she stays on the step", async () => {
    L.createSchedule.mockRejectedValue({ response: { data: { error: "That date is in the past" } } });
    renderAt("/portal/coach/new-visit?school=niete%3A494&teacher=923001110005");
    await screen.findByText("Step 3 of 3");
    fireEvent.click(screen.getByRole("button", { name: /Schedule/ }));
    expect(await screen.findByText("That date is in the past")).toBeInTheDocument();
    expect(screen.getByText("Step 3 of 3")).toBeInTheDocument();
  });
});
