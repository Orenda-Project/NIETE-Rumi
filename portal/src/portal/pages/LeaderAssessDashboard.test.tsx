import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// The example results dashboard (/portal/leader/assess/dashboard): behind sa_example_dashboard, which the server
// turns on only on sandbox. Off → "not available" and no numbers. On → the "Example data" banner, 1,000 synthetic
// students, a sub-region table that drills into schools, filters, and one card per task. It never reads a session.

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

beforeEach(() => {
  vi.clearAllMocks();
  try { window.localStorage.clear(); window.localStorage.setItem("niete-assess-lang", "en"); } catch { /* none */ }
});

describe("LeaderAssessDashboard", () => {
  it("switch off: says not available and shows no numbers", async () => {
    api.getSwitches.mockResolvedValue({ exampleDashboard: false });
    renderPage();
    expect(await screen.findByTestId("dash-off")).toBeInTheDocument();
    expect(screen.queryByTestId("dash-banner")).toBeNull();
    expect(screen.queryByTestId("dash-total")).toBeNull();
  });

  it("switches unreadable: off (fail closed)", async () => {
    api.getSwitches.mockRejectedValue({ response: { status: 404 } });
    renderPage();
    expect(await screen.findByTestId("dash-off")).toBeInTheDocument();
  });

  it("switch on: the example banner, 1,000 students, six sub-regions, every task, and no session read", async () => {
    api.getSwitches.mockResolvedValue({ exampleDashboard: true });
    renderPage();
    expect(await screen.findByTestId("dash-banner")).toHaveTextContent(/example data/i);
    expect(screen.getByTestId("dash-total")).toHaveTextContent("1,000");
    const rows = within(screen.getByTestId("dash-groups")).getAllByTestId("dash-group-row");
    expect(rows.map((r) => r.getAttribute("data-key"))).toEqual(["Bhara Kahu", "Nilore", "Sihala", "Tarnol", "Urban-I", "Urban-II"]);
    expect(screen.getByTestId("dash-task-ur.story_w3")).toBeInTheDocument();
    expect(screen.getByTestId("dash-task-ma.fluency1m")).toBeInTheDocument();
    expect(screen.queryByTestId("dash-task-en.story_w3")).toBeNull();
    expect(api.getResults).not.toHaveBeenCalled();
  });

  it("each chart names its rule, and the reading bands are in plain words", async () => {
    api.getSwitches.mockResolvedValue({ exampleDashboard: true });
    renderPage();
    const passage = await screen.findByTestId("dash-task-ur.story_w3");
    expect(passage).toHaveTextContent(/Non-reader \(0\)/);
    expect(within(passage).getByTestId("dash-rule")).toHaveTextContent(/40 or more words per minute/);
    expect(within(screen.getByTestId("dash-task-ur.story_comp_w3")).getByTestId("dash-rule")).toHaveTextContent(/80% or more/);
    expect(within(screen.getByTestId("dash-task-ma.missing4")).getByTestId("dash-rule")).toHaveTextContent(/75% or more/);
    expect(within(screen.getByTestId("dash-task-ma.fluency1m")).getByTestId("dash-rule")).toHaveTextContent(/60 seconds/);
    expect(within(screen.getByTestId("dash-task-ur.words4")).getByTestId("dash-rule")).toHaveTextContent(/no item right/);
  });

  it("drills from a sub-region into its schools, and back", async () => {
    api.getSwitches.mockResolvedValue({ exampleDashboard: true });
    renderPage();
    const groups = await screen.findByTestId("dash-groups");
    fireEvent.click(within(groups).getAllByTestId("dash-group-row").find((r) => r.getAttribute("data-key") === "Sihala") as HTMLElement);
    const schools = within(screen.getByTestId("dash-groups")).getAllByTestId("dash-group-row");
    expect(schools.length).toBeGreaterThan(1);
    expect(schools.every((r) => /Sihala/.test(r.textContent || ""))).toBe(true);
    const n = Number((screen.getByTestId("dash-total").textContent || "").replace(/\D/g, ""));
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThan(1000);
    fireEvent.click(screen.getByTestId("dash-all-sectors"));
    expect(screen.getByTestId("dash-total")).toHaveTextContent("1,000");
  });

  it("filters by grade and gender, and switches the reading section to English", async () => {
    api.getSwitches.mockResolvedValue({ exampleDashboard: true });
    renderPage();
    await screen.findByTestId("dash-banner");
    fireEvent.click(screen.getByTestId("dash-grade-3"));
    const g3 = Number((screen.getByTestId("dash-total").textContent || "").replace(/\D/g, ""));
    fireEvent.click(screen.getByTestId("dash-gender-girl"));
    const g3girls = Number((screen.getByTestId("dash-total").textContent || "").replace(/\D/g, ""));
    expect(g3).toBeLessThan(1000);
    expect(g3girls).toBeLessThan(g3);
    fireEvent.click(screen.getByTestId("dash-read-en"));
    expect(screen.getByTestId("dash-task-en.story_w3")).toBeInTheDocument();
    expect(screen.queryByTestId("dash-task-ur.story_w3")).toBeNull();
  });

  it("Urdu: the banner and headings are in Urdu with Urdu digits", async () => {
    window.localStorage.setItem("niete-assess-lang", "ur");
    api.getSwitches.mockResolvedValue({ exampleDashboard: true });
    renderPage();
    expect(await screen.findByTestId("dash-banner")).toHaveTextContent(/مثالی/);
    expect(screen.getByTestId("dash-total").textContent).toMatch(/[۰-۹]/);
  });

  it("grades 1 to 5, and the passage card shows that grade's Rawalpindi reference", async () => {
    api.getSwitches.mockResolvedValue({ exampleDashboard: true });
    renderPage();
    await screen.findByTestId("dash-banner");
    for (const g of [1, 2, 3, 4, 5]) expect(screen.getByTestId(`dash-grade-${g}`)).toBeInTheDocument();
    const all = within(screen.getByTestId("dash-task-ur.story_w3")).getByTestId("dash-rwp");
    expect(all).toHaveTextContent(/Rawalpindi/);
    expect(within(all).getAllByTestId("dash-rwp-row")).toHaveLength(5);
    fireEvent.click(screen.getByTestId("dash-grade-4"));
    const g4 = within(screen.getByTestId("dash-task-ur.story_w3")).getByTestId("dash-rwp");
    expect(within(g4).getAllByTestId("dash-rwp-row")).toHaveLength(1);
    expect(g4).toHaveTextContent(/Grade 4/);
    expect(g4).toHaveTextContent(/60/);
    expect(g4).toHaveTextContent(/14%/);
  });

  it("the example page never reads real sessions", async () => {
    api.getSwitches.mockResolvedValue({ exampleDashboard: true, realDashboard: false });
    renderPage();
    await screen.findByTestId("dash-banner");
    expect(api.getSessions).not.toHaveBeenCalled();
  });

  it("the Rawalpindi reference says May, early in the school year, so an October child is not read as behind", async () => {
    api.getSwitches.mockResolvedValue({ exampleDashboard: true });
    renderPage();
    const rwp = within(await screen.findByTestId("dash-task-ur.story_w3")).getByTestId("dash-rwp");
    expect(rwp).toHaveTextContent(/Rawalpindi study, May 2026/);
    expect(within(rwp).getByTestId("dash-rwp-note")).toHaveTextContent(/early in the school year/);
  });
});

// The same page on REAL sessions (sa_real_dashboard): the coach's own, or every coach's for a results admin.
const realTask = (taskId: string, score: Record<string, number> | null, correct: number | null = null) => ({
  taskId, mode: correct === null ? "record" : "keypad", attempted: null, correct, optionsN: null, chanceCorrected: null,
  itemsPerMin: null, stopReason: null, recording: score ? "scored" : "none", score,
});
const realSession = (id: string, sector: string | null, schoolId: string, grade = 3) => ({
  schoolId, schoolName: `School ${schoolId}`, sector, grade,
  results: {
    session: { id, grade, form: "A", block: "rdf_auto", status: "completed", startedAt: "2026-10-23T05:00:00Z", endedAt: "2026-10-23T05:32:00Z", lang: "ur" },
    tasks: [realTask("ur.story_w3", { correct: 20, per_minute: 24 }), realTask("ur.words4", { correct: 3 }), realTask("ma.missing4", null, 2)],
  },
});
const many = (n: number, sector: string | null, schoolId: string) => Array.from({ length: n }, (_, i) => realSession(`${schoolId}-${i}`, sector, schoolId));

describe("LeaderAssessDashboard on real sessions (sa_real_dashboard)", () => {
  it("live: reads the sessions, says how many, and drops the example banner and the gender filter", async () => {
    api.getSwitches.mockResolvedValue({ exampleDashboard: true, realDashboard: true });
    api.getSessions.mockResolvedValue({ sessions: [...many(6, "Urban-I", "a"), ...many(5, "Nilore", "b")] });
    renderPage();
    const banner = await screen.findByTestId("dash-live");
    expect(banner).toHaveTextContent(/Live data: 11 sessions/);
    expect(screen.queryByTestId("dash-banner")).toBeNull();
    expect(screen.queryByTestId("dash-gender-girl")).toBeNull();
    expect(screen.getByTestId("dash-total")).toHaveTextContent("11");
    const rows = within(screen.getByTestId("dash-groups")).getAllByTestId("dash-group-row");
    expect(rows.map((r) => r.getAttribute("data-key"))).toEqual(["Nilore", "Urban-I"]);
    expect(within(screen.getByTestId("dash-task-ur.story_w3")).queryByTestId("dash-masked")).toBeNull();
  });

  it("live without the example switch (any tier): still the live page", async () => {
    api.getSwitches.mockResolvedValue({ exampleDashboard: false, realDashboard: true });
    api.getSessions.mockResolvedValue({ sessions: many(5, "Urban-I", "a") });
    renderPage();
    expect(await screen.findByTestId("dash-live")).toHaveTextContent(/5 sessions/);
  });

  it("a cell under 5 children shows <5 and no numbers: a sub-region row, the totals and a task card", async () => {
    api.getSwitches.mockResolvedValue({ realDashboard: true });
    api.getSessions.mockResolvedValue({ sessions: [...many(6, "Urban-I", "a"), ...many(2, "Sihala", "c")] });
    renderPage();
    await screen.findByTestId("dash-live");
    const sihala = within(screen.getByTestId("dash-groups")).getAllByTestId("dash-group-row").find((r) => r.getAttribute("data-key") === "Sihala") as HTMLElement;
    expect(sihala).toHaveTextContent("<5");
    expect(sihala.textContent).not.toMatch(/\d+%/);
    fireEvent.click(sihala);
    expect(screen.getByTestId("dash-total")).toHaveTextContent("<5");
    expect(within(screen.getByTestId("dash-task-ur.story_w3")).getByTestId("dash-masked")).toBeInTheDocument();
    expect(screen.getByTestId("dash-orf").textContent).not.toMatch(/\d/);
  });

  it("sessions with another voice heard in a recording are counted in a caveat; none, no caveat", async () => {
    window.localStorage.setItem("niete-assess-lang", "en");
    api.getSwitches.mockResolvedValue({ realDashboard: true });
    const flagged = many(6, "Urban-I", "a");
    flagged[0].results.tasks[0] = { ...flagged[0].results.tasks[0], secondVoice: true } as any;
    flagged[1].results.tasks[1] = { ...flagged[1].results.tasks[1], secondVoice: true } as any;
    api.getSessions.mockResolvedValue({ sessions: flagged });
    const { unmount } = renderPage();
    expect(await screen.findByTestId("dash-second-voice")).toHaveTextContent(/2 of 6 sessions/);
    unmount();
    api.getSessions.mockResolvedValue({ sessions: many(6, "Urban-I", "a") });
    renderPage();
    await screen.findByTestId("dash-live");
    expect(screen.queryByTestId("dash-second-voice")).toBeNull();
  });

  it("a school with no sub-region is listed as such", async () => {
    window.localStorage.setItem("niete-assess-lang", "en");
    api.getSwitches.mockResolvedValue({ realDashboard: true });
    api.getSessions.mockResolvedValue({ sessions: many(5, null, "z") });
    renderPage();
    await screen.findByTestId("dash-live");
    expect(within(screen.getByTestId("dash-groups")).getByTestId("dash-group-row")).toHaveTextContent(/Sub-region not set/);
  });

  it("the read fails: says so, and never falls back to the example numbers", async () => {
    api.getSwitches.mockResolvedValue({ exampleDashboard: true, realDashboard: true });
    api.getSessions.mockRejectedValue({ response: { status: 502 } });
    renderPage();
    expect(await screen.findByTestId("dash-load-failed")).toBeInTheDocument();
    expect(screen.queryByTestId("dash-banner")).toBeNull();
    expect(screen.queryByTestId("dash-total")).toBeNull();
  });

  it("no sessions yet: says so", async () => {
    api.getSwitches.mockResolvedValue({ realDashboard: true });
    api.getSessions.mockResolvedValue({ sessions: [] });
    renderPage();
    expect(await screen.findByTestId("dash-live")).toHaveTextContent(/0 sessions/);
    expect(screen.getByTestId("dash-empty")).toBeInTheDocument();
  });

  it("Urdu: the live banner in Urdu with Urdu digits", async () => {
    window.localStorage.setItem("niete-assess-lang", "ur");
    api.getSwitches.mockResolvedValue({ realDashboard: true });
    api.getSessions.mockResolvedValue({ sessions: many(5, "Urban-I", "a") });
    renderPage();
    const live = await screen.findByTestId("dash-live");
    expect(live.textContent).toMatch(/[\u0600-\u06FF]/);
    expect(live.textContent).toMatch(/۵/);
  });
});
