import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, within, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Round 7b (sa_end_test_restart): a child the coach ended stays on the list with Restart test, which opens a NEW attempt
// (a new phone id, `restart: true` to the server) for that child. OFF: Stopped with no button, as before.

vi.mock("../components/PortalLayout", () => ({ default: ({ children }: any) => <div>{children}</div> }));
vi.mock("../lib/keepAwake", () => ({ keepScreenOn: vi.fn().mockResolvedValue(async () => {}) }));
vi.mock("../services/api", () => ({
  portal: { getConfig: vi.fn() },
  childTestSa: { getSchools: vi.fn(), getList: vi.fn(), markOutcome: vi.fn(), getStatus: vi.fn(), mintLink: vi.fn(), getSwitches: vi.fn(), addChild: vi.fn() },
}));

import { portal, childTestSa } from "../services/api";
import LeaderAssess from "./LeaderAssess";

const api = childTestSa as any;
const FIRST = ["Ayan", "Bilal", "Dua", "Esha", "Fiza"];
const child = (n: number) => ({
  drawId: `d${n}`, name: `${FIRST[n - 1]} Testwala`, nameUr: null, firstName: FIRST[n - 1], firstNameUr: null, grade: 3, section: "A",
  classLabel: "Grade 3 - A", classLabelUr: null, teacherName: "Saima Testwala", status: "listed", childNo: n, role: "new", namesake: false,
});
const LIST = { visit: { visitId: "v2", visitKey: null }, cycleId: "C1", grade: 3, gradeFallback: false, reused: false, children: [1, 2, 3, 4, 5].map(child), alternates: [] };
const SW = { handbackV2: false, micRequired: false, coachPicksBlock: false, rdfForm: false, resultsView: false };

beforeEach(() => {
  vi.clearAllMocks();
  try { window.localStorage.clear(); window.localStorage.setItem("niete-assess-lang", "en"); } catch { /* none */ }
  (portal.getConfig as any).mockResolvedValue({ features: { childTestSa: true } });
  api.getSchools.mockResolvedValue({ schools: [{ schoolId: "s2", name: "School Beta", visitId: "v2", observedGrade: 3, visitToday: true }] });
  api.getList.mockResolvedValue({ list: LIST });
  api.markOutcome.mockResolvedValue({ sessionId: "server-1" });
  api.getStatus.mockResolvedValue({ session: { id: "x", status: "started", grade: 3, form: "f" }, block: "B1", lastSeq: 0, tasksDone: [], audio: [] });
});
afterEach(() => { vi.useRealTimers(); });

async function openAndEnd() {
  render(<MemoryRouter><LeaderAssess /></MemoryRouter>);
  fireEvent.click(await screen.findByTestId("assess-school-s2"));
  const ready = screen.queryByTestId("assess-preflight-ready");
  if (ready) fireEvent.click(ready);
  await screen.findByText("Ayan Testwala");
  fireEvent.click(within(screen.getByTestId("assess-child-d1")).getByRole("button", { name: "Present" }));
  fireEvent.click(await screen.findByRole("button", { name: "Start" }));
  const frame = (await screen.findByTestId("assess-engine-frame")) as HTMLIFrameElement;
  const s = new URL(frame.getAttribute("src") as string, "http://x").searchParams.get("s") as string;
  act(() => { window.dispatchEvent(new MessageEvent("message", { data: { type: "sa:done", s, reason: "coach_end" }, origin: window.location.origin })); });
  return s;
}

describe("LeaderAssess round 7b: Restart test", () => {
  it("ON: the ended child stays with Restart test; it opens a new attempt with restart: true and a new phone id", async () => {
    api.getSwitches.mockResolvedValue({ ...SW, endTestRestart: true });
    const first = await openAndEnd();
    const row = await screen.findByTestId("assess-child-d1");
    expect(row).toHaveTextContent("Stopped");
    expect(screen.getByTestId("assess-stopped")).toHaveTextContent("Tap Restart test to begin again.");
    fireEvent.click(within(row).getByRole("button", { name: "Restart test" }));
    fireEvent.click(await screen.findByRole("button", { name: "Start" }));
    const frame = (await screen.findByTestId("assess-engine-frame")) as HTMLIFrameElement;
    const second = new URL(frame.getAttribute("src") as string, "http://x").searchParams.get("s") as string;
    expect(second).not.toBe(first);
    await waitFor(() => expect(api.markOutcome).toHaveBeenCalledTimes(2));
    expect(api.markOutcome.mock.calls[1][0]).toMatchObject({ drawId: "d1", outcome: "present", clientSessionId: second, restart: true });
    expect(api.markOutcome.mock.calls[0][0].restart).toBeUndefined();
  });

  it("OFF: Stopped with no Restart test", async () => {
    api.getSwitches.mockResolvedValue(SW);
    await openAndEnd();
    const row = await screen.findByTestId("assess-child-d1");
    expect(row).toHaveTextContent("Stopped");
    expect(within(row).queryByRole("button", { name: "Restart test" })).toBeNull();
  });
});
