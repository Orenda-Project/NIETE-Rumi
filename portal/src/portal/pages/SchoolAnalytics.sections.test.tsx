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
    // The Attendance tab loads its detail too (2026-09-30).
    getAttendance: vi.fn().mockResolvedValue({ success: true, from: null, to: null, focusTeacher: null, teachers: [], schoolDays: [], students: { groups: [], byDay: [] }, staff: { groups: [], byDay: [] } }),
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

  it("has Observations, Attendance and Principal Remarks, in that order — as tabs", async () => {
    mount();
    await screen.findByTestId("observations");
    // One section at a time since 2026-09-30; the ORDER now lives in the tabs.
    expect(screen.getAllByRole("tab").map((t) => t.textContent?.trim()))
      .toEqual(["Observations", "Attendance", "Principal Remarks"]);
    expect(headings(2)).toContain("Observations");
    await userEvent.click(screen.getByRole("tab", { name: "Attendance" }));
    expect(headings(2)).toContain("Attendance");
    await userEvent.click(screen.getByRole("tab", { name: "Principal Remarks" }));
    expect(headings(2)).toContain("Principal Remarks");
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
    // Each card names its kind and, inside it, says what that kind is.
    expect(within(obs).getByTestId("count-human")).toHaveTextContent(/Human Observation.*watched the lesson in class/i);
    expect(within(obs).getByTestId("count-digital")).toHaveTextContent(/Digital Coach Observation.*recorded (her|their) own lesson/i);
  });

  it("counts each kind", async () => {
    mount();
    const obs = await screen.findByTestId("observations");
    expect(within(obs).getByTestId("count-human")).toHaveTextContent("2");
    expect(within(obs).getByTestId("count-human")).toHaveTextContent("Human Observations");
    expect(within(obs).getByTestId("count-digital")).toHaveTextContent("2");
    expect(within(obs).getByTestId("count-digital")).toHaveTextContent("Digital Coach Observations");
  });

  it("Observation Feedback plots Human Observations only", async () => {
    mount();
    const obs = await screen.findByTestId("observations");
    expect(within(obs).getByRole("heading", { level: 3, name: "Observation Feedback" })).toBeInTheDocument();
    const line = charts.find((c) => c.type === "line");
    expect(line?.series[0].data).toEqual([48, 64]);
    expect(within(obs).getByTestId("progress-help")).toHaveTextContent(/Human Observation/);
  });

  it("Observation Feedback lists the three areas, strongest first, and marks the weakest", async () => {
    mount();
    const fb = await screen.findByTestId("observation-feedback");
    const items = within(fb).getAllByTestId(/^area-/);
    expect(items.map((i) => i.getAttribute("data-testid"))).toEqual(["area-e", "area-t", "area-s"]);
    expect(items[0]).toHaveTextContent(/Engagement.*Excellent/);
    expect(items[2]).toHaveTextContent(/Subject knowledge.*Needs support/);
    expect(items[2]).toHaveTextContent(/work on this/i);
    expect(items[0]).not.toHaveTextContent(/work on this/i);
  });

  it("When Observations Happened is a day strip of BOTH kinds", async () => {
    mount();
    const obs = await screen.findByTestId("observations");
    expect(within(obs).getByRole("heading", { level: 3, name: "When Observations Happened" })).toBeInTheDocument();
    expect(charts.find((c) => c.type === "bar")).toBeUndefined();
    expect(within(obs).getByTestId("obs-day-2026-08-12")).toHaveTextContent("1"); // Human
    expect(within(obs).getByTestId("obs-day-2026-09-02")).toHaveTextContent("1"); // Digital Coach
    expect(within(obs).getByTestId("obs-day-2026-09-03")).toHaveTextContent("–");
  });

  it("each day is a plain button that lists what happened that day", async () => {
    mount();
    await screen.findByTestId("observations");
    // The newest day is shown to start with.
    expect(screen.getByTestId("obs-day-2026-09-20")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getAllByTestId(/^obs-row-/)).toHaveLength(1);
    await userEvent.click(screen.getByTestId("obs-day-2026-08-12"));
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
    // The day strip still shows, because Digital Coach Observations exist.
    expect(within(obs).getByTestId("obs-strip")).toBeInTheDocument();
  });

  it("no rating inside Observations is a number or a percentage", async () => {
    mount();
    const obs = await screen.findByTestId("observations");
    expect(obs.textContent).not.toMatch(/\d+(?:\.\d+)?\s*%/);
  });
});
