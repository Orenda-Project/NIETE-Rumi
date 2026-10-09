/* eslint-disable @typescript-eslint/no-explicit-any -- test mocks, as the other coach tests */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, within, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import i18n from "i18next";

vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: any) => <div>{children}</div> }));
vi.mock("../CoachGate", () => ({ default: ({ children }: any) => <>{children}</> }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: () => ({ user: { firstName: "Hataf", role: "coach", phoneNumber: "923001234567" }, loading: false }) }));
vi.mock("../../services/api", () => ({
  coach: { getHome: vi.fn(), getPeople: vi.fn(), getSchedule: vi.fn(), getTeam: vi.fn(), editSchedule: vi.fn(), getPending: vi.fn() },
  leader: { createSchedule: vi.fn() },
  language: { get: vi.fn(() => new Promise(() => {})), set: vi.fn() },
}));
import { coach } from "../../services/api";
import CoachNewVisit from "../pages/CoachNewVisit";
import CoachScheduling from "../pages/CoachScheduling";
import CoachSchedule from "../pages/CoachSchedule";
import CoachTeam from "../pages/CoachTeam";
import { SCHEDULE_COPY_UR as U } from "./copy";

/**
 * bd-4404s7.3 — the Schedule area in Urdu: every word of the hub, My schedule, Team schedule and New visit (with the
 * clash) comes from the bilingual copy; names, schools and times are data / the kit's TimeStamp and stay as they are.
 * MACHINE-DRAFTED Urdu (NATIVE-CHECK in the review file).
 */
const C = coach as any;
const plain = (t: string | null) => (t || "").replace(/[\u2066-\u2069]/g, "");
/** The leaf whose text is exactly `want`, ignoring the kit's bidi isolates round digits and Latin. */
const text = (want: string) => (_: string, el: Element | null) => !!el && el.children.length === 0 && plain(el.textContent) === want;

const PEOPLE = {
  success: true,
  schools: [{ schoolExtId: "niete:494", emis: "494", name: "IMCB G-9/4", teachers: 8, visits: 1, daysSinceVisit: 41, avgHitl: 58 }],
  teachers: [{ teacherExtId: "923001110005", name: "Sadia Noor", phone: "923001110005", schoolExtId: "niete:494", emis: "494", schoolName: "IMCB G-9/4", hitl: 1, dc: 0, avgHitl: 49, daysSinceVisit: 41, daysSinceTraining: 64 }],
};

const at = (path: string) => render(
  <MemoryRouter initialEntries={[path]}>
    <Routes>
      <Route path="/portal/coach/scheduling" element={<CoachScheduling />} />
      <Route path="/portal/coach/schedule" element={<CoachSchedule />} />
      <Route path="/portal/coach/team" element={<CoachTeam />} />
      <Route path="/portal/coach/new-visit" element={<CoachNewVisit />} />
    </Routes>
  </MemoryRouter>,
);

beforeEach(async () => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-07T05:00:00Z"));
  C.getPending.mockResolvedValue({ waiting: 0, ids: [] });
  C.getHome.mockResolvedValue({ success: true, home: { today: [], counts: { week: 6, overdue: 1, waiting: 0, inProgress: 0, teachers: 24, schools: 12 } } });
  C.getPeople.mockResolvedValue(PEOPLE);
  C.getSchedule.mockResolvedValue({
    success: true, from: "2026-10-04", to: "2026-10-10",
    overdue: [{ id: "o1", teacherName: "Sadia Noor", schoolName: "IMCB G-9/4", scheduledFor: "2026-10-02", scheduledSlot: "09:00", status: "upcoming", overdue: true }],
    visits: [{ id: "v1", teacherName: "Nasreen Akhtar", schoolName: "IMSG G-10/2", scheduledFor: "2026-10-07", scheduledSlot: "09:00", status: "upcoming" }],
  });
  C.getTeam.mockResolvedValue({
    success: true, date: "2026-10-07", totals: { today: 46, week: 212, month: 840 },
    days: [{ date: "2026-10-07", count: 46 }],
    groups: [{ slot: "09:00", visits: [{ id: "t1", coachId: "me", coachName: "Hataf Atif", mine: true, teacherName: "Huma", schoolName: "IMSB F-6/2", status: "upcoming", done: false }] }],
    coaches: [{ id: "me", name: "Hataf Atif", me: true }],
  });
  if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} });
  await act(async () => { await i18n.changeLanguage("ur"); });
});

afterEach(async () => {
  vi.useRealTimers();
  await act(async () => { await i18n.changeLanguage("en"); });
});

describe("Schedule in Urdu", () => {
  it("the hub: title and the three doors, with their chips", async () => {
    at("/portal/coach/scheduling");
    expect(await screen.findByRole("heading", { level: 1, name: U.title })).toBeTruthy();
    expect(screen.getByText(U.newVisit)).toBeTruthy();
    expect(screen.getByText(U.mySchedule)).toBeTruthy();
    expect(screen.getByText(U.teamSchedule)).toBeTruthy();
    await waitFor(() => expect(screen.getByText(text(U.overdueN(1)))).toBeTruthy());
    expect(screen.getByText(text(U.thisWeekN(6)))).toBeTruthy();
  });

  it("My schedule: the title, the Urdu weekdays, Overdue and days late, and the kit's Urdu AM/PM on a time", async () => {
    at("/portal/coach/schedule");
    expect(await screen.findByRole("heading", { level: 1, name: U.mySchedule })).toBeTruthy();
    const overdue = within(await screen.findByTestId("overdue"));
    expect(overdue.getByText(text(U.daysLate(5)))).toBeTruthy();
    expect(screen.getByRole("button", { name: `${U.weekdaysShort[3]} 7` })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 3, name: new RegExp(`${U.today} · ${U.weekdaysShort[3]}`) })).toBeTruthy();
    expect(plain(document.body.textContent)).toContain("صبح"); // TimeStamp's own AM word
  });

  it("Team schedule: the totals' labels and the coach field", async () => {
    at("/portal/coach/team");
    expect(await screen.findByRole("heading", { level: 1, name: U.teamSchedule })).toBeTruthy();
    expect(await screen.findByRole("button", { name: new RegExp(`^${U.coach}`) })).toBeTruthy();
    expect(screen.getByText(text(U.totals.month))).toBeTruthy();
    expect(screen.getByText(text(U.visitsN(1)))).toBeTruthy();
  });

  it("New visit 3: Chosen so far, the month in Urdu, Already booked, and the clash that still lets her book", async () => {
    at("/portal/coach/new-visit?school=niete%3A494&teacher=923001110005");
    expect(await screen.findByText(text(U.stepOf(3)))).toBeTruthy();
    expect(screen.getByRole("region", { name: U.chosenSoFar })).toBeTruthy();
    expect(screen.getByRole("link", { name: `${U.change} ${U.school}` })).toBeTruthy();
    expect(screen.getByText(text(`${U.months[9]} 2026`))).toBeTruthy();
    const booked = within(await screen.findByRole("region", { name: U.alreadyBooked }));
    expect(booked.getByText(U.clash)).toBeTruthy();
    const alert = screen.getByRole("alert");
    expect(plain(alert.textContent)).toContain(U.clashTitle("9:00 صبح"));
    expect(plain(alert.textContent)).toContain(U.clashStill);
    expect((screen.getByRole("button", { name: new RegExp(U.schedule) }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("New visit 1: the legend and the status chips are Urdu", async () => {
    at("/portal/coach/new-visit");
    expect(await screen.findByText(text(U.stepOf(1)))).toBeTruthy();
    const legend = screen.getByTestId("since-legend");
    expect(plain(legend.textContent)).toContain(U.legendOld);
    expect(screen.getByText(text(U.daysAgo(41)))).toBeTruthy();
    expect(screen.getByText(text(U.teachersCount(8)))).toBeTruthy();
  });
});
