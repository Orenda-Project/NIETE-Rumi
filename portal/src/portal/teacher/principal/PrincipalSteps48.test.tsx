import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

/**
 * bd-o15qnr.48 (queue #244, the 390 px walk on sandbox) — the principal's When? and Later (day and time) said "Step 3 of 3"
 * with three filled bars, though she never sees steps 1 and 2 (Pick the teacher has no step bar: she has one school).
 * Her booking screens now draw no step bar; the coach's three steps are unchanged (CoachNewVisit.test.tsx).
 *
 * Setup copied from PrincipalV6.test.tsx (bd-o15qnr.27).
 * bd-o15qnr.27 (queue #204, v6) — principals on the portal (the operator 20 Nov ~14:40: "For the Coach and the Principal
 * both, we need to get this HITL feature live"; ~14:50: "On Portal. We can even ignore the WhatsApp one for
 * Principals."). With the v6 switch on for a principal on the principal app (`features.principalFlowV2`), Pick the
 * teacher → When?:
 *   Schedule for Now     straight to the principal's record / upload screen for that teacher: no booking, so the teacher
 *                        gets no message (the principal app never made a visit row for an observation)
 *   Schedule for Later   the coach's day-and-time step, the booking and its WhatsApp message, then "Observation scheduled"
 * Switch off: the day-and-time step at once, as on production.
 */

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("../../coach/CoachGate", () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: () => ({ user: { firstName: "Hina", role: "principal", phoneNumber: "923001234567" }, loading: false }) }));
const api = vi.hoisted(() => ({
  coach: { getSchedule: vi.fn(), editSchedule: vi.fn(), handoff: vi.fn(() => Promise.resolve({ code: null })) },
  leader: { createSchedule: vi.fn() },
}));
vi.mock("../../services/api", () => ({ default: { get: vi.fn(), post: vi.fn() }, ...api }));
const visitOf = vi.hoisted(() => vi.fn());
vi.mock("./observe", async (orig) => ({ ...(await orig<typeof import("./observe")>()), principalVisit: visitOf }));
const flow = vi.hoisted(() => ({ on: true as boolean | null }));
vi.mock("../../coach/flow/useCoachFlowV2", async (orig) => ({
  ...(await orig<object>()), useFlowV6: () => flow.on, useFlowV2: () => false, useCoachFlowV2: () => false,
}));
vi.mock("../../coach/flow/track", () => ({ trackFlow: vi.fn() }));

import { PrincipalNewVisit } from "./NewVisit";

vi.setConfig({ testTimeout: 40_000 });
const TODAY = new Date().toISOString().slice(0, 10);
const P = "/portal/teacher/principal";

function Where() {
  const { pathname, search } = useLocation();
  return <p data-testid="where">{`${pathname}${search}`}</p>;
}
const renderAt = (path: string) => render(
  <MemoryRouter initialEntries={[path]}>
    <Where />
    <Routes>
      <Route path={`${P}/new-visit`} element={<PrincipalNewVisit />} />
      <Route path="*" element={<p data-testid="other">other</p>} />
    </Routes>
  </MemoryRouter>,
);

beforeEach(() => {
  vi.clearAllMocks();
  flow.on = true;
  visitOf.mockResolvedValue({
    visit: { id: "900001", teacherExtId: "900001", teacherName: "Ayesha Sample", schoolName: "GGPS Sample", schoolExtId: "niete:1126", scheduledFor: TODAY, scheduledSlot: null, status: "upcoming" },
  });
  api.coach.getSchedule.mockResolvedValue({ success: true, from: TODAY, to: TODAY, overdue: [], visits: [] });
  api.leader.createSchedule.mockResolvedValue({ success: true, id: "sched-1" });
});

describe("a principal\'s booking screens: no step count she never walked", () => {
  it("When?: no 'Step 3 of 3' and no step bar", async () => {
    renderAt(`${P}/new-visit?teacher=900001`);
    await screen.findByTestId("when-now");
    expect(screen.queryByText(/Step \d of \d/)).toBeNull();
  });

  it("Later (day and time): no 'Step 3 of 3' either", async () => {
    renderAt(`${P}/new-visit?teacher=900001&when=later`);
    await screen.findByRole("heading", { level: 1 });
    await waitFor(() => expect(document.body.textContent).toMatch(/Ayesha Sample/));
    expect(screen.queryByText(/Step \d of \d/)).toBeNull();
  });
});
