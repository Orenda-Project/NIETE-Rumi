import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within, act, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// The last recording: the coach page's hidden drain frame sends every session the phone holds, any school,
// any day. So it runs once when the page opens, with no new test and no child of this visit waiting (K1, K1b), and
// again while its answer left anything on the phone. A child the list calls completed is not 'sent' until this page's
// own status poll has answered (the list's 'completed' says nothing of the audio). The harness is LeaderAssess.test.tsx's.

vi.mock("../components/PortalLayout", () => ({ default: ({ children }: any) => <div>{children}</div> }));
vi.mock("../lib/keepAwake", () => ({ keepScreenOn: vi.fn().mockResolvedValue(async () => {}) }));
vi.mock("../services/api", () => ({
  portal: { getConfig: vi.fn() },
  childTestSa: { getSchools: vi.fn(), getList: vi.fn(), markOutcome: vi.fn(), getStatus: vi.fn(), mintLink: vi.fn(), getSwitches: vi.fn(), addChild: vi.fn() },
}));

import { portal, childTestSa } from "../services/api";
import LeaderAssess from "./LeaderAssess";
import { pickBlock } from "../lib/assess/blocks";

const api = childTestSa as any;
const FIRST = ["Ayan", "Bilal", "Dua", "Esha", "Fiza", "Faraz", "Hira", "Iqra"];
const child = (n: number, extra: any = {}) => ({
  drawId: `d${n}`, name: `${FIRST[n - 1]} Testwala`, nameUr: n === 1 ? "ایان ٹیسٹ والا" : null, firstName: FIRST[n - 1], firstNameUr: n === 1 ? "ایان" : null,
  grade: 3, section: n % 2 ? "A" : "B", classLabel: n % 2 ? "Grade 3 - A" : "Grade 3 - B", classLabelUr: n % 2 ? "جماعت سوم - A" : "جماعت سوم - B",
  teacherName: "Saima Testwala", status: "listed", childNo: n, role: "new", namesake: false, rollNumber: "917", ...extra,
});
const LIST = {
  visit: { visitId: "v2", visitKey: null }, cycleId: "C1", grade: 3, gradeFallback: false, reused: false,
  children: [1, 2, 3, 4, 5].map((n) => child(n)), alternates: [child(6), child(7)],
};
const SCHOOLS = [
  { schoolId: "s1", name: "School Alpha", visitId: null, observedGrade: null, visitToday: false },
  { schoolId: "s2", name: "School Beta", visitId: "v2", observedGrade: 3, visitToday: true },
];

function renderPage() {
  return render(<MemoryRouter><LeaderAssess /></MemoryRouter>);
}

/** Pick the school; the first time in a visit, get past the pre-flight card. */
async function chooseSchool(id = "s2") {
  fireEvent.click(await screen.findByTestId(`assess-school-${id}`));
  const ready = screen.queryByTestId("assess-preflight-ready");
  if (ready) fireEvent.click(ready);
}

async function openList() {
  const r = renderPage();
  await chooseSchool();
  await screen.findByText("Ayan Testwala");
  return r;
}

beforeEach(() => {
  vi.clearAllMocks();
  try { window.localStorage.clear(); window.localStorage.setItem("niete-assess-lang", "en"); } catch { /* none */ }
  (portal.getConfig as any).mockResolvedValue({ features: { childTestSa: true } });
  api.getSchools.mockResolvedValue({ schools: SCHOOLS });
  api.getList.mockResolvedValue({ list: LIST });
  api.markOutcome.mockResolvedValue({});
  api.getStatus.mockResolvedValue({ session: { id: "x", status: "started", grade: 3, form: "f" }, block: "B1", lastSeq: 0, tasksDone: [], audio: [] });
  api.mintLink.mockResolvedValue({ token: "tok-123", expiresAt: "2026-10-20T10:00:00Z" });
  api.getSwitches.mockResolvedValue(SWITCHES_OFF);
});

const SWITCHES_OFF = { handbackV2: false, micRequired: false, coachPicksBlock: false, rdfForm: false, resultsView: false };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const NET = () => Object.assign(new Error("Network Error"), { request: {} });
const BLOCK_EN: Record<string, string> = { B1: "Urdu reading", B2: "English reading", B3: "Listening", B4: "Maths: numbers", B5: "Maths: sums" };

function saDone(s: string) {
  act(() => { window.dispatchEvent(new MessageEvent("message", { data: { type: "sa:done", s, reason: "complete" }, origin: window.location.origin })); });
}

async function startChild(drawId = "d1") {
  fireEvent.click(within(screen.getByTestId(`assess-child-${drawId}`)).getByRole("button", { name: "Present" }));
  fireEvent.click(await screen.findByRole("button", { name: "Start" }));
  const frame = (await screen.findByTestId("assess-engine-frame")) as HTMLIFrameElement;
  return new URL(frame.getAttribute("src") as string, "http://x").searchParams.get("s") as string;
}

function stored() {
  const k = Object.keys(window.localStorage).find((x) => x.startsWith("assess:s2:")) as string;
  return JSON.parse(window.localStorage.getItem(k) as string);
}
afterEach(() => { vi.useRealTimers(); });

function drained(sessions: unknown[] = []) {
  act(() => { window.dispatchEvent(new MessageEvent("message", { data: { type: "sa:drained", sessions }, origin: window.location.origin })); });
}

describe("LeaderAssess: the coach page sends whatever the phone holds", () => {
  it("K1/K1b: the page opens on the schools list, no test started, no child of a visit: the drain frame runs once", async () => {
    renderPage();
    await screen.findByTestId("assess-school-s2");
    const frame = await screen.findByTestId("assess-drain-frame");
    expect(frame.getAttribute("src")).toBe("/sa/play.html?drain=1&embed=1");
    drained();
    await waitFor(() => expect(screen.queryByTestId("assess-drain-frame")).toBeNull());
  });

  it("the drain answered nothing held: no more frames on the next ticks", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderPage();
    await screen.findByTestId("assess-drain-frame");
    drained();
    await waitFor(() => expect(screen.queryByTestId("assess-drain-frame")).toBeNull());
    await act(async () => { vi.advanceTimersByTime(31_000); });
    expect(screen.queryByTestId("assess-drain-frame")).toBeNull();
  });

  it("the drain left something on the phone (another day's session): it runs again on a later tick", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderPage();
    await screen.findByTestId("assess-drain-frame");
    drained([{ s: "yesterday-1", pending_events: 0, pending_audio: 1, state: "error" }]);
    await waitFor(() => expect(screen.queryByTestId("assess-drain-frame")).toBeNull());
    await act(async () => { vi.advanceTimersByTime(31_000); });
    expect(await screen.findByTestId("assess-drain-frame")).toBeInTheDocument();
  });

  it("a drain that ends with no answer (stuck, or the cap) is not 'nothing held': it runs again on a later tick", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderPage();
    await screen.findByTestId("assess-drain-frame");
    // no sa:drained: the frame is ended by the page's own clock (60 s for a frame that never reports progress)
    await act(async () => { vi.advanceTimersByTime(61_000); });
    await waitFor(() => expect(screen.queryByTestId("assess-drain-frame")).toBeNull());
    await act(async () => { vi.advanceTimersByTime(31_000); });
    expect(await screen.findByTestId("assess-drain-frame")).toBeInTheDocument();
  });

  it("a reloaded page: a child the list calls completed is not 'sent' before the status poll answers", async () => {
    // a child tested here earlier: the visit's memory holds the session, sent at Start
    renderPage();
    await chooseSchool();
    await screen.findByText("Ayan Testwala");
    const s = await startChild();
    saDone(s);
    await screen.findByTestId("assess-child-d1");
    cleanup();
    // the reload: the server's list says completed; its status poll has not answered yet
    api.getList.mockResolvedValue({ list: { ...LIST, children: [child(1, { status: "tested", sessionId: s, sessionStatus: "completed" }), ...LIST.children.slice(1)] } });
    api.getStatus.mockImplementation(() => new Promise(() => {}));
    renderPage();
    await chooseSchool();
    await screen.findByText("Ayan Testwala");
    const bar = screen.getByTestId("assess-visit-bar");
    expect(bar).not.toHaveTextContent(/\bsent\b/);
    expect(bar).toHaveTextContent("sending");
  });

  it("offline, a reloaded page: a completed child whose status cannot be asked reads 'on phone', never 'sending'", async () => {
    renderPage();
    await chooseSchool();
    await screen.findByText("Ayan Testwala");
    const s = await startChild();
    saDone(s);
    await screen.findByTestId("assess-child-d1");
    cleanup();
    api.getList.mockResolvedValue({ list: { ...LIST, children: [child(1, { status: "tested", sessionId: s, sessionStatus: "completed" }), ...LIST.children.slice(1)] } });
    const online = vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(false);
    try {
      renderPage();
      await chooseSchool();
      await screen.findByText("Ayan Testwala");
      const bar = screen.getByTestId("assess-visit-bar");
      expect(bar).toHaveTextContent("on phone");
      expect(bar).not.toHaveTextContent("sending");
    } finally {
      online.mockRestore();
    }
  });
});
