import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * A teacher's own Analytics page is the page her principal sees when she
 * picks that teacher (operator, 2026-09-30), in the teacher's own words:
 *   · top row: her lesson plans and exams generated
 *   · Observations — both kinds defined, two counts, Progress and Strong and
 *     Weak Areas from Human Observations, and When Observations Happened —
 *     where HER Digital Coach Observations carry their ratings too
 *   · Attendance — her own presence and her students', kept separate
 *   · Principal Remarks — the remark she received: comment and each area
 */

vi.mock("react-apexcharts", () => ({ default: (p: any) => <div data-testid={`chart-${p.type}`} /> }));
vi.mock("../hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("../services/api", () => ({ portal: { getMyAnalytics: vi.fn() } }));

import { useAuth } from "../hooks/useAuth";
import { portal } from "../services/api";
import PortalCoachingAnalytics from "./PortalCoachingAnalytics";

const PAYLOAD = {
  success: true,
  totals: { lessonPlans: 12, examsGenerated: 5 },
  analytics: {
    totalSessions: 3, humanObservations: 1, digitalCoachObservations: 2, averageScore: 64,
    scoreTrend: [{ date: "2026-09-15T09:00:00Z", percentage: 64, points: 64, maxPoints: 100, teacherName: null }],
    areas: [
      { key: "e", name: "Engagement", pct: 85, band: "excellent", observations: 1 },
      { key: "s", name: "Subject knowledge", pct: 30, band: "below_average", observations: 1 },
    ],
    byMonth: [{ month: "2026-09", human: 1, digitalCoach: 2 }],
    observations: [
      { date: "2026-09-20T09:00:00Z", kind: "digital_coach", percentage: 90, teacherName: null },
      { date: "2026-09-15T09:00:00Z", kind: "human", percentage: 64, teacherName: null },
      { date: "2026-09-02T09:00:00Z", kind: "digital_coach", percentage: 45, teacherName: null },
    ],
    domainBreakdown: [], strongestDomain: null, focusDomain: null,
  },
  presence: {
    teacher: { records: 20, present: 18, absent: 1, leave: 1, presentPct: 94.7 },
    student: { sessions: 6, totalMarked: 240, present: 210, presentPct: 87.5 },
  },
  remarksReceived: [{
    cycleName: "Third Quarter 2026", submittedAt: "2026-09-24T10:00:00Z", comment: "Prepares well and is punctual.",
    areas: [
      { ordinal: 1, name: "Professional Growth & Feedback Uptake", score: 3 },
      { ordinal: 2, name: "Collaboration & Peer Support", score: 4 },
    ],
  }],
};

function mount(over: any = {}) {
  (useAuth as any).mockReturnValue({ user: { firstName: "Ayesha", role: "teacher" }, loading: false, logout: vi.fn() });
  (portal.getMyAnalytics as any).mockResolvedValue({ ...PAYLOAD, ...over });
  render(<MemoryRouter><PortalCoachingAnalytics /></MemoryRouter>);
}

beforeEach(() => vi.clearAllMocks());

describe("the teacher's own Analytics page", () => {
  it("is titled My Analytics", async () => {
    mount();
    expect(await screen.findByRole("heading", { level: 1, name: "My Analytics" })).toBeInTheDocument();
  });

  it("shows her lesson plans and exams generated", async () => {
    mount();
    expect(await screen.findByTestId("kpi-lesson-plans")).toHaveTextContent("12");
    expect(screen.getByTestId("kpi-exams")).toHaveTextContent("5");
    expect(screen.getByTestId("kpi-exams")).toHaveTextContent("Exams generated");
  });

  it("has Observations, Attendance and Principal Remarks, in that order", async () => {
    mount();
    await screen.findByTestId("observations");
    const h2 = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent?.trim());
    const order = ["Observations", "Attendance", "Principal Remarks"].map((t) => h2.indexOf(t));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("defines both kinds of observation in her words", async () => {
    mount();
    expect(await screen.findByTestId("def-human")).toHaveTextContent(/watched your lesson in class/);
    expect(screen.getByTestId("def-digital")).toHaveTextContent(/you recorded your own lesson/i);
  });

  it("rates her own Digital Coach Observations in the list", async () => {
    mount();
    await screen.findByTestId("observations");
    const rows = screen.getAllByTestId(/^obs-row-/);
    const digital = rows.find((r) => /Digital Coach Observation/.test(r.textContent || ""));
    expect(digital).toHaveTextContent("Excellent"); // 90
  });

  it("keeps Progress and the areas on Human Observations", async () => {
    mount();
    const obs = await screen.findByTestId("observations");
    expect(within(obs).getByTestId("progress-help")).toHaveTextContent(/Human Observation/);
    expect(within(obs).getByTestId("area-s")).toHaveTextContent(/work on this/i);
  });

  it("shows her own presence and her students', separately, with no link to the principal's page", async () => {
    mount();
    await screen.findByTestId("observations");
    expect(screen.getByTestId("presence-teacher-block")).toHaveTextContent(/You were present/);
    expect(screen.getByTestId("presence-teacher-block")).toHaveTextContent(/18 present · 1 absent · 1 on leave/);
    expect(screen.getByTestId("presence-student-block")).toHaveTextContent(/Your students/);
    expect(screen.queryByTestId("attendance-detail-link")).toBeNull();
    // …but a link to her OWN attendance page.
    expect(screen.getByTestId("my-attendance-link")).toHaveAttribute("href", "/portal/attendance");
  });

  it("shows the remark she received — the quarter, the comment and each area", async () => {
    mount();
    const r = await screen.findByTestId("remark-received-0");
    expect(r).toHaveTextContent("Third Quarter 2026");
    expect(r).toHaveTextContent("Prepares well and is punctual.");
    expect(r).toHaveTextContent(/Professional Growth & Feedback Uptake.*3\/4/);
    expect(r).toHaveTextContent(/Collaboration & Peer Support.*4\/4/);
  });

  it("says so plainly when she has not received a remark yet", async () => {
    mount({ remarksReceived: [] });
    expect(await screen.findByTestId("remarks-empty")).toHaveTextContent(/No remark from your principal yet/);
  });

  it("no observation rating is a number or a percentage", async () => {
    mount();
    const obs = await screen.findByTestId("observations");
    expect(obs.textContent).not.toMatch(/\d+(?:\.\d+)?\s*%/);
  });
});
