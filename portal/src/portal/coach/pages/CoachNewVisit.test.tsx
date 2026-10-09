import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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

/** The time the picker shows, as the kit's TimeStamp names it ("9:00 AM"). */
const picked = () => within(screen.getByTestId("time-picker")).getByRole("img").getAttribute("aria-label");

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
    const names = Array.from(document.querySelectorAll("[data-history-row]")).map((el) => el.querySelector("[class*=line-clamp]")?.textContent);
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
    expect(card).toHaveTextContent("41 days ago");
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
    expect(picked()).toBe("9:00 AM");
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
    expect(picked()).toBe("2:30 PM");
    expect(screen.getByRole("radio", { name: "PM" })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("button", { name: /Schedule/ }));
    await waitFor(() => expect(L.createSchedule).toHaveBeenCalledWith(expect.objectContaining({ slot: "14:30" })));
  });

  it("she can still flip AM/PM by hand", async () => {
    renderAt("/portal/coach/new-visit?school=niete%3A494&teacher=923001110005");
    await screen.findByText("Step 3 of 3");
    fireEvent.click(screen.getByRole("radio", { name: "PM" }));
    expect(picked()).toBe("9:00 PM");
  });

  it("Reschedule edits the visit instead of booking a new one", async () => {
    renderAt("/portal/coach/new-visit?school=niete%3A110&teacher=923001110001&visit=0d8a6d1c-1111-4c1c-9a1a-000000000009&slot=11%3A30");
    await screen.findByText("Step 3 of 3");
    expect(picked()).toBe("11:30 AM");
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

/* bd-4404s7.3 — the kit's ChosenSoFar, the month, who is already booked, and the clash that warns but never blocks. */
describe("bd-4404s7.3 — what she chose so far", () => {
  it("step 2: the school is plain text with a separate Change that goes back to step 1", async () => {
    renderAt("/portal/coach/new-visit?school=niete%3A494");
    await screen.findByText("Sadia Noor");
    const chosen = within(screen.getByRole("region", { name: "Chosen so far" }));
    expect(chosen.getByText("School")).toBeInTheDocument();
    expect(chosen.getByText("IMCB G-9/4")).toBeInTheDocument();
    expect(chosen.getByText("IMCB G-9/4").closest("a")).toBeNull(); // the choice is information, not a link
    expect(chosen.getByRole("link", { name: "Change School" })).toHaveAttribute("href", "/portal/coach/new-visit");
  });

  it("step 3: the school and the teacher, each with its own Change", async () => {
    renderAt("/portal/coach/new-visit?school=niete%3A494&teacher=923001110005");
    await screen.findByText("Step 3 of 3");
    const chosen = within(screen.getByRole("region", { name: "Chosen so far" }));
    expect(chosen.getByText("IMCB G-9/4")).toBeInTheDocument();
    expect(chosen.getByText("Sadia Noor")).toBeInTheDocument();
    expect(chosen.getByText("0300 1110005")).toBeInTheDocument();
    expect(chosen.getByRole("link", { name: "Change School" })).toHaveAttribute("href", "/portal/coach/new-visit");
    expect(chosen.getByRole("link", { name: "Change Teacher" })).toHaveAttribute("href", "/portal/coach/new-visit?school=niete%3A494");
  });

  it("Reschedule has no Change: the visit is already chosen", async () => {
    renderAt("/portal/coach/new-visit?school=niete%3A110&teacher=923001110001&visit=v9&slot=11%3A30");
    await screen.findByText("Step 3 of 3");
    expect(screen.queryByRole("link", { name: /^Change/ })).toBeNull();
  });
});

describe("bd-4404s7.3 — step 1 status, in the kit's tones", () => {
  it("none or over 30 days is amber, 8 to 30 is grey, within a week is green; a legend says so", async () => {
    renderAt("/portal/coach/new-visit");
    await screen.findByText("Step 1 of 3");
    const row = (name: string) => screen.getByText(name).closest("[data-history-row]") as HTMLElement;
    const chip = (name: string) => row(name).querySelector("[data-chip]") as HTMLElement;
    expect(chip("IMSG G-6/2")).toHaveTextContent("No visits yet");
    expect(chip("IMSG G-6/2").className).toContain("fef3c7");
    expect(chip("IMCB G-9/4")).toHaveTextContent("41 days ago");
    expect(chip("IMCB G-9/4").className).toContain("fef3c7");
    expect(chip("IMSG I-10/1")).toHaveTextContent("Today");
    expect(chip("IMSG I-10/1").className).toContain("eaf6ef");
    const legend = screen.getByTestId("since-legend");
    expect(legend).toHaveTextContent("Over 30 days, or none");
    expect(legend).toHaveTextContent("8 to 30 days");
    expect(legend).toHaveTextContent("Within a week");
    // the teacher count stays plain text, never a chip
    expect(row("IMCB G-9/4")).toHaveTextContent("8 teachers");
    expect(within(row("IMCB G-9/4")).getByText("8 teachers").closest("[data-chip]")).toBeNull();
    // a coach row's lead is the round avatar, never the grade·subject column
    expect(row("IMCB G-9/4").querySelector("[data-testid=history-lead]")).toBeNull();
  });
});

describe("bd-4404s7.3 — day and time: the month, who is booked, the clash", () => {
  const BOOKED = {
    success: true, from: "2026-10-07", to: "2026-10-07", overdue: [],
    visits: [
      { id: "b1", teacherName: "Nasreen Akhtar", schoolName: "IMSG G-10/2", scheduledFor: "2026-10-07", scheduledSlot: "09:00", status: "upcoming" },
      { id: "b2", teacherName: "Muhammad Abdul Rehman Siddiqui", schoolName: "Federal Government Girls Secondary School Tarlai", scheduledFor: "2026-10-07", scheduledSlot: "11:30", status: "upcoming" },
      { id: "b3", teacherName: "Other Day", schoolName: "X", scheduledFor: "2026-10-08", scheduledSlot: "09:00", status: "upcoming" },
    ],
  };
  const STEP3 = "/portal/coach/new-visit?school=niete%3A494&teacher=923001110005";

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-07T05:00:00Z")); // Wednesday 7 October, Pakistan
  });
  afterEach(() => { vi.useRealTimers(); });

  it("shows the month over the day strip, and the readout's day in words", async () => {
    renderAt(STEP3);
    await screen.findByText("Step 3 of 3");
    expect(screen.getByText("October 2026")).toBeInTheDocument();
    expect(screen.getByText("Wednesday 7 October")).toBeInTheDocument();
  });

  it("Already booked lists who and when, for that day only, in TimeStamps", async () => {
    C.getSchedule.mockResolvedValue(BOOKED);
    renderAt(STEP3);
    const booked = within(await screen.findByRole("region", { name: "Already booked" }));
    expect(booked.getByRole("img", { name: "9:00 AM" })).toBeInTheDocument();
    expect(booked.getByText("Nasreen Akhtar")).toBeInTheDocument();
    expect(booked.getByText("IMSG G-10/2")).toBeInTheDocument();
    expect(booked.getByRole("img", { name: "11:30 AM" })).toBeInTheDocument();
    expect(booked.getByText("Muhammad Abdul Rehman Siddiqui")).toBeInTheDocument();
    expect(booked.queryByText("Other Day")).toBeNull();
  });

  it("a visit she is rescheduling is not in her own booked list", async () => {
    C.getSchedule.mockResolvedValue(BOOKED);
    renderAt("/portal/coach/new-visit?school=niete%3A110&teacher=923001110001&visit=b1&slot=09%3A00");
    const booked = within(await screen.findByRole("region", { name: "Already booked" }));
    expect(booked.queryByText("Nasreen Akhtar")).toBeNull();
    expect(booked.getByText("Muhammad Abdul Rehman Siddiqui")).toBeInTheDocument();
  });

  it("nothing booked: no Already booked card and no clash", async () => {
    renderAt(STEP3);
    await screen.findByText("Step 3 of 3");
    await waitFor(() => expect(C.getSchedule).toHaveBeenCalled());
    expect(screen.queryByRole("region", { name: "Already booked" })).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("picking a slot she already has: an amber Clash row and the warning, and Schedule stays enabled and books", async () => {
    C.getSchedule.mockResolvedValue(BOOKED);
    renderAt(STEP3); // opens on 9:00 AM, which Nasreen Akhtar already holds
    const booked = within(await screen.findByRole("region", { name: "Already booked" }));
    const clashRow = booked.getByText("Nasreen Akhtar").closest("[data-clash]") as HTMLElement;
    expect(clashRow).not.toBeNull();
    expect(within(clashRow).getByText("Clash")).toBeInTheDocument();
    expect(clashRow.className).toContain("fffbeb");
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("You already have a visit at 9:00 AM");
    expect(alert).toHaveTextContent("Nasreen Akhtar");
    expect(alert).toHaveTextContent("IMSG G-10/2");
    expect(alert).toHaveTextContent("You can still book it.");
    expect(booked.getByText("Muhammad Abdul Rehman Siddiqui").closest("[data-clash]")).toBeNull();
    expect(within(screen.getByTestId("time-picker")).getByRole("img")).toHaveAttribute("data-tone", "overdue"); // the readout turns amber
    const go = screen.getByRole("button", { name: /Schedule/ });
    expect(go).toBeEnabled();
    fireEvent.click(go);
    await waitFor(() => expect(L.createSchedule).toHaveBeenCalledWith(expect.objectContaining({ slot: "09:00", date: "2026-10-07" })));
    expect(await screen.findByText("Visit scheduled")).toBeInTheDocument();
  });

  it("moving off the booked time clears the clash", async () => {
    C.getSchedule.mockResolvedValue(BOOKED);
    renderAt(STEP3);
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("radio", { name: ":30" })); // 9:30 AM: nobody there
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(within(screen.getByTestId("time-picker")).getByRole("img")).toHaveAttribute("data-tone", "neutral");
  });

  it("the Visit scheduled page shows her time as a TimeStamp", async () => {
    renderAt(STEP3);
    await screen.findByText("Step 3 of 3");
    fireEvent.click(screen.getByRole("button", { name: /Schedule/ }));
    await screen.findByText("Visit scheduled");
    expect(screen.getByRole("img", { name: "9:00 AM" })).toBeInTheDocument();
  });
});
