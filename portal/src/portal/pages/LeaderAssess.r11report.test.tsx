import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Round 11 (a reviewer's phone, 10 Nov: Get ready tapped three times, then a class list that never came, and nothing on
// our side said where it stuck): "Get ready for offline" and the class list report what they did. Every report is
// best-effort — a send that throws never stops Get ready, the list, or the test.

vi.mock("../components/PortalLayout", () => ({ default: ({ children }: any) => <div>{children}</div> }));
vi.mock("../lib/keepAwake", () => ({ keepScreenOn: vi.fn().mockResolvedValue(async () => {}) }));
vi.mock("../services/api", () => ({
  portal: { getConfig: vi.fn() },
  childTestSa: { getSchools: vi.fn(), getList: vi.fn(), markOutcome: vi.fn(), getStatus: vi.fn(), mintLink: vi.fn(), getSwitches: vi.fn(), addChild: vi.fn() },
}));
vi.mock("../components/assess/offlineReady", async (orig) => {
  const real: any = await orig();
  return { ...real, prepForms: vi.fn(), checkForms: vi.fn(), keepPageOffline: vi.fn(), dropPageOffline: vi.fn() };
});
const WORKERS = {
  pageSwControlled: true, pageSwScript: "/assess-sw.js", saSwScript: "/sa/sw.js", saSwActive: "activated", saSwWaiting: false, saSwInstalling: false, saSwUpdateFound: false,
};
vi.mock("../lib/assess/offlineReport", async (orig) => {
  const real: any = await orig();
  return { ...real, reportSaOffline: vi.fn(), workerState: vi.fn(), watchSaWorker: vi.fn() };
});

import { portal, childTestSa } from "../services/api";
import { prepForms, checkForms, keepPageOffline, dropPageOffline } from "../components/assess/offlineReady";
import { reportSaOffline, workerState, watchSaWorker } from "../lib/assess/offlineReport";
import LeaderAssess from "./LeaderAssess";

const api = childTestSa as any;
const prep = prepForms as any;
const keepPage = keepPageOffline as any;
const report = reportSaOffline as any;
const FIRST = ["Ayan", "Bilal", "Dua", "Esha", "Fiza"];
const child = (n: number) => ({
  drawId: `d${n}`, name: `${FIRST[n - 1]} Testwala`, nameUr: null, firstName: FIRST[n - 1], firstNameUr: null, grade: 3, section: "A",
  classLabel: "Grade 3 - A", classLabelUr: null, teacherName: "Saima Testwala", status: "listed", childNo: n, role: "new", namesake: false,
});
const LIST = { visit: { visitId: "v2", visitKey: null }, cycleId: "C1", grade: 3, gradeFallback: false, reused: false, children: [1, 2, 3, 4, 5].map(child), alternates: [] };
const SCHOOLS = [{ schoolId: "s2", name: "School Beta", visitId: "v2", observedGrade: 3, visitToday: true }];
const SW = { handbackV2: false, micRequired: false, coachPicksBlock: false, rdfForm: false, resultsView: false, r8OfflinePrep: true };
const OK = { ok: true, total: 100, cached: 100, missing: 0, bytes: 3 * 1024 * 1024 };
const sent = (k: string) => report.mock.calls.map((c: any[]) => c[0]).filter((b: any) => b.k === k);

beforeEach(() => {
  vi.clearAllMocks();
  try { window.localStorage.clear(); window.localStorage.setItem("niete-assess-lang", "en"); } catch { /* none */ }
  (portal.getConfig as any).mockResolvedValue({ features: { childTestSa: true } });
  api.getSchools.mockResolvedValue({ schools: SCHOOLS });
  api.getList.mockResolvedValue({ list: LIST });
  api.getSwitches.mockResolvedValue(SW);
  prep.mockResolvedValue(OK);
  (checkForms as any).mockResolvedValue({ ready: true, total: 100, cached: 100 });
  keepPage.mockResolvedValue(true);
  (dropPageOffline as any).mockResolvedValue(undefined);
  (workerState as any).mockResolvedValue(WORKERS);
  (watchSaWorker as any).mockReturnValue({ state: () => Promise.resolve({ ...WORKERS, saSwUpdateFound: true }), stop: vi.fn() });
});
afterEach(() => { vi.useRealTimers(); });

async function openList() {
  render(<MemoryRouter><LeaderAssess /></MemoryRouter>);
  fireEvent.click(await screen.findByTestId("assess-school-s2"));
  const ready = await screen.findByTestId("assess-preflight-ready").catch(() => null);
  if (ready) fireEvent.click(ready);
}

describe("Get ready for offline reports its result (sa_prep.result)", () => {
  it("ready: one report with the counts, the time it took, and both workers' state", async () => {
    render(<MemoryRouter><LeaderAssess /></MemoryRouter>);
    fireEvent.click(await screen.findByTestId("assess-offline-go"));
    await screen.findByTestId("assess-offline-ready");
    await waitFor(() => expect(sent("prep")).toHaveLength(1));
    const r = sent("prep")[0];
    expect(r).toMatchObject({
      k: "prep", outcome: "ready", ok: true, total: 100, cached: 100, missing: 0, missingPaths: [], missingForms: [], bytes: 3 * 1024 * 1024,
      forms: 2, schools: 1, listed: 1, grades: 1, pageKept: true, ...WORKERS, saSwUpdateFound: true,
    });
    expect(r.elapsedMs).toEqual(expect.any(Number));
    expect(JSON.stringify(r)).not.toMatch(/School Beta|Testwala|s2|v2/);
  });

  it("updating (the phone's Jugnu is being replaced): the outcome and the engine's reason", async () => {
    prep.mockResolvedValue({ ok: false, total: 0, cached: 0, missing: 0, bytes: 0, why: "worker_update_pending" });
    (checkForms as any).mockResolvedValue({ ready: false, total: 0, cached: 0, why: "worker_update_pending" });
    render(<MemoryRouter><LeaderAssess /></MemoryRouter>);
    fireEvent.click(await screen.findByTestId("assess-offline-go"));
    await screen.findByTestId("assess-offline-updating");
    await waitFor(() => expect(sent("prep")).toHaveLength(1));
    expect(sent("prep")[0]).toMatchObject({ outcome: "updating", ok: false, why: "worker_update_pending" });
  });

  it("partly: the missing count, up to 5 missing paths, the batteries with files missing, a list that did not come", async () => {
    prep.mockResolvedValue({ ok: false, total: 100, cached: 93, missing: 7, bytes: 1024, forms: [
      { form: "sa.coach.G3.A.ur", ok: false, files: 50, missing: 7 }, { form: "sa.coach.G3.A.en", ok: true, files: 50, missing: 0 }] });
    keepPage.mockImplementation(async (_l: string[], out?: { missing?: string[] }) => {
      if (out) out.missing = ["/assets/a.js", "/assets/b.js", "/api/portal/me", "/api/portal/config", "/sa/sa-offline.js", "/assets/c.css"];
      return false;
    });
    render(<MemoryRouter><LeaderAssess /></MemoryRouter>);
    fireEvent.click(await screen.findByTestId("assess-offline-go"));
    await screen.findByTestId("assess-offline-partly");
    await waitFor(() => expect(sent("prep")).toHaveLength(1));
    const r = sent("prep")[0];
    expect(r).toMatchObject({ outcome: "partly", ok: false, total: 100, cached: 93, missing: 7, missingForms: ["sa.coach.G3.A.ur"], pageKept: false });
    expect(r.missingPaths).toEqual(["/assets/a.js", "/assets/b.js", "/api/portal/me", "/api/portal/config", "/sa/sa-offline.js"]);
  });

  it("still running 120 s after the tap: one still-waiting report with where it is (a list read that never answers)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    api.getList.mockReturnValue(new Promise(() => {}));
    render(<MemoryRouter><LeaderAssess /></MemoryRouter>);
    fireEvent.click(await screen.findByTestId("assess-offline-go"));
    await screen.findByTestId("assess-offline-progress");
    await act(async () => { vi.advanceTimersByTime(119_000); });
    expect(sent("prep_waiting")).toHaveLength(0);
    await act(async () => { vi.advanceTimersByTime(2_000); });
    await waitFor(() => expect(sent("prep_waiting")).toHaveLength(1));
    expect(sent("prep_waiting")[0]).toMatchObject({ phase: "lists", done: 0, total: 0, ...WORKERS, saSwUpdateFound: true });
    await act(async () => { vi.advanceTimersByTime(240_000); });
    expect(sent("prep_waiting")).toHaveLength(1);
    expect(sent("prep")).toHaveLength(0);
  });

  it("a report that throws never stops Get ready", async () => {
    report.mockImplementation(() => { throw new Error("boom"); });
    (watchSaWorker as any).mockImplementation(() => { throw new Error("boom"); });
    render(<MemoryRouter><LeaderAssess /></MemoryRouter>);
    fireEvent.click(await screen.findByTestId("assess-offline-go"));
    expect(await screen.findByTestId("assess-offline-ready")).toBeTruthy();
  });
});

describe("the class list reports a failure, or a list still not on screen (sa_list.*)", () => {
  it("a problem from the server: its reason, not a network failure, the HTTP status, the time it took", async () => {
    api.getList.mockRejectedValue(Object.assign(new Error("x"), { response: { status: 409, data: { reason: "no_class_list" } } }));
    await openList();
    await waitFor(() => expect(sent("list_failed")).toHaveLength(1));
    expect(sent("list_failed")[0]).toMatchObject({ reason: "no_class_list", shown: "problem", network: false, status: 409, grade: null });
    expect(sent("list_failed")[0].elapsedMs).toEqual(expect.any(Number));
  });

  it("a network failure with nothing kept: the could-not-load screen, reported as one", async () => {
    api.getList.mockRejectedValue(Object.assign(new Error("Network Error"), { response: undefined }));
    await openList();
    await waitFor(() => expect(sent("list_failed")).toHaveLength(1));
    expect(sent("list_failed")[0]).toMatchObject({ reason: null, shown: "failed", network: true, status: null });
  });

  it("a network failure with a list kept by Get ready: the kept list is shown, and that is reported", async () => {
    window.localStorage.setItem("assess:r8:list:s2:0", JSON.stringify(LIST));
    api.getList.mockRejectedValue(Object.assign(new Error("Network Error"), { response: undefined }));
    await openList();
    await screen.findByText("Ayan Testwala");
    await waitFor(() => expect(sent("list_failed")).toHaveLength(1));
    expect(sent("list_failed")[0]).toMatchObject({ shown: "saved_list", network: true });
  });

  it("still not on screen 15 s after the step opened: one slow report; when it comes, a late one", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let answer: (v: unknown) => void = () => {};
    api.getList.mockReturnValue(new Promise((ok) => { answer = ok; }));
    await openList();
    await waitFor(() => expect(api.getList).toHaveBeenCalled());
    await act(async () => { vi.advanceTimersByTime(14_000); });
    expect(sent("list_slow")).toHaveLength(0);
    await act(async () => { vi.advanceTimersByTime(1_500); });
    await waitFor(() => expect(sent("list_slow")).toHaveLength(1));
    expect(sent("list_slow")[0]).toMatchObject({ pending: true, grade: null, ...WORKERS });
    await act(async () => { answer({ list: LIST }); });
    await screen.findByText("Ayan Testwala");
    await waitFor(() => expect(sent("list_late")).toHaveLength(1));
    expect(sent("list_late")[0].elapsedMs).toBeGreaterThanOrEqual(15_000);
    expect(sent("list_failed")).toHaveLength(0);
  });

  it("a list that comes at once sends nothing; a report that throws never stops the list", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    report.mockImplementation(() => { throw new Error("boom"); });
    await openList();
    await screen.findByText("Ayan Testwala");
    await act(async () => { vi.advanceTimersByTime(20_000); });
    expect(report).not.toHaveBeenCalled();
  });
});
