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
vi.mock("./useCoachFlowV2", () => ({ useFlowV2: () => flow.on, useCoachFlowV2: () => flow.on, coachFlowV2On: () => flow.on === true, useFlowV6: () => false }));
// bd-3xf7vb.1 (#217): every Observe frame now reads useFlowV6 for its "?"; off here, so these screens are as tested.

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

/*
 * bd-o15qnr.27 (queue #204): the Observe screen and "Start an observation" (book-now mode) are v6 now: Schedule an
 * observation → school → teacher → Schedule for Now / Schedule for Later. Their tests are in ./v6.test.tsx.
 */

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
