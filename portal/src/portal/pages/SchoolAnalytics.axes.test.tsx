import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * bd-60174 (STEPS v1.1, principal-dashboard feedback item 2).
 *
 * Reported as: "Lesson and observation score graph is confusing and can't be
 * understood at a glance. It needs to be either clearly labelled (what the axes
 * represent, what the score means) or replaced with a simpler visual."
 *
 * The chart drew tick labels on both axes but never said what either axis WAS:
 * no xaxis.title, no yaxis.title. The reader got dates along the bottom and
 * percentages up the side, with nothing naming the quantity.
 *
 * Apex renders through a ResizeObserver that jsdom does not implement, so the
 * suite already stubs react-apexcharts. This stub goes one step further and
 * CAPTURES the options object the component passes — so the assertion runs
 * against the real `trendOptions` the component built, not against source text.
 */

const captured: { options?: any; series?: any } = {};

vi.mock("../hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("../services/api", () => ({ leader: { getSchoolAnalytics: vi.fn() } }));
vi.mock("react-apexcharts", () => ({
  default: (props: any) => {
    captured.options = props.options;
    captured.series = props.series;
    return <div data-testid="chart" />;
  },
}));

import { useAuth } from "../hooks/useAuth";
import { leader } from "../services/api";
import SchoolAnalytics from "./SchoolAnalytics";

const ANALYTICS = {
  success: true,
  school: { name: "IMSG Mohra Nagial", totalTeachers: 19, onRumi: 17, totalLessonPlans: 269 },
  analytics: {
    totalSessions: 3,
    averageScore: 67.7,
    scoreTrend: [
      { date: "2026-09-01T00:00:00Z", percentage: 61 },
      { date: "2026-09-08T00:00:00Z", percentage: 68 },
      { date: "2026-09-15T00:00:00Z", percentage: 74 },
    ],
    domainBreakdown: [
      { key: "student_engagement", name: "Student Engagement", percentage: 78.5, sessions: 3 },
    ],
    strongestDomain: "Student Engagement",
    focusDomain: "Student Engagement",
  },
};

function mount(payload: any = ANALYTICS) {
  (useAuth as any).mockReturnValue({ user: { firstName: "Atifa", role: "principal" }, loading: false, logout: vi.fn() });
  (leader.getSchoolAnalytics as any).mockResolvedValue(payload);
  render(<MemoryRouter><SchoolAnalytics /></MemoryRouter>);
}

describe("SchoolAnalytics score trend — the axes say what they are (bd-60174)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete captured.options;
    delete captured.series;
  });

  it("titles the x axis so the reader knows each point is one observed lesson", async () => {
    mount();
    await waitFor(() => expect(captured.options).toBeDefined());
    expect(captured.options?.xaxis?.title?.text).toBeTruthy();
  });

  it("titles the y axis with the quantity, not just the % on the ticks", async () => {
    mount();
    await waitFor(() => expect(captured.options).toBeDefined());
    const title = captured.options?.yaxis?.title?.text;
    expect(title).toBeTruthy();
    // "%" was already on the ticks and was not enough: the title has to carry a
    // word, so the reader learns what is being scored.
    expect(String(title)).toMatch(/score|lesson/i);
  });
});
