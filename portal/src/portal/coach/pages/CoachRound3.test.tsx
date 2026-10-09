import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: any) => <div>{children}</div> }));
vi.mock("../CoachGate", () => ({ default: ({ children }: any) => <>{children}</> }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: () => ({ user: { firstName: "Hataf", role: "coach", phoneNumber: "923001234567" }, loading: false }) }));
vi.mock("../../services/api", () => ({ coach: { getHome: vi.fn(), getTeacher: vi.fn(), getPeople: vi.fn() } }));
import { coach } from "../../services/api";
import CoachHome from "./CoachHome";
import CoachTeacher from "./CoachTeacher";
import CoachPeople from "./CoachPeople";
import { COACH_COPY } from "../copy";
import { fullDate } from "../time";

/**
 * bd-o15qnr.18 — operator round 3 (sandbox, 2026-10-07):
 *  1 "The Date tile is small. Make a nice subheading of Wednesday, 7th October … remove [the Coach pill]".
 *  3 Teacher History: a count beside the heading, rows grouped by month, newest first.
 *  5 "Where it says AVG score, it should instead say Avg. HITL Score."
 */
const C = coach as any;

function at(path: string, route: string, element: React.ReactNode) {
  return render(<MemoryRouter initialEntries={[path]}><Routes><Route path={route} element={element} /></Routes></MemoryRouter>);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-07T10:00:00+05:00"));
  C.getHome.mockResolvedValue({ success: true, home: { today: [], next: null, counts: { week: 0, overdue: 0, waiting: 0, inProgress: 0, teachers: 3, schools: 2 } } });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("1 — Home: a full-date subheading, no pills", () => {
  // bd-4404s7.2 — Home's date moved into the NIETE band (the kit's HomeGreeting), in the band's long form.
  it("the date is in the band, 'Wednesday 7 October'; no date pill, no Coach pill", async () => {
    at("/portal/coach", "/portal/coach", <CoachHome />);
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("Salaam, Hataf!");
    expect(screen.getByTestId("home-date")).toHaveTextContent(/^Wednesday 7 October$/);
    expect(screen.queryByText("Coach")).toBeNull();
    expect(screen.queryByText(/Wed 7 Oct/)).toBeNull();
  });

  it("the day is Pakistan's: 01:00 PKT on the 7th is still the 7th, though UTC says the 6th", () => {
    expect(fullDate(new Date("2026-10-06T20:00:00Z"))).toBe("Wednesday, 7th October");
    expect(fullDate(new Date("2026-10-07T18:59:00Z"))).toBe("Wednesday, 7th October");
    expect(fullDate(new Date("2026-10-07T19:00:00Z"))).toBe("Thursday, 8th October");
  });

  it.each([
    ["2026-10-01", "Thursday, 1st October"], ["2026-10-02", "Friday, 2nd October"], ["2026-10-03", "Saturday, 3rd October"],
    ["2026-10-04", "Sunday, 4th October"], ["2026-10-11", "Sunday, 11th October"], ["2026-10-12", "Monday, 12th October"],
    ["2026-10-13", "Tuesday, 13th October"], ["2026-10-21", "Wednesday, 21st October"], ["2026-10-22", "Thursday, 22nd October"],
    ["2026-10-23", "Friday, 23rd October"], ["2026-10-31", "Saturday, 31st October"],
  ])("%s → %s", (day, text) => {
    expect(fullDate(new Date(`${day}T12:00:00+05:00`))).toBe(text);
  });
});

describe("3 — Teacher History: a count, then months, newest first", () => {
  const TEACHER = {
    success: true,
    teacher: { teacherExtId: "923001110001", name: "Ayesha Bibi", phone: "923001110001", schoolName: "IMSG I-10/1", schoolExtId: "niete:110", emis: "110", hitl: 3, dc: 7, avgHitl: 61, daysSinceVisit: 22, daysSinceTraining: 12, trainingModules: 4 },
    history: [
      { id: "h1", date: "2026-10-05T09:00:00Z", kind: "HITL", score: 66, step: "sent", open: "report" },
      { id: "h2", date: "2026-10-01T09:00:00Z", kind: "DC", score: 60, step: null, open: null },
      { id: "h3", date: "2026-09-14T09:00:00Z", kind: "HITL", score: 61, step: "sent", open: "report" },
      { id: "h4", date: "2026-08-20T09:00:00Z", kind: "HITL", score: 64, step: "sent", open: null },
      { id: "h5", date: "2026-08-10T09:00:00Z", kind: "DC", score: 55, step: null, open: null },
      { id: "h6", date: "2026-08-02T09:00:00Z", kind: "DC", score: 50, step: null, open: null },
    ],
    nextVisit: null,
  };

  it("History 6, then October 2026 · 2, September 2026 · 1, August 2026 · 3", async () => {
    C.getTeacher.mockResolvedValue(TEACHER);
    at("/portal/coach/teacher/923001110001", "/portal/coach/teacher/:ext", <CoachTeacher />);
    const heading = await screen.findByRole("heading", { name: /History/ });
    expect(within(heading).getByTestId("section-count")).toHaveTextContent("6");
    const months = screen.getAllByTestId("history-month");
    const label = (m: HTMLElement) => {
      const h = within(m).getByRole("heading");
      return [m.getAttribute("data-month"), h.firstElementChild?.textContent, within(h).getByTestId("section-count").textContent];
    };
    expect(months.map(label)).toEqual([["2026-10", "October 2026", "2"], ["2026-09", "September 2026", "1"], ["2026-08", "August 2026", "3"]]);
    expect(within(months[2]).getAllByTestId(/^history-h/).map((r) => r.getAttribute("data-testid"))).toEqual(["history-h4", "history-h5", "history-h6"]);
  });
});

describe("5 — 'Avg. HITL Score' everywhere", () => {
  it("every average-score word in the copy is the same label", () => {
    for (const k of ["avg", "avgHitl", "avgScore", "sortAvg"] as const) expect(COACH_COPY[k]).toBe("Avg. HITL Score");
  });

  it("Teachers tab: the strip shows it, and lets it wrap rather than cut it", async () => {
    C.getPeople.mockResolvedValue({ success: true, schools: [], teachers: [
      { teacherExtId: "923001110005", name: "Sadia Noor", phone: "923001110005", schoolExtId: "niete:494", emis: "494", schoolName: "IMCB G-9/4", hitl: 1, dc: 0, avgHitl: 49, daysSinceVisit: 41, daysSinceTraining: 64 },
    ] });
    at("/portal/coach/people?tab=teachers", "/portal/coach/people", <CoachPeople />);
    const card = await screen.findByTestId("teacher-card");
    const label = within(card).getByText("Avg. HITL Score");
    expect(label.className).not.toMatch(/whitespace-nowrap/);
    expect(screen.queryByText(/^Avg score$|^Avg HITL$|^Avg$/)).toBeNull();
  });
});
