import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: any) => <div>{children}</div> }));
vi.mock("../CoachGate", () => ({ default: ({ children }: any) => <>{children}</> }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: () => ({ user: { firstName: "Hataf", role: "coach", phoneNumber: "923001234567" }, loading: false }) }));
vi.mock("../../services/api", () => ({ coach: { getTeacher: vi.fn(), getVisit: vi.fn() }, leader: { cancelSchedule: vi.fn() } }));
import { coach } from "../../services/api";
import CoachTeacher from "./CoachTeacher";
import CoachVisit from "./CoachVisit";

/**
 * bd-o15qnr.20 — lesson plan engagement is live on sandbox, so a teacher's
 * card shows "Exams generated" and "Lesson plans opened" (Teacher page and the
 * Visit page's teacher card). A teacher off Rumi shows "—".
 */
const C = coach as any;
const T = { teacherExtId: "923001110001", name: "Ayesha Bibi", phone: "923001110001", schoolName: "IMSG I-10/1", schoolExtId: "niete:110", emis: "110",
  hitl: 3, dc: 7, avgHitl: 61, daysSinceVisit: 22, daysSinceTraining: 12, trainingModules: 4, examsGenerated: 5, lpOpened: 12 };

function at(path: string, route: string, el: React.ReactNode) {
  return render(<MemoryRouter initialEntries={[path]}><Routes><Route path={route} element={el} /></Routes></MemoryRouter>);
}

beforeEach(() => {
  vi.clearAllMocks();
  C.getTeacher.mockResolvedValue({ success: true, teacher: T, history: [], nextVisit: null });
  C.getVisit.mockResolvedValue({ success: true, teacher: T, lastVisit: null,
    visit: { id: "v1", teacherName: "Ayesha Bibi", teacherExtId: "923001110001", schoolName: "IMSG I-10/1", schoolExtId: "niete:110", scheduledFor: "2026-10-07", scheduledSlot: "11:30", status: "upcoming" } });
});

const valueOf = (scope: HTMLElement, label: string) => within(scope).getByText(label).closest("[data-stat]")?.querySelector("b")?.textContent;

describe("Exams generated and Lesson plans opened", () => {
  it("on the Teacher page's stats card", async () => {
    at("/portal/coach/teacher/923001110001", "/portal/coach/teacher/:ext", <CoachTeacher />);
    const card = await screen.findByTestId("teacher-stats");
    expect(valueOf(card, "Exams generated")).toBe("5");
    expect(valueOf(card, "Lesson plans opened")).toBe("12");
  });

  it("on the Visit page's teacher card numbers", async () => {
    at("/portal/coach/visit/v1", "/portal/coach/visit/:id", <CoachVisit />);
    const stats = await screen.findByTestId("visit-stats");
    expect(valueOf(stats, "Exams generated")).toBe("5");
    expect(valueOf(stats, "Lesson plans opened")).toBe("12");
  });

  it("a teacher off Rumi shows a dash for lesson plans", async () => {
    C.getTeacher.mockResolvedValue({ success: true, teacher: { ...T, lpOpened: null, examsGenerated: 0 }, history: [], nextVisit: null });
    at("/portal/coach/teacher/923001110001", "/portal/coach/teacher/:ext", <CoachTeacher />);
    const card = await screen.findByTestId("teacher-stats");
    expect(valueOf(card, "Lesson plans opened")).toBe("—");
  });
});
