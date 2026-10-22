import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// The example results dashboard (/portal/leader/assess/dashboard): behind sa_example_dashboard, which the server
// turns on only on sandbox. Off → "not available" and no numbers. On → the "Example data" banner, 1,000 synthetic
// students, a sub-region table that drills into schools, filters, and one card per task. It never reads a session.

vi.mock("../components/PortalLayout", () => ({ default: ({ children }: any) => <div>{children}</div> }));
vi.mock("../services/api", () => ({ childTestSa: { getSwitches: vi.fn(), getResults: vi.fn() } }));

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
});
