import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Round 8 (the reviewer's 28 Oct list: "loading the roster and the test in advance", "once a test starts it should run
// offline", "it takes very long for the screen to appear"): three coach-page switches, each OFF by default.
//   sa_r8_fast_start    Start opens the test after at most FAST_START_MS, whatever the server's Present answer is doing.
//   sa_r8_offline_first the child's battery is on the phone before Start (progress; Try again when it cannot come down).
//   sa_r8_offline_prep  "Get ready for offline": lists + batteries kept while online, used when the network fails.

vi.mock("../components/PortalLayout", () => ({ default: ({ children }: any) => <div>{children}</div> }));
vi.mock("../lib/keepAwake", () => ({ keepScreenOn: vi.fn().mockResolvedValue(async () => {}) }));
vi.mock("../services/api", () => ({
  portal: { getConfig: vi.fn() },
  childTestSa: { getSchools: vi.fn(), getList: vi.fn(), markOutcome: vi.fn(), getStatus: vi.fn(), mintLink: vi.fn(), getSwitches: vi.fn(), addChild: vi.fn() },
}));
// the engine's worker is the browser's; the page's side of it is mocked here (its own tests: dashboard/tests/sa-r8-offline-prep)
vi.mock("../components/assess/offlineReady", async (orig) => {
  const real: any = await orig();
  return { ...real, prepForms: vi.fn(), checkForms: vi.fn(), keepPageOffline: vi.fn(), dropPageOffline: vi.fn() };
});

import { portal, childTestSa } from "../services/api";
import { prepForms, checkForms, keepPageOffline, dropPageOffline, FAST_START_MS } from "../components/assess/offlineReady";
import LeaderAssess from "./LeaderAssess";

const api = childTestSa as any;
const prep = prepForms as any;
const check = checkForms as any;
const keepPage = keepPageOffline as any;
const dropPage = dropPageOffline as any;
const FIRST = ["Ayan", "Bilal", "Dua", "Esha", "Fiza"];
const child = (n: number) => ({
  drawId: `d${n}`, name: `${FIRST[n - 1]} Testwala`, nameUr: null, firstName: FIRST[n - 1], firstNameUr: null, grade: 3, section: "A",
  classLabel: "Grade 3 - A", classLabelUr: null, teacherName: "Saima Testwala", status: "listed", childNo: n, role: "new", namesake: false,
});
const LIST = { visit: { visitId: "v2", visitKey: null }, cycleId: "C1", grade: 3, gradeFallback: false, reused: false, children: [1, 2, 3, 4, 5].map(child), alternates: [] };
const SCHOOLS = [{ schoolId: "s2", name: "School Beta", visitId: "v2", observedGrade: 3, visitToday: true }];
const SW = { handbackV2: false, micRequired: false, coachPicksBlock: false, rdfForm: false, resultsView: false };
const OK = { ok: true, total: 100, cached: 100, missing: 0, bytes: 3 * 1024 * 1024 };
const netErr = () => Object.assign(new Error("Network Error"), { response: undefined });

beforeEach(() => {
  vi.clearAllMocks();
  try { window.localStorage.clear(); window.localStorage.setItem("niete-assess-lang", "en"); } catch { /* none */ }
  (portal.getConfig as any).mockResolvedValue({ features: { childTestSa: true } });
  api.getSchools.mockResolvedValue({ schools: SCHOOLS });
  api.getList.mockResolvedValue({ list: LIST });
  api.markOutcome.mockResolvedValue({ sessionId: "server-1" });
  api.getStatus.mockResolvedValue({ session: { id: "x", status: "started", grade: 3, form: "f" }, block: "B1", lastSeq: 0, tasksDone: [], audio: [] });
  prep.mockResolvedValue(OK);
  check.mockResolvedValue({ ready: true, total: 100, cached: 100 });
  keepPage.mockResolvedValue(true);
  dropPage.mockResolvedValue(undefined);
});

async function toHandover() {
  render(<MemoryRouter><LeaderAssess /></MemoryRouter>);
  fireEvent.click(await screen.findByTestId("assess-school-s2"));
  const ready = screen.queryByTestId("assess-preflight-ready");
  if (ready) fireEvent.click(ready);
  await screen.findByText("Ayan Testwala");
  fireEvent.click(within(screen.getByTestId("assess-child-d1")).getByRole("button", { name: "Present" }));
  return screen.findByRole("button", { name: "Start" });
}
const visitMemory = () => {
  const k = Object.keys(window.localStorage).find((x) => x.startsWith("assess:s2"));
  return k ? JSON.parse(window.localStorage.getItem(k) as string) : null;
};

describe("sa_r8_fast_start", () => {
  it("ON: a slow Present answer does not hold the test; the late answer's server id is kept", async () => {
    api.getSwitches.mockResolvedValue({ ...SW, r8FastStart: true });
    let answer: (v: unknown) => void = () => {};
    api.markOutcome.mockReturnValue(new Promise((ok) => { answer = ok; }));
    fireEvent.click(await toHandover());
    const t0 = Date.now();
    await screen.findByTestId("assess-engine-frame", undefined, { timeout: FAST_START_MS + 1500 });
    expect(Date.now() - t0).toBeLessThan(FAST_START_MS + 1000);
    answer({ sessionId: "server-late" });
    await waitFor(() => expect(Object.values(visitMemory().sessions).some((x: any) => x.serverId === "server-late")).toBe(true));
  });

  it("ON: the late answer is a network failure → Present is queued on the phone", async () => {
    api.getSwitches.mockResolvedValue({ ...SW, r8FastStart: true });
    let fail: (e: unknown) => void = () => {};
    api.markOutcome.mockReturnValue(new Promise((_, no) => { fail = no; }));
    fireEvent.click(await toHandover());
    await screen.findByTestId("assess-engine-frame", undefined, { timeout: FAST_START_MS + 1500 });
    fail(netErr());
    await waitFor(() => expect(visitMemory().queue.map((q: any) => q.outcome)).toEqual(["present"]));
  });

  it("OFF: Start waits for the Present answer", async () => {
    api.getSwitches.mockResolvedValue(SW);
    api.markOutcome.mockReturnValue(new Promise(() => {}));
    fireEvent.click(await toHandover());
    await new Promise((r) => setTimeout(r, FAST_START_MS + 300));
    expect(screen.queryByTestId("assess-engine-frame")).toBeNull();
  });
});

describe("sa_r8_offline_first", () => {
  it("ON: the child's own part goes on the phone before Start (the whole battery warms from the list), then the test opens", async () => {
    api.getSwitches.mockResolvedValue({ ...SW, r8OfflineFirst: true });
    check.mockResolvedValue({ ready: false, total: 100, cached: 10 });
    const start = await toHandover();
    await waitFor(() => expect(prep.mock.calls.some((c: any[]) => c[0][0] === "sa.coach.G3.A.en" && !c[2])).toBe(true));
    fireEvent.click(start);
    const frame = (await screen.findByTestId("assess-engine-frame")) as HTMLIFrameElement;
    const q = new URL(frame.getAttribute("src") as string, "http://x").searchParams;
    // the gate asked for exactly the part this page runs: its block and its session (the passage it draws)
    const gate = prep.mock.calls.find((c: any[]) => c[2]);
    expect(gate[0]).toEqual(["sa.coach.G3.A.en"]);
    expect(gate[2]).toEqual({ block: q.get("block"), seed: q.get("s") });
    // the phone was asked first, for the same part; the battery is not read again (fresh: false)
    expect(check).toHaveBeenCalledWith(["sa.coach.G3.A.en"], { block: q.get("block"), seed: q.get("s") });
    expect(gate[3]).toEqual({ fresh: false });
    expect(prep.mock.invocationCallOrder[prep.mock.calls.indexOf(gate)]).toBeLessThan(api.markOutcome.mock.invocationCallOrder[0]);
    expect(api.markOutcome).toHaveBeenCalledTimes(1);
    // the other language follows behind the test
    await waitFor(() => expect(prep.mock.calls.some((c: any[]) => c[0][0] === "sa.coach.G3.A.ur")).toBe(true));
  });

  it("ON: the part already on the phone → Start opens with no download at all", async () => {
    api.getSwitches.mockResolvedValue({ ...SW, r8OfflineFirst: true });
    check.mockResolvedValue({ ready: true, total: 100, cached: 100 });
    fireEvent.click(await toHandover());
    await screen.findByTestId("assess-engine-frame");
    expect(prep.mock.calls.filter((c: any[]) => c[2])).toHaveLength(0);
  });

  it("ON: the list's background download holds while the Start gate downloads the part", async () => {
    api.getSwitches.mockResolvedValue({ ...SW, r8OfflineFirst: true });
    check.mockResolvedValue({ ready: false, total: 100, cached: 0 });
    let paused: (() => boolean) | null = null;
    let release: (v: unknown) => void = () => {};
    prep.mockImplementation((forms: string[], _p: unknown, part: unknown, opts: any) => {
      if (!part && opts?.paused && !paused) paused = opts.paused;
      if (part) return new Promise((ok) => { release = ok; });
      return Promise.resolve(OK);
    });
    const start = await toHandover();
    await waitFor(() => expect(paused).not.toBeNull());
    expect(paused!()).toBe(false);
    fireEvent.click(start);
    await waitFor(() => expect(prep.mock.calls.some((c: any[]) => c[2])).toBe(true));
    expect(paused!()).toBe(true);
    release(OK);
    await screen.findByTestId("assess-engine-frame");
    expect(paused!()).toBe(false);
  });

  it("ON: when the battery cannot come down, no test and no Present: the coach sees why, with Try again", async () => {
    api.getSwitches.mockResolvedValue({ ...SW, r8OfflineFirst: true });
    prep.mockResolvedValue({ ok: false, total: 100, cached: 40, missing: 60, bytes: 0 });
    check.mockResolvedValue({ ready: false, total: 100, cached: 40 });
    fireEvent.click(await toHandover());
    expect(await screen.findByTestId("assess-ready-failed")).toHaveTextContent("Jugnu's voice is not on this phone yet");
    expect(screen.queryByTestId("assess-engine-frame")).toBeNull();
    expect(api.markOutcome).not.toHaveBeenCalled();
    prep.mockResolvedValue(OK);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByTestId("assess-engine-frame");
  });

  it("OFF: nothing is downloaded by the page; Start opens the test as before", async () => {
    api.getSwitches.mockResolvedValue(SW);
    fireEvent.click(await toHandover());
    await screen.findByTestId("assess-engine-frame");
    expect(prep).not.toHaveBeenCalled();
    expect(screen.queryByTestId("assess-ready-gate")).toBeNull();
  });
});

describe("sa_r8_offline_prep", () => {
  it("ON: Get ready keeps today's lists and both languages' batteries, and says how much came down", async () => {
    api.getSwitches.mockResolvedValue({ ...SW, r8OfflinePrep: true });
    render(<MemoryRouter><LeaderAssess /></MemoryRouter>);
    fireEvent.click(await screen.findByTestId("assess-offline-go"));
    expect(await screen.findByTestId("assess-offline-ready")).toHaveTextContent("Ready for offline ✓ 1 school · 3.0 MB");
    expect(api.getList).toHaveBeenCalledWith("s2", "v2");
    expect(prep.mock.calls[0][0]).toEqual(["sa.coach.G3.A.ur", "sa.coach.G3.A.en"]);
    expect(JSON.parse(window.localStorage.getItem("assess:r8:prep") as string)).toMatchObject({ ok: true, forms: ["sa.coach.G3.A.ur", "sa.coach.G3.A.en"] });
    // the page itself is kept too, with the list read it made, so a reloaded tab opens at the school
    expect(keepPage).toHaveBeenCalledWith(["/api/portal/leader/child-test/sa/list?schoolId=s2&visitId=v2"]);
    expect(dropPage).not.toHaveBeenCalled();
  });

  it("ON, every grade (sa_all_grades): the coach ticks the grades per school; only those lists and tests are kept", async () => {
    api.getSwitches.mockResolvedValue({ ...SW, allGrades: true, r8OfflinePrep: true });
    api.getSchools.mockResolvedValue({ schools: [{ schoolId: "s2", name: "School Beta", visitId: "v2", observedGrade: null, visitToday: true }] });
    api.getList.mockImplementation((_s: string, _v: string, g: number) => Promise.resolve({ list: { ...LIST, grade: g, children: LIST.children.map((k: any) => ({ ...k, grade: g })) } }));
    render(<MemoryRouter><LeaderAssess /></MemoryRouter>);
    fireEvent.click(await screen.findByTestId("assess-offline-go"));
    expect(await screen.findByTestId("assess-offline-no-grade")).toHaveTextContent("School Beta: tick the grades");
    expect(api.getList).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("assess-offline-grade-s2-2"));
    fireEvent.click(screen.getByTestId("assess-offline-grade-s2-4"));
    fireEvent.click(screen.getByTestId("assess-offline-go"));
    await screen.findByTestId("assess-offline-ready");
    expect(api.getList.mock.calls.map((c: any[]) => c[2])).toEqual([2, 4]);
    expect(prep.mock.calls[0][0]).toEqual(["sa.coach.G2.A.ur", "sa.coach.G2.A.en", "sa.coach.G4.A.ur", "sa.coach.G4.A.en"]);
    expect(JSON.parse(window.localStorage.getItem("assess:r8:list:s2:4") as string).grade).toBe(4);
    expect(keepPage).toHaveBeenCalledWith(["/api/portal/leader/child-test/sa/list?schoolId=s2&visitId=v2&grade=2", "/api/portal/leader/child-test/sa/list?schoolId=s2&visitId=v2&grade=4"]);
  });

  it("ON: the page is kept before the lists are read (a list that never answers still leaves the page openable offline)", async () => {
    api.getSwitches.mockResolvedValue({ ...SW, r8OfflinePrep: true });
    api.getList.mockReturnValue(new Promise(() => {}));
    render(<MemoryRouter><LeaderAssess /></MemoryRouter>);
    fireEvent.click(await screen.findByTestId("assess-offline-go"));
    await waitFor(() => expect(keepPage).toHaveBeenCalledWith([]));
  });

  it("read as OFF: a page worker an earlier Get ready left on the phone is removed", async () => {
    api.getSwitches.mockResolvedValue(SW);
    render(<MemoryRouter><LeaderAssess /></MemoryRouter>);
    await waitFor(() => expect(dropPage).toHaveBeenCalledTimes(1));
    expect(keepPage).not.toHaveBeenCalled();
  });

  it("switches not read (the read failed): nothing is removed", async () => {
    api.getSwitches.mockRejectedValue(netErr());
    render(<MemoryRouter><LeaderAssess /></MemoryRouter>);
    await screen.findByTestId("assess-school-s2");
    expect(dropPage).not.toHaveBeenCalled();
  });

  it("ON, at the school with no signal: the saved schools and the prepared list are shown, and a child can start", async () => {
    api.getSwitches.mockResolvedValue({ ...SW, r8OfflinePrep: true });
    window.localStorage.setItem("assess:r8:schools", JSON.stringify(SCHOOLS));
    window.localStorage.setItem("assess:r8:list:s2:0", JSON.stringify(LIST));
    api.getSchools.mockRejectedValue(netErr());
    api.getList.mockRejectedValue(netErr());
    api.markOutcome.mockRejectedValue(netErr());
    render(<MemoryRouter><LeaderAssess /></MemoryRouter>);
    expect(await screen.findByTestId("assess-saved-schools")).toBeInTheDocument();
    fireEvent.click(await screen.findByTestId("assess-school-s2"));
    const ready = screen.queryByTestId("assess-preflight-ready");
    if (ready) fireEvent.click(ready);
    await screen.findByText("Ayan Testwala");
    fireEvent.click(within(screen.getByTestId("assess-child-d1")).getByRole("button", { name: "Present" }));
    fireEvent.click(await screen.findByRole("button", { name: "Start" }));
    await screen.findByTestId("assess-engine-frame");
  });

  it("OFF: no card, and no network → the page's own failure, as before", async () => {
    api.getSwitches.mockResolvedValue(SW);
    window.localStorage.setItem("assess:r8:schools", JSON.stringify(SCHOOLS));
    api.getSchools.mockRejectedValue(netErr());
    render(<MemoryRouter><LeaderAssess /></MemoryRouter>);
    await waitFor(() => expect(api.getSchools).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByTestId("assess-offline-card")).toBeNull();
    expect(screen.queryByTestId("assess-saved-schools")).toBeNull();
    expect(screen.queryByTestId("assess-school-s2")).toBeNull();
  });
});
