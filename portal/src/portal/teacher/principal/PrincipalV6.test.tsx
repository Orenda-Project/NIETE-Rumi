import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

/**
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

describe("a principal, v6 on: Pick the teacher → When?", () => {
  it("When? with Schedule for Now and Schedule for Later; never him or her", async () => {
    renderAt(`${P}/new-visit?teacher=900001`);
    const now = await screen.findByTestId("when-now");
    expect(within(now).getByText("Schedule for Now")).toBeInTheDocument();
    expect(within(now).getByText("Ayesha Sample gets no message.")).toBeInTheDocument();
    expect(within(screen.getByTestId("when-later")).getByRole("link", { name: /Pick day and time/ }))
      .toHaveAttribute("href", `${P}/new-visit?teacher=900001&when=later`);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Schedule an observation");
    expect(document.body.textContent).not.toMatch(/\b(her|him|his|she|he)\b/i);
  });

  it("Now · Start recording: the principal's record screen for that teacher, no booking", async () => {
    renderAt(`${P}/new-visit?teacher=900001`);
    fireEvent.click(await screen.findByRole("button", { name: /Start recording/ }));
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent(`${P}/observe/900001/record`));
    expect(api.leader.createSchedule).not.toHaveBeenCalled();
  });

  it("Now · Upload recording: the upload screen, no booking", async () => {
    renderAt(`${P}/new-visit?teacher=900001`);
    fireEvent.click(await screen.findByRole("button", { name: /Upload recording/ }));
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent(`${P}/observe/900001/attach`));
    expect(api.leader.createSchedule).not.toHaveBeenCalled();
  });

  it("Later: the day and time, the teacher told by WhatsApp, then Observation scheduled with links in the principal's app", async () => {
    renderAt(`${P}/new-visit?teacher=900001&when=later`);
    await screen.findByTestId("time-picker");
    expect(screen.getByText("Ayesha Sample gets a WhatsApp message.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Schedule$/ }));
    await waitFor(() => expect(api.leader.createSchedule).toHaveBeenCalledWith({ teacherExtId: "900001", date: expect.any(String), slot: "09:00" }));
    expect(await screen.findByText("Observation scheduled")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Schedule another/ })).toHaveAttribute("href", `${P}/pick`);
    // bd-o15qnr.29 (the operator 21 Nov ~08:50): "They should land on the homepage of obsevrations", never the old My schedule
    expect(screen.getByRole("link", { name: "Done" })).toHaveAttribute("href", "/portal/teacher/observations");
  });

  it("switch off: the day and time at once (production)", async () => {
    flow.on = false;
    renderAt(`${P}/new-visit?teacher=900001`);
    expect(await screen.findByTestId("time-picker")).toBeInTheDocument();
    expect(screen.queryByTestId("when-now")).toBeNull();
  });
});
