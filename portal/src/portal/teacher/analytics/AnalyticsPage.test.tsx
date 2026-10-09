import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

/**
 * bd-fmf24g.8 — Analytics (v28 canvas): the existing GET /progress (this period + the one before) and
 * GET /my-analytics, in the v2 look. Ratings as bands; the lesson-plan and paper counts shown
 * (operator, 2026-10-08); See all → All lesson plans and All Digital Coaching.
 */

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("../../lib/recordingSession", () => ({ useRecordingSession: () => null }));
vi.mock("../../services/api", () => ({
  default: { get: vi.fn(), post: vi.fn() },
  portal: { getMyAnalytics: vi.fn() },
}));

import "../routes";
import api, { portal } from "../../services/api";
import analyticsRoutes from "./routes";
import { ANALYTICS_HOME, ANALYTICS_TEACHER } from "./paths";
import { ANALYTICS_V2_COPY as C } from "./copy";
import { LESSONS_ALL } from "../lessons/paths";
import { COACHING_ALL } from "../coaching/paths";
import { teacherPath } from "../routes";

const http = api as unknown as { get: ReturnType<typeof vi.fn> };
const mine = portal.getMyAnalytics as unknown as ReturnType<typeof vi.fn>;

const PROGRESS = {
  lessonPlans: { used: 14 }, training: { completed: 6 }, assessments: { made: 4 },
  attendance: { days: 18 }, coaching: { digitalCoach: 9, observations: 3 },
};
const BEFORE = { ...PROGRESS, lessonPlans: { used: 11 }, coaching: { digitalCoach: 7, observations: 3 } };

const MINE = {
  success: true,
  totals: { lessonPlans: 20, examsGenerated: 5 },
  analytics: {
    totalSessions: 3, averageScore: 66, domainBreakdown: [], strongestDomain: null, focusDomain: null,
    scoreTrend: [
      { date: "2026-08-12", percentage: 45, points: null, maxPoints: null, teacherName: null },
      { date: "2026-09-03", percentage: 63, points: null, maxPoints: null, teacherName: null },
      { date: "2026-09-28", percentage: 66, points: null, maxPoints: null, teacherName: null },
    ],
    areas: [
      { key: "t", name: "Teaching skills", pct: 72, band: "good", observations: 3 },
      { key: "s", name: "Subject knowledge", pct: 51, band: "average", observations: 3 },
    ],
  },
  presence: {
    teacher: { records: 20, present: 19, absent: 1, leave: 0, presentPct: 95 },
    student: { sessions: 30, totalMarked: 900, present: 783, presentPct: 87 },
  },
  remarksReceived: [{ cycleName: "Q2", submittedAt: "2026-09-28T09:00:00Z", comment: "Good use of the board.", areas: [] }],
};

const open = () => render(
  <MemoryRouter initialEntries={[ANALYTICS_HOME]}>
    <Routes>{analyticsRoutes.map((r) => <Route key={r.path} path={r.path} element={r.element} />)}</Routes>
  </MemoryRouter>,
);

beforeEach(() => {
  vi.clearAllMocks();
  http.get.mockImplementation(async (_url: string, cfg?: { params?: { range?: string } }) => ({
    data: cfg?.params?.range === "custom" ? BEFORE : PROGRESS,
  }));
  mine.mockResolvedValue(MINE);
});

describe("Analytics", () => {
  it("registers at /portal/teacher/analytics; Back goes to More", async () => {
    expect(analyticsRoutes.map((r) => r.path)).toEqual([ANALYTICS_HOME, ANALYTICS_TEACHER]);
    open();
    expect(await screen.findByRole("heading", { name: C.title })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back" }).getAttribute("href")).toBe(teacherPath("more"));
  });

  it("This month by default: /progress for this period and the one before, /my-analytics for the same dates", async () => {
    open();
    await screen.findByText(C.lessonPlansUsed);
    expect(http.get).toHaveBeenCalledWith("/progress", { params: { range: "this_month" } });
    expect(http.get).toHaveBeenCalledWith("/progress", { params: expect.objectContaining({ range: "custom" }) });
    expect(mine).toHaveBeenCalledWith(expect.objectContaining({ from: expect.stringMatching(/^\d{4}-\d{2}-01$/) }));
  });

  it("Activity and Observations tiles show the counts, lesson plans and papers included, with their change", async () => {
    open();
    const activity = await screen.findByRole("region", { name: C.activity });
    expect(within(activity).getByText("14")).toBeTruthy();
    expect(within(activity).getByText(C.papersMade)).toBeTruthy();
    expect(within(activity).getByText("4")).toBeTruthy();
    expect(within(activity).getByText("18")).toBeTruthy();
    const obs = screen.getByRole("region", { name: C.observationsHeading });
    expect(within(obs).getByText("9")).toBeTruthy();
    expect(within(obs).getByText(C.digitalCoaching)).toBeTruthy();
  });

  it("the tiles wear their feature, centred, with the locked names and no compare line or pressable look", async () => {
    const { container } = open();
    await screen.findByRole("region", { name: C.activity });
    expect(Array.from(container.querySelectorAll("[data-feature-tile]")).map((t) => t.getAttribute("data-feature-tile"))).toEqual([
      "lessons", "training", "assessment", "attendance", "observations", "coaching",
    ]);
    for (const name of ["Lesson Plans", "Assessments", "Coach Observations", "Digital Coaching"]) expect(screen.getByText(name)).toBeTruthy();
    expect(container.textContent).not.toMatch(/vs \d/);
    expect(container.querySelector("[data-feature-tile] a, [data-feature-tile] button")).toBeNull();
  });

  it("charts and bars take the feature's colour, never a grade colour", async () => {
    const { container } = open();
    await screen.findByRole("img", { name: /Average.*Good.*Good/ });
    expect(container.querySelector("polyline")).toHaveAttribute("stroke", "#c8331f");
    expect(container.querySelector("[data-feature-card='attendance'] i")).toHaveStyle({ background: "#33374a" });
  });

  it("See all rows go to All lesson plans and All Digital Coaching", async () => {
    open();
    expect((await screen.findByRole("link", { name: C.allLessonPlans })).getAttribute("href")).toBe(LESSONS_ALL);
    expect(screen.getByRole("link", { name: C.allDigitalCoaching }).getAttribute("href")).toBe(COACHING_ALL);
  });

  it("rating over time as bands (no numbers), strongest → weakest with the focus, attendance, principal remarks", async () => {
    open();
    const chart = await screen.findByRole("img", { name: /Average.*Good.*Good/ });
    expect(chart.textContent).not.toMatch(/\d+%/);
    for (const band of ["Excellent", "Good", "Average", "Below average", "Needs support"]) {
      expect(within(chart).getAllByText(band).length).toBeGreaterThan(0);
    }
    const areas = screen.getByRole("region", { name: C.strongestToWeakest });
    expect(Array.from(areas.querySelectorAll("[data-meter-row]")).map((li) => li.textContent)).toEqual([
      expect.stringContaining("Teaching skills"), expect.stringContaining("Subject knowledge"),
    ]);
    expect(within(areas).getByText(C.focus)).toBeTruthy();
    const att = screen.getByRole("region", { name: C.attendance });
    // numbers and short labels, never "19 of 20 days" (operator, 2026-10-10)
    expect(within(att).queryByText(C.daysOf(19, 20))).toBeNull();
    expect(within(att).getByText(C.youWerePresent)).toBeTruthy();
    expect(within(att).getByText("95%")).toBeTruthy();
    expect(within(att).getByText("87%")).toBeTruthy();
    const remarks = screen.getByRole("region", { name: C.principalRemarks });
    expect(within(remarks).getByText("Good use of the board.")).toBeTruthy();
    expect(within(remarks).getByText("28 Sep")).toBeTruthy();
  });

  it("nothing rated, no remarks, nothing marked → each section says so instead of inventing numbers", async () => {
    mine.mockResolvedValue({
      ...MINE,
      analytics: { ...MINE.analytics, scoreTrend: [], areas: [] },
      presence: { teacher: { records: 0, present: 0, absent: 0, leave: 0, presentPct: null }, student: { sessions: 0, totalMarked: 0, present: 0, presentPct: null } },
      remarksReceived: [],
    });
    open();
    expect(await screen.findByText(C.noRatingsYet)).toBeTruthy();
    expect(screen.getByText(C.noRemarksYet)).toBeTruthy();
    expect(screen.queryByRole("region", { name: C.strongestToWeakest })).toBeNull();
    await waitFor(() => expect(screen.queryByRole("region", { name: C.attendance })).toBeNull());
  });
});
