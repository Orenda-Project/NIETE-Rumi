import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

/**
 * bd-60119 — two UX gaps the operator hit on sandbox (2026-09-17).
 *
 * 1. CHANGING THE TEACHER GAVE NO FEEDBACK. `loading` is only true before the
 *    FIRST load, so a refetch swapped every number in place with nothing on
 *    screen to say it was working. On a slow connection that reads as "the
 *    filter is broken" — or worse, the old teacher's numbers get read as the
 *    new teacher's, because nothing marked them as stale.
 *
 * 2. "Score over time" / "By area" DO NOT EXPLAIN THEMSELVES. They name the
 *    chart's shape, not what it measures. The score is a FICO classroom
 *    observation — a coach watches a lesson and scores sections B/C/D/F — and
 *    a principal cannot be expected to infer that from an axis. Each panel now
 *    says what it is and where the number came from.
 */

vi.mock("../hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("../services/api", () => ({ leader: {
    // The Attendance tab loads its detail too (2026-09-30).
    getAttendance: vi.fn().mockResolvedValue({ success: true, from: null, to: null, focusTeacher: null, teachers: [], schoolDays: [], students: { groups: [], byDay: [] }, staff: { groups: [], byDay: [] } }), getSchoolAnalytics: vi.fn(), getSteps: vi.fn().mockResolvedValue({ success: true, cycle: null, teachers: [], summary: {} }) } }));
vi.mock("react-apexcharts", () => ({ default: () => <div data-testid="chart" /> }));

import { useAuth } from "../hooks/useAuth";
import { leader } from "../services/api";
import SchoolAnalytics from "./SchoolAnalytics";

const PAYLOAD = {
  success: true,
  school: { name: "IMSB (I-V), MAL", totalTeachers: 8, onRumi: 7, totalLessonPlans: 42 },
  focusTeacher: null,
  teachers: [
    { id: "t1", name: "Ayesha Bibi", isPrincipal: false },
    { id: "t2", name: "Sana Riaz", isPrincipal: false },
  ],
  analytics: {
    totalSessions: 18, averageScore: 60.7,
    scoreTrend: [{ date: "2026-08-01T00:00:00Z", percentage: 58 }],
    domainBreakdown: [
      { key: "high_leverage_practices", name: "High Leverage Practices", percentage: 55.7, sessions: 18 },
    ],
    strongestDomain: "High Leverage Practices",
    focusDomain: "High Leverage Practices",
  },
  presence: {
    teacher: { records: 6, present: 6, absent: 0, leave: 0, presentPct: 100 },
    student: { sessions: 7, totalMarked: 161, present: 143, presentPct: 88.8 },
  },
  remarks: {
    submitted: 1, averagePct: 70,
    indicatorBreakdown: [
      { key: "score_growth", ordinal: 1, name: "Professional Growth & Feedback Uptake", average: 3, percentage: 75, teachers: 1 },
    ],
    focusIndicator: "Professional Growth & Feedback Uptake",
  },
};

function mount(resolver?: (id: string | null) => Promise<any>) {
  (useAuth as any).mockReturnValue({ user: { firstName: "Atifa", role: "principal" }, loading: false, logout: vi.fn() });
  (leader.getSchoolAnalytics as any).mockImplementation(
    resolver || (() => Promise.resolve(PAYLOAD)),
  );
  render(<MemoryRouter><SchoolAnalytics /></MemoryRouter>);
}

describe("SchoolAnalytics — refetch feedback", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows a spinner while the newly-picked teacher is loading", async () => {
    let release: (v: any) => void = () => {};
    mount((id) =>
      id === null
        ? Promise.resolve(PAYLOAD)
        : new Promise((res) => { release = () => res({ ...PAYLOAD, focusTeacher: { id: "t1", name: "Ayesha Bibi" } }); }),
    );

    await waitFor(() => expect(screen.getByTestId("teacher-filter")).toBeInTheDocument());
    expect(screen.queryByTestId("refetching")).not.toBeInTheDocument();

    await userEvent.selectOptions(screen.getByTestId("teacher-filter"), "t1");

    // In flight: the spinner is up.
    await waitFor(() => expect(screen.getByTestId("refetching")).toBeInTheDocument());

    release(null);
    await waitFor(() => expect(screen.queryByTestId("refetching")).not.toBeInTheDocument());
    expect(screen.getByTestId("scope-label")).toHaveTextContent("Ayesha Bibi");
  });

  it("keeps the filter usable while a refetch is in flight", async () => {
    let release: (v: any) => void = () => {};
    mount((id) =>
      id === null ? Promise.resolve(PAYLOAD)
                  : new Promise((res) => { release = () => res(PAYLOAD); }));
    await waitFor(() => expect(screen.getByTestId("teacher-filter")).toBeInTheDocument());
    await userEvent.selectOptions(screen.getByTestId("teacher-filter"), "t1");
    await waitFor(() => expect(screen.getByTestId("refetching")).toBeInTheDocument());
    // The whole page must NOT be replaced by the full-page loader — that would
    // throw away her scroll position and the filter she is still using.
    expect(screen.getByTestId("teacher-filter")).toBeInTheDocument();
    release(null);
  });
});

describe("SchoolAnalytics — panels explain themselves", () => {
  beforeEach(() => vi.clearAllMocks());

  // Rewritten 2026-09-29 for the Observations section (operator): the same
  // questions — does each panel say what it is? — asked of what replaced them.
  it("says what the Progress line IS: one rating per Human Observation", async () => {
    mount();
    await waitFor(() => expect(screen.getByTestId("progress-help")).toBeInTheDocument());
    expect(screen.getByTestId("progress-help").textContent).toMatch(/Human Observation/);
    expect(screen.getByTestId("progress-help").textContent).toMatch(/oldest to newest/i);
  });

  it("defines both kinds of observation in plain words", async () => {
    mount();
    await waitFor(() => expect(screen.getByTestId("def-human")).toBeInTheDocument());
    expect(screen.getByTestId("def-human").textContent).toMatch(/watched the lesson in class/);
    expect(screen.getByTestId("def-digital").textContent).toMatch(/recorded her own lesson/);
  });

  it("gives every panel a plain heading a principal can act on", async () => {
    mount();
    await waitFor(() => expect(screen.getByTestId("observations")).toBeInTheDocument());
    const h3 = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    // Progress and Strong and Weak Areas are one section now (operator, 2026-09-30).
    expect(h3).toEqual(expect.arrayContaining(["Observation Feedback", "When Observations Happened"]));
    expect(h3).not.toContain("Progress");
    expect(h3).not.toContain("Score over time");
    expect(h3).not.toContain("By area");
  });

  it("renders ONE view of the areas — a ranked list, never a chart of the same numbers", async () => {
    mount();
    await waitFor(() => expect(screen.getByTestId("observations")).toBeInTheDocument());
    // The only chart is the rating line; areas are a list, days are a strip.
    expect(screen.queryAllByTestId("chart").length).toBeLessThanOrEqual(1);
  });

  it("explains the attendance and evaluation panels too", async () => {
    mount();
    // Each is on its own tab (operator, 2026-09-30).
    await userEvent.click(await screen.findByRole("tab", { name: "Attendance" }));
    expect(screen.getByTestId("presence-help")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "Principal Remarks" }));
    expect(screen.getByTestId("remarks-help")).toBeInTheDocument();
  });
});
