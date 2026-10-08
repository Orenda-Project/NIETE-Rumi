import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: any) => <div>{children}</div> }));
vi.mock("../CoachGate", () => ({ default: ({ children }: any) => <>{children}</> }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: () => ({ user: { firstName: "Hataf", role: "coach", phoneNumber: "923001234567" }, loading: false }) }));
// bd-15y1pc: her own observation, WhatsApp too, also asks the pipeline view (leader.getObservation).
vi.mock("../../services/api", () => ({ coach: { getTeacher: vi.fn(), getObservation: vi.fn() }, leader: { getObservation: vi.fn(), getObservationDraft: vi.fn() } }));
import { coach, leader } from "../../services/api";
import CoachTeacher from "./CoachTeacher";
import CoachObservation from "./CoachObservation";

/**
 * bd-o15qnr.10 — a teacher's History opens her HITL reports. Her own portal
 * observation opens its existing page; any other HITL with its report out
 * opens the v2 report; a DC session (and a HITL still on WhatsApp) is
 * information only — no link, no chevron.
 */
const C = coach as any;
const TEACHER = {
  success: true,
  teacher: {
    teacherExtId: "923001110001", name: "Ayesha Bibi", phone: "923001110001", schoolName: "IMSG I-10/1",
    schoolExtId: "niete:110", emis: "110", hitl: 3, dc: 7, avgHitl: 61, daysSinceVisit: 22, daysSinceTraining: 12, trainingModules: 4,
  },
  history: [
    { id: "h-portal", date: "2026-10-05T09:00:00Z", kind: "HITL", score: 66, step: "talk", open: "observe" },
    { id: "h-wa-sent", date: "2026-09-14T09:00:00Z", kind: "HITL", score: 61, step: "sent", open: "report" },
    { id: "h-wa-draft", date: "2026-08-20T09:00:00Z", kind: "HITL", score: null, step: "draft", open: null },
    { id: "h-dc", date: "2026-08-10T09:00:00Z", kind: "DC", score: 55, step: null, open: null },
  ],
  nextVisit: null,
};
const REPORT = {
  success: true,
  id: "h-wa-sent", date: "2026-09-14T09:00:00Z", score: 61, summary: "Clear modelling; more checks for understanding.",
  teacher: { name: "Ayesha Bibi", teacherExtId: "923001110001", schoolName: "IMSG I-10/1" },
  observer: { self: true, name: "Hataf Atif" }, sentAt: "2026-09-14T12:00:00Z",
  imageUrl: "https://signed.example/report.png", caption: null,
};

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/portal/coach/teacher/:ext" element={<CoachTeacher />} />
        <Route path="/portal/coach/observation/:id" element={<CoachObservation />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  C.getTeacher.mockResolvedValue(TEACHER);
  C.getObservation.mockResolvedValue(REPORT);
  // Unreachable view: the page stands on the session row alone, as these tests always read it.
  (leader as any).getObservation.mockRejectedValue(new Error("view unavailable"));
});

describe("Teacher History opens reports", () => {
  // bd-o15qnr.19 — every HITL row opens the one v2 observation page; the
  // report the teacher received opens from its last step there.
  it("tapping a HITL row with its report out opens the observation page, and its report from the last step", async () => {
    C.getObservation.mockResolvedValue({ ...REPORT, step: "sent", portal: false, mine: true, dcScore: 61 });
    renderAt("/portal/coach/teacher/923001110001");
    const history = await screen.findByTestId("history");
    const row = within(history).getByTestId("history-h-wa-sent");
    expect(row.tagName).toBe("A");
    fireEvent.click(row);
    const steps = await screen.findAllByTestId("obs-step");
    expect(C.getObservation).toHaveBeenCalledWith("h-wa-sent");
    fireEvent.click(within(steps[4]).getByRole("button"));
    expect(await screen.findByTestId("observation-report")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /Ayesha/ })).toHaveAttribute("src", "https://signed.example/report.png");
    expect(screen.getByLabelText(/Digital Coach score 61%/)).toBeInTheDocument();
  });

  it("her own portal observation and a HITL still on WhatsApp open the same page", async () => {
    renderAt("/portal/coach/teacher/923001110001");
    const history = await screen.findByTestId("history");
    expect(within(history).getByTestId("history-h-portal")).toHaveAttribute("href", "/portal/coach/observation/h-portal");
    expect(within(history).getByTestId("history-h-wa-draft")).toHaveAttribute("href", "/portal/coach/observation/h-wa-draft");
  });

  it("a DC session is information only: no link", async () => {
    renderAt("/portal/coach/teacher/923001110001");
    const row = within(await screen.findByTestId("history")).getByTestId("history-h-dc");
    expect(row.tagName).not.toBe("A");
    expect(row.querySelector("[data-chevron]")).toBeNull();
  });
});

