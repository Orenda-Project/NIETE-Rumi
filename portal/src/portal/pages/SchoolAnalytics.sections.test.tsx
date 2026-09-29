import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

/**
 * The Analytics page, as agreed with the operator on 2026-09-29. Audience:
 * principals who are not tech-savvy, so every title and label is plain.
 *
 *   School Analytics
 *   ├─ Observations            (S·T·E)
 *   │   Human Observation          — you or a coach watched the lesson in class
 *   │   Digital Coach Observation  — the teacher recorded her own lesson
 *   │   · two counts, one per kind
 *   │   · Progress                 — Human Observations only
 *   │   · Strong and Weak Areas    — Human Observations only, the 3 STEPS areas
 *   │   · When Observations Happened — BOTH kinds, a monthly chart + month list
 *   ├─ Attendance              (P)
 *   └─ Principal Remarks       (S)
 *
 * Ratings come from Human Observations only because STEPS feeds each
 * teacher's ACR, and 83% of analysed sessions on prod are lessons she recorded
 * herself (17,282 of 20,725, 2026-09-29).
 */

const charts: Array<{ type: string; options: any; series: any }> = [];
vi.mock("react-apexcharts", () => ({
  default: (props: any) => {
    charts.push({ type: props.type, options: props.options, series: props.series });
    return <div data-testid={`chart-${props.type}`} />;
  },
}));
vi.mock("../hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("../services/api", () => ({
  leader: {
    getSchoolAnalytics: vi.fn(),
    getSteps: vi.fn().mockResolvedValue({ success: true, cycle: null, teachers: [], summary: {} }),
  },
}));

import { useAuth } from "../hooks/useAuth";
import { leader } from "../services/api";
import SchoolAnalytics from "./SchoolAnalytics";

const OBSERVATIONS = [
  { date: "2026-09-20T09:00:00Z", kind: "digital_coach", percentage: null, teacherName: "Ayesha Bibi" },
  { date: "2026-09-15T09:00:00Z", kind: "human", percentage: 64, teacherName: "Ayesha Bibi" },
  { date: "2026-09-02T09:00:00Z", kind: "digital_coach", percentage: null, teacherName: "Sana Riaz" },
  { date: "2026-08-12T09:00:00Z", kind: "human", percentage: 48, teacherName: "Ayesha Bibi" },
];

const PAYLOAD = {
  success: true,
  school: { name: "IMSG Mohra Nagial", totalTeachers: 19, onRumi: 17, totalLessonPlans: 42 },
  focusTeacher: null,
  teachers: [{ id: "t1", name: "Ayesha Bibi", isPrincipal: false }],
  analytics: {
    totalSessions: 4,
    humanObservations: 2,
    digitalCoachObservations: 2,
    averageScore: 56,
    scoreTrend: [
      { date: "2026-08-12T09:00:00Z", percentage: 48, points: 48, maxPoints: 100, teacherName: "Ayesha Bibi" },
      { date: "2026-09-15T09:00:00Z", percentage: 64, points: 64, maxPoints: 100, teacherName: "Ayesha Bibi" },
    ],
    areas: [
      { key: "e", name: "Engagement", pct: 89.3, band: "excellent", observations: 2 },
      { key: "t", name: "Teaching skills", pct: 54.5, band: "average", observations: 2 },
      { key: "s", name: "Subject knowledge", pct: 18.8, band: "needs_support", observations: 2 },
    ],
    byMonth: [
      { month: "2026-08", human: 1, digitalCoach: 0 },
      { month: "2026-09", human: 1, digitalCoach: 2 },
    ],
    observations: OBSERVATIONS,
    domainBreakdown: [], strongestDomain: null, focusDomain: null,
  },
  presence: {
    teacher: { records: 20, present: 18, absent: 2, leave: 0, presentPct: 90 },
    student: { sessions: 5, totalMarked: 200, present: 180, presentPct: 90 },
  },
  remarks: { submitted: 0, averagePct: null, indicatorBreakdown: [], focusIndicator: null },
};

function mount(over: any = {}) {
  (useAuth as any).mockReturnValue({ user: { firstName: "Atifa", role: "principal" }, loading: false, logout: vi.fn() });
  (leader.getSchoolAnalytics as any).mockResolvedValue({ ...PAYLOAD, ...over, analytics: { ...PAYLOAD.analytics, ...(over.analytics || {}) } });
  render(<MemoryRouter><SchoolAnalytics /></MemoryRouter>);
}

const headings = (level: number) =>
  screen.getAllByRole("heading", { level }).map((h) => h.textContent?.trim() || "");

beforeEach(() => {
  vi.clearAllMocks();
  charts.length = 0;
});

describe("the page and its sections have plain names", () => {
  it("is titled School Analytics", async () => {
    mount();
    expect(await screen.findByRole("heading", { level: 1, name: "School Analytics" })).toBeInTheDocument();
  });

  it("has Observations, Attendance and Principal Remarks, in that order", async () => {
    mount();
    await screen.findByTestId("observations");
    const order = ["Observations", "Attendance", "Principal Remarks"].map((t) => headings(2).indexOf(t));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("the old vague titles are gone", async () => {
    mount();
    await screen.findByTestId("observations");
    const all = [...headings(1), ...headings(2), ...headings(3)];
    for (const old of ["Your school", "Who is showing up", "Your evaluations", "Are lessons improving?",
      "What teaching is strongest and weakest", "Recent observed lessons", "Where to focus"]) {
      expect(all).not.toContain(old);
    }
  });

  it("no longer counts 'Coaching sessions' or claims a coach sat in", async () => {
    mount();
    await screen.findByTestId("observations");
    expect(document.body.textContent).not.toMatch(/Coaching sessions/);
    expect(document.body.textContent).not.toMatch(/a coach sat in/i);
  });
});

describe("Observations", () => {
  it("explains both kinds in one simple sentence each", async () => {
    mount();
    const obs = await screen.findByTestId("observations");
    expect(within(obs).getByTestId("def-human")).toHaveTextContent(/Human Observation.*watched the lesson in class/);
    expect(within(obs).getByTestId("def-digital")).toHaveTextContent(/Digital Coach Observation.*recorded (her|their) own lesson/);
  });

  it("counts each kind", async () => {
    mount();
    const obs = await screen.findByTestId("observations");
    expect(within(obs).getByTestId("count-human")).toHaveTextContent("2");
    expect(within(obs).getByTestId("count-human")).toHaveTextContent("Human Observations");
    expect(within(obs).getByTestId("count-digital")).toHaveTextContent("2");
    expect(within(obs).getByTestId("count-digital")).toHaveTextContent("Digital Coach Observations");
  });

  it("Progress plots Human Observations only", async () => {
    mount();
    const obs = await screen.findByTestId("observations");
    expect(within(obs).getByRole("heading", { level: 3, name: "Progress" })).toBeInTheDocument();
    const line = charts.find((c) => c.type === "line");
    expect(line?.series[0].data).toEqual([48, 64]);
    expect(within(obs).getByTestId("progress-help")).toHaveTextContent(/Human Observation/);
  });

  it("Strong and Weak Areas lists the three areas, strongest first, and marks the weakest", async () => {
    mount();
    const obs = await screen.findByTestId("observations");
    expect(within(obs).getByRole("heading", { level: 3, name: "Strong and Weak Areas" })).toBeInTheDocument();
    const items = within(obs).getAllByTestId(/^area-/);
    expect(items.map((i) => i.getAttribute("data-testid"))).toEqual(["area-e", "area-t", "area-s"]);
    expect(items[0]).toHaveTextContent(/Engagement.*Excellent/);
    expect(items[2]).toHaveTextContent(/Subject knowledge.*Needs support/);
    expect(items[2]).toHaveTextContent(/work on this/i);
    expect(items[0]).not.toHaveTextContent(/work on this/i);
  });

  it("When Observations Happened is a monthly chart of BOTH kinds", async () => {
    mount();
    const obs = await screen.findByTestId("observations");
    expect(within(obs).getByRole("heading", { level: 3, name: "When Observations Happened" })).toBeInTheDocument();
    const bar = charts.find((c) => c.type === "bar");
    expect(bar?.options?.chart?.stacked).toBe(true);
    expect(bar?.series.map((s: any) => s.name)).toEqual(["Human Observations", "Digital Coach Observations"]);
    expect(bar?.series.map((s: any) => s.data)).toEqual([[1, 1], [0, 2]]);
  });

  it("each month is a plain button that lists what happened that month", async () => {
    mount();
    await screen.findByTestId("observations");
    // The newest month is shown to start with.
    expect(screen.getAllByTestId(/^obs-row-/)).toHaveLength(3);
    await userEvent.click(screen.getByTestId("month-2026-08"));
    const rows = screen.getAllByTestId(/^obs-row-/);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent(/Human Observation/);
    expect(rows[0]).toHaveTextContent(/Average/); // 48
  });

  it("only a Human Observation shows a rating in the list", async () => {
    mount();
    await screen.findByTestId("observations");
    const rows = screen.getAllByTestId(/^obs-row-/);
    const digital = rows.filter((r) => /Digital Coach Observation/.test(r.textContent || ""));
    expect(digital.length).toBeGreaterThan(0);
    for (const r of digital) {
      expect(r.textContent).not.toMatch(/Excellent|Good|Average|Needs support/);
    }
  });

  it("with no Human Observations, says so plainly instead of an empty chart", async () => {
    mount({ analytics: { humanObservations: 0, scoreTrend: [], areas: [], averageScore: null } });
    const obs = await screen.findByTestId("observations");
    expect(within(obs).getAllByText(/No Human Observations yet/).length).toBeGreaterThan(0);
    expect(charts.find((c) => c.type === "line")).toBeUndefined();
    // The monthly chart still shows, because Digital Coach Observations exist.
    expect(charts.find((c) => c.type === "bar")).toBeDefined();
  });

  it("no rating inside Observations is a number or a percentage", async () => {
    mount();
    const obs = await screen.findByTestId("observations");
    expect(obs.textContent).not.toMatch(/\d+(?:\.\d+)?\s*%/);
  });
});
