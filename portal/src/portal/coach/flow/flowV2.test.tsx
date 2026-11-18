import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

/**
 * bd-o15qnr.26 (queue #177, Option A) — the coach visit flow v2, behind portal_coach_flow_v2 (fail-closed):
 *
 *   Schedule     ONE open list of her visits: Overdue · Today · Coming up · Earlier, nothing folded. A visit not yet done
 *                carries its own buttons (Start recording today or late, Reschedule when it is coming up, Cancel visit,
 *                which asks first). A done visit opens its observation.
 *   Routes       on: the Schedule hub, the Observe hub and Take observation's list send her on (old links keep working);
 *                off or unread: exactly today's pages.
 *   New visit    All · Primary · Middle · High on steps 1–2, only when nine in ten of her teachers have a level.
 */

vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: any) => <div>{children}</div> }));
vi.mock("../CoachGate", () => ({ default: ({ children }: any) => <>{children}</> }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: () => ({ user: { firstName: "Hina", role: "coach", phoneNumber: "923001234567" }, loading: false }) }));
vi.mock("../../services/api", () => ({
  coach: { getHome: vi.fn(), getSchedule: vi.fn(), getTeam: vi.fn(), getPeople: vi.fn(), handoff: vi.fn(() => Promise.resolve({ code: null })) },
  leader: { cancelSchedule: vi.fn(), createSchedule: vi.fn() },
}));
vi.mock("./track", () => ({ trackFlow: vi.fn() }));
vi.mock("@/lib/whatsapp", async (orig) => ({ ...(await orig<object>()), useBotNumber: () => "923000000000" }));
const flow = vi.hoisted(() => ({ on: true as boolean | null }));
vi.mock("./useCoachFlowV2", () => ({ useFlowV2: () => flow.on, useCoachFlowV2: () => flow.on, coachFlowV2On: () => flow.on === true }));

import { coach, leader } from "../../services/api";
import { trackFlow } from "./track";
import { karachiDay } from "../time";
import { addDays } from "../../teacher/ui";
import { SchedulingRoute, ScheduleRoute, ObserveRoute, ObservePickRoute } from "./routes";
import CoachNewVisit from "../pages/CoachNewVisit";
import { SCHEDULE_COPY } from "../schedule/copy";
import { OBSERVE_COPY } from "../observe/copy";

const C = coach as any;
const L = leader as any;

function Where() {
  const { pathname, search } = useLocation();
  return <p data-testid="where">{`${pathname}${search}`}</p>;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Where />
      <Routes>
        <Route path="/portal/coach/scheduling" element={<SchedulingRoute />} />
        <Route path="/portal/coach/schedule" element={<ScheduleRoute />} />
        <Route path="/portal/coach/observe" element={<ObserveRoute />} />
        <Route path="/portal/coach/observe/pick" element={<ObservePickRoute />} />
        <Route path="/portal/coach/new-visit" element={<CoachNewVisit />} />
        <Route path="/portal/coach/reports" element={<p data-testid="reports-page">My observations</p>} />
        <Route path="*" element={<p data-testid="other">other</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

const today = karachiDay();
const v = (id: string, day: string, slot: string, status: string, name: string, extra: Record<string, unknown> = {}) => ({
  id, teacherName: name, schoolName: "IMCB G-10/4", schoolExtId: "S1", teacherExtId: `92300000${id}`, scheduledFor: day, scheduledSlot: slot, status, ...extra,
});

/** 44 done visits in the 30 days before today (as a busy coach's), two overdue, three today, two coming up. */
function busyWeek() {
  const earlier = Array.from({ length: 44 }, (_, i) => v(`e${i}`, addDays(today, -1 - (i % 28)), "09:00", "done", `Done Teacher ${i}`, { sessionId: `sess-${i}` }));
  const overdue = [v("o1", addDays(today, -5), "10:00", "upcoming", "Rabia Nawaz", { overdue: true }), v("o2", addDays(today, -2), "11:30", "upcoming", "Sumaira Akhtar", { overdue: true })];
  const todays = [v("t1", today, "08:30", "done", "Farah Naz", { sessionId: "sess-farah" }), v("t2", today, "10:00", "upcoming", "Kiran Shahzadi"), v("t3", today, "12:00", "upcoming", "Asma Batool")];
  const later = [v("c1", addDays(today, 1), "09:00", "upcoming", "Huma Ijaz"), v("c2", addDays(today, 3), "13:00", "upcoming", "Tahira Bibi")];
  return { success: true, from: addDays(today, -30), to: addDays(today, 90), overdue, visits: [...earlier, ...overdue, ...todays, ...later] };
}

beforeEach(() => {
  vi.clearAllMocks();
  flow.on = true;
  C.getSchedule.mockResolvedValue(busyWeek());
  C.getHome.mockResolvedValue({ success: true, home: { today: [], next: null, counts: { week: 5, overdue: 2, waiting: 1, inProgress: 0, teachers: 20, schools: 6 } } });
});

describe("Schedule, switch on: one open list, nothing folded", () => {
  it("asks for 30 days back to 90 ahead, as Take observation did", async () => {
    renderAt("/portal/coach/schedule");
    await screen.findByTestId("visit-list");
    expect(C.getSchedule).toHaveBeenCalledWith({ from: addDays(today, -30), to: addDays(today, 90) });
  });

  it("Overdue · Today · Coming up · Earlier, in that order, every group open (no fold, no week strip)", async () => {
    renderAt("/portal/coach/schedule");
    const list = await screen.findByTestId("visit-list");
    const groups = Array.from(list.querySelectorAll("[data-group]")).map((g) => g.getAttribute("data-group"));
    expect(groups).toEqual(["overdue", "today", "coming", "earlier"]);
    // nothing folded: no toggle anywhere, and every one of the 44 earlier visits is on the page
    expect(list.querySelector("[aria-expanded]")).toBeNull();
    expect(within(list.querySelector('[data-group="earlier"]') as HTMLElement).getAllByText(/^Done Teacher \d+$/)).toHaveLength(44);
    // the week strip is gone (risk 2: dropped)
    expect(screen.queryByRole("group", { name: SCHEDULE_COPY.week })).toBeNull();
  });

  it("each group says how many it holds", async () => {
    renderAt("/portal/coach/schedule");
    const list = await screen.findByTestId("visit-list");
    const count = (g: string) => within(list.querySelector(`[data-group="${g}"]`) as HTMLElement).getAllByTestId("section-count")[0].textContent;
    expect(count("overdue")).toBe("2");
    expect(count("today")).toBe("3");
    expect(count("coming")).toBe("2");
    expect(count("earlier")).toBe("44");
  });

  it("an overdue or today's visit: Start recording (its record step) and Cancel visit; coming up: Reschedule and Cancel visit", async () => {
    renderAt("/portal/coach/schedule");
    await screen.findByTestId("visit-list");
    const rabia = screen.getByTestId("visit-o1");
    expect(within(rabia).getByRole("link", { name: /Start recording/ })).toHaveAttribute("href", "/portal/coach/visit/o1/record");
    expect(within(rabia).getByRole("button", { name: /Cancel visit/ })).toBeInTheDocument();
    expect(within(rabia).getByText("5 days late")).toBeInTheDocument();
    const kiran = screen.getByTestId("visit-t2");
    expect(within(kiran).getByRole("link", { name: /Start recording/ })).toHaveAttribute("href", "/portal/coach/visit/t2/record");
    const huma = screen.getByTestId("visit-c1");
    expect(within(huma).queryByRole("link", { name: /Start recording/ })).toBeNull();
    const reschedule = within(huma).getByRole("link", { name: /Reschedule/ });
    expect(reschedule.getAttribute("href")).toMatch(/^\/portal\/coach\/new-visit\?/);
    expect(reschedule.getAttribute("href")).toContain("visit=c1");
    expect(within(huma).getByRole("button", { name: /Cancel visit/ })).toBeInTheDocument();
  });

  it("the row buttons leave room for two Nastaliq lines (Urdu Start recording wraps; it spilled out on sandbox)", async () => {
    renderAt("/portal/coach/schedule");
    await screen.findByTestId("visit-list");
    const row = screen.getByTestId("visit-t2");
    for (const el of [within(row).getByRole("link", { name: /Start recording/ }), within(row).getByRole("button", { name: /Cancel visit/ })]) {
      expect(el.className.split(/\s+/)).toEqual(expect.arrayContaining(["min-h-[56px]", "py-2", "leading-tight", "rtl:leading-[1.8]"]));
    }
  });

  it("a done visit has no buttons and opens its observation", async () => {
    renderAt("/portal/coach/schedule");
    await screen.findByTestId("visit-list");
    const farah = screen.getByText("Farah Naz").closest("a") as HTMLElement;
    expect(farah).toHaveAttribute("href", "/portal/coach/observation/sess-farah");
    expect(screen.getByText("Done Teacher 0").closest("a")).toHaveAttribute("href", "/portal/coach/observation/sess-0");
    expect(within(screen.getByTestId("visit-t1")).queryByRole("button", { name: /Cancel visit/ })).toBeNull();
  });

  it("Start recording on a row is counted (schedule.start)", async () => {
    renderAt("/portal/coach/schedule");
    await screen.findByTestId("visit-list");
    fireEvent.click(within(screen.getByTestId("visit-t2")).getByRole("link", { name: /Start recording/ }));
    expect(trackFlow).toHaveBeenCalledWith("schedule.start");
  });

  it("New visit in the dock; Team schedule as a row; the way back to WhatsApp on top", async () => {
    renderAt("/portal/coach/schedule");
    await screen.findByTestId("visit-list");
    expect(screen.getByRole("link", { name: /New visit/ })).toHaveAttribute("href", "/portal/coach/new-visit");
    expect(screen.getByRole("link", { name: /Team schedule/ })).toHaveAttribute("href", "/portal/coach/team");
    expect(screen.getByTestId("continue-on-whatsapp")).toBeInTheDocument();
  });

  it("no visits at all: one slim row, never an empty card", async () => {
    C.getSchedule.mockResolvedValue({ success: true, from: today, to: today, overdue: [], visits: [] });
    renderAt("/portal/coach/schedule");
    expect(await screen.findByText(SCHEDULE_COPY.noVisits)).toBeInTheDocument();
  });
});

describe("Cancel visit on a row: asks, then the visit leaves the list", () => {
  it("Cancel visit opens the tray (Keep visit / Cancel visit); Keep closes it and nothing is sent", async () => {
    renderAt("/portal/coach/schedule");
    await screen.findByTestId("visit-list");
    fireEvent.click(within(screen.getByTestId("visit-t3")).getByRole("button", { name: /Cancel visit/ }));
    const tray = await screen.findByRole("dialog");
    expect(within(tray).getByText(/Asma Batool/)).toBeInTheDocument();
    expect(trackFlow).toHaveBeenCalledWith("schedule.cancel_tap");
    fireEvent.click(within(tray).getByRole("button", { name: OBSERVE_COPY.keepVisit }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(L.cancelSchedule).not.toHaveBeenCalled();
    expect(screen.getByTestId("visit-t3")).toBeInTheDocument();
  });

  it("confirm: the same server cancel as the visit page (leader.cancelSchedule), then the row is gone", async () => {
    L.cancelSchedule.mockResolvedValue({ success: true, cancelled: true });
    renderAt("/portal/coach/schedule");
    await screen.findByTestId("visit-list");
    fireEvent.click(within(screen.getByTestId("visit-t3")).getByRole("button", { name: /Cancel visit/ }));
    const tray = await screen.findByRole("dialog");
    fireEvent.click(within(tray).getByRole("button", { name: OBSERVE_COPY.cancelVisit }));
    await waitFor(() => expect(L.cancelSchedule).toHaveBeenCalledWith("t3"));
    await waitFor(() => expect(screen.queryByTestId("visit-t3")).toBeNull());
    expect(trackFlow).toHaveBeenCalledWith("schedule.cancel_confirm");
    // the rest stay, and Today counts one fewer
    expect(screen.getByTestId("visit-t2")).toBeInTheDocument();
    const todayGroup = screen.getByTestId("visit-list").querySelector('[data-group="today"]') as HTMLElement;
    expect(within(todayGroup).getAllByTestId("section-count")[0].textContent).toBe("2");
  });

  it("the server refuses: the tray closes and the visit stays", async () => {
    L.cancelSchedule.mockRejectedValue(new Error("400"));
    renderAt("/portal/coach/schedule");
    await screen.findByTestId("visit-list");
    fireEvent.click(within(screen.getByTestId("visit-o2")).getByRole("button", { name: /Cancel visit/ }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: OBSERVE_COPY.cancelVisit }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByTestId("visit-o2")).toBeInTheDocument();
  });
});

describe("old addresses, switch on: WhatsApp and old links keep working", () => {
  it.each([
    ["/portal/coach/scheduling", "/portal/coach/schedule"],
    ["/portal/coach/observe/pick", "/portal/coach/schedule"],
    ["/portal/coach/observe", "/portal/coach/reports"],
  ])("%s → %s", async (from, to) => {
    renderAt(from);
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent(new RegExp(`^${to}$`)));
  });
});

describe("switch off: every coach screen exactly as today", () => {
  beforeEach(() => { flow.on = false; });

  it("/scheduling is the three-tile hub", async () => {
    renderAt("/portal/coach/scheduling");
    expect(await screen.findByRole("link", { name: /My schedule/ })).toHaveAttribute("href", "/portal/coach/schedule");
    expect(screen.getByTestId("where")).toHaveTextContent(/^\/portal\/coach\/scheduling$/);
  });

  it("/schedule is My schedule with its week strip, no buttons on the rows", async () => {
    C.getSchedule.mockResolvedValue({ success: true, from: today, to: addDays(today, 6), overdue: [], visits: [v("t2", today, "10:00", "upcoming", "Kiran Shahzadi")] });
    renderAt("/portal/coach/schedule");
    expect(await screen.findByText("Kiran Shahzadi")).toBeInTheDocument();
    expect(screen.queryByTestId("visit-list")).toBeNull();
    expect(screen.queryByRole("button", { name: /Cancel visit/ })).toBeNull();
    expect(screen.getByRole("heading", { name: SCHEDULE_COPY.mySchedule })).toBeInTheDocument();
  });

  it("/observe is the Observe hub and /observe/pick keeps its Earlier fold", async () => {
    renderAt("/portal/coach/observe/pick");
    const fold = await screen.findByRole("button", { expanded: false });
    expect(fold).toHaveTextContent(OBSERVE_COPY.earlier);
    expect(screen.getByTestId("where")).toHaveTextContent(/^\/portal\/coach\/observe\/pick$/);
  });

  it("while the switch is read (null), nothing redirects", async () => {
    flow.on = null;
    renderAt("/portal/coach/observe");
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.getByTestId("where")).toHaveTextContent(/^\/portal\/coach\/observe$/);
  });
});

/* ── New visit: the teaching-level chips ──────────────────────────────────────────────────────────────────────────── */

const teacher = (id: string, school: string, levels: string[]) => ({
  teacherExtId: id, name: `Teacher ${id}`, phone: null, schoolName: school === "S1" ? "IMS G-7/3" : "IMCB G-10/4", emis: null, schoolExtId: school,
  hitl: 0, dc: 0, avgHitl: null, daysSinceTraining: null, daysSinceVisit: null, levels,
});
function people(teachers: ReturnType<typeof teacher>[]) {
  return {
    success: true,
    schools: [
      { schoolExtId: "S1", name: "IMS G-7/3", teachers: teachers.filter((t) => t.schoolExtId === "S1").length, daysSinceVisit: 41 },
      { schoolExtId: "S2", name: "IMCB G-10/4", teachers: teachers.filter((t) => t.schoolExtId === "S2").length, daysSinceVisit: 3 },
    ],
    teachers,
  };
}
const MIXED = [teacher("a", "S1", ["PRIMARY"]), teacher("b", "S1", ["PRIMARY"]), teacher("c", "S1", ["MIDDLE"]), teacher("d", "S2", ["HIGH"]), teacher("e", "S2", ["MIDDLE", "HIGH"])];

describe("New visit, switch on: All · Primary · Middle · High", () => {
  it("step 1: the chips; Primary keeps only schools with Primary teachers, counted at that level, and the link carries it", async () => {
    C.getPeople.mockResolvedValue(people(MIXED));
    renderAt("/portal/coach/new-visit");
    const chips = await screen.findByTestId("level-chips");
    expect(within(chips).getAllByRole("radio").map((b) => b.textContent)).toEqual(["All", "Primary", "Middle", "High"]);
    expect(screen.getByText("IMCB G-10/4")).toBeInTheDocument();
    fireEvent.click(within(chips).getByRole("radio", { name: "Primary" }));
    await waitFor(() => expect(screen.queryByText("IMCB G-10/4")).toBeNull());
    const row = screen.getByText("IMS G-7/3").closest("a") as HTMLElement;
    expect(row).toHaveTextContent("2 teachers");
    expect(row.getAttribute("href")).toContain("level=primary");
    expect(trackFlow).toHaveBeenCalledWith("new_visit.level", "primary");
  });

  it("step 2 keeps the level: only that school's teachers at it", async () => {
    C.getPeople.mockResolvedValue(people(MIXED));
    renderAt("/portal/coach/new-visit?school=S2&level=high");
    await screen.findByTestId("level-chips");
    expect(screen.getByTestId("teacher-d")).toBeInTheDocument();
    expect(screen.getByTestId("teacher-e")).toBeInTheDocument();
    fireEvent.click(within(screen.getByTestId("level-chips")).getByRole("radio", { name: "Middle" }));
    await waitFor(() => expect(screen.queryByTestId("teacher-d")).toBeNull());
    expect(screen.getByTestId("teacher-e")).toBeInTheDocument();
    expect(screen.getByTestId("where")).toHaveTextContent("level=middle");
  });

  it("fewer than nine in ten of her teachers have a level (GB today): no chips, every school", async () => {
    C.getPeople.mockResolvedValue(people([teacher("a", "S1", ["PRIMARY"]), teacher("b", "S1", []), teacher("c", "S2", []), teacher("d", "S2", ["HIGH"])]));
    renderAt("/portal/coach/new-visit");
    expect(await screen.findByText("IMCB G-10/4")).toBeInTheDocument();
    expect(screen.queryByTestId("level-chips")).toBeNull();
  });

  it("switch off: no chips", async () => {
    flow.on = false;
    C.getPeople.mockResolvedValue(people(MIXED));
    renderAt("/portal/coach/new-visit");
    expect(await screen.findByText("IMCB G-10/4")).toBeInTheDocument();
    expect(screen.queryByTestId("level-chips")).toBeNull();
  });
});

describe("words", () => {
  it("1 day late, not 1 days late (both lists)", () => {
    expect(SCHEDULE_COPY.daysLate(1)).toBe("1 day late");
    expect(SCHEDULE_COPY.daysLate(3)).toBe("3 days late");
    expect(OBSERVE_COPY.daysLate(1)).toBe("1 day late");
    expect(OBSERVE_COPY.daysLate(4)).toBe("4 days late");
  });
});
