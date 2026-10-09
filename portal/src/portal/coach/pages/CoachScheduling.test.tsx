import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: any) => <div>{children}</div> }));
vi.mock("../CoachGate", () => ({ default: ({ children }: any) => <>{children}</> }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: () => ({ user: { firstName: "Hataf", role: "coach", phoneNumber: "923001234567" }, loading: false }) }));
vi.mock("../../services/api", () => ({ coach: { getHome: vi.fn(), getSchedule: vi.fn(), getTeam: vi.fn() } }));
import { coach } from "../../services/api";
import CoachScheduling from "./CoachScheduling";
import CoachSchedule from "./CoachSchedule";
import CoachTeam from "./CoachTeam";

const C = coach as any;

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/portal/coach/scheduling" element={<CoachScheduling />} />
        <Route path="/portal/coach/schedule" element={<CoachSchedule />} />
        <Route path="/portal/coach/team" element={<CoachTeam />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("Scheduling hub", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    C.getHome.mockResolvedValue({ success: true, home: { today: [], counts: { week: 6, overdue: 1, waiting: 0, inProgress: 0, teachers: 24, schools: 12 } } });
  });

  it("three big tiles: New visit, My schedule, Team schedule", async () => {
    renderAt("/portal/coach/scheduling");
    expect(await screen.findByRole("link", { name: /New visit/ })).toHaveAttribute("href", "/portal/coach/new-visit");
    expect(screen.getByRole("link", { name: /My schedule/ })).toHaveAttribute("href", "/portal/coach/schedule");
    expect(screen.getByRole("link", { name: /My schedule/ })).toHaveTextContent("6 this week");
    expect(screen.getByRole("link", { name: /My schedule/ })).toHaveTextContent("1 overdue");
    expect(screen.getByRole("link", { name: /Team schedule/ })).toHaveAttribute("href", "/portal/coach/team");
  });

  it("bd-4404s7.3: the three doors are the Schedule feature's rose, and their chips use the kit's status tones", async () => {
    renderAt("/portal/coach/scheduling");
    await screen.findByRole("link", { name: /New visit/ });
    const icons = screen.getAllByTestId("hub-icon");
    expect(icons).toHaveLength(3);
    for (const el of icons) {
      expect(el.style.background).toBe("rgb(252, 231, 243)"); // #fce7f3
      expect(el.style.color).toBe("rgb(190, 24, 93)"); // #be185d
    }
    await waitFor(() => expect(screen.getByText("1 overdue")).toBeInTheDocument());
    expect(screen.getByText("1 overdue").className).toContain("fef3c7");
    expect(screen.getByText("6 this week").className).toContain("f3f4f6");
  });
});

describe("My schedule", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    C.getSchedule.mockResolvedValue({
      success: true, from: "2026-10-05", to: "2026-10-11",
      overdue: [{ id: "o1", teacherName: "Sadia Noor", schoolName: "IMCB G-9/4", scheduledFor: "2026-10-02", scheduledSlot: "09:00", status: "upcoming", overdue: true }],
      visits: [
        { id: "v1", teacherName: "Mehwish Khan", schoolName: "IMSG I-10/1", scheduledFor: "2026-10-06", scheduledSlot: "09:00", status: "done", overdue: false },
        { id: "v2", teacherName: "Rabia Saleem", schoolName: "IMCG F-7/2", scheduledFor: "2026-10-06", scheduledSlot: "14:30", status: "upcoming", overdue: false },
        { id: "v3", teacherName: "Nadia Parveen", schoolName: "IMS Tarnol", scheduledFor: "2026-10-07", scheduledSlot: null, status: "upcoming", overdue: false },
      ],
    });
  });

  it("overdue first, with days late; then each day's visits in 12-hour time, each opening its visit", async () => {
    renderAt("/portal/coach/schedule");
    const overdue = within(await screen.findByTestId("overdue"));
    expect(overdue.getByText("Sadia Noor").closest("a")).toHaveAttribute("href", "/portal/coach/visit/o1");
    expect(overdue.getByText(/days late/)).toBeInTheDocument();
    const rabia = screen.getByText("Rabia Saleem").closest("a") as HTMLElement;
    expect(within(rabia).getByRole("img", { name: "2:30 PM" })).toBeInTheDocument(); // the kit's TimeStamp
    expect(screen.getByText("Mehwish Khan").closest("a")).toHaveTextContent("Done");
  });

  it("bd-4404s7.3: a visit's time is a TimeStamp in the visit's tone, beside a round avatar (never a grade tile)", async () => {
    renderAt("/portal/coach/schedule");
    const done = (await screen.findByText("Mehwish Khan")).closest("a") as HTMLElement;
    expect(within(done).getByRole("img", { name: "9:00 AM" })).toHaveAttribute("data-tone", "done");
    const late = screen.getByText("Sadia Noor").closest("a") as HTMLElement;
    expect(within(late).getByRole("img", { name: "9:00 AM" })).toHaveAttribute("data-tone", "overdue");
    expect(late.querySelector(".rounded-full")).not.toBeNull();
    expect(late.querySelector("[data-testid=history-lead]")).toBeNull();
    expect(within(late).getByText(/days late/).className).toContain("fef3c7"); // waiting tone
    expect(done.querySelector("[data-chip]")?.className).toContain("eaf6ef"); // done tone
  });

  it("a visit with no time shows nothing for it, not a made-up one", async () => {
    renderAt("/portal/coach/schedule");
    const row = (await screen.findByText("Nadia Parveen")).closest("a") as HTMLElement;
    expect(within(row).queryByRole("img")).toBeNull();
  });

  it("the week strip shows a dot per visit; New visit at the bottom", async () => {
    renderAt("/portal/coach/schedule");
    await screen.findByText("Rabia Saleem");
    expect(screen.getByRole("link", { name: /New visit/ })).toHaveAttribute("href", "/portal/coach/new-visit");
    expect(screen.getAllByRole("button", { name: /Mon|Tue|Wed|Thu|Fri|Sat|Sun/ })).toHaveLength(7);
  });
});

describe("Team schedule", () => {
  const TEAM = {
    success: true, date: "2026-10-06",
    totals: { today: 46, week: 212, month: 840 },
    days: [41, 46, 44, 38, 43, 0, 0].map((n, i) => ({ date: `2026-10-${String(5 + i).padStart(2, "0")}`, count: n })),
    groups: [
      { slot: "09:00", visits: Array.from({ length: 20 }, (_, i) => ({ id: `t${i}`, coachId: i === 0 ? "me" : "c2", coachName: i === 0 ? "Hataf Atif" : "Imran S", mine: i === 0, teacherName: `Teacher ${i}`, schoolName: "IMSG I-10/1", status: "upcoming", done: i < 3 })) },
      { slot: "11:30", visits: [{ id: "u1", coachId: "c3", coachName: "Saima R", mine: false, teacherName: "Huma", schoolName: "IMSB F-6/2", status: "upcoming", done: false }] },
    ],
    coaches: [{ id: "00000000-0000-4000-8000-000000000001", name: "Hataf Atif", me: true }, { id: "00000000-0000-4000-8000-000000000002", name: "Imran S", me: false }],
  };
  beforeEach(() => { vi.clearAllMocks(); C.getTeam.mockResolvedValue(TEAM); });

  it("leads with the totals: today, this week, this month", async () => {
    renderAt("/portal/coach/team");
    const totals = within(await screen.findByTestId("team-totals"));
    expect(totals.getByText("46")).toBeInTheDocument();
    expect(totals.getByText("212")).toBeInTheDocument();
    expect(totals.getByText("840")).toBeInTheDocument();
  });

  it("bd-4404s7.3: the totals are the kit's KpiTiles, three across", async () => {
    renderAt("/portal/coach/team");
    const totals = within(await screen.findByTestId("team-totals"));
    expect(totals.getByRole("group", { name: /46.*Today/ })).toBeInTheDocument();
    expect(totals.getByText("This month")).toBeInTheDocument();
  });

  it("a time with 20 visits shows a few and a Show all 20; it opens to all 20", async () => {
    renderAt("/portal/coach/team");
    const group = within(await screen.findByTestId("slot-09:00"));
    expect(group.getByRole("img", { name: "9:00 AM" })).toBeInTheDocument(); // the kit's TimeStamp
    expect(group.getByText("20 visits")).toBeInTheDocument();
    expect(group.getAllByTestId("team-visit").length).toBeLessThan(20);
    fireEvent.click(group.getByRole("button", { name: /Show all 20/ }));
    expect(group.getAllByTestId("team-visit")).toHaveLength(20);
  });

  it("a coach can be picked from the list; the page asks again for her only", async () => {
    renderAt("/portal/coach/team");
    const select = await screen.findByLabelText("Coach");
    fireEvent.change(select, { target: { value: "00000000-0000-4000-8000-000000000002" } });
    await waitFor(() => expect(C.getTeam).toHaveBeenLastCalledWith(expect.objectContaining({ coach: "00000000-0000-4000-8000-000000000002" })));
  });
});
