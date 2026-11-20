import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

/**
 * bd-slknzt (queue #203) — the principal's booking screens (bd-31ziu8: New visit, My schedule) are the coach's own, drawn
 * in CoachPage. CoachPage always wrapped CoachGate, which admits only a coach, so a principal who tapped a teacher on
 * Pick the teacher was sent to /portal/leader and on to Home (operator, 20 Nov, demo prep). Inside the principal app's
 * routes (PrincipalObserve: coachGate false, as for ObservePage) CoachPage skips the coach gate; the coach app keeps it.
 *
 * Unlike PrincipalBooking.test.tsx, the coach gate is NOT mocked away here: it is what this suite is about.
 */

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("../../coach/useCoachV2", async (orig) => ({ ...(await orig<object>()), useCoachV2: vi.fn() }));
const api = vi.hoisted(() => ({
  coach: { getSchedule: vi.fn(), editSchedule: vi.fn(), getPending: vi.fn() },
  leader: { createSchedule: vi.fn() },
  language: { get: vi.fn(() => new Promise(() => {})) },
}));
vi.mock("../../services/api", () => ({ default: { get: vi.fn(), post: vi.fn() }, ...api }));
const visitOf = vi.hoisted(() => vi.fn());
vi.mock("./observe", async (orig) => ({ ...(await orig<typeof import("./observe")>()), principalVisit: visitOf }));

import { useAuth } from "../../hooks/useAuth";
import { useCoachV2 } from "../../coach/useCoachV2";
import { ObserveRoutesProvider } from "../../coach/observe/observeRoutes";
import { PRINCIPAL_OBSERVE_ROUTES } from "./observe";
import { PrincipalNewVisit } from "./NewVisit";
import { PrincipalSchedule } from "./Schedule";

vi.setConfig({ testTimeout: 40_000 });
const TODAY = new Date().toISOString().slice(0, 10);
const PRINCIPAL = { firstName: "Saima Sample", role: "principal", phoneNumber: "test-principal-1" };

function renderAs(user: Record<string, unknown>, at: string, principalApp: boolean) {
  vi.mocked(useAuth).mockReturnValue({ user, loading: false } as unknown as ReturnType<typeof useAuth>);
  // the coach-v2 flag is on for her (as for the demo accounts): the gate still refuses a non-coach
  vi.mocked(useCoachV2).mockReturnValue(true);
  const screens = (
    <Routes>
      <Route path="/portal/teacher/principal/new-visit" element={<PrincipalNewVisit />} />
      <Route path="/portal/teacher/principal/schedule" element={<PrincipalSchedule />} />
      <Route path="/portal/leader" element={<div>bounced to my patch</div>} />
    </Routes>
  );
  return render(
    <MemoryRouter initialEntries={[at]}>
      {principalApp ? <ObserveRoutesProvider value={PRINCIPAL_OBSERVE_ROUTES}>{screens}</ObserveRoutesProvider> : screens}
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  visitOf.mockResolvedValue({
    visit: { id: "900001", teacherExtId: "900001", teacherName: "Ayesha Sample", schoolName: "GGPS Sample", schoolExtId: "niete:1126", scheduledFor: TODAY, scheduledSlot: null, status: "upcoming" },
  });
  api.coach.getSchedule.mockResolvedValue({ success: true, from: TODAY, to: TODAY, overdue: [], visits: [] });
  api.coach.getPending.mockResolvedValue({ waiting: 2, ids: [] });
});

describe("a principal on the principal app reaches the booking screens (not bounced Home)", () => {
  it("Pick the teacher → New visit: the day and time step, not My Patch", async () => {
    renderAs(PRINCIPAL, "/portal/teacher/principal/new-visit?teacher=900001", true);
    await waitFor(() => expect(screen.getByTestId("time-picker")).toBeTruthy());
    expect(screen.queryByText("bounced to my patch")).toBeNull();
    expect(visitOf).toHaveBeenCalledWith("900001");
  });

  it("My schedule: her schedule, not My Patch", async () => {
    renderAs(PRINCIPAL, "/portal/teacher/principal/schedule", true);
    await waitFor(() => expect(api.coach.getSchedule).toHaveBeenCalled());
    await waitFor(() => expect(document.querySelector('a[href="/portal/teacher/principal/pick"]')).toBeTruthy());
    expect(screen.queryByText("bounced to my patch")).toBeNull();
  });

  it("no coach 'reports waiting' banner on her booking screen (the coach's queue is not hers)", async () => {
    renderAs(PRINCIPAL, "/portal/teacher/principal/new-visit?teacher=900001", true);
    await waitFor(() => expect(screen.getByTestId("time-picker")).toBeTruthy());
    expect(api.coach.getPending).not.toHaveBeenCalled();
  });
});

describe("the coach app keeps its gate", () => {
  it("outside the principal app's routes a principal on a coach screen still goes to My Patch", async () => {
    renderAs(PRINCIPAL, "/portal/teacher/principal/new-visit?teacher=900001", false);
    await waitFor(() => expect(screen.getByText("bounced to my patch")).toBeTruthy());
    expect(screen.queryByTestId("time-picker")).toBeNull();
  });

  it("a coach with the flag still sees the coach's booking screen", async () => {
    renderAs({ role: "coach", phoneNumber: "test-coach-1" }, "/portal/teacher/principal/new-visit?teacher=900001", false);
    await waitFor(() => expect(screen.getByTestId("time-picker")).toBeTruthy());
    expect(screen.queryByText("bounced to my patch")).toBeNull();
  });
});
