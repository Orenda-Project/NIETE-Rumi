import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

/**
 * bd-60121 — observed lessons get their own page, like attendance did.
 *
 * On Analytics the list ran to every lesson ever: prod has schools at 63 rows
 * (median 5, p90 13) and it grows as observation coverage improves, so a cap
 * there is a band-aid. The panel keeps a short preview and links out; this
 * page is the full list, with the same teacher filter the rest of the leader
 * pages use.
 */

vi.mock("../hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("../services/api", () => ({ leader: { getSchoolAnalytics: vi.fn() } }));
vi.mock("react-apexcharts", () => ({ default: () => <div data-testid="chart" /> }));

import { useAuth } from "../hooks/useAuth";
import { leader } from "../services/api";
import SchoolLessons from "./SchoolLessons";

const trend = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    date: `2026-09-${String((i % 28) + 1).padStart(2, '0')}T00:00:00Z`,
    percentage: 50 + i,
    points: 50 + i,
    maxPoints: 100,
    teacherName: i % 2 ? 'Sana Riaz' : 'Ayesha Bibi',
  }));

const PAYLOAD = {
  success: true,
  school: { name: "IMSB (I-V), MAL", totalTeachers: 19, onRumi: 17, totalLessonPlans: 42 },
  focusTeacher: null,
  teachers: [
    { id: "t1", name: "Ayesha Bibi", isPrincipal: false },
    { id: "t2", name: "Sana Riaz", isPrincipal: false },
  ],
  analytics: {
    totalSessions: 24, averageScore: 61,
    scoreTrend: trend(24),
    domainBreakdown: [], strongestDomain: null, focusDomain: null,
  },
  presence: { teacher: { records: 0, present: 0, absent: 0, leave: 0, presentPct: null },
              student: { sessions: 0, totalMarked: 0, present: 0, presentPct: null } },
  remarks: { submitted: 0, averagePct: null, indicatorBreakdown: [], focusIndicator: null },
};

function mount(payload: any = PAYLOAD) {
  (useAuth as any).mockReturnValue({ user: { firstName: "Atifa", role: "principal" }, loading: false, logout: vi.fn() });
  (leader.getSchoolAnalytics as any).mockResolvedValue(payload);
  render(<MemoryRouter><SchoolLessons /></MemoryRouter>);
}

describe("SchoolLessons", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lists every observed lesson, not a capped preview", async () => {
    mount();
    await waitFor(() => expect(screen.getByTestId("lessons-list")).toBeInTheDocument());
    expect(screen.getAllByTestId(/^lesson-row-/)).toHaveLength(24);
  });

  it("puts the newest lesson first", async () => {
    mount();
    await waitFor(() => expect(screen.getByTestId("lessons-list")).toBeInTheDocument());
    const rows = screen.getAllByTestId(/^lesson-row-/);
    // trend() is oldest-first; the page reverses it.
    //
    // bd-60174: this asserted on the score "73", which the leader view no
    // longer renders. The DATE is the better proxy for ordering anyway — it is
    // the thing being ordered BY, where the score was only correlated with it.
    // Pull the date off the row rather than slicing a fixed width — "1 Sept"
    // and "24 Sept" are different lengths, and a fixed slice reads as NaN.
    const dateOf = (el: Element) => {
      const m = (el.textContent || "").match(/(\d{1,2} \w+ \d{4})/);
      return m ? Date.parse(m[1].replace("Sept", "Sep")) : NaN;
    };
    expect(rows[0].textContent).toMatch(/24 Sept 2026/);
    expect(dateOf(rows[0])).toBeGreaterThan(dateOf(rows[rows.length - 1]));
  });

  it("names the teacher on each row across the whole school", async () => {
    mount();
    await waitFor(() => expect(screen.getByTestId("lessons-list")).toBeInTheDocument());
    expect(screen.getAllByTestId(/^lesson-row-/)[0].textContent).toMatch(/Sana Riaz/);
  });

  it("drops the teacher name when filtered to one teacher", async () => {
    mount({ ...PAYLOAD, focusTeacher: { id: "t1", name: "Ayesha Bibi" } });
    await waitFor(() => expect(screen.getByTestId("lessons-list")).toBeInTheDocument());
    expect(screen.getAllByTestId(/^lesson-row-/)[0].textContent).not.toMatch(/Sana Riaz/);
  });

  it("refetches scoped to one teacher from the filter", async () => {
    mount();
    await waitFor(() => expect(screen.getByTestId("teacher-filter")).toBeInTheDocument());
    await userEvent.selectOptions(screen.getByTestId("teacher-filter"), "t1");
    await waitFor(() => expect(leader.getSchoolAnalytics).toHaveBeenLastCalledWith("t1"));
  });

  it("says so when no lesson has been observed yet", async () => {
    mount({ ...PAYLOAD, analytics: { ...PAYLOAD.analytics, totalSessions: 0, scoreTrend: [] } });
    await waitFor(() => expect(screen.getByTestId("lessons-empty")).toBeInTheDocument());
  });
});
