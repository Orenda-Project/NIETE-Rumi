import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * Principal-dashboard feedback, items 3, 4 and 5, on the principal's home.
 *
 *  3 · "organised by STEPS features and teachers list … track each teacher's
 *      progress feature by feature … All features engagement data visible".
 *      → one table: a row per teacher, a column per STEPS letter
 *        (Subject knowledge, Teaching skills, Engagement, Presence,
 *        Supervisor remark), and a summary strip for the whole school.
 *  4 · "Every section … clickable … drill into it".
 *      → every cell and every summary tile is a link.
 *  5 · "reworked into a clear, step by step journey".
 *      → a numbered 1→5 journey strip, and a Next-step link.
 *
 * Observation letters show a BAND, never a number. Presence is counts in
 * words ("18 of 20 days"), deliberately not a band — see steps-grid.service.
 */

vi.mock("../hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("../services/api", () => ({
  leader: { getOverview: vi.fn(), getSteps: vi.fn() },
}));

import { useAuth } from "../hooks/useAuth";
import { leader } from "../services/api";
import LeaderHome from "./LeaderHome";

const STEPS = {
  success: true,
  cycle: { name: "Third Quarter 2026", endsAt: "2026-10-01T00:00:00Z" },
  teachers: [
    {
      id: "u1", name: "Ayesha Bibi", lastObservedAt: "2026-09-15",
      s: { pct: 18.8, band: "needs_support" }, t: { pct: 63.6, band: "good" }, e: { pct: 92.9, band: "excellent" },
      presence: { present: 18, absent: 2, leave: 1, markedDays: 20 },
      remark: "done",
    },
    {
      id: "u2", name: "Bushra Khan", lastObservedAt: null,
      s: null, t: null, e: null,
      presence: { present: 0, absent: 0, leave: 0, markedDays: 0 },
      remark: "todo",
    },
  ],
  summary: {
    s: { pct: 18.8, band: "needs_support", teachers: 1, of: 2 },
    t: { pct: 63.6, band: "good", teachers: 1, of: 2 },
    e: { pct: 92.9, band: "excellent", teachers: 1, of: 2 },
    presence: { present: 18, absent: 2, leave: 1, teachersMarked: 1, of: 2 },
    remark: { done: 1, todo: 1 },
  },
};

const OVERVIEW = {
  overview: {
    totalTeachers: 2, onRumi: 2, notOnRumi: 0, totalCoachingSessions: 3, totalLessonPlans: 4,
    totalAttendanceSessions: 0, totalTrainingModules: 0, teachersMarkingAttendance: 0, teachersInTraining: 0,
    scoredTeachers: 1, avgLastScore: 60, focus: [],
  },
};

function mount(role = "principal") {
  (useAuth as any).mockReturnValue({ user: { firstName: "Atifa", role }, loading: false, logout: vi.fn() });
  (leader.getOverview as any).mockResolvedValue(OVERVIEW);
  (leader.getSteps as any).mockResolvedValue(STEPS);
  render(<MemoryRouter><LeaderHome /></MemoryRouter>);
}

const hrefOf = (el: HTMLElement) => (el.closest("a") || el).getAttribute("href");

describe("3 · the principal's home is organised by STEPS", () => {
  beforeEach(() => vi.clearAllMocks());

  it("has a column for every STEPS letter, in order", async () => {
    mount();
    const grid = await screen.findByTestId("steps-grid");
    const headers = within(grid).getAllByRole("columnheader").map((h) => h.textContent || "");
    const order = ["Subject knowledge", "Teaching skills", "Engagement", "Presence", "Supervisor remark"]
      .map((label) => headers.findIndex((h) => h.includes(label)));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("has a row for every teacher", async () => {
    mount();
    await screen.findByTestId("steps-grid");
    expect(screen.getByTestId("steps-row-u1")).toHaveTextContent("Ayesha Bibi");
    expect(screen.getByTestId("steps-row-u2")).toHaveTextContent("Bushra Khan");
  });

  it("observation letters read as bands; presence as days; the remark as a to-do", async () => {
    mount();
    await screen.findByTestId("steps-grid");
    expect(screen.getByTestId("steps-cell-u1-s")).toHaveTextContent("Needs support");
    expect(screen.getByTestId("steps-cell-u1-t")).toHaveTextContent("Good");
    expect(screen.getByTestId("steps-cell-u1-e")).toHaveTextContent("Excellent");
    expect(screen.getByTestId("steps-cell-u1-p")).toHaveTextContent("18 of 20 days");
    expect(screen.getByTestId("steps-cell-u1-r")).toHaveTextContent("Done");
    expect(screen.getByTestId("steps-cell-u2-s")).toHaveTextContent("Not observed yet");
    expect(screen.getByTestId("steps-cell-u2-p")).toHaveTextContent("Not marked yet");
    expect(screen.getByTestId("steps-cell-u2-r")).toHaveTextContent("To do");
  });

  it("no observation score shows as a number or a percentage", async () => {
    mount();
    const grid = await screen.findByTestId("steps-grid");
    expect(grid.textContent).not.toMatch(/\d+(?:\.\d+)?\s*%/);
    expect(screen.getByTestId("steps-summary").textContent).not.toMatch(/\d+(?:\.\d+)?\s*%/);
  });

  it("the summary strip gives the school's band per letter, and how many it covers", async () => {
    mount();
    const strip = await screen.findByTestId("steps-summary");
    expect(within(strip).getByTestId("steps-summary-s")).toHaveTextContent("Needs support");
    expect(within(strip).getByTestId("steps-summary-s")).toHaveTextContent("1 of 2 teachers");
    expect(within(strip).getByTestId("steps-summary-r")).toHaveTextContent("1 of 2 done");
  });

  it("names the open evaluation cycle and when it closes", async () => {
    mount();
    expect(await screen.findByTestId("steps-cycle")).toHaveTextContent("Third Quarter 2026");
  });
});

describe("4 · everything on it is clickable", () => {
  beforeEach(() => vi.clearAllMocks());

  it("a teacher's cells open HER Analytics, and presence opens her attendance", async () => {
    // bd-60119 already decided where a principal's teacher leads: Analytics,
    // filtered to her — it does strictly more than the detail page. The grid
    // follows it, so a teacher never leads two places from two screens.
    mount();
    await screen.findByTestId("steps-grid");
    for (const k of ["s", "t", "e", "r"]) {
      expect(hrefOf(screen.getByTestId(`steps-cell-u1-${k}`))).toBe("/portal/leader/school-analytics?teacherId=u1");
    }
    expect(hrefOf(screen.getByTestId("steps-cell-u1-p"))).toBe("/portal/leader/attendance?teacherId=u1");
  });

  it("every summary tile drills into its feature", async () => {
    mount();
    await screen.findByTestId("steps-summary");
    expect(hrefOf(screen.getByTestId("steps-summary-s"))).toBe("/portal/leader/lessons");
    expect(hrefOf(screen.getByTestId("steps-summary-t"))).toBe("/portal/leader/lessons");
    expect(hrefOf(screen.getByTestId("steps-summary-e"))).toBe("/portal/leader/lessons");
    expect(hrefOf(screen.getByTestId("steps-summary-p"))).toBe("/portal/leader/attendance");
    expect(hrefOf(screen.getByTestId("steps-summary-r"))).toBe("/portal/leader/school-analytics#remarks");
  });
});

describe("5 · a step-by-step journey", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows the five steps, numbered, each a link", async () => {
    mount();
    const journey = await screen.findByTestId("steps-journey");
    const links = within(journey).getAllByRole("link");
    expect(links).toHaveLength(5);
    expect(links.map((l) => l.getAttribute("href"))).toEqual([
      "/portal/leader",
      "/portal/leader/teachers",
      "/portal/leader/lessons",
      "/portal/leader/attendance",
      "/portal/leader/school-analytics#remarks",
    ]);
    links.forEach((l, i) => expect(l).toHaveTextContent(String(i + 1)));
  });

  it("points to the next step", async () => {
    mount();
    expect(hrefOf(await screen.findByTestId("next-step"))).toBe("/portal/leader/teachers");
  });
});

describe("the other leader roles keep their own home", () => {
  beforeEach(() => vi.clearAllMocks());

  it("a coach does not get the one-school STEPS grid", async () => {
    mount("coach");
    await waitFor(() => expect(leader.getOverview).toHaveBeenCalled());
    expect(leader.getSteps).not.toHaveBeenCalled();
    expect(screen.queryByTestId("steps-grid")).toBeNull();
  });
});
