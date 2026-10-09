import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: any) => <div>{children}</div> }));
vi.mock("../CoachGate", () => ({ default: ({ children }: any) => <>{children}</> }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: () => ({ user: { firstName: "Hataf", role: "coach", phoneNumber: "923001234567" }, loading: false }) }));
vi.mock("../../services/api", () => ({
  coach: { getHome: vi.fn(), getSchedule: vi.fn(), getPeople: vi.fn(), editSchedule: vi.fn(), getReports: vi.fn() },
  leader: { createSchedule: vi.fn() },
}));
import { coach, leader } from "../../services/api";
import CoachObserve from "./CoachObserve";
import CoachObservePick from "./CoachObservePick";
import CoachNewVisit from "./CoachNewVisit";
import CoachPeople from "./CoachPeople";
import CoachHome from "./CoachHome";
import CoachReports from "./CoachReports";
import CoachScheduling from "./CoachScheduling";
import { formatPhone } from "../ui";

/**
 * bd-o15qnr.8 — operator feedback round 1 on coach v2 (sandbox, 2026-10-06):
 *  1 "Pick a teacher screen should also show teacher phone number" — both pickers.
 *  2 "allow coaches to schedule one in the past as well" — the day strip pages back.
 *  3 "AM and PM warning can be removed" — no warning; the default flip stays.
 *  4 "You can show all of the observations chronologically ordered" — Pick the teacher.
 *  5 "show whichever one the next is, even if it is not today" — the Observe chip.
 *  7 "the first tab should be Schools, and should be the one that opens by default".
 * 15 "On the main page, not scheduling but Schedule".
 * 11 "the count thingy … should be next to Today's visits so we know that is the count".
 * The clock is Tuesday 6 Oct 2026, 10:00 in Pakistan.
 */
const C = coach as any;
const L = leader as any;

const visit = (id: string, name: string, phone: string, day: string, slot: string, status = "upcoming", extra: Record<string, unknown> = {}) => ({
  id, teacherName: name, teacherExtId: phone, schoolName: "IMSG I-10/1", schoolExtId: "niete:110",
  scheduledFor: day, scheduledSlot: slot, status, overdue: status === "upcoming" && day < "2026-10-06", ...extra,
});

const PEOPLE = {
  success: true,
  schools: [
    { schoolExtId: "niete:110", emis: "110", name: "IMSG I-10/1", teachers: 6, visits: 9, daysSinceVisit: 0, avgHitl: 66 },
    { schoolExtId: "niete:494", emis: "494", name: "IMCB G-9/4", teachers: 8, visits: 1, daysSinceVisit: 41, avgHitl: 58 },
  ],
  teachers: [
    { teacherExtId: "923001110005", name: "Sadia Noor", phone: "923001110005", schoolExtId: "niete:494", emis: "494", schoolName: "IMCB G-9/4", hitl: 1, dc: 0, avgHitl: 49, daysSinceVisit: 41, daysSinceTraining: 64 },
    { teacherExtId: "sadaf-khan", name: "Sadaf Khan", phone: null, schoolExtId: "niete:494", emis: "494", schoolName: "IMCB G-9/4", hitl: 0, dc: 0, avgHitl: null, daysSinceVisit: null, daysSinceTraining: null },
    { teacherExtId: "923001110001", name: "Ayesha Bibi", phone: "923001110001", schoolExtId: "niete:110", emis: "110", schoolName: "IMSG I-10/1", hitl: 3, dc: 7, avgHitl: 61, daysSinceVisit: 22, daysSinceTraining: 12 },
  ],
};

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/portal/coach/observe" element={<CoachObserve />} />
        <Route path="/portal/coach/observe/pick" element={<CoachObservePick />} />
        <Route path="/portal/coach/new-visit" element={<CoachNewVisit />} />
        <Route path="/portal/coach/people" element={<CoachPeople />} />
        <Route path="/portal/coach" element={<CoachHome />} />
        <Route path="/portal/coach/reports" element={<CoachReports />} />
        <Route path="/portal/coach/scheduling" element={<CoachScheduling />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-06T10:00:00+05:00"));
  C.getPeople.mockResolvedValue(PEOPLE);
  C.getSchedule.mockResolvedValue({ success: true, from: "x", to: "y", overdue: [], visits: [] });
  C.getHome.mockResolvedValue({ success: true, home: { today: [], next: null, counts: { week: 0, overdue: 0, waiting: 0, inProgress: 0, teachers: 3, schools: 2 } } });
  L.createSchedule.mockResolvedValue({ success: true, id: "new-1" });
  C.editSchedule.mockResolvedValue({ success: true, id: "v9" });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("1 — the teacher's phone on both pickers", () => {
  // bd-o15qnr.14 — operator: phone numbers read as 03xx, "0399 0000123" as on
  // the canvas. Display only: the users table keeps E.164 (923…).
  it("formatPhone: a Pakistani mobile in the local 03xx form; nothing for a name slug", () => {
    expect(formatPhone("923001110005")).toBe("0300 1110005");
    expect(formatPhone("+923001110005")).toBe("0300 1110005");
    expect(formatPhone("+92 300 1110005")).toBe("0300 1110005");
    expect(formatPhone("03001110005")).toBe("0300 1110005");
    expect(formatPhone("923990000123")).toBe("0399 0000123");
    expect(formatPhone("255677095937")).toBe("+255677095937");
    expect(formatPhone("sadaf-khan")).toBeNull();
    expect(formatPhone(null)).toBeNull();
    expect(formatPhone("")).toBeNull();
  });

  it("New visit step 2 shows each teacher's phone; an off-Rumi teacher shows none", async () => {
    renderAt("/portal/coach/new-visit?school=niete%3A494");
    const sadia = await screen.findByTestId("teacher-923001110005");
    expect(sadia).toHaveTextContent("0300 1110005");
    expect(sadia).not.toHaveTextContent("+92");
    const sadaf = screen.getByTestId("teacher-sadaf-khan");
    expect(sadaf).not.toHaveTextContent(/\+92|03\d\d /);
  });

  it("Pick the teacher shows each visit's phone", async () => {
    C.getSchedule.mockResolvedValue({ success: true, from: "x", to: "y", overdue: [], visits: [visit("t1", "Ayesha Bibi", "923001110001", "2026-10-06", "11:30")] });
    renderAt("/portal/coach/observe/pick");
    const row = (await screen.findByText("Ayesha Bibi")).closest("a")!;
    expect(row).toHaveTextContent("0300 1110001");
    expect(row).not.toHaveTextContent("+92");
  });
});

describe("2 — a visit can be booked on a past day", () => {
  it("the day strip goes back a week; a past day is booked as picked", async () => {
    renderAt("/portal/coach/new-visit?school=niete%3A494&teacher=923001110005");
    await screen.findByText("Step 3 of 3");
    fireEvent.click(screen.getByRole("button", { name: "Earlier days" }));
    fireEvent.click(screen.getByRole("button", { name: "Fri 2" }));
    fireEvent.click(screen.getByRole("button", { name: /^Schedule$/ }));
    await waitFor(() => expect(L.createSchedule).toHaveBeenCalledWith(expect.objectContaining({ date: "2026-10-02", slot: "09:00" })));
  });

  it("and forward again to later weeks", async () => {
    renderAt("/portal/coach/new-visit?school=niete%3A494&teacher=923001110005");
    await screen.findByText("Step 3 of 3");
    fireEvent.click(screen.getByRole("button", { name: "Later days" }));
    fireEvent.click(screen.getByRole("button", { name: "Wed 14" }));
    fireEvent.click(screen.getByRole("button", { name: /^Schedule$/ }));
    await waitFor(() => expect(L.createSchedule).toHaveBeenCalledWith(expect.objectContaining({ date: "2026-10-14" })));
  });
});

describe("3 — no AM/PM warning", () => {
  it("flipping 9:00 to PM shows no warning and books 21:00", async () => {
    renderAt("/portal/coach/new-visit?school=niete%3A494&teacher=923001110005");
    await screen.findByText("Step 3 of 3");
    fireEvent.click(screen.getByRole("radio", { name: "PM" }));
    expect(screen.getByTestId("time-readout")).toHaveTextContent("9:00 PM");
    expect(screen.queryByText(/7:00 AM/)).toBeNull();
    const button = screen.getByRole("button", { name: /^Schedule$/ });
    expect(button).not.toBeDisabled();
    fireEvent.click(button);
    await waitFor(() => expect(L.createSchedule).toHaveBeenCalledWith(expect.objectContaining({ slot: "21:00" })));
  });

  it("the default flip is unchanged: 11 is AM, 12 is PM", async () => {
    renderAt("/portal/coach/new-visit?school=niete%3A494&teacher=923001110005");
    await screen.findByText("Step 3 of 3");
    const later = screen.getByRole("button", { name: "Later hour" });
    fireEvent.click(later); fireEvent.click(later); // 9 → 10 → 11
    expect(screen.getByTestId("time-readout")).toHaveTextContent("11:00 AM");
    fireEvent.click(later); // 12
    expect(screen.getByTestId("time-readout")).toHaveTextContent("12:00 PM");
  });
});

describe("4 — Pick the teacher lists every visit, by day, in order", () => {
  const SCHEDULE = {
    success: true, from: "2026-09-06", to: "2026-12-31",
    overdue: [visit("late", "Sadia Noor", "923001110005", "2026-10-02", "09:00")],
    visits: [
      visit("past-done", "Rabia Saleem", "923001110007", "2026-10-05", "14:00", "done"),
      visit("t-done", "Mehwish Khan", "923001110002", "2026-10-06", "09:00", "done"),
      visit("t1", "Ayesha Bibi", "923001110001", "2026-10-06", "11:30"),
      visit("thu", "Hina Tariq", "923001110006", "2026-10-08", "09:00", "upcoming", { schoolName: "IMCB G-9/4", schoolExtId: "niete:494" }),
    ],
  };

  it("asks for a range around today, not just today", async () => {
    C.getSchedule.mockResolvedValue(SCHEDULE);
    renderAt("/portal/coach/observe/pick");
    await screen.findByText("Ayesha Bibi");
    const range = C.getSchedule.mock.calls[0][0];
    expect(range.from < "2026-10-06").toBe(true);
    expect(range.to > "2026-10-06").toBe(true);
  });

  it("Earlier (collapsed) above Today above later days; a later day can be picked", async () => {
    C.getSchedule.mockResolvedValue(SCHEDULE);
    renderAt("/portal/coach/observe/pick");
    await screen.findByText("Ayesha Bibi");
    const labels = screen.getAllByTestId("day-group").map((g) => g.getAttribute("data-day"));
    expect(labels).toEqual(["earlier", "2026-10-06", "2026-10-08"]);
    expect(screen.queryByText("Sadia Noor")).toBeNull();
    expect(screen.getByText("Hina Tariq").closest("a")).toHaveAttribute("href", "/portal/coach/visit/thu");
    expect(screen.getByText("Ayesha Bibi").closest("a")).toHaveAttribute("href", "/portal/coach/visit/t1");
  });

  it("opening Earlier shows the past days in order; the overdue one can be picked, a done one cannot", async () => {
    C.getSchedule.mockResolvedValue(SCHEDULE);
    renderAt("/portal/coach/observe/pick");
    await screen.findByText("Ayesha Bibi");
    fireEvent.click(screen.getByRole("button", { name: /Earlier/ }));
    const earlier = within(screen.getAllByTestId("day-group")[0]);
    const names = earlier.getAllByTestId("name").map((n) => n.textContent);
    expect(names).toEqual(["Sadia Noor", "Rabia Saleem"]);
    expect(earlier.getByText("Sadia Noor").closest("a")).toHaveAttribute("href", "/portal/coach/visit/late");
    expect(earlier.getByText("Rabia Saleem").closest("a")).toBeNull();
    expect(screen.getByText("Mehwish Khan").closest("a")).toBeNull();
    expect(within(screen.getByText("Mehwish Khan").closest("[aria-disabled]") as HTMLElement).getByText("Done")).toBeInTheDocument();
  });

  it("searching opens Earlier so a match is never hidden; the school filter still works", async () => {
    C.getSchedule.mockResolvedValue(SCHEDULE);
    renderAt("/portal/coach/observe/pick");
    await screen.findByText("Ayesha Bibi");
    fireEvent.change(screen.getByPlaceholderText("Name or phone"), { target: { value: "03001110005" } });
    expect(screen.getByText("Sadia Noor")).toBeInTheDocument();
    expect(screen.queryByText("Ayesha Bibi")).toBeNull();
    fireEvent.change(screen.getByPlaceholderText("Name or phone"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("School"), { target: { value: "niete:494" } });
    expect(screen.getByText("Hina Tariq")).toBeInTheDocument();
    expect(screen.queryByText("Ayesha Bibi")).toBeNull();
  });
});

describe("5 — Take observation shows the next visit, whatever its day", () => {
  it("Thursday's visit when there is none today", async () => {
    C.getHome.mockResolvedValue({ success: true, home: {
      today: [], next: visit("thu", "Ayesha Bibi", "923001110001", "2026-10-08", "09:00"),
      counts: { week: 1, overdue: 0, waiting: 0, inProgress: 0, teachers: 3, schools: 2 },
    } });
    renderAt("/portal/coach/observe");
    expect(await screen.findByRole("link", { name: /Take observation/ })).toHaveTextContent("Next: Ayesha · Thu 8 Oct 9:00 AM");
  });

  it("today's next visit shows its time only", async () => {
    const t = visit("t1", "Ayesha Bibi", "923001110001", "2026-10-06", "11:30");
    C.getHome.mockResolvedValue({ success: true, home: {
      today: [{ ...t, current: true }], next: t, counts: { week: 1, overdue: 0, waiting: 0, inProgress: 0, teachers: 3, schools: 2 },
    } });
    renderAt("/portal/coach/observe");
    expect(await screen.findByRole("link", { name: /Take observation/ })).toHaveTextContent("Next: Ayesha · 11:30 AM");
  });

  it("no chip when nothing is coming up", async () => {
    renderAt("/portal/coach/observe");
    const tile = await screen.findByRole("link", { name: /Take observation/ });
    await waitFor(() => expect(C.getHome).toHaveBeenCalled());
    expect(tile).not.toHaveTextContent("Next");
  });
});

describe("7 — Schools first, and open by default", () => {
  it("no ?tab: Schools is the first tab and the one selected", async () => {
    renderAt("/portal/coach/people");
    expect(await screen.findAllByTestId("school-card")).toHaveLength(2);
    const tabs = screen.getAllByTestId("tab");
    expect(tabs.map((t) => t.textContent?.replace(/\d+/g, "").trim())).toEqual(["Schools", "Teachers"]);
    expect(tabs[0]).toHaveAttribute("aria-current", "page");
    expect(tabs[0]).toHaveAttribute("href", "/portal/coach/people");
    expect(tabs[1]).toHaveAttribute("href", "/portal/coach/people?tab=teachers");
  });

  it("Teachers is one tap away", async () => {
    renderAt("/portal/coach/people");
    await screen.findAllByTestId("school-card");
    fireEvent.click(screen.getAllByTestId("tab")[1]);
    expect(await screen.findAllByTestId("teacher-card")).toHaveLength(3);
  });
});

describe("11 — a heading's count sits right after the heading text", () => {
  /** The count is inside the heading, straight after its text, and nothing pushes it to the far side. */
  function expectCountBeside(heading: HTMLElement, label: string, count: string) {
    const badge = within(heading).getByTestId("section-count");
    expect(badge).toHaveTextContent(count);
    expect(badge.previousElementSibling).toHaveTextContent(label);
    expect(badge.previousElementSibling!.className).not.toMatch(/flex-1/);
    expect(heading.className).not.toMatch(/justify-between/);
  }

  it("Home: Today's visits 2", async () => {
    C.getHome.mockResolvedValue({ success: true, home: {
      today: [visit("a", "Ayesha Bibi", "923001110001", "2026-10-06", "11:30"), visit("b", "Rabia Saleem", "923001110007", "2026-10-06", "14:00")],
      next: null, counts: { week: 2, overdue: 0, waiting: 0, inProgress: 0, teachers: 3, schools: 2 },
    } });
    renderAt("/portal/coach");
    await screen.findByText("Ayesha Bibi");
    expectCountBeside(screen.getByRole("heading", { name: /Today's visits/ }), "Today's visits", "2");
  });

  it("Reports: Waiting for you, In progress, All observations, and each day", async () => {
    const R = (id: string, step: string, createdAt: string) => ({ id, createdAt, teacherName: "Bushra Ali", teacherPhone: null, teacherExtId: null, schoolName: "IMS Tarnol", schoolExtId: null, status: "x", step, score: step === "sent" ? 70 : null, portal: true });
    C.getReports.mockResolvedValue({ success: true, waiting: [R("w1", "draft", "2026-10-05T09:00:00Z")], inProgress: [R("p1", "analysing", "2026-10-05T08:00:00Z")],
      all: { total: 1, page: 1, pageSize: 20, items: [R("s1", "sent", "2026-10-05T07:00:00Z")] } });
    renderAt("/portal/coach/reports");
    await screen.findAllByText("Bushra Ali");
    expectCountBeside(screen.getByRole("heading", { name: /Waiting for you/ }), "Waiting for you", "1");
    expectCountBeside(screen.getByRole("heading", { name: /In progress/ }), "In progress", "1");
    expectCountBeside(screen.getByRole("heading", { name: /All observations/ }), "All observations", "1");
    const day = within(screen.getByTestId("report-day")).getByRole("heading");
    expectCountBeside(day, "Mon 5 Oct", "1");
  });

  it("Pick the teacher: Today and each later day", async () => {
    C.getSchedule.mockResolvedValue({ success: true, from: "x", to: "y", overdue: [], visits: [
      visit("t1", "Ayesha Bibi", "923001110001", "2026-10-06", "11:30"),
      visit("thu", "Hina Tariq", "923001110006", "2026-10-08", "09:00"),
    ] });
    renderAt("/portal/coach/observe/pick");
    await screen.findByText("Ayesha Bibi");
    const [, thu] = screen.getAllByTestId("day-group");
    expectCountBeside(screen.getByRole("heading", { name: /^Today/ }), "Today", "1");
    expectCountBeside(within(thu).getByRole("heading"), "Thu 8 Oct", "1");
  });
});

describe("15 — Schedule, not Scheduling", () => {
  it("the hub's title and the New visit crumb say Schedule", async () => {
    renderAt("/portal/coach/scheduling");
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent(/^Schedule$/);
  });

  it("New visit's crumb", async () => {
    renderAt("/portal/coach/new-visit");
    await screen.findByText("Step 1 of 3");
    // bd-4404s7.3 (Coach_NewVisit1): the header says New visit, the crumb over it says Schedule
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/^New visit$/);
    expect(screen.getByText("Schedule")).toBeInTheDocument();
    expect(screen.queryByText(/Scheduling/)).toBeNull();
  });
});
