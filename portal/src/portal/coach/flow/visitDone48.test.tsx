import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

/**
 * bd-o15qnr.48 (queue #244, the 390 px sanity walk on sandbox, 24 Nov) — a visit she has already sent. Back from
 * "Observation sent" (CoachSending's back is the visit) landed on the visit page, which said only "Done" and offered
 * the PREVIOUS visit's "Last observation" row: no way to the observation she had just sent. On the switch, a done visit
 * that has its observation (`sessionId`) now has one row to it, "Open observation", before the teacher's card. Off the
 * switch the page is unchanged.
 */

vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: { children: unknown }) => <div>{children as never}</div> }));
vi.mock("../CoachGate", () => ({ default: ({ children }: { children: unknown }) => <>{children as never}</> }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: () => ({ user: { firstName: "Hataf", role: "coach", phoneNumber: "923001234567" }, loading: false }) }));
vi.mock("../../services/api", () => ({
  coach: { getVisit: vi.fn(), getPending: vi.fn() },
  leader: { cancelSchedule: vi.fn(), getObservation: vi.fn() },
  portal: { uploadToR2: vi.fn() },
}));
const flow = vi.hoisted(() => ({ on: true as boolean | null }));
vi.mock("./useCoachFlowV2", async (orig) => ({ ...(await orig<object>()), useFlowV6: () => flow.on, useFlowV2: () => flow.on, useCoachFlowV2: () => flow.on }));
vi.mock("../observe/sender", async (orig) => ({ ...(await orig<object>()), useSendJob: () => null, retrySend: vi.fn() }));

import { coach } from "../../services/api";
import CoachVisit from "../pages/CoachVisit";

vi.setConfig({ testTimeout: 30_000 });
const C = coach as unknown as Record<string, ReturnType<typeof vi.fn>>;
const VISIT = { id: "v1", teacherName: "Lubna Arif", teacherExtId: "923001110001", schoolName: "IMSG G-7/3", schoolExtId: "niete:110", scheduledFor: "2026-11-24", scheduledSlot: "03:30" };
const LAST = { id: "cs-old", date: "2026-11-05", byMe: true, observerName: null, score: null, step: "draft" };

const page = () => render(
  <MemoryRouter initialEntries={["/portal/coach/visit/v1"]}>
    <Routes>
      <Route path="/portal/coach/visit/:id" element={<CoachVisit />} />
      <Route path="/portal/coach/observation/:id" element={<div>observation page</div>} />
    </Routes>
  </MemoryRouter>,
);

beforeEach(() => { vi.clearAllMocks(); flow.on = true; });

describe("a done visit's page", () => {
  it("on the switch: one row, 'Open observation', to THIS visit's observation", async () => {
    C.getVisit.mockResolvedValue({ success: true, teacher: null, lastVisit: LAST, visit: { ...VISIT, status: "done", sessionId: "cs-9" } });
    page();
    const row = await screen.findByTestId("visit-open-observation");
    expect(row).toHaveTextContent("Open observation");
    expect(row.getAttribute("href")).toBe("/portal/coach/observation/cs-9");
    fireEvent.click(row);
    expect(await screen.findByText("observation page")).toBeTruthy();
  });

  it("no observation tied to it yet, or still upcoming: no such row", async () => {
    C.getVisit.mockResolvedValue({ success: true, teacher: null, lastVisit: LAST, visit: { ...VISIT, status: "done", sessionId: null } });
    const a = page();
    await screen.findByTestId("teacher-card");
    expect(screen.queryByTestId("visit-open-observation")).toBeNull();
    a.unmount();
    C.getVisit.mockResolvedValue({ success: true, teacher: null, lastVisit: LAST, visit: { ...VISIT, status: "upcoming", sessionId: null } });
    page();
    await screen.findByTestId("teacher-card");
    expect(screen.queryByTestId("visit-open-observation")).toBeNull();
  });

  it("off the switch: unchanged (no row)", async () => {
    flow.on = false;
    C.getVisit.mockResolvedValue({ success: true, teacher: null, lastVisit: LAST, visit: { ...VISIT, status: "done", sessionId: "cs-9" } });
    page();
    await screen.findByTestId("teacher-card");
    expect(screen.queryByTestId("visit-open-observation")).toBeNull();
  });
});
