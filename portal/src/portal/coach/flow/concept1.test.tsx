import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

/**
 * bd-o15qnr.26 (queue #177, rebuilt to #188's Concept 1 "Today and Needs you", the operator 19 Nov ~19:45) — behind
 * portal_coach_flow_v2 (fail-closed). ONE short Observe screen:
 *
 *   Start an observation   a big button: pick the school and the teacher, then record (booked for now, no day-and-time step)
 *   Booked for today       today's visits still to do, each with Record (one tap to its record step)
 *   Needs you              observations waiting on her, OLDEST first, three shown, See all N
 *   two rows               Booked visits (late, today, ahead) and History (her observations)
 *
 * New visit, switch on: no last-visit legend, no Profile button (the operator on the canvas).
 */

vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: any) => <div>{children}</div> }));
vi.mock("../CoachGate", () => ({ default: ({ children }: any) => <>{children}</> }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: () => ({ user: { firstName: "Hina", role: "coach", phoneNumber: "923001234567" }, loading: false }) }));
vi.mock("../../services/api", () => ({
  coach: { getHome: vi.fn(), getSchedule: vi.fn(), getTeam: vi.fn(), getPeople: vi.fn(), getReports: vi.fn(), handoff: vi.fn(() => Promise.resolve({ code: null })) },
  leader: { cancelSchedule: vi.fn(), createSchedule: vi.fn() },
}));
vi.mock("./track", () => ({ trackFlow: vi.fn() }));
vi.mock("@/lib/whatsapp", async (orig) => ({ ...(await orig<object>()), useBotNumber: () => "923000000000" }));
const flow = vi.hoisted(() => ({ on: true as boolean | null }));
vi.mock("./useCoachFlowV2", () => ({ useFlowV2: () => flow.on, useCoachFlowV2: () => flow.on, coachFlowV2On: () => flow.on === true }));

import { coach, leader } from "../../services/api";
import { trackFlow } from "./track";
import { karachiDay, karachiSlotNow } from "../time";
import { addDays } from "../../teacher/ui";
import { ObserveRoute } from "./routes";
import CoachNewVisit from "../pages/CoachNewVisit";

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
        <Route path="/portal/coach/observe" element={<ObserveRoute />} />
        <Route path="/portal/coach/new-visit" element={<CoachNewVisit />} />
        <Route path="*" element={<p data-testid="other">other</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

const today = karachiDay();
const v = (id: string, day: string, slot: string, status: string, name: string, extra: Record<string, unknown> = {}) => ({
  id, teacherName: name, schoolName: "IMCB G-8/4", schoolExtId: "S2", teacherExtId: `t-${id}`, scheduledFor: day, scheduledSlot: slot, status, ...extra,
});
const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString();
const report = (id: string, name: string, step: string, ago: number) => ({
  id, createdAt: daysAgo(ago), teacherName: name, teacherPhone: null, teacherExtId: null, schoolName: "IMSG G-7/3", schoolExtId: null,
  status: "x", step, score: null, portal: true,
});

beforeEach(() => {
  vi.clearAllMocks();
  flow.on = true;
  C.getPeople.mockResolvedValue({ success: true, schools: [], teachers: [] });
  C.getSchedule.mockResolvedValue({
    success: true, from: today, to: today,
    overdue: [v("o1", addDays(today, -6), "10:00", "upcoming", "Rabia Nawaz", { overdue: true }), v("o2", addDays(today, -2), "11:30", "upcoming", "Sumaira Akhtar", { overdue: true })],
    visits: [v("t1", today, "08:30", "done", "Farah Naz"), v("t2", today, "10:30", "upcoming", "Kiran Shahzadi"), v("t3", today, "12:00", "upcoming", "Asma Batool")],
  });
  C.getReports.mockResolvedValue({
    success: true,
    waiting: [report("r1", "Saima Riaz", "draft", 0.5), report("r2", "Lubna Arif", "talk", 17), report("r3", "Huma Ijaz", "talk", 1), report("r4", "Ambreen Gul", "report", 3)],
    inProgress: [],
    all: { total: 38, page: 1, pageSize: 20, items: [] },
  });
});

describe("Observe, switch on: Today and Needs you, one short screen", () => {
  it("a big Start an observation, into New visit's book-now mode, counted", async () => {
    renderAt("/portal/coach/observe");
    const start = await screen.findByRole("link", { name: /Start an observation/ });
    expect(start).toHaveAttribute("href", "/portal/coach/new-visit?now=1");
    fireEvent.click(start);
    expect(trackFlow).toHaveBeenCalledWith("observe.start");
  });

  it("asks only for today (and the late ones the server adds), never the month", async () => {
    renderAt("/portal/coach/observe");
    await screen.findByTestId("observe-today");
    expect(C.getSchedule).toHaveBeenCalledWith({ from: today, to: today });
    expect(C.getReports).toHaveBeenCalledWith({ page: 1 });
  });

  it("Booked for today: today's visits still to do, each with Record to its record step; done and late ones are not here", async () => {
    renderAt("/portal/coach/observe");
    const booked = await screen.findByTestId("booked-today");
    expect(within(booked).getByText("Kiran Shahzadi")).toBeInTheDocument();
    expect(within(booked).getByText("Asma Batool")).toBeInTheDocument();
    expect(within(booked).queryByText("Farah Naz")).toBeNull();
    expect(within(booked).queryByText("Rabia Nawaz")).toBeNull();
    const records = within(booked).getAllByRole("link", { name: /Record/ });
    expect(records.map((a) => a.getAttribute("href"))).toEqual(["/portal/coach/visit/t2/record", "/portal/coach/visit/t3/record"]);
    fireEvent.click(records[0]);
    expect(trackFlow).toHaveBeenCalledWith("schedule.start");
  });

  it("Needs you: oldest first, three shown with how long each has waited and its step; See all 4", async () => {
    renderAt("/portal/coach/observe");
    const needs = await screen.findByTestId("needs-you");
    expect(within(needs).getAllByTestId("section-count")[0]).toHaveTextContent("4");
    const rows = within(needs).getAllByRole("link").filter((a) => (a.getAttribute("href") || "").startsWith("/portal/coach/observation/"));
    expect(rows.map((a) => a.getAttribute("href"))).toEqual(["/portal/coach/observation/r2", "/portal/coach/observation/r4", "/portal/coach/observation/r3"]);
    expect(rows[0]).toHaveTextContent("Lubna Arif");
    expect(rows[0]).toHaveTextContent("17 days waiting");
    expect(rows[0]).toHaveTextContent("Debrief");
    expect(rows[1]).toHaveTextContent("3 days waiting");
    expect(rows[2]).toHaveTextContent("Since yesterday");
    expect(within(needs).getByRole("link", { name: /See all 4/ })).toHaveAttribute("href", "/portal/coach/reports?show=waiting");
  });

  it("three or fewer waiting: no See all; none: one slim row", async () => {
    C.getReports.mockResolvedValue({ success: true, waiting: [], inProgress: [], all: { total: 0, page: 1, pageSize: 20, items: [] } });
    renderAt("/portal/coach/observe");
    const needs = await screen.findByTestId("needs-you");
    expect(within(needs).getByText("Nothing waiting")).toBeInTheDocument();
    expect(within(needs).queryByRole("link", { name: /See all/ })).toBeNull();
  });

  it("two rows: Booked visits (with how many are late) and History (with how many in all)", async () => {
    renderAt("/portal/coach/observe");
    await screen.findByTestId("observe-today");
    const booked = screen.getByRole("link", { name: /Booked visits/ });
    expect(booked).toHaveAttribute("href", "/portal/coach/schedule");
    expect(booked).toHaveTextContent("2 late");
    const history = screen.getByRole("link", { name: /History/ });
    expect(history).toHaveAttribute("href", "/portal/coach/reports");
    expect(history).toHaveTextContent("38 in all");
  });

  // Staging adapt: no #166 WhatsApp strip on this branch yet (ObservePage gets it when #166 lands).
});

/* ── Start an observation: New visit in book-now mode ─────────────────────────────────────────────────────────────── */

const teacher = (id: string, school: string) => ({
  teacherExtId: id, name: `Teacher ${id}`, phone: null, schoolName: "IMS G-7/3", emis: null, schoolExtId: school,
  hitl: 0, dc: 0, avgHitl: null, daysSinceTraining: null, daysSinceVisit: 41, levels: ["PRIMARY"],
});
const PEOPLE = {
  success: true,
  schools: [{ schoolExtId: "S1", name: "IMS G-7/3", teachers: 2, daysSinceVisit: 41 }],
  teachers: [teacher("a", "S1"), teacher("b", "S1")],
};

describe("Start an observation: school, teacher, then straight to recording", () => {
  beforeEach(() => { C.getPeople.mockResolvedValue(PEOPLE); });

  it("two steps, not three; the picks keep now=1", async () => {
    renderAt("/portal/coach/new-visit?now=1");
    expect(await screen.findByText("Step 1 of 2")).toBeInTheDocument();
    expect(screen.getByText("IMS G-7/3").closest("a")?.getAttribute("href")).toContain("now=1");
  });

  it("picking the teacher books her for now (today, this half hour) and opens the record step", async () => {
    C.getSchedule.mockResolvedValue({ success: true, from: today, to: today, overdue: [], visits: [] });
    L.createSchedule.mockResolvedValue({ success: true, id: "new-1" });
    renderAt("/portal/coach/new-visit?now=1&school=S1");
    const link = (await screen.findByTestId("teacher-a")).querySelector("a") as HTMLAnchorElement;
    expect(link.getAttribute("href")).toContain("now=1");
    fireEvent.click(link);
    await waitFor(() => expect(L.createSchedule).toHaveBeenCalledWith({ teacherExtId: "a", date: today, slot: karachiSlotNow() }));
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent(/^\/portal\/coach\/visit\/new-1\/record$/));
  });

  it("she is already booked today: no second booking, her visit's record step", async () => {
    C.getSchedule.mockResolvedValue({ success: true, from: today, to: today, overdue: [], visits: [{ ...v("t9", today, "09:00", "upcoming", "Teacher a"), teacherExtId: "a" }] });
    renderAt("/portal/coach/new-visit?now=1&school=S1&teacher=a");
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent(/^\/portal\/coach\/visit\/t9\/record$/));
    expect(L.createSchedule).not.toHaveBeenCalled();
  });

  it("the booking fails: she stays, with the reason and Try again", async () => {
    C.getSchedule.mockResolvedValue({ success: true, from: today, to: today, overdue: [], visits: [] });
    L.createSchedule.mockRejectedValue({ response: { data: { error: "Teacher not found" } } });
    renderAt("/portal/coach/new-visit?now=1&school=S1&teacher=a");
    expect(await screen.findByText("Teacher not found")).toBeInTheDocument();
    expect(screen.getByTestId("where")).toHaveTextContent("/portal/coach/new-visit");
  });
});

describe("New visit, switch on: the canvas's two removals", () => {
  beforeEach(() => { C.getPeople.mockResolvedValue(PEOPLE); });

  it("no last-visit legend and no 'Last visit' label (each row keeps its chip)", async () => {
    renderAt("/portal/coach/new-visit");
    await screen.findByText("IMS G-7/3");
    expect(screen.queryByTestId("since-legend")).toBeNull();
    expect(screen.queryByText("Last visit")).toBeNull();
    expect(screen.getByText("41 days ago")).toBeInTheDocument();
  });

  it("step 2: no Profile button on a teacher (the row picks her)", async () => {
    renderAt("/portal/coach/new-visit?school=S1");
    await screen.findByTestId("teacher-a");
    expect(screen.queryByRole("link", { name: "Profile" })).toBeNull();
    expect(screen.queryByText("Last visit")).toBeNull();
  });

  it("switch off: the legend, the label and Profile are all still there", async () => {
    flow.on = false;
    renderAt("/portal/coach/new-visit?school=S1");
    await screen.findByTestId("teacher-a");
    expect(screen.getAllByRole("link", { name: "Profile" }).length).toBe(2);
    expect(screen.getByText("Last visit")).toBeInTheDocument();
  });
});

describe("the time of now", () => {
  it("this half hour in Pakistan, whatever the phone's zone", () => {
    expect(karachiSlotNow(new Date("2026-11-19T05:47:00Z"))).toBe("10:30");
    expect(karachiSlotNow(new Date("2026-11-19T05:29:00Z"))).toBe("10:00");
    expect(karachiSlotNow(new Date("2026-11-19T18:59:00Z"))).toBe("23:30");
  });
});
