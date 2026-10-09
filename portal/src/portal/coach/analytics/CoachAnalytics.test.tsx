import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";

/**
 * bd-fmf24g.27 — the coach's Analytics: her teachers across her schools with a school filter; lifetime counts (no range
 * bar, no change pill); a row opens that teacher; a teacher who is not hers is Not found.
 */
vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: any) => <div>{children}</div> }));
vi.mock("../CoachGate", () => ({ default: ({ children }: any) => <>{children}</> }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: () => ({ user: { firstName: "Hataf", role: "coach", phoneNumber: "923001234567" }, loading: false }) }));
vi.mock("../../services/api", () => ({
  coach: { getPeople: vi.fn(), getTeacher: vi.fn(), getPending: vi.fn(() => Promise.resolve({ waiting: 0, ids: [] })) },
  language: { get: vi.fn(() => new Promise(() => {})), set: vi.fn() },
}));
import { coach } from "../../services/api";
import { CoachAnalytics, CoachTeacherAnalytics, COACH_ANALYTICS, COACH_ANALYTICS_TEACHER } from "./CoachAnalytics";
import { ANALYTICS_V2_COPY as C } from "../../teacher/analytics/copy";
import { teacherPathOf } from "./model";

const API = coach as any;
const T = (name: string, o: Record<string, unknown>) => ({
  teacherExtId: "9230011100" + name.length, name, phone: null, schoolName: "IMSG I-10/1", schoolExtId: "niete:110", emis: "110",
  hitl: 0, dc: 0, avgHitl: null, daysSinceVisit: null, daysSinceTraining: null, trainingModules: 0, examsGenerated: 0, ...o,
});
const PEOPLE = {
  success: true,
  teachers: [
    T("Ayesha", { teacherExtId: "t1", hitl: 2, dc: 6, avgHitl: 65, trainingModules: 3, examsGenerated: 1 }),
    T("Sadia", { teacherExtId: "t2", schoolName: "IMCB G-9/4", schoolExtId: "niete:494", hitl: 1, dc: 1, avgHitl: 30, trainingModules: 2, examsGenerated: 4 }),
    T("The Principal", { teacherExtId: "t3", isPrincipal: true, hitl: 9, dc: 9 }),
  ],
  schools: [
    { schoolExtId: "niete:110", emis: "110", name: "IMSG I-10/1", teachers: 2, visits: 1, daysSinceVisit: 1, avgHitl: 60 },
    { schoolExtId: "niete:494", emis: "494", name: "IMCB G-9/4", teachers: 1, visits: 1, daysSinceVisit: 1, avgHitl: 30 },
  ],
};
const open = (path = COACH_ANALYTICS) => render(
  <MemoryRouter initialEntries={[path]}>
    <Routes>
      <Route path={COACH_ANALYTICS} element={<CoachAnalytics />} />
      <Route path={COACH_ANALYTICS_TEACHER} element={<CoachTeacherAnalytics />} />
    </Routes>
  </MemoryRouter>,
);
const tile = (c: HTMLElement, f: string) => c.querySelector(`[data-feature-tile='${f}']`)!;

beforeEach(() => { vi.clearAllMocks(); API.getPeople.mockResolvedValue(PEOPLE); });

describe("coach Analytics", () => {
  it("sums her teachers (not principals) into the four tiles, no range bar, no change pill", async () => {
    const { container } = open();
    await screen.findByText("Ayesha");
    expect(within(tile(container, "observations") as HTMLElement).getByText("3")).toBeTruthy();
    expect(within(tile(container, "coaching") as HTMLElement).getByText("7")).toBeTruthy();
    expect(within(tile(container, "training") as HTMLElement).getByText("5")).toBeTruthy();
    expect(within(tile(container, "assessment") as HTMLElement).getByText("5")).toBeTruthy();
    expect(container.querySelector("[data-delta]")).toBeNull();
    expect(screen.queryByText(C.attendanceDays)).toBeNull();
    expect(screen.queryByText("The Principal")).toBeNull();
  });

  it("each teacher is a row with school, counts and a rating word, opening her page", async () => {
    open();
    const row = await screen.findByRole("link", { name: /Ayesha/ });
    expect(row).toHaveAttribute("href", teacherPathOf("t1"));
    expect(row).toHaveTextContent("IMSG I-10/1 · 2 Observations · 6 DC");
    expect(row).toHaveTextContent("Good");
    expect(screen.getByRole("link", { name: /Sadia/ })).toHaveTextContent("Below average");
  });

  it("the school filter narrows the tiles and the rows; All schools brings them back", async () => {
    const user = userEvent.setup();
    const { container } = open();
    await screen.findByText("Ayesha");
    await user.click(screen.getByRole("radio", { name: "IMCB G-9/4" }));
    expect(screen.queryByText("Ayesha")).toBeNull();
    expect(within(tile(container, "observations") as HTMLElement).getByText("1")).toBeTruthy();
    await user.click(screen.getByRole("radio", { name: C.allSchools }));
    expect(await screen.findByText("Ayesha")).toBeTruthy();
  });

  it("one teacher: asks the coach API for that id; a lesson-plan count she has not is left out", async () => {
    API.getTeacher.mockResolvedValue({ success: true, teacher: T("Ayesha", { teacherExtId: "t1", hitl: 2, dc: 6, lpOpened: null }), history: [{ id: "a", date: "2026-09-28T05:00:00Z", kind: "HITL", score: 66 }], nextVisit: null });
    const { container } = open(teacherPathOf("t1"));
    expect(await screen.findByRole("heading", { name: "Ayesha" })).toBeTruthy();
    expect(API.getTeacher).toHaveBeenCalledWith("t1");
    expect(container.querySelector("[data-feature-tile='lessons']")).toBeNull();
    expect(container.querySelector("[data-feature-card='observations']")).not.toBeNull();
  });

  it("a teacher who is not hers (the API refuses) is Not found, nothing else", async () => {
    API.getTeacher.mockRejectedValue(new Error("404"));
    const { container } = open(teacherPathOf("someone-else"));
    expect(await screen.findByText(C.notFound)).toBeTruthy();
    expect(container.querySelector("[data-feature-tile]")).toBeNull();
  });
});
