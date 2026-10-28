import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// Round 8, behind sa_r8_hide_practice (the server answers practiceFilter: true and marks each row `practice`): the LIVE
// dashboard leaves practice-school sessions out by default (totals, tables, stops, the coach picker) and one toggle,
// "Include practice schools", adds them back. Without practiceFilter the page is as before, whatever the rows say.

vi.mock("../components/PortalLayout", () => ({ default: ({ children }: any) => <div>{children}</div> }));
vi.mock("../services/api", () => ({ childTestSa: { getSwitches: vi.fn(), getResults: vi.fn(), getSessions: vi.fn() } }));

import { childTestSa } from "../services/api";
import LeaderAssessDashboard from "./LeaderAssessDashboard";

const api = childTestSa as any;

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/portal/leader/assess/dashboard"]}>
      <Routes>
        <Route path="/portal/leader/assess/dashboard" element={<LeaderAssessDashboard />} />
      </Routes>
    </MemoryRouter>,
  );
}

const task = (taskId: string, score: Record<string, number> | null) => ({
  taskId, mode: "record", attempted: null, correct: null, optionsN: null, chanceCorrected: null,
  itemsPerMin: null, stopReason: null, recording: score ? "scored" : "none", score,
});
let n = 0;
function row(o: { practice: boolean; tasks?: boolean; stops?: any[] }) {
  n += 1;
  const id = `s-${n}`;
  const at = `2026-10-27T0${n % 10}:00:00Z`;
  return {
    schoolId: o.practice ? "sch-sim" : "sch-1", schoolName: o.practice ? "SIM Practice" : "School One", sector: o.practice ? "ICT" : "Urban-I", grade: 3,
    mode: "auto", block: "rdf_auto", coachId: o.practice ? "coach-sim" : "coach-a", coachName: o.practice ? "Sim Tester" : "Asim Testwala",
    startedAt: at, stops: o.stops ?? [], origin: "drawn", practice: o.practice,
    results: {
      session: { id, grade: 3, form: "A", block: "rdf_auto", status: "completed", startedAt: at, endedAt: null, lang: "ur" },
      tasks: o.tasks === false ? [] : [task("ur.story_w3", { correct: 20, per_minute: 24 }), task("ur.words4", { correct: 3 })],
    },
  };
}
function fixture(practiceFilter = true) {
  n = 0;
  return {
    sessions: [...Array.from({ length: 6 }, () => row({ practice: false })), ...Array.from({ length: 3 }, () => row({ practice: true }))],
    stopSessions: [row({ practice: true, tasks: false, stops: [{ type: "end_test", taskId: null, at: "2026-10-27T09:01:00Z", by: "coach", data: { by: "coach" } }] })],
    ...(practiceFilter ? { practiceFilter: true } : {}),
  };
}
const total = () => Number((screen.getByTestId("dash-total").textContent || "").replace(/\D/g, ""));
const stopTotal = () => Number((screen.getByTestId("dash-stop-total-end_test").textContent || "").replace(/\D/g, ""));

beforeEach(() => {
  vi.clearAllMocks();
  try { window.localStorage.clear(); window.localStorage.setItem("niete-assess-lang", "en"); } catch { /* none */ }
});

describe("LeaderAssessDashboard: practice schools (sa_r8_hide_practice)", () => {
  it("without practiceFilter: every session counts and there is no toggle", async () => {
    api.getSwitches.mockResolvedValue({ realDashboard: true, dashFilters: true });
    api.getSessions.mockResolvedValue(fixture(false));
    renderPage();
    await screen.findByTestId("dash-live");
    expect(total()).toBe(9);
    expect(screen.queryByTestId("dash-include-practice")).toBeNull();
  });

  it("default: practice sessions are left out of the totals, the stops, the coach picker and the area table", async () => {
    api.getSwitches.mockResolvedValue({ realDashboard: true, dashFilters: true });
    api.getSessions.mockResolvedValue(fixture());
    renderPage();
    await screen.findByTestId("dash-live");
    expect(total()).toBe(6);
    expect(screen.getByTestId("dash-live").textContent).toMatch(/\b6\b/);
    expect(stopTotal()).toBe(0);
    expect(screen.queryByTestId("dash-coach")).toBeNull(); // one coach left: no picker
    expect(screen.getAllByTestId("dash-group-row").map((r) => r.getAttribute("data-key"))).toEqual(["Urban-I"]);
    const toggle = screen.getByTestId("dash-include-practice") as HTMLInputElement;
    expect(toggle.checked).toBe(false);
    expect(screen.getByText("Include practice schools")).toBeTruthy();
    expect(screen.getByTestId("dash-practice-hidden").textContent).toMatch(/\b4\b/);
  });

  it("the toggle adds them back everywhere, and takes them out again", async () => {
    api.getSwitches.mockResolvedValue({ realDashboard: true, dashFilters: true });
    api.getSessions.mockResolvedValue(fixture());
    renderPage();
    await screen.findByTestId("dash-live");
    fireEvent.click(screen.getByTestId("dash-include-practice"));
    expect(total()).toBe(9);
    expect(stopTotal()).toBe(1);
    const picker = screen.getByTestId("dash-coach");
    expect(within(picker).getByText("Sim Tester")).toBeTruthy();
    expect(screen.getAllByTestId("dash-group-row").map((r) => r.getAttribute("data-key")).sort()).toEqual(["ICT", "Urban-I"]);
    expect(screen.queryByTestId("dash-practice-hidden")).toBeNull();
    fireEvent.click(screen.getByTestId("dash-include-practice"));
    expect(total()).toBe(6);
  });

  it("only practice sessions: the empty state still offers the toggle", async () => {
    api.getSwitches.mockResolvedValue({ realDashboard: true, dashFilters: true });
    const f = fixture();
    api.getSessions.mockResolvedValue({ ...f, sessions: f.sessions.filter((s) => s.practice) });
    renderPage();
    await screen.findByTestId("dash-empty");
    fireEvent.click(screen.getByTestId("dash-include-practice"));
    expect(screen.queryByTestId("dash-empty")).toBeNull();
    expect(screen.getByTestId("dash-live").textContent).toMatch(/\b3\b/); // 3 children: the tiles show <5
  });

  it("Urdu: the toggle has its Urdu label", async () => {
    window.localStorage.setItem("niete-assess-lang", "ur");
    api.getSwitches.mockResolvedValue({ realDashboard: true, dashFilters: true });
    api.getSessions.mockResolvedValue(fixture());
    renderPage();
    await screen.findByTestId("dash-live");
    expect(screen.getByText("مشقی اسکول شامل کریں")).toBeTruthy();
  });
});
